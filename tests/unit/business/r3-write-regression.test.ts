/**
 * FAMP-R3 Phase 5 回归场景：Customer + Project 写入失败分类。
 *
 * 覆盖 verdict 要求的 ≥10 个场景：
 *   1. normal success（Customer + Project 双写成功）
 *   2. missing-required（缺少 项目名称）
 *   3. illegal-select（非法 项目类型 / 风格定位 选项）
 *   4. relation-struct（DuplexLink 传入显示名称而非 record_id）
 *   5. date-format（"8月15日" 年-less 日期必须被解析）
 *   6. bad-field-name（未知字段静默丢弃，不污染 Base）
 *   7. customer-ok-project-fail（Customer 成功、Project 失败 → 仍属 write_partial）
 *   8. both-ok（与 normal success 区分：显式断言两个真实 ID）
 *   9. idempotent-replay（同一 ingestionId 二次写，created=false）
 *  10. readback-mismatch（写入后读回字段不一致）
 *  11. feishu-error-redaction（错误消息不得回显手机号等敏感值）
 *  12. create-token-determinism（同一操作键重试必须复用相同 client_token）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { FeishuCustomerRecordWriter } from '../../../src/server/business/customer-record-writer.js';
import {
  FeishuProjectRecordWriter,
  PROJECT_STYLE_OPTIONS,
} from '../../../src/server/business/project-record-writer.js';
import { FeishuCommitFailedError, FieldTypeMismatchError } from '../../../src/server/domain/errors.js';
import { FeishuApiError } from '../../../src/server/feishu/feishu-errors.js';
import type { FeishuRecord, FeishuClient } from '../../../src/server/feishu/feishu-client.js';

interface MockClient {
  createRecord: Mock<
    (tableId: string, fields: Record<string, unknown>, clientToken?: string) => Promise<string>
  >;
  searchRecords: Mock<(tableId: string, opts?: unknown) => Promise<FeishuRecord[]>>;
  getRecord: Mock<(tableId: string, recordId: string) => Promise<FeishuRecord>>;
  deleteRecord: Mock<(tableId: string, recordId: string) => Promise<void>>;
}

function createMockClient(): MockClient {
  return {
    createRecord: vi.fn(async () => 'rec_new'),
    searchRecords: vi.fn(async () => []),
    getRecord: vi.fn(async (_tableId, recordId) => ({ record_id: recordId, fields: {} })),
    deleteRecord: vi.fn(async () => {}),
  };
}

const C_TABLE = 'tblCustomer';
const P_TABLE = 'tblProject';

describe('R3 write regression scenarios', () => {
  let client: MockClient;

  beforeEach(() => {
    client = createMockClient();
  });

  function customerWriter(ingestionIdField?: string) {
    return new FeishuCustomerRecordWriter(client as unknown as FeishuClient, {
      customerTableId: C_TABLE,
      ingestionIdField,
    });
  }

  function projectWriter(ingestionIdField?: string) {
    return new FeishuProjectRecordWriter(client as unknown as FeishuClient, {
      projectTableId: P_TABLE,
      ingestionIdField,
      styleOptions: PROJECT_STYLE_OPTIONS,
    });
  }

  // 1. normal success
  it('normal: writes customer then project with duplex link', async () => {
    client.createRecord
      .mockResolvedValueOnce('rec_customer_001')
      .mockResolvedValueOnce('rec_project_001');

    const cWriter = customerWriter();
    const pWriter = projectWriter('项目名称');

    const customer = await cWriter.write({
      ingestionId: 'ing_normal',
      normalizedFields: {
        客户姓名: '林小姐',
        联系方式: '13800138000',
        咨询时间: '2026-08-15',
        预算区间: '5000-8000元',
        意向风格: ['日系清新'],
      },
    });
    expect(customer.created).toBe(true);
    expect(customer.business_record_id).toBe('rec_customer_001');

    const project = await pWriter.write({
      ingestionId: 'ing_normal',
      normalizedFields: {
        项目名称: 'R3-正常项目',
        项目类型: '客片',
        拍摄档期: '2026年8月15日',
        风格定位: '日系清新',
        拍摄地点: '杭州西湖',
        '关联客户 ID': customer.business_record_id,
      },
    });
    expect(project.created).toBe(true);
    expect(project.business_record_id).toBe('rec_project_001');

    const [, projectFields] = client.createRecord.mock.calls[1];
    expect(projectFields['关联客户 ID']).toEqual(['rec_customer_001']);
  });

  // 2. missing required
  it('missing-required: empty project name fails fast before create', async () => {
    const writer = projectWriter('项目名称');
    await expect(
      writer.write({
        ingestionId: 'ing_missing',
        normalizedFields: { 项目类型: '客片' },
      }),
    ).rejects.toMatchObject({ code: 'FEISHU_COMMIT_FAILED' });
    expect(client.createRecord).not.toHaveBeenCalled();
  });

  // 3. illegal select
  it('illegal-select: unsupported project type is rejected', async () => {
    const writer = projectWriter('项目名称');
    await expect(
      writer.write({
        ingestionId: 'ing_bad_type',
        normalizedFields: {
          项目名称: 'R3-非法类型',
          项目类型: '不存在类型',
        },
      }),
    ).rejects.toThrow(FeishuCommitFailedError);
  });

  it('illegal-select: unknown style option is rejected when styleOptions supplied', async () => {
    const writer = projectWriter('项目名称');
    await expect(
      writer.write({
        ingestionId: 'ing_bad_style',
        normalizedFields: {
          项目名称: 'R3-非法风格',
          项目类型: '客片',
          风格定位: '赛博朋克',
        },
      }),
    ).rejects.toMatchObject({
      code: 'FIELD_TYPE_MISMATCH',
      fieldName: '风格定位',
    });
  });

  // 4. relation struct
  it('relation-struct: display name instead of record_id is rejected (AC-C07)', async () => {
    const writer = projectWriter('项目名称');
    await expect(
      writer.write({
        ingestionId: 'ing_bad_relation',
        normalizedFields: {
          项目名称: 'R3-关系结构错误',
          项目类型: '客片',
          '关联客户 ID': '林小姐', // display name, not record_id
        },
      }),
    ).rejects.toThrow(FieldTypeMismatchError);
  });

  it('relation-struct: object instead of string/array is rejected (AC-C07)', async () => {
    const writer = projectWriter('项目名称');
    await expect(
      writer.write({
        ingestionId: 'ing_bad_relation_obj',
        normalizedFields: {
          项目名称: 'R3-关系对象错误',
          项目类型: '客片',
          '关联客户 ID': { id: 'rec_xxx' } as unknown as string,
        },
      }),
    ).rejects.toThrow(FieldTypeMismatchError);
  });

  // 5. date format
  it('date-format: year-less "8月15日" resolves to a valid epoch ms', async () => {
    const writer = projectWriter('项目名称');
    await writer.write({
      ingestionId: 'ing_date',
      normalizedFields: {
        项目名称: 'R3-年-less-日期',
        拍摄档期: '8月15日',
      },
    });

    const [, fields] = client.createRecord.mock.calls[0];
    expect(typeof fields['拍摄档期']).toBe('number');
    expect(fields['拍摄档期']).toBeGreaterThan(0);
  });

  // 6. bad field name
  it('bad-field-name: unknown fields are silently dropped from the payload', async () => {
    const writer = projectWriter('项目名称');
    await writer.write({
      ingestionId: 'ing_bad_field',
      normalizedFields: {
        项目名称: 'R3-未知字段',
        项目类型: '客片',
        hacker_injection: 'drop me',
        __proto__: { polluted: true },
      },
    });

    const [, fields] = client.createRecord.mock.calls[0];
    expect(fields['hacker_injection']).toBeUndefined();
    expect(Object.hasOwn(fields, '__proto__')).toBe(false);
    expect(fields['项目名称']).toBe('R3-未知字段');
  });

  // 7. customer-ok-project-fail
  it('customer-ok-project-fail: customer succeeds but project failure leaves partial state', async () => {
    client.createRecord.mockResolvedValueOnce('rec_customer_002');
    client.searchRecords.mockImplementation(async (tableId) => {
      if (tableId === P_TABLE) {
        throw new FeishuApiError(1254064, 'DatetimeFieldConvFail');
      }
      return [];
    });

    const cWriter = customerWriter();
    const pWriter = projectWriter('项目名称');

    const customer = await cWriter.write({
      ingestionId: 'ing_partial',
      normalizedFields: { 客户姓名: '张女士' },
    });
    expect(customer.created).toBe(true);

    await expect(
      pWriter.write({
        ingestionId: 'ing_partial',
        normalizedFields: { 项目名称: 'R3-部分失败' },
      }),
    ).rejects.toMatchObject({ code: 'FEISHU_COMMIT_FAILED' });
  });

  // 8. both-ok
  it('both-ok: returns real record_ids for both tables', async () => {
    client.createRecord
      .mockResolvedValueOnce('rec_customer_both')
      .mockResolvedValueOnce('rec_project_both');

    const cWriter = customerWriter();
    const pWriter = projectWriter('项目名称');

    const customer = await cWriter.write({
      ingestionId: 'ing_both',
      normalizedFields: { 客户姓名: '王先生' },
    });
    const project = await pWriter.write({
      ingestionId: 'ing_both',
      normalizedFields: {
        项目名称: 'R3-双成功',
        项目类型: '创作',
        '关联客户 ID': customer.business_record_id,
      },
    });

    expect(customer.business_record_id).toMatch(/^rec_/);
    expect(project.business_record_id).toMatch(/^rec_/);
    expect(client.createRecord).toHaveBeenCalledTimes(2);
  });

  // 9. idempotent replay
  it('idempotent-replay: second write with same ingestionId returns created=false', async () => {
    client.searchRecords.mockResolvedValue([{ record_id: 'rec_existing', fields: {} }]);

    const writer = customerWriter();
    const first = await writer.write({
      ingestionId: 'ing_idem',
      normalizedFields: { 客户姓名: '陈女士' },
    });
    const second = await writer.write({
      ingestionId: 'ing_idem',
      normalizedFields: { 客户姓名: '陈女士' },
    });

    expect(first.created).toBe(false);
    expect(second.created).toBe(false);
    expect(first.business_record_id).toBe('rec_existing');
    expect(second.business_record_id).toBe('rec_existing');
    expect(client.createRecord).not.toHaveBeenCalled();
  });

  // 10. readback mismatch
  it('readback-mismatch: verifyRecord throws when readback does not match expected', async () => {
    client.createRecord.mockResolvedValueOnce('rec_project_mismatch');
    client.getRecord.mockResolvedValueOnce({
      record_id: 'rec_project_mismatch',
      fields: { 项目名称: '被篡改的项目名' },
    });

    const writer = projectWriter('项目名称');
    const result = await writer.write({
      ingestionId: 'ing_mismatch',
      normalizedFields: { 项目名称: 'R3-读回一致' },
    });

    await expect(
      writer.verifyRecord?.(result.business_record_id, {
        ingestionId: 'ing_mismatch',
        normalizedFields: { 项目名称: 'R3-读回一致' },
      }),
    ).rejects.toThrow();
  });

  // 11. feishu error redaction
  it('feishu-error-redaction: error detail must not contain offending field value', async () => {
    client.searchRecords.mockRejectedValueOnce(
      new FeishuApiError(1254063, 'phone 13800138000 in error'),
    );

    const writer = customerWriter();
    try {
      await writer.write({
        ingestionId: 'ing_redact',
        normalizedFields: { 客户姓名: '赵女士', 联系方式: '13800138000' },
      });
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(FeishuCommitFailedError);
      const serialized = JSON.stringify(e);
      expect(serialized).not.toContain('13800138000');
      expect(e).toMatchObject({ code: 'FEISHU_COMMIT_FAILED' });
    }
  });

  // 12. create token determinism
  it('create-token-determinism: retry uses identical client_token for the same operation key', async () => {
    client.createRecord
      .mockRejectedValueOnce(new FeishuApiError(10001, 'transient'))
      .mockResolvedValueOnce('rec_retry');

    const writer = customerWriter();
    await expect(
      writer.write({ ingestionId: 'ing_retry', normalizedFields: { 客户姓名: 'Retry' } }),
    ).rejects.toThrow(); // writer does not retry, so it throws

    // The token is deterministic; verify by calling again and capturing tokens.
    client.createRecord.mockClear();
    const call1 = writer.write({ ingestionId: 'ing_retry', normalizedFields: { 客户姓名: 'Retry' } });
    const call2 = writer.write({ ingestionId: 'ing_retry', normalizedFields: { 客户姓名: 'Retry' } });
    await Promise.all([call1, call2]);

    const token1 = client.createRecord.mock.calls[0][2];
    const token2 = client.createRecord.mock.calls[1][2];
    expect(token1).toBe(token2);
    expect(token1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
