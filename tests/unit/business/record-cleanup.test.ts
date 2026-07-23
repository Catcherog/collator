// record-cleanup.test.ts
// AC-C10 / AC-E22: 精确 record_id 清理助手测试。
//
// 断言：
//   - 仅按精确 (tableId, recordId) 删除，deleteRecord 被调用且参数精确。
//   - 绝不调用 searchRecords（无名称匹配）。
//   - 单条失败不中断其余删除，失败项进入 result.failed。
//   - 空/缺 recordId 被跳过；缺 tableId 计入 failed。
//
// 运行：vitest run tests/unit/business/record-cleanup.test.ts

import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { FeishuClient } from '../../../src/server/feishu/feishu-client.js';
import { cleanupByRecordIds } from '../../../src/server/business/record-cleanup.js';

function createMockClient(opts: { failOnRecordId?: string } = {}) {
  const calls = {
    deleteRecord: [] as Array<{ tableId: string; recordId: string }>,
    searchRecords: [] as Array<unknown>,
  };
  const client = {
    deleteRecord: vi.fn(async (tableId: string, recordId: string) => {
      calls.deleteRecord.push({ tableId, recordId });
      if (opts.failOnRecordId && recordId === opts.failOnRecordId) {
        throw new Error('Simulated delete failure');
      }
    }) as Mock,
    searchRecords: vi.fn(async () => {
      calls.searchRecords.push(true);
      return [];
    }) as Mock,
  };
  return { client: client as unknown as FeishuClient, calls };
}

describe('cleanupByRecordIds — AC-C10 / AC-E22', () => {
  it('deletes only the provided exact record_ids', async () => {
    const { client, calls } = createMockClient();
    const result = await cleanupByRecordIds(client, [
      { recordId: 'rec_001', tableId: 'tblA' },
      { recordId: 'rec_002', tableId: 'tblB' },
    ]);

    expect(result.deleted).toEqual(['rec_001', 'rec_002']);
    expect(result.failed).toEqual([]);
    expect(calls.deleteRecord).toHaveLength(2);
    expect(calls.deleteRecord[0]).toEqual({ tableId: 'tblA', recordId: 'rec_001' });
    expect(calls.deleteRecord[1]).toEqual({ tableId: 'tblB', recordId: 'rec_002' });
  });

  it('NEVER calls searchRecords (no name-based matching)', async () => {
    const { client, calls } = createMockClient();
    await cleanupByRecordIds(client, [
      { recordId: 'rec_001', tableId: 'tblA' },
      { recordId: 'rec_002', tableId: 'tblA' },
    ]);
    expect(calls.searchRecords).toHaveLength(0);
  });

  it('a failed deletion does not abort the remaining targets', async () => {
    const { client, calls } = createMockClient({ failOnRecordId: 'rec_will_fail' });
    const result = await cleanupByRecordIds(client, [
      { recordId: 'rec_ok_1', tableId: 'tblA' },
      { recordId: 'rec_will_fail', tableId: 'tblA' },
      { recordId: 'rec_ok_2', tableId: 'tblB' },
    ]);

    expect(result.deleted).toEqual(['rec_ok_1', 'rec_ok_2']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].recordId).toBe('rec_will_fail');
    expect(result.failed[0].tableId).toBe('tblA');
    // all three were attempted
    expect(calls.deleteRecord).toHaveLength(3);
  });

  it('skips blank record_ids and reports missing table_ids as failed', async () => {
    const { client, calls } = createMockClient();
    const result = await cleanupByRecordIds(client, [
      { recordId: '', tableId: 'tblA' }, // blank id → skipped
      { recordId: '   ', tableId: 'tblA' }, // blank id → skipped
      { recordId: 'rec_no_table', tableId: '' }, // missing table → failed
      { recordId: 'rec_ok', tableId: 'tblA' },
    ]);

    expect(result.deleted).toEqual(['rec_ok']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].recordId).toBe('rec_no_table');
    expect(result.failed[0].error).toBe('MISSING_TABLE_ID');
    // only rec_no_table (failed pre-check, no API call) + rec_ok reached API? No:
    // rec_no_table does NOT call deleteRecord (it is recorded as failed before the call).
    expect(calls.deleteRecord).toHaveLength(1);
    expect(calls.deleteRecord[0]).toEqual({ tableId: 'tblA', recordId: 'rec_ok' });
  });

  it('returns empty result for an empty target list', async () => {
    const { client, calls } = createMockClient();
    const result = await cleanupByRecordIds(client, []);
    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(calls.deleteRecord).toHaveLength(0);
    expect(calls.searchRecords).toHaveLength(0);
  });
});
