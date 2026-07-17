import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { FeishuReviewRepository } from '../../../src/server/repositories/feishu-review-repository.js';
import type { NewReviewRecord } from '../../../src/server/repositories/review-repository.js';
import type { CandidateRecord } from '../../../src/server/domain/ingestion.js';
import type { FeishuRecord } from '../../../src/server/feishu/feishu-client.js';

function makeCandidate(): CandidateRecord {
  return {
    schema_name: 'customer',
    schema_version: '1.0.0',
    prompt_version: '1.0.0',
    fields: { 客户姓名: '张三' },
    field_confidence: { 客户姓名: 0.95 },
    evidence: { 客户姓名: '咨询中提到姓名' },
  };
}

function makeNewRecord(overrides: Partial<NewReviewRecord> = {}): NewReviewRecord {
  return {
    ingestion_id: 'ing_test_001',
    status: 'pending_review',
    candidate: makeCandidate(),
    normalized_fields: { 客户姓名: '张三' },
    validation: { errors: [], warnings: [], pipelineVersion: '2c.1.0' },
    updated_at: '2026-07-15T10:00:00.000Z',
    ...overrides,
  };
}

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

describe('FeishuReviewRepository', () => {
  const REVIEW_TABLE_ID = 'tblReview';
  let client: MockClient;
  let repo: FeishuReviewRepository;

  beforeEach(() => {
    client = createMockClient();
    repo = new FeishuReviewRepository(
      client as unknown as import('../../../src/server/feishu/feishu-client.js').FeishuClient,
      { reviewTableId: REVIEW_TABLE_ID }
    );
  });

  describe('create', () => {
    it('creates a review and uses Feishu record_id as review_record_id', async () => {
      const record = makeNewRecord();
      const created = await repo.create(record);

      expect(client.createRecord).toHaveBeenCalledTimes(1);
      const [tableId, fields] = client.createRecord.mock.calls[0];
      expect(tableId).toBe(REVIEW_TABLE_ID);
      // Indexed field
      expect(fields['摄入 ID']).toBe(record.ingestion_id);
      expect(fields['状态']).toBe(record.status);
      // JSON evidence fields
      expect(typeof fields['候选 JSON']).toBe('string');
      expect(JSON.parse(fields['候选 JSON'] as string)).toEqual(record.candidate);
      expect(typeof fields['标准化结果 JSON']).toBe('string');
      expect(JSON.parse(fields['标准化结果 JSON'] as string)).toEqual(record.normalized_fields);
      expect(typeof fields['校验结果 JSON']).toBe('string');
      expect(JSON.parse(fields['校验结果 JSON'] as string)).toEqual(record.validation);
      // Datetime field
      expect(fields['更新时间']).toBe(new Date(record.updated_at).getTime());

      // The returned record_id must be the one FeishuClient returned.
      expect(created.review_record_id).toBe(`rec_1`);
      expect(created.ingestion_id).toBe(record.ingestion_id);
      expect(created.candidate).toEqual(record.candidate);
    });

    it('returns the existing record when create is called twice for same ingestion', async () => {
      const record = makeNewRecord();
      const first = await repo.create(record);
      const second = await repo.create(record);

      expect(first.review_record_id).toBe(second.review_record_id);
      // No duplicate create call: createRecord was only invoked once.
      expect(client.createRecord).toHaveBeenCalledTimes(1);
    });
  });

  describe('findByIngestionId', () => {
    it('searches by 摄入 ID and reconstructs JSON fields', async () => {
      const record = makeNewRecord();
      await repo.create(record);

      const found = await repo.findByIngestionId(record.ingestion_id);
      expect(found).not.toBeNull();
      expect(found?.review_record_id).toBe('rec_1');
      expect(found?.ingestion_id).toBe(record.ingestion_id);
      expect(found?.candidate).toEqual(record.candidate);
      expect(found?.normalized_fields).toEqual(record.normalized_fields);
      expect(found?.validation).toEqual(record.validation);
    });

    it('calls searchRecords with a filter on 摄入 ID', async () => {
      await repo.findByIngestionId('ing_missing');
      const [_tableId, opts] = client.searchRecords.mock.calls[0];
      const cond = opts!.filter!.conditions[0];
      expect(cond.field_name).toBe('摄入 ID');
      expect(cond.value).toEqual(['ing_missing']);
    });

    it('returns null when no review exists', async () => {
      const found = await repo.findByIngestionId('ing_missing');
      expect(found).toBeNull();
    });
  });

  describe('save', () => {
    it('updates an existing record without creating a second record', async () => {
      const record = makeNewRecord();
      const created = await repo.create(record);

      const updated = {
        ...created,
        status: 'approved' as const,
        reviewer_id: 'reviewer_1',
        review_decision: 'approved' as const,
        corrections: { 客户姓名: '李四' },
        updated_at: '2026-07-15T11:00:00.000Z',
      };
      await repo.save(updated);

      expect(client.updateRecord).toHaveBeenCalledTimes(1);
      expect(client.createRecord).toHaveBeenCalledTimes(1); // No second create
      const [tableId, recordId, fields] = client.updateRecord.mock.calls[0];
      expect(tableId).toBe(REVIEW_TABLE_ID);
      expect(recordId).toBe(created.review_record_id);
      expect(fields['状态']).toBe('approved');
      expect(fields['审核人']).toBe('reviewer_1');
      expect(fields['审核决定']).toBe('approved');
      expect(JSON.parse(fields['人工修正 JSON'] as string)).toEqual({ 客户姓名: '李四' });
    });

    it('writes datetime as epoch milliseconds', async () => {
      const record = makeNewRecord({ updated_at: '2026-07-15T10:00:00.000Z' });
      await repo.create(record);

      const [_t, _r, fields] = [REVIEW_TABLE_ID, '', {}] as unknown as [string, string, Record<string, unknown>];
      // The create call already wrote 更新时间; verify it's a numeric epoch.
      const createFields = client.createRecord.mock.calls[0][1];
      expect(typeof createFields['更新时间']).toBe('number');
      expect(createFields['更新时间']).toBe(new Date('2026-07-15T10:00:00.000Z').getTime());
      // Avoid unused-var lint
      expect(_t).toBe(REVIEW_TABLE_ID);
      expect(fields).toEqual({});
    });
  });

  describe('malformed JSON handling', () => {
    it('throws a descriptive error for malformed JSON without exposing raw candidate content', async () => {
      // Inject a record directly into the mock with a malformed 候选 JSON.
      const recordId = 'rec_corrupt';
      const rawCandidateText = 'LEAKED_RAW_CANDIDATE_CONTENT_WITH_PHONE_13800000000';
      client.__records.set(recordId, {
        record_id: recordId,
        fields: {
          '摄入 ID': 'ing_corrupt',
          '状态': 'pending_review',
          '候选 JSON': '{ not valid json',
          '标准化结果 JSON': '{}',
          '校验结果 JSON': '{}',
          '更新时间': 1234567890000,
          // Intentionally include the raw leaky string somewhere it shouldn't appear:
          '__leaked_marker': rawCandidateText,
        },
      });

      // Force findByIngestionId to find our corrupt record by stubbing search.
      client.searchRecords.mockImplementationOnce(async () => [
        client.__records.get(recordId)!,
      ]);

      let caught: unknown;
      try {
        await repo.findByIngestionId('ing_corrupt');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      // Mentions the field name and the record id.
      expect(msg).toContain('候选 JSON');
      expect(msg).toContain(recordId);
      // Does NOT expose the raw leaky candidate content.
      expect(msg).not.toContain(rawCandidateText);
      expect(msg).not.toContain('13800000000');
    });
  });
});
