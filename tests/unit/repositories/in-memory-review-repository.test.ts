import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryReviewRepository } from '../../../src/server/repositories/in-memory-review-repository.js';
import type { NewReviewRecord } from '../../../src/server/repositories/review-repository.js';
import type { CandidateRecord } from '../../../src/server/domain/ingestion.js';

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
    validation: { errors: [], warnings: [] },
    updated_at: '2026-07-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('InMemoryReviewRepository', () => {
  let repo: InMemoryReviewRepository;

  beforeEach(() => {
    repo = new InMemoryReviewRepository();
  });

  it('create returns a record with an opaque non-empty review_record_id', async () => {
    const created = await repo.create(makeNewRecord());
    expect(typeof created.review_record_id).toBe('string');
    expect(created.review_record_id.length).toBeGreaterThan(0);
    // Must not follow the legacy rec_review_ prefix contract.
    expect(created.review_record_id.startsWith('rec_review_')).toBe(false);
  });

  it('finds a review by ingestion_id after create', async () => {
    const created = await repo.create(makeNewRecord());
    const found = await repo.findByIngestionId(created.ingestion_id);
    expect(found).not.toBeNull();
    expect(found?.review_record_id).toBe(created.review_record_id);
  });

  it('returns null when no review exists for an ingestion_id', async () => {
    const found = await repo.findByIngestionId('ing_unknown');
    expect(found).toBeNull();
  });

  it('save updates an existing record without creating a duplicate', async () => {
    const created = await repo.create(makeNewRecord());
    const updated: typeof created = {
      ...created,
      status: 'approved',
      reviewer_id: 'reviewer_1',
      review_decision: 'approved',
      updated_at: '2026-07-15T11:00:00.000Z',
    };
    await repo.save(updated);

    const found = await repo.findByIngestionId(created.ingestion_id);
    expect(found?.status).toBe('approved');
    expect(found?.reviewer_id).toBe('reviewer_1');
    // Still only one record — no duplicate IDs.
    expect(found?.review_record_id).toBe(created.review_record_id);
  });

  it('defensively deep-copies stored records so callers cannot mutate state', async () => {
    const record = makeNewRecord();
    const created = await repo.create(record);

    // Mutate the returned record.
    created.normalized_fields['客户姓名'] = 'mutated';
    (created.candidate.fields as Record<string, unknown>)['客户姓名'] = 'mutated';

    // The stored record must be unaffected.
    const found = await repo.findByIngestionId(created.ingestion_id);
    expect(found?.normalized_fields['客户姓名']).toBe('张三');
    expect((found?.candidate.fields as Record<string, unknown>)['客户姓名']).toBe('张三');
  });

  it('defensively deep-copies input so subsequent caller mutations do not leak', async () => {
    const record = makeNewRecord();
    await repo.create(record);

    // Mutate the original input after create.
    record.normalized_fields['客户姓名'] = 'leaked';
    record.candidate.fields['客户姓名'] = 'leaked';

    const found = await repo.findByIngestionId(record.ingestion_id);
    expect(found?.normalized_fields['客户姓名']).toBe('张三');
    expect((found?.candidate.fields as Record<string, unknown>)['客户姓名']).toBe('张三');
  });
});
