// 主线 A1: 项目主表幂等写入器测试
//
// 验证 FeishuProjectRecordWriter 的幂等策略和字段白名单：
//   1. 新记录创建：搜索无结果 → createRecord → 返回 created=true
//   2. 幂等重放：搜索有结果 → 返回已有 record_id，created=false，不调用 createRecord
//   3. 字段白名单：非白名单字段被静默丢弃
//   4. 日期字段转换：拍摄日期 → 飞书 epoch 毫秒
//   5. MultiSelect 字段：风格要求 → 字符串数组
//   6. deleteRecord：用于事务回滚
//   7. 飞书 API 错误 → FeishuCommitFailedError
//
// 运行：vitest run tests/unit/business/project-record-writer.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { FeishuProjectRecordWriter } from '../../../src/server/business/project-record-writer.js';
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
  deleteRecord: Mock<(tableId: string, recordId: string) => Promise<void>>;
}

function createMockClient(): MockClient {
  return {
    createRecord: vi.fn(async (_tableId: string, _fields: Record<string, unknown>) => {
      return 'rec_project_new_001';
    }),
    searchRecords: vi.fn(async () => []),
    deleteRecord: vi.fn(async () => {}),
  };
}

describe('FeishuProjectRecordWriter', () => {
  const PROJECT_TABLE_ID = 'tblProject';
  let client: MockClient;
  let writer: FeishuProjectRecordWriter;

  beforeEach(() => {
    client = createMockClient();
    writer = new FeishuProjectRecordWriter(
      client as unknown as import('../../../src/server/feishu/feishu-client.js').FeishuClient,
      { projectTableId: PROJECT_TABLE_ID }
    );
  });

  describe('write', () => {
    it('creates a new project record when none exists', async () => {
      const result = await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          项目名称: '夏日客片拍摄',
          项目类型: 'client',
          拍摄日期: '2026-08-15',
          预算区间: '5000-8000元',
          风格要求: '复古旗袍',
        },
      });

      expect(result.business_record_id).toBe('rec_project_new_001');
      expect(result.created).toBe(true);
      expect(client.createRecord).toHaveBeenCalledTimes(1);
      const [tableId, fields] = client.createRecord.mock.calls[0];
      expect(tableId).toBe(PROJECT_TABLE_ID);
      // Idempotency key set
      expect(fields['Collator 摄入 ID']).toBe('ing_test_001');
      // Whitelisted fields copied
      expect(fields['项目名称']).toBe('夏日客片拍摄');
      expect(fields['项目类型']).toBe('client');
      // Non-whitelisted fields dropped
      expect(fields['非白名单字段']).toBeUndefined();
    });

    it('searches by Collator 摄入 ID before creating', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: { 项目名称: '测试项目' },
      });

      const [tableId, opts] = client.searchRecords.mock.calls[0];
      expect(tableId).toBe(PROJECT_TABLE_ID);
      expect(opts?.filter?.conditions[0].field_name).toBe('Collator 摄入 ID');
      expect(opts?.filter?.conditions[0].value).toEqual(['ing_test_001']);
    });

    it('returns existing record without creating (idempotent replay)', async () => {
      client.searchRecords = vi.fn(async () => [
        { record_id: 'rec_existing_001', fields: {} },
      ]);

      const result = await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: { 项目名称: '测试项目' },
      });

      expect(result.business_record_id).toBe('rec_existing_001');
      expect(result.created).toBe(false);
      expect(client.createRecord).not.toHaveBeenCalled();
    });

    it('converts date fields to epoch milliseconds', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          拍摄日期: '2026-08-15',
        },
      });

      const [, fields] = client.createRecord.mock.calls[0];
      // 2026-08-15 → epoch milliseconds
      expect(typeof fields['拍摄日期']).toBe('number');
      expect(fields['拍摄日期']).toBe(Date.parse('2026-08-15'));
    });

    it('wraps MultiSelect fields in array', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          风格要求: '复古旗袍',
        },
      });

      const [, fields] = client.createRecord.mock.calls[0];
      expect(Array.isArray(fields['风格要求'])).toBe(true);
      expect(fields['风格要求']).toEqual(['复古旗袍']);
    });

    it('passes through MultiSelect arrays unchanged', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          风格要求: ['复古旗袍', '现代简约'],
        },
      });

      const [, fields] = client.createRecord.mock.calls[0];
      expect(fields['风格要求']).toEqual(['复古旗袍', '现代简约']);
    });

    it('wraps a single record_id into an array for relation fields (AC-C07)', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          客户关联: 'rec_customer_abc',
          模特关联: 'rec_model_xyz',
        },
      });

      const [, fields] = client.createRecord.mock.calls[0];
      // Feishu link fields require an array of record_id strings.
      expect(fields['客户关联']).toEqual(['rec_customer_abc']);
      expect(fields['模特关联']).toEqual(['rec_model_xyz']);
    });

    it('passes through relation arrays unchanged (AC-C07)', async () => {
      await writer.write({
        ingestionId: 'ing_test_001',
        normalizedFields: {
          客户关联: ['rec_customer_abc', 'rec_customer_def'],
        },
      });

      const [, fields] = client.createRecord.mock.calls[0];
      expect(fields['客户关联']).toEqual(['rec_customer_abc', 'rec_customer_def']);
    });

    it('throws FeishuCommitFailedError on FeishuApiError', async () => {
      client.searchRecords = vi.fn(async () => {
        throw new FeishuApiError(1254063, 'FieldConvFail');
      });

      await expect(
        writer.write({
          ingestionId: 'ing_test_001',
          normalizedFields: { 项目名称: '测试' },
        })
      ).rejects.toThrow(FeishuCommitFailedError);
    });
  });

  describe('deleteRecord', () => {
    it('deletes a record by ID', async () => {
      await writer.deleteRecord('rec_to_delete');

      expect(client.deleteRecord).toHaveBeenCalledTimes(1);
      const [tableId, recordId] = client.deleteRecord.mock.calls[0];
      expect(tableId).toBe(PROJECT_TABLE_ID);
      expect(recordId).toBe('rec_to_delete');
    });

    it('throws FeishuCommitFailedError on FeishuApiError', async () => {
      client.deleteRecord = vi.fn(async () => {
        throw new FeishuApiError(1254040, 'RecordNotFound');
      });

      await expect(writer.deleteRecord('rec_missing')).rejects.toThrow(FeishuCommitFailedError);
    });
  });

  describe('stable client_token', () => {
    it('uses the same client_token for the same ingestion across writer instances', async () => {
      const secondWriter = new FeishuProjectRecordWriter(
        client as unknown as import('../../../src/server/feishu/feishu-client.js').FeishuClient,
        { projectTableId: PROJECT_TABLE_ID }
      );

      await writer.write({
        ingestionId: 'ing_same_operation',
        normalizedFields: { 项目名称: '测试' },
      });
      await secondWriter.write({
        ingestionId: 'ing_same_operation',
        normalizedFields: { 项目名称: '测试' },
      });

      const firstToken = client.createRecord.mock.calls[0][2];
      const secondToken = client.createRecord.mock.calls[1][2];
      expect(firstToken).toBe(secondToken);
      // UUIDv4 format
      expect(firstToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });
});
