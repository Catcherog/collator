import { describe, it, expect, beforeEach } from 'vitest';
import { FeishuTaskRepository } from '../../src/server/repositories/feishu-task-repository.js';
import type { IngestionTask } from '../../src/server/domain/ingestion.js';
import type { FeishuClient, FeishuRecord, SearchFilter } from '../../src/server/feishu/feishu-client.js';

/**
 * In-process fake of FeishuClient used for integration tests.
 *
 * Simulates the parts of the real Feishu Base API that FeishuTaskRepository
 * depends on (create/update/get/delete/search). Records are stored in a Map
 * keyed by record_id; multiple FeishuTaskRepository instances backed by the
 * same FakeFeishuClient share state, which lets us verify cross-instance reads
 * (acceptance: "保存后可由新的 Repository 实例完整读取，字段深度等价").
 *
 * Field shapes returned mirror what real Feishu Base returns:
 * - text/long-text fields: plain string
 * - datetime fields: number (ms since epoch)
 * - single-select fields: { text: 'received' } (NOT a bare string)
 *
 * This way we exercise the repository's tolerance for real Feishu response
 * shapes, not just the shapes our own createRecord writes.
 *
 * Note: we deliberately do NOT `implements FeishuClient` because that would
 * require implementing private members of the class. FeishuTaskRepository
 * only depends on the five public methods we expose here; we cast at the
 * construction site.
 */
class FakeFeishuClient {
  private records = new Map<string, FeishuRecord>();
  private counter = 0;

  async createRecord(_tableId: string, fields: Record<string, unknown>): Promise<string> {
    this.counter += 1;
    const id = `rec${this.counter}`;
    this.records.set(id, { record_id: id, fields: { ...fields } });
    return id;
  }

  async getRecord(_tableId: string, recordId: string): Promise<FeishuRecord> {
    const r = this.records.get(recordId);
    if (!r) throw new Error(`record not found: ${recordId}`);
    return this.toReadShape(r);
  }

  async updateRecord(
    _tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ): Promise<FeishuRecord> {
    const r = this.records.get(recordId);
    if (!r) throw new Error(`record not found: ${recordId}`);
    r.fields = { ...r.fields, ...fields };
    return this.toReadShape(r);
  }

  async deleteRecord(_tableId: string, recordId: string): Promise<void> {
    this.records.delete(recordId);
  }

  async searchRecords(
    _tableId: string,
    opts: { filter?: SearchFilter; page_size?: number } = {}
  ): Promise<FeishuRecord[]> {
    const cond = opts.filter?.conditions?.[0];
    let results = Array.from(this.records.values());
    if (cond) {
      results = results.filter((r) => {
        const v = r.fields[cond.field_name];
        const actual = typeof v === 'object' && v !== null && 'text' in v
          ? (v as { text: string }).text
          : v;
        return actual === cond.value[0];
      });
    }
    return results.map((r) => this.toReadShape(r));
  }

  private toReadShape(r: FeishuRecord): FeishuRecord {
    return {
      record_id: r.record_id,
      fields: { ...r.fields },
    };
  }

  /** Test-only helper to inspect internal state. */
  size(): number {
    return this.records.size;
  }
}

/**
 * Convenience: wrap the fake in a FeishuClient-typed reference so the
 * repository constructor accepts it.
 */
function asClient(fake: FakeFeishuClient): FeishuClient {
  return fake as unknown as FeishuClient;
}

function makeTask(overrides: Partial<IngestionTask> = {}): IngestionTask {
  return {
    ingestion_id: 'ing_int_001',
    idempotency_key: 'idem_int_abc',
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

describe('FeishuTaskRepository integration (FakeFeishuClient)', () => {
  const TABLE_ID = 'tblIngestionFake';
  let client: FakeFeishuClient;

  beforeEach(() => {
    client = new FakeFeishuClient();
  });

  it('task saved by one repository instance is fully readable by a fresh instance', async () => {
    const task = makeTask({
      candidate: {
        schema_name: 'customer',
        schema_version: '1.0.0',
        prompt_version: '1.0.0',
        fields: { budget: '3000-5000元' },
        field_confidence: { budget: 0.95 },
        evidence: { budget: '预算3000元左右' },
      },
      normalized_fields: { budget: '3000-5000元', shooting_date: '2026-08-01' },
      warnings: [{ field: 'phone', code: 'MISSING', message: 'no phone' }],
      duplicate_candidates: [{ id: 'dup1', score: 0.88 }],
    });

    const writer = new FeishuTaskRepository(asClient(client), { ingestionTableId: TABLE_ID });
    await writer.save(task);

    // Brand new repository instance — no in-memory cache, must hit the
    // fake Base and reconstruct the task from the JSON snapshot.
    const reader = new FeishuTaskRepository(asClient(client), { ingestionTableId: TABLE_ID });
    const fetched = await reader.findById(task.ingestion_id);

    expect(fetched).not.toBeNull();
    // Deep equality is the TASK-001 acceptance criterion.
    expect(fetched).toEqual(task);
  });

  it('findByIdempotencyKey on a fresh instance returns the same task', async () => {
    const task = makeTask();
    const writer = new FeishuTaskRepository(asClient(client), { ingestionTableId: TABLE_ID });
    await writer.save(task);

    const reader = new FeishuTaskRepository(asClient(client), { ingestionTableId: TABLE_ID });
    const fetched = await reader.findByIdempotencyKey(task.idempotency_key);
    expect(fetched).toEqual(task);
  });

  it('save twice (update) on the same ingestion_id keeps exactly one record', async () => {
    const task = makeTask();
    const repo = new FeishuTaskRepository(asClient(client), { ingestionTableId: TABLE_ID });
    await repo.save(task);
    await repo.save({ ...task, status: 'pending_review', updated_at: '2026-07-17T11:00:00.000Z' });

    expect(client.size()).toBe(1);
    const fetched = await repo.findById(task.ingestion_id);
    expect(fetched?.status).toBe('pending_review');
    expect(fetched?.updated_at).toBe('2026-07-17T11:00:00.000Z');
  });

  it('20 distinct ingestion_ids round-trip through a fresh reader instance', async () => {
    const writer = new FeishuTaskRepository(asClient(client), { ingestionTableId: TABLE_ID });
    const tasks: IngestionTask[] = [];
    for (let i = 0; i < 20; i++) {
      const t = makeTask({
        ingestion_id: `ing_int_${String(i).padStart(3, '0')}`,
        idempotency_key: `idem_int_${i}`,
        content: `request ${i}`,
      });
      tasks.push(t);
      await writer.save(t);
    }
    expect(client.size()).toBe(20);

    const reader = new FeishuTaskRepository(asClient(client), { ingestionTableId: TABLE_ID });
    for (const t of tasks) {
      const fetched = await reader.findById(t.ingestion_id);
      expect(fetched).toEqual(t);
    }
  });

  it('findById returns null for unknown ingestion_id on a fresh instance', async () => {
    const reader = new FeishuTaskRepository(asClient(client), { ingestionTableId: TABLE_ID });
    const fetched = await reader.findById('ing_does_not_exist');
    expect(fetched).toBeNull();
  });

  it('findByIdempotencyKey returns null for unknown key on a fresh instance', async () => {
    const reader = new FeishuTaskRepository(asClient(client), { ingestionTableId: TABLE_ID });
    const fetched = await reader.findByIdempotencyKey('idem_unknown');
    expect(fetched).toBeNull();
  });
});
