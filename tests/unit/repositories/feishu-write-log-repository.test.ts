import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { FeishuWriteLogRepository } from '../../../src/server/repositories/feishu-write-log-repository.js';
import type { NewWriteLogRecord } from '../../../src/server/repositories/write-log-repository.js';
import type { FeishuRecord } from '../../../src/server/feishu/feishu-client.js';

function makeNewRecord(overrides: Partial<NewWriteLogRecord> = {}): NewWriteLogRecord {
  return {
    ingestion_id: 'ing_test_001',
    target_table_id: 'tblCustomer',
    status: 'succeeded',
    business_record_id: 'rec_customer_001',
    created_at: '2026-07-18T10:00:00.000Z',
    ...overrides,
  };
}

interface MockClient {
  createRecord: Mock<
    (
      tableId: string,
      fields: Record<string, unknown>,
      clientToken?: string
    ) => Promise<string>
  >;
  updateRecord: Mock<
    (tableId: string, recordId: string, fields: Record<string, unknown>) => Promise<FeishuRecord>
  >;
  searchRecords: Mock<
    (
      tableId: string,
      opts?: {
        filter?: {
          conjunction?: 'and' | 'or';
          conditions: Array<{ field_name: string; operator?: string; value: unknown[] }>;
        };
        page_size?: number;
      }
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
    searchRecords: vi.fn(async (
      _tableId: string,
      opts: {
        filter?: {
          conditions: Array<{ field_name: string; value: unknown[] }>;
        };
      } = {}
    ) => {
      const cond = opts.filter?.conditions?.[0];
      if (!cond) return Array.from(records.values());
      const fieldName = cond.field_name;
      const wanted = cond.value[0];
      return Array.from(records.values()).filter((r) => {
        const v = r.fields[fieldName];
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

describe('FeishuWriteLogRepository', () => {
  const WRITE_LOG_TABLE_ID = 'tblWriteLog';
  let client: MockClient;
  let repo: FeishuWriteLogRepository;

  beforeEach(() => {
    client = createMockClient();
    repo = new FeishuWriteLogRepository(
      client as unknown as import('../../../src/server/feishu/feishu-client.js').FeishuClient,
      { writeLogTableId: WRITE_LOG_TABLE_ID }
    );
  });

  describe('create', () => {
    it('persists a succeeded log with the required + business_record_id fields', async () => {
      const record = makeNewRecord();
      const created = await repo.create(record);

      expect(client.createRecord).toHaveBeenCalledTimes(1);
      const [tableId, fields] = client.createRecord.mock.calls[0];
      expect(tableId).toBe(WRITE_LOG_TABLE_ID);
      expect(fields['摄入 ID']).toBe(record.ingestion_id);
      expect(fields['目标表 ID']).toBe(record.target_table_id);
      expect(fields['写入状态']).toBe('succeeded');
      expect(fields['业务记录 ID']).toBe('rec_customer_001');
      // Datetime stored as epoch milliseconds.
      expect(fields['创建时间']).toBe(new Date(record.created_at).getTime());
      expect(typeof fields['创建时间']).toBe('number');
      // Optional error fields NOT written when undefined.
      expect(fields['错误码']).toBeUndefined();
      expect(fields['脱敏错误消息']).toBeUndefined();

      // The returned write_log_id is the real Feishu record_id.
      expect(created.write_log_id).toBe('rec_1');
      expect(created.ingestion_id).toBe(record.ingestion_id);
      expect(created.target_table_id).toBe(record.target_table_id);
      expect(created.status).toBe('succeeded');
      expect(created.business_record_id).toBe('rec_customer_001');
    });

    it('uses a stable UUIDv4 client token for succeeded logs only', async () => {
      await repo.create(makeNewRecord());
      const succeededToken = client.createRecord.mock.calls[0][2];
      expect(succeededToken).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );

      await repo.create(
        makeNewRecord({
          ingestion_id: 'ing_failed_attempt',
          status: 'failed',
          business_record_id: undefined,
          error_code: 'FEISHU_COMMIT_FAILED',
        })
      );
      expect(client.createRecord.mock.calls[1][2]).toBeUndefined();
    });

    it('persists a failed log with error_code and redacted_error_message', async () => {
      const record = makeNewRecord({
        status: 'failed',
        business_record_id: undefined,
        error_code: 'FEISHU_COMMIT_FAILED',
        redacted_error_message: 'Feishu API error (code=1254045): masked 138****8000',
      });
      const created = await repo.create(record);

      const [, fields] = client.createRecord.mock.calls[0];
      expect(fields['写入状态']).toBe('failed');
      expect(fields['错误码']).toBe('FEISHU_COMMIT_FAILED');
      expect(fields['脱敏错误消息']).toBe('Feishu API error (code=1254045): masked 138****8000');
      // No business record id on failed path.
      expect(fields['业务记录 ID']).toBeUndefined();
      expect(created.business_record_id).toBeUndefined();
    });

    it('persists a skipped_dry_run log with only required fields', async () => {
      const record = makeNewRecord({
        target_table_id: 'dry_run',
        status: 'skipped_dry_run',
        business_record_id: undefined,
      });
      await repo.create(record);

      const [, fields] = client.createRecord.mock.calls[0];
      expect(fields['写入状态']).toBe('skipped_dry_run');
      expect(fields['目标表 ID']).toBe('dry_run');
      expect(fields['业务记录 ID']).toBeUndefined();
      expect(fields['错误码']).toBeUndefined();
      expect(fields['脱敏错误消息']).toBeUndefined();
    });

    it('is idempotent on (ingestion_id, target_table_id) tuple: returns existing record without creating a second log', async () => {
      const record = makeNewRecord();
      const first = await repo.create(record);
      const second = await repo.create(record);

      expect(first.write_log_id).toBe(second.write_log_id);
      // Only one create call — second invocation searched and reused.
      expect(client.createRecord).toHaveBeenCalledTimes(1);
    });

    it('treats logs with same ingestion_id but different target_table_id as distinct', async () => {
      const r1 = makeNewRecord({ target_table_id: 'tblCustomer' });
      const r2 = makeNewRecord({ target_table_id: 'tblOther' });
      const first = await repo.create(r1);
      const second = await repo.create(r2);

      expect(first.write_log_id).not.toBe(second.write_log_id);
      expect(client.createRecord).toHaveBeenCalledTimes(2);
    });

    it('calls searchRecords with a filter on 摄入 ID before creating', async () => {
      await repo.create(makeNewRecord());

      const [tableId, opts] = client.searchRecords.mock.calls[0];
      expect(tableId).toBe(WRITE_LOG_TABLE_ID);
      const cond = opts!.filter!.conditions[0];
      expect(cond.field_name).toBe('摄入 ID');
      expect(cond.value).toEqual(['ing_test_001']);
    });
  });

  describe('findByIngestionId', () => {
    it('returns logs records previously created, reconstructing all fields', async () => {
      const record = makeNewRecord();
      await repo.create(record);

      const found = await repo.findByIngestionId(record.ingestion_id);
      expect(found).toHaveLength(1);
      expect(found[0].ingestion_id).toBe(record.ingestion_id);
      expect(found[0].target_table_id).toBe(record.target_table_id);
      expect(found[0].status).toBe('succeeded');
      expect(found[0].business_record_id).toBe('rec_customer_001');
      expect(found[0].created_at).toBe(record.created_at);
    });

    it('returns an empty array when no log exists', async () => {
      const found = await repo.findByIngestionId('ing_missing');
      expect(found).toEqual([]);
    });

    it('reconstructs datetime from epoch ms back to ISO 8601', async () => {
      await repo.create(makeNewRecord({ created_at: '2026-07-18T10:00:00.000Z' }));

      const found = await repo.findByIngestionId('ing_test_001');
      // Round-trip preserves the ISO timestamp.
      expect(found[0].created_at).toBe('2026-07-18T10:00:00.000Z');
    });

    it('handles Feishu text-field response shape ({text: "..."}) for required fields', async () => {
      // Inject a record directly into the mock with Feishu's text-object shape.
      client.__records.set('rec_text_shape', {
        record_id: 'rec_text_shape',
        fields: {
          '摄入 ID': { text: 'ing_text_001' },
          '目标表 ID': { text: 'tblCustomer' },
          '写入状态': [{ name: 'succeeded' }],
          '业务记录 ID': { text: 'rec_customer_text' },
          '错误码': { text: 'FEISHU_COMMIT_FAILED' },
          '脱敏错误消息': { text: 'sanitised message' },
          '创建时间': new Date('2026-07-18T10:00:00.000Z').getTime(),
        },
      });
      client.searchRecords.mockResolvedValueOnce([client.__records.get('rec_text_shape')!]);

      const found = await repo.findByIngestionId('ing_text_001');
      expect(found).toHaveLength(1);
      expect(found[0].ingestion_id).toBe('ing_text_001');
      expect(found[0].target_table_id).toBe('tblCustomer');
      expect(found[0].status).toBe('succeeded');
      expect(found[0].business_record_id).toBe('rec_customer_text');
      expect(found[0].error_code).toBe('FEISHU_COMMIT_FAILED');
      expect(found[0].redacted_error_message).toBe('sanitised message');
    });

    it('throws a descriptive error mentioning field name and record_id for missing required field', async () => {
      // Inject a record missing the 摄入 ID field.
      const recordId = 'rec_corrupt';
      const rawSensitive = 'SENSITIVE_LEAK_13800138000';
      client.__records.set(recordId, {
        record_id: recordId,
        fields: {
          // 摄入 ID intentionally missing
          '目标表 ID': 'tblCustomer',
          '写入状态': 'succeeded',
          '脱敏错误消息': rawSensitive,
          '创建时间': 1234567890000,
        },
      });
      client.searchRecords.mockResolvedValueOnce([client.__records.get(recordId)!]);

      let caught: unknown;
      try {
        await repo.findByIngestionId('ing_corrupt');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      // Mentions the field name and the record id — supports diagnosis.
      expect(msg).toContain('摄入 ID');
      expect(msg).toContain(recordId);
    });
  });

  describe('save', () => {
    it('updates an existing log record via updateRecord', async () => {
      const created = await repo.create(makeNewRecord({ status: 'pending' }));

      const updated = {
        ...created,
        status: 'succeeded' as const,
        business_record_id: 'rec_after_retry',
      };
      await repo.save(updated);

      expect(client.updateRecord).toHaveBeenCalledTimes(1);
      const [tableId, recordId, fields] = client.updateRecord.mock.calls[0];
      expect(tableId).toBe(WRITE_LOG_TABLE_ID);
      expect(recordId).toBe(created.write_log_id);
      expect(fields['写入状态']).toBe('succeeded');
      expect(fields['业务记录 ID']).toBe('rec_after_retry');
    });

    it('writes the write_log_id field on save (so the row keeps its idempotency key)', async () => {
      const created = await repo.create(makeNewRecord());
      await repo.save(created);

      const [, , fields] = client.updateRecord.mock.calls[0];
      expect(fields['写入日志 ID']).toBe(created.write_log_id);
    });
  });
});
