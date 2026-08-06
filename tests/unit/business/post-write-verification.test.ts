import { describe, expect, it, vi } from 'vitest';
import { TransactionalBatchWriter } from '../../../src/server/business/transactional-batch-writer.js';
import { assertExpectedFields, PostWriteVerificationError } from '../../../src/server/business/post-write-verification.js';

function projectWriter(options: { verifyFails?: boolean } = {}) {
  return {
    write: vi.fn(async () => ({ business_record_id: 'rec_project_pilot', created: true })),
    verifyRecord: vi.fn(async () => {
      if (options.verifyFails) throw new Error('mismatch');
    }),
    deleteRecord: vi.fn(async () => undefined),
  };
}

describe('TransactionalBatchWriter - production-pilot post-write verification', () => {
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

describe('post-write field normalization', () => {
  it('accepts Feishu link read-back items that use record_ids', () => {
    expect(() => assertExpectedFields(
      {
        '关联客户 ID': [{
          record_ids: ['rec_customer_001'],
          table_id: 'tbl_customer',
          text: '脱敏客户',
          text_arr: ['脱敏客户'],
          type: 'url',
        }],
      },
      { '关联客户 ID': ['rec_customer_001'] },
    )).not.toThrow();
  });

  // AC-01: Real Feishu {id, text, table_id, type} read-back format matches ["recXXX"]
  it('accepts real Feishu relation read-back with {id, text, table_id, type}', () => {
    expect(() => assertExpectedFields(
      {
        '关联客户 ID': [{
          id: 'rec_customer_001',
          text: '脱敏客户',
          table_id: 'tbl_customer',
          type: 'url',
        }],
      },
      { '关联客户 ID': ['rec_customer_001'] },
    )).not.toThrow();
  });

  // AC-02: Different Record ID must fail verification
  it('rejects when the actual relation id differs from expected', () => {
    expect(() => assertExpectedFields(
      {
        '关联客户 ID': [{
          id: 'rec_customer_999',
          text: '另一个客户',
          table_id: 'tbl_customer',
          type: 'url',
        }],
      },
      { '关联客户 ID': ['rec_customer_001'] },
    )).toThrow(PostWriteVerificationError);
  });

  // AC-03: Multiple relation records in different order still compare correctly
  it('compares multiple relation records order-independently', () => {
    expect(() => assertExpectedFields(
      {
        '关联客户 ID': [
          { id: 'recB', text: 'B', table_id: 'tbl', type: 'url' },
          { id: 'recA', text: 'A', table_id: 'tbl', type: 'url' },
        ],
      },
      { '关联客户 ID': ['recA', 'recB'] },
    )).not.toThrow();
  });

  // AC-03 (reverse): expected in different order vs actual
  it('compares multiple relation records order-independently (reverse)', () => {
    expect(() => assertExpectedFields(
      {
        '关联客户 ID': [
          { id: 'recA', text: 'A', table_id: 'tbl', type: 'url' },
          { id: 'recB', text: 'B', table_id: 'tbl', type: 'url' },
        ],
      },
      { '关联客户 ID': ['recB', 'recA'] },
    )).not.toThrow();
  });

  // AC-04 (legacy): record_id old structure continues to pass
  it('accepts legacy record_id read-back format', () => {
    expect(() => assertExpectedFields(
      {
        '关联客户 ID': [{
          record_id: 'rec_customer_001',
          text: '脱敏客户',
        }],
      },
      { '关联客户 ID': ['rec_customer_001'] },
    )).not.toThrow();
  });

  // AC-05 (legacy): record_ids old structure continues to pass
  it('accepts legacy record_ids read-back format', () => {
    expect(() => assertExpectedFields(
      {
        '关联客户 ID': [{
          record_ids: ['rec_customer_001', 'rec_customer_002'],
          table_id: 'tbl_customer',
          text: '脱敏客户',
          type: 'url',
        }],
      },
      { '关联客户 ID': ['rec_customer_001', 'rec_customer_002'] },
    )).not.toThrow();
  });

  // AC-06: Empty arrays are handled normally
  it('handles empty arrays without error', () => {
    expect(() => assertExpectedFields(
      { '关联客户 ID': [] },
      { '关联客户 ID': [] },
    )).not.toThrow();
  });

  // AC-07: Ordinary business objects with id must not be treated as relation records
  it('does not treat ordinary business objects with id as relation records', () => {
    const businessObject = { id: 'internal_id', name: '测试项目', status: 'active' };
    expect(() => assertExpectedFields(
      { '项目详情': businessObject },
      { '项目详情': { id: 'internal_id', name: '测试项目', status: 'active' } },
    )).not.toThrow();

    // Different ordinary objects with id should fail if content differs
    expect(() => assertExpectedFields(
      { '项目详情': { id: 'id_A', name: 'A' } },
      { '项目详情': { id: 'id_B', name: 'B' } },
    )).toThrow(PostWriteVerificationError);
  });

  // Error carries field_name diagnostic
  it('PostWriteVerificationError carries fieldName on mismatch', () => {
    try {
      assertExpectedFields(
        { '关联客户 ID': [{ id: 'rec_wrong', text: 'X', table_id: 'tbl', type: 'url' }] },
        { '关联客户 ID': ['rec_correct'] },
      );
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PostWriteVerificationError);
      const err = e as PostWriteVerificationError;
      expect(err.fieldName).toBe('关联客户 ID');
      expect(err.reason).toBe('normalized_values_do_not_match');
      expect(err.verificationStage).toBe('field_comparison');
    }
  });
});
