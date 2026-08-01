import { describe, expect, it, vi } from 'vitest';
import { TransactionalBatchWriter } from '../../../src/server/business/transactional-batch-writer.js';

function projectWriter(options: { verifyFails?: boolean } = {}) {
  return {
    write: vi.fn(async () => ({ business_record_id: 'rec_project_pilot', created: true })),
    verifyRecord: vi.fn(async () => {
      if (options.verifyFails) throw new Error('mismatch');
    }),
    deleteRecord: vi.fn(async () => undefined),
  };
}

describe('TransactionalBatchWriter — production-pilot post-write verification', () => {
  it('reads back a newly created record when verification is enabled', async () => {
    const writer = projectWriter();
    const batchWriter = new TransactionalBatchWriter(undefined, writer as never, undefined);

    const result = await batchWriter.writeBatch({
      ingestionId: 'ing_pilot_verify_001',
      normalizedFields: { 项目名称: '脱敏项目' },
      targetTables: ['project'],
      verifyAfterWrite: true,
    });

    expect(result.status).toBe('committed');
    expect(writer.verifyRecord).toHaveBeenCalledWith(
      'rec_project_pilot',
      expect.objectContaining({ ingestionId: 'ing_pilot_verify_001' }),
    );
  });

  it('compensates the exact newly created record when read-back verification fails', async () => {
    const writer = projectWriter({ verifyFails: true });
    const batchWriter = new TransactionalBatchWriter(undefined, writer as never, undefined);

    const result = await batchWriter.writeBatch({
      ingestionId: 'ing_pilot_verify_002',
      normalizedFields: { 项目名称: '脱敏项目' },
      targetTables: ['project'],
      verifyAfterWrite: true,
    });

    expect(result.status).not.toBe('committed');
    expect(result.error_code).toBe('POST_WRITE_VERIFY_FAILED');
    expect(writer.deleteRecord).toHaveBeenCalledWith('rec_project_pilot');
  });

  it('fails closed when a pilot target has no configured writer', async () => {
    const batchWriter = new TransactionalBatchWriter();

    const result = await batchWriter.writeBatch({
      ingestionId: 'ing_pilot_missing_writer_001',
      normalizedFields: { 客户姓名: '脱敏客户' },
      targetTables: ['customer'],
      verifyAfterWrite: true,
    });

    expect(result.status).not.toBe('committed');
    expect(result.error_code).toBe('WRITER_NOT_CONFIGURED');
    expect(result.write_results[0].status).toBe('failed');
  });
});
