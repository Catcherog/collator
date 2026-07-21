import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { FeishuCustomerRecordWriter } from '../../../src/server/business/customer-record-writer.js';
import { FeishuCommitFailedError } from '../../../src/server/domain/errors.js';
import { FeishuApiError } from '../../../src/server/feishu/feishu-errors.js';
import type { FeishuRecord } from '../../../src/server/feishu/feishu-client.js';

interface MockClient {
  createRecord: Mock<
    (
      tableId: string,
      fields: Record<string, unknown>,
      clientToken?: string
    ) => Promise<string>
  >;
  searchRecords: Mock<
    (
      tableId: string,
      opts?: {
        filter?: {
          conditions: Array<{ field_name: string; value: unknown[] }>;
        };
      }
    ) => Promise<FeishuRecord[]>
  >;
}

function createMockClient(): MockClient {
  return {
    createRecord: vi.fn(async (_tableId: string, _fields: Record<string, unknown>) => {
      return 'rec_new_001';
    }),
    searchRecords: vi.fn(async () => []),
  };
}

describe('FeishuCustomerRecordWriter', () => {
  const CUSTOMER_TABLE_ID = 'tblCustomer';
  let client: MockClient;
  let writer: FeishuCustomerRecordWriter;

  beforeEach(() => {
    client = createMockClient();
    writer = new FeishuCustomerRecordWriter(
      client as unknown as import('../../../src/server/feishu/feishu-client.js').FeishuClient,
      { customerTableId: CUSTOMER_TABLE_ID }
    );
  });

  describe('write', () => {
    it('creates a new customer record when none exists', async () => {
      const result = await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          客户姓名: '张三',
          联系方式: '13800138000',
          预算区间: '3000-5000元',
        },
      });

      expect(result.business_record_id).toBe('rec_new_001');
      expect(result.created).toBe(true);
      expect(client.createRecord).toHaveBeenCalledTimes(1);
      const [tableId, fields] = client.createRecord.mock.calls[0];
      expect(tableId).toBe(CUSTOMER_TABLE_ID);
      // Idempotency key set
      expect(fields['Collator 摄入 ID']).toBe('ing_test_001');
      // Whitelisted fields copied
      expect(fields['客户姓名']).toBe('张三');
      expect(fields['联系方式']).toBe('13800138000');
      expect(fields['预算区间']).toBe('3000-5000元');
    });

    it('searches by Collator 摄入 ID before creating', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: { 客户姓名: '张三' },
      });

      const [_tableId, opts] = client.searchRecords.mock.calls[0];
      expect(opts?.filter?.conditions[0].field_name).toBe('Collator 摄入 ID');
      expect(opts?.filter?.conditions[0].value).toEqual(['ing_test_001']);
    });

    it('uses the same UUIDv4 client token for the same ingestion across writer instances', async () => {
      const secondWriter = new FeishuCustomerRecordWriter(
        client as unknown as import('../../../src/server/feishu/feishu-client.js').FeishuClient,
        { customerTableId: CUSTOMER_TABLE_ID }
      );

      await writer.write({
        ingestionId: 'ing_same_operation',
        normalizedFields: { 客户姓名: '张三' },
      });
      await secondWriter.write({
        ingestionId: 'ing_same_operation',
        normalizedFields: { 客户姓名: '张三' },
      });

      const firstToken = client.createRecord.mock.calls[0][2];
      const secondToken = client.createRecord.mock.calls[1][2];
      expect(firstToken).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(secondToken).toBe(firstToken);
    });

    it('returns existing record_id without creating when record already exists (idempotent)', async () => {
      client.searchRecords.mockResolvedValueOnce([
        { record_id: 'rec_existing_001', fields: {} },
      ]);

      const result = await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: { 客户姓名: '张三' },
      });

      expect(result.business_record_id).toBe('rec_existing_001');
      expect(result.created).toBe(false);
      expect(client.createRecord).not.toHaveBeenCalled();
    });

    it('drops unknown fields outside the whitelist', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          客户姓名: '张三',
          unknown_field: 'should be dropped',
          another_unknown: 42,
          // Internal/task-only fields that must never reach the customer table
          idempotency_key: 'abc123',
          raw_candidate: { fields: {} },
        },
      });

      const [_t, fields] = client.createRecord.mock.calls[0];
      expect(fields['客户姓名']).toBe('张三');
      expect(fields['unknown_field']).toBeUndefined();
      expect(fields['another_unknown']).toBeUndefined();
      expect(fields['idempotency_key']).toBeUndefined();
      expect(fields['raw_candidate']).toBeUndefined();
    });

    it('converts 咨询时间 ISO datetime to epoch milliseconds', async () => {
      const iso = '2026-07-15T10:00:00.000Z';
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          客户姓名: '张三',
          咨询时间: iso,
        },
      });

      const [_t, fields] = client.createRecord.mock.calls[0];
      expect(fields['咨询时间']).toBe(new Date(iso).getTime());
      expect(typeof fields['咨询时间']).toBe('number');
    });

    it('passes through malformed datetime string when Date.parse returns NaN', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          咨询时间: 'not-a-date',
        },
      });

      const [_t, fields] = client.createRecord.mock.calls[0];
      // Pass-through so Feishu rejects it and surfaces as FEISHU_COMMIT_FAILED,
      // rather than silently dropping the field.
      expect(fields['咨询时间']).toBe('not-a-date');
    });

    it('does not mutate the input normalizedFields object', async () => {
      const input = {
        客户姓名: '张三',
        咨询时间: '2026-07-15T10:00:00.000Z',
        unknown_field: 'dropped',
      };
      const inputCopy = JSON.parse(JSON.stringify(input));

      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: input,
      });

      expect(input).toEqual(inputCopy);
    });

    it('wraps FeishuApiError from searchRecords as FeishuCommitFailedError', async () => {
      const feishuApiError = new FeishuApiError(1254045, 'record not found msg with phone 13800138000');
      client.searchRecords.mockRejectedValueOnce(feishuApiError);

      await expect(
        writer.write({
          ingestionId: 'ing_test_001',
          normalizedFields: { 客户姓名: '张三' },
        })
      ).rejects.toMatchObject({
        code: 'FEISHU_COMMIT_FAILED',
        statusCode: 502,
      });
    });

    it('wraps FeishuApiError from createRecord as FeishuCommitFailedError', async () => {
      client.searchRecords.mockResolvedValueOnce([]);
      const feishuApiError = new FeishuApiError(1254045, 'permission denied with phone 13800138000');
      client.createRecord.mockRejectedValueOnce(feishuApiError);

      await expect(
        writer.write({
          ingestionId: 'ing_test_001',
          normalizedFields: { 客户姓名: '张三' },
        })
      ).rejects.toMatchObject({
        code: 'FEISHU_COMMIT_FAILED',
        statusCode: 502,
      });
    });

    it('sanitises phone numbers in FeishuApiError messages before surfacing', async () => {
      client.searchRecords.mockResolvedValueOnce([]);
      const feishuApiError = new FeishuApiError(1254045, 'error涉及手机号13800138000');
      client.createRecord.mockRejectedValueOnce(feishuApiError);

      try {
        await writer.write({
          ingestionId: 'ing_test_001',
          normalizedFields: { 客户姓名: '张三' },
        });
        throw new Error('expected rejection');
      } catch (e) {
        expect(e).toBeInstanceOf(FeishuCommitFailedError);
        const msg = (e as Error).message;
        // FeishuApiError.redactPhone already masked the phone
        expect(msg).not.toContain('13800138000');
        expect(msg).toContain('138****8000');
      }
    });

    it('wraps unknown errors without leaking internal stack traces', async () => {
      client.searchRecords.mockResolvedValueOnce([]);
      const internalError = new Error('Internal path /usr/local/secret with phone 13900139000');
      client.createRecord.mockRejectedValueOnce(internalError);

      try {
        await writer.write({
          ingestionId: 'ing_test_001',
          normalizedFields: { 客户姓名: '张三' },
        });
        throw new Error('expected rejection');
      } catch (e) {
        expect(e).toBeInstanceOf(FeishuCommitFailedError);
        const msg = (e as Error).message;
        // Unknown errors are reduced to their `name` only — no message,
        // no stack, no paths, no PII.
        expect(msg).not.toContain('/usr/local/secret');
        expect(msg).not.toContain('13900139000');
        expect(msg).toContain('Error');
      }
    });

    it('does not write app_secret into any field of the create payload', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          客户姓名: '张三',
          // Simulate attacker attempting to inject the secret via corrections
          app_secret: 'SECRET_VALUE_THAT_MUST_NOT_LEAK',
          FEISHU_APP_SECRET: 'SECRET_VALUE_THAT_MUST_NOT_LEAK',
        },
      });

      const [_t, fields] = client.createRecord.mock.calls[0];
      const serialized = JSON.stringify(fields);
      expect(serialized).not.toContain('SECRET_VALUE_THAT_MUST_NOT_LEAK');
    });

    it('writes the Gate D synthetic record shape correctly', async () => {
      // Synthetic record from TASK-003 Gate D spec.
      await writer.write({
        ingestionId: 'ing_gated_001',
        normalizedFields: {
          客户姓名: 'GateD测试客户',
          联系方式: '13800000000',
          来源渠道: '其他',
          拍摄类型: '亲子',
          预算区间: '1000-2000元',
          意向风格: '日系清新',
          跟进记录: 'COLLATOR_GATE_D_TEST:abc-123',
        },
      });

      const [_t, fields] = client.createRecord.mock.calls[0];
      expect(fields['Collator 摄入 ID']).toBe('ing_gated_001');
      expect(fields['客户姓名']).toBe('GateD测试客户');
      expect(fields['联系方式']).toBe('13800000000');
      expect(fields['来源渠道']).toBe('其他');
      expect(fields['拍摄类型']).toBe('亲子');
      expect(fields['预算区间']).toBe('1000-2000元');
      // 意向风格 is a Feishu MultiSelect (type=4); strings are wrapped
      // in a single-element array to avoid MultiSelectFieldConvFail.
      expect(fields['意向风格']).toEqual(['日系清新']);
      expect(fields['跟进记录']).toBe('COLLATOR_GATE_D_TEST:abc-123');
    });

    it('wraps bare string 意向风格 into a single-element array (MultiSelect field)', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          客户姓名: '张三',
          意向风格: '日系清新',
        },
      });

      const [_t, fields] = client.createRecord.mock.calls[0];
      expect(fields['意向风格']).toEqual(['日系清新']);
      expect(Array.isArray(fields['意向风格'])).toBe(true);
    });

    it('passes through array 意向风格 unchanged (already MultiSelect-compatible)', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          客户姓名: '张三',
          意向风格: ['日系清新', '复古风'],
        },
      });

      const [_t, fields] = client.createRecord.mock.calls[0];
      expect(fields['意向风格']).toEqual(['日系清新', '复古风']);
    });

    it('does not mutate the input when wrapping MultiSelect strings', async () => {
      const input = {
        客户姓名: '张三',
        意向风格: '日系清新',
      };
      const inputCopy = JSON.parse(JSON.stringify(input));

      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: input,
      });

      // Input remains a string; only the Feishu payload is wrapped.
      expect(input).toEqual(inputCopy);
      expect(typeof input.意向风格).toBe('string');
    });

    it('skips null and undefined values in normalizedFields', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          客户姓名: '张三',
          联系方式: null,
          来源渠道: undefined,
          预算区间: '3000-5000元',
        },
      });

      const [_t, fields] = client.createRecord.mock.calls[0];
      expect(fields['客户姓名']).toBe('张三');
      expect(fields['联系方式']).toBeUndefined();
      expect(fields['来源渠道']).toBeUndefined();
      expect(fields['预算区间']).toBe('3000-5000元');
    });
  });
});
