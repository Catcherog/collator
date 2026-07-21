import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryWriteLogRepository } from '../../../src/server/repositories/in-memory-write-log-repository.js';
import type { NewWriteLogRecord } from '../../../src/server/repositories/write-log-repository.js';

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

describe('InMemoryWriteLogRepository', () => {
  let repo: InMemoryWriteLogRepository;

  beforeEach(() => {
    repo = new InMemoryWriteLogRepository();
  });

  it('create assigns an opaque non-empty write_log_id', async () => {
    const created = await repo.create(makeNewRecord());
    expect(typeof created.write_log_id).toBe('string');
    expect(created.write_log_id.length).toBeGreaterThan(0);
  });

  it('finds a log by ingestion_id after create', async () => {
    const created = await repo.create(makeNewRecord());
    const found = await repo.findByIngestionId(created.ingestion_id);
    expect(found).toHaveLength(1);
    expect(found[0].write_log_id).toBe(created.write_log_id);
  });

  it('returns an empty array when no log exists', async () => {
    const found = await repo.findByIngestionId('ing_unknown');
    expect(found).toEqual([]);
  });

  it('is idempotent on (ingestion_id, target_table_id) tuple', async () => {
    const record = makeNewRecord();
    const first = await repo.create(record);
    const second = await repo.create(record);

    expect(first.write_log_id).toBe(second.write_log_id);
    expect(repo.size()).toBe(1);
  });

  it('creates a new log entry when a prior log for the same tuple is failed (retry-after-commit_failed audit trail)', async () => {
    // First attempt fails.
    const failed = await repo.create(
      makeNewRecord({
        status: 'failed',
        business_record_id: undefined,
        error_code: 'FEISHU_COMMIT_FAILED',
        redacted_error_message: 'transient',
      })
    );
    // Retry succeeds — same (ingestion_id, target_table_id) tuple.
    const succeeded = await repo.create(
      makeNewRecord({ status: 'succeeded', business_record_id: 'rec_after_retry' })
    );

    expect(failed.status).toBe('failed');
    expect(succeeded.status).toBe('succeeded');
    expect(failed.write_log_id).not.toBe(succeeded.write_log_id);
    expect(repo.size()).toBe(2);

    const logs = await repo.findByIngestionId('ing_test_001');
    const statuses = logs.map((l) => l.status).sort();
    expect(statuses).toEqual(['failed', 'succeeded']);
  });

  it('is idempotent for skipped_dry_run logs only on terminal succeeded replay', async () => {
    // A skipped_dry_run log does not short-circuit a later succeeded log
    // for the same tuple (uncommon in practice because approve blocks on
    // completed, but the contract is: only `succeeded` is terminal).
    await repo.create(makeNewRecord({ status: 'skipped_dry_run', business_record_id: undefined }));
    await repo.create(makeNewRecord({ status: 'succeeded' }));

    expect(repo.size()).toBe(2);
  });

  it('treats logs with same ingestion_id but different target_table_id as distinct', async () => {
    const r1 = makeNewRecord({ target_table_id: 'tblCustomer' });
    const r2 = makeNewRecord({ target_table_id: 'tblOther' });
    await repo.create(r1);
    await repo.create(r2);

    expect(repo.size()).toBe(2);
    const found = await repo.findByIngestionId('ing_test_001');
    expect(found).toHaveLength(2);
    const targets = found.map((r) => r.target_table_id).sort();
    expect(targets).toEqual(['tblCustomer', 'tblOther']);
  });

  it('save updates an existing record without creating a duplicate', async () => {
    const created = await repo.create(makeNewRecord({ status: 'pending' }));
    const updated = {
      ...created,
      status: 'succeeded' as const,
      business_record_id: 'rec_after_retry',
    };
    await repo.save(updated);

    expect(repo.size()).toBe(1);
    const found = await repo.findByIngestionId(created.ingestion_id);
    expect(found[0].status).toBe('succeeded');
    expect(found[0].business_record_id).toBe('rec_after_retry');
  });

  it('defensively deep-copies stored records so callers cannot mutate state', async () => {
    const created = await repo.create(makeNewRecord());
    created.business_record_id = 'mutated';
    created.redacted_error_message = 'mutated';

    const found = await repo.findByIngestionId(created.ingestion_id);
    expect(found[0].business_record_id).toBe('rec_customer_001');
    expect(found[0].redacted_error_message).toBeUndefined();
  });

  it('defensively deep-copies input so subsequent caller mutations do not leak', async () => {
    const record = makeNewRecord();
    await repo.create(record);
    record.business_record_id = 'leaked';

    const found = await repo.findByIngestionId(record.ingestion_id);
    expect(found[0].business_record_id).toBe('rec_customer_001');
  });

  it('clear() empties the repository', async () => {
    await repo.create(makeNewRecord());
    expect(repo.size()).toBe(1);
    repo.clear();
    expect(repo.size()).toBe(0);
    const found = await repo.findByIngestionId('ing_test_001');
    expect(found).toEqual([]);
  });
});
