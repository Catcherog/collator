// record-cleanup.ts
// AC-C10 / AC-E22: 精确 record_id 清理助手。
//
// 跨实体事务补偿与部分失败清理使用。删除 ONLY by exact Feishu record_id —
// 绝不按名称、摄入 ID 或任何其他字段搜索匹配。这是 AC-C10 / AC-E22 的硬性
// 约束：按名称匹配会误删同名记录，破坏幂等与审计边界。
//
// 该助手直接使用 FeishuClient.deleteRecord(tableId, recordId)，不经过任何
// writer 的搜索路径，从结构上保证「无名称匹配」。

import type { FeishuClient } from '../feishu/feishu-client.js';

/**
 * A single cleanup target: the exact record_id and the table it lives in.
 * `tableId` is required because the Feishu delete API is scoped per table.
 */
export interface CleanupTarget {
  recordId: string;
  tableId: string;
}

/**
 * Result of a cleanup sweep.
 *
 * - `deleted`: record_ids successfully deleted.
 * - `failed`: targets whose deletion raised, with a sanitised error code
 *   (never the raw Feishu body, which may contain PII).
 *
 * `failed` entries let the caller decide whether to retry or surface a
 * `partial` status — cleanup is best-effort and never throws to abort the
 * whole compensation flow.
 */
export interface CleanupResult {
  deleted: string[];
  failed: Array<{ recordId: string; tableId: string; error: string }>;
}

/**
 * Delete Feishu records by their exact record_id only (AC-C10 / AC-E22).
 *
 * Invariants:
 * - Calls `FeishuClient.deleteRecord(tableId, recordId)` for each target.
 * - NEVER calls `searchRecords` / `getRecord` — no name-based matching, no
 *   lookup by ingestion id. Deletion is purely positional on the record_id.
 * - Best-effort: a failure on one target does not abort the remaining
 *   targets; failed targets are collected in `result.failed`.
 * - Empty / blank record_ids are skipped (defensive — they cannot identify a
 *   record and would produce a 400 from the API).
 * - Error messages are reduced to a short code / error name; the raw Feishu
 *   response body is never propagated (it may contain PII or secrets).
 *
 * @param client  the FeishuClient used for deletion
 * @param targets the exact (recordId, tableId) pairs to delete
 */
export async function cleanupByRecordIds(
  client: FeishuClient,
  targets: CleanupTarget[]
): Promise<CleanupResult> {
  const deleted: string[] = [];
  const failed: CleanupResult['failed'] = [];

  for (const target of targets) {
    const recordId = target?.recordId;
    const tableId = target?.tableId;
    if (!recordId || typeof recordId !== 'string' || recordId.trim().length === 0) {
      // Skip blank ids — they cannot identify a record.
      continue;
    }
    if (!tableId || typeof tableId !== 'string' || tableId.trim().length === 0) {
      failed.push({ recordId, tableId: tableId ?? '', error: 'MISSING_TABLE_ID' });
      continue;
    }
    try {
      await client.deleteRecord(tableId, recordId);
      deleted.push(recordId);
    } catch (e) {
      // Sanitise: keep only a short error name / code, never the raw body.
      const errName = (e as Error)?.name ?? 'UnknownError';
      failed.push({ recordId, tableId, error: errName });
    }
  }

  return { deleted, failed };
}
