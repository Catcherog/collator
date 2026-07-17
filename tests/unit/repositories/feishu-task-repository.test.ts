import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { FeishuTaskRepository } from '../../../src/server/repositories/feishu-task-repository.js';
import type { IngestionTask } from '../../../src/server/domain/ingestion.js';
import type { FeishuRecord } from '../../../src/server/feishu/feishu-client.js';

// Construct a representative IngestionTask that exercises all field kinds
// (optional fields, nested objects, arrays).
function makeTask(overrides: Partial<IngestionTask> = {}): IngestionTask {
  return {
    ingestion_id: 'ing_test_001',
    idempotency_key: 'idem_key_abc',
    status: 'received',
    source_system: 'feishu_form',
    source_record_id: 'rec_source_001',
    source_type: 'chat_text',
    target_domain: 'customer_consultation',
    content: '你好，预算3000左右',
    submitted_at: '2026-07-17T10:00:00.000Z',
    timezone: 'Asia/Shanghai',
    submitted_by: 'operator_1',
    dry_run: true,
    attempt_count: 0,
    warnings: [],
    errors: [],
    duplicate_candidates: [],
    created_at: '2026-07-17T10:00:01.000Z',
    updated_at: '2026-07-17T10:00:01.000Z',
    ...overrides,
  };
}

// Minimal mock client. Methods are vi.fn so each test can configure returns
// and inspect calls. We expose the Mock instances directly (rather than
// typing the object as `FeishuClient`) so TypeScript keeps `.mock` accessible.
interface MockClient {
  createRecord: Mock<
    (tableId: string, fields: Record<string, unknown>) => Promise<string>
  >;
  updateRecord: Mock<
    (tableId: string, recordId: string, fields: Record<string, unknown>) => Promise<FeishuRecord>
  >;
  getRecord: Mock<(tableId: string, recordId: string) => Promise<FeishuRecord>>;
  deleteRecord: Mock<(tableId: string, recordId: string) => Promise<void>>;
  searchRecords: Mock<
    (
      tableId: string,
      opts?: { filter?: { conditions: Array<{ field_name: string; value: unknown[] }> } }
    ) => Promise<FeishuRecord[]>
  >;
  __records: Map<string, FeishuRecord>;
}

function createMockClient(): MockClient {
  const records = new Map<string, FeishuRecord>();

  const mock: MockClient = {
    createRecord: vi.fn(async (_tableId: string, fields: Record<string, unknown>) => {
      const id = `rec_${records.size + 1}`;
      records.set(id, { record_id: id, fields });
      return id;
    }),
    updateRecord: vi.fn(async (_tableId: string, recordId: string, fields: Record<string, unknown>) => {
      const existing = records.get(recordId);
      if (!existing) throw new Error(`record not found: ${recordId}`);
      existing.fields = { ...existing.fields, ...fields };
      return existing;
    }),
    getRecord: vi.fn(async (_tableId: string, recordId: string) => {
      const r = records.get(recordId);
      if (!r) throw new Error(`record not found: ${recordId}`);
      return r;
    }),
    deleteRecord: vi.fn(async () => {}),
    searchRecords: vi.fn(async (
      _tableId: string,
      opts: { filter?: { conditions: Array<{ field_name: string; value: unknown[] }> } } = {}
    ) => {
      const cond = opts.filter?.conditions?.[0];
      if (!cond) return Array.from(records.values());
      const fieldName = cond.field_name;
      const wanted = cond.value[0];
      return Array.from(records.values()).filter((r) => {
        const v = r.fields[fieldName];
        // Tolerate both plain string and { text: '...' } shapes
        const actual = typeof v === 'object' && v !== null && 'text' in v
          ? (v as { text: string }).text
          : v;
        return actual === wanted;
      });
    }),
    __records: records,
  };

  return mock;
}

describe('FeishuTaskRepository', () => {
  const INGESTION_TABLE_ID = 'tblIngestion';
  let client: MockClient;
  let repo: FeishuTaskRepository;

  beforeEach(() => {
    client = createMockClient();
    // Cast to FeishuClient-shaped parameter: FeishuTaskRepository only uses
    // the five methods we mock.
    repo = new FeishuTaskRepository(client as unknown as import('../../../src/server/feishu/feishu-client.js').FeishuClient, {
      ingestionTableId: INGESTION_TABLE_ID,
    });
  });

  describe('save (create)', () => {
    it('creates a new record with mapped fields when ingestion_id is new', async () => {
      const task = makeTask();
      await repo.save(task);

      expect(client.createRecord).toHaveBeenCalledTimes(1);
      const [tableId, fields] = client.createRecord.mock.calls[0];
      expect(tableId).toBe(INGESTION_TABLE_ID);
      // Primary / indexed columns
      expect(fields['摄入 ID']).toBe(task.ingestion_id);
      expect(fields['幂等键']).toBe(task.idempotency_key);
      expect(fields['状态']).toBe(task.status);
      expect(fields['来源记录 ID']).toBe(task.source_record_id);
      // Snapshot column must contain the full task as JSON
      const snapshot = fields['任务快照 JSON'] as string;
      expect(typeof snapshot).toBe('string');
      expect(JSON.parse(snapshot)).toEqual(task);
      // Datetime columns present (any value, not undefined)
      expect(fields['创建时间']).toBeDefined();
      expect(fields['更新时间']).toBeDefined();
    });

    it('updates an existing record when ingestion_id already present', async () => {
      const task = makeTask();
      await repo.save(task); // creates

      const updated: IngestionTask = {
        ...task,
        status: 'pending_review',
        updated_at: '2026-07-17T11:00:00.000Z',
        review_record_id: 'rec_review_xyz',
      };
      await repo.save(updated); // should update, not create

      expect(client.createRecord).toHaveBeenCalledTimes(1);
      expect(client.updateRecord).toHaveBeenCalledTimes(1);
      const [tableId, recordId, fields] = client.updateRecord.mock.calls[0];
      expect(tableId).toBe(INGESTION_TABLE_ID);
      expect(recordId).toBe(`rec_${client.__records.size}`); // first created record id
      const snapshot = fields['任务快照 JSON'] as string;
      expect(JSON.parse(snapshot)).toEqual(updated);
      expect(fields['状态']).toBe('pending_review');
    });
  });

  describe('findById', () => {
    it('returns the task parsed from 任务快照 JSON when found', async () => {
      const task = makeTask();
      await repo.save(task);

      const fetched = await repo.findById(task.ingestion_id);

      expect(fetched).not.toBeNull();
      expect(fetched).toEqual(task);
    });

    it('calls searchRecords with a filter on 摄入 ID', async () => {
      await repo.findById('ing_missing');
      expect(client.searchRecords).toHaveBeenCalledTimes(1);
      const [_tableId, opts] = client.searchRecords.mock.calls[0];
      const cond = opts!.filter!.conditions[0];
      expect(cond.field_name).toBe('摄入 ID');
      expect(cond.value).toEqual(['ing_missing']);
    });

    it('returns null when not found', async () => {
      const fetched = await repo.findById('ing_does_not_exist');
      expect(fetched).toBeNull();
    });

    it('preserves nested objects and arrays through round-trip', async () => {
      const task = makeTask({
        candidate: {
          schema_name: 'customer',
          schema_version: '1.0.0',
          prompt_version: '1.0.0',
          fields: { budget: '3000-5000元', shooting_date: '2026-08-01' },
          field_confidence: { budget: 0.95 },
          evidence: { budget: '预算3000元左右' },
        },
        warnings: [{ field: 'phone', code: 'MISSING', message: 'no phone' }],
        duplicate_candidates: [{ id: 'dup1', score: 0.88 }],
        normalized_fields: { budget: '3000-5000元' },
      });
      await repo.save(task);

      const fetched = await repo.findById(task.ingestion_id);
      expect(fetched).toEqual(task);
    });
  });

  describe('findByIdempotencyKey', () => {
    it('returns the task when found by 幂等键', async () => {
      const task = makeTask();
      await repo.save(task);

      const fetched = await repo.findByIdempotencyKey(task.idempotency_key);
      expect(fetched).toEqual(task);
    });

    it('calls searchRecords with a filter on 幂等键', async () => {
      await repo.findByIdempotencyKey('idem_missing');
      const [_tableId, opts] = client.searchRecords.mock.calls[0];
      const cond = opts!.filter!.conditions[0];
      expect(cond.field_name).toBe('幂等键');
      expect(cond.value).toEqual(['idem_missing']);
    });

    it('returns null when not found', async () => {
      const fetched = await repo.findByIdempotencyKey('idem_missing');
      expect(fetched).toBeNull();
    });
  });
});
