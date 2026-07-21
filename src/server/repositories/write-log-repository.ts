// write-log-repository.ts
// TASK-003: 写入日志仓库合同。
// 内存与飞书实现共享同一合同；记录审核通过后业务主表写入的脱敏审计轨迹。

/**
 * Write log status. Mirrors the select options on the
 * "Collator 写入日志" Feishu table.
 *
 * - `pending`: reserved for future two-phase commit; currently the writer
 *   either succeeds or fails synchronously.
 * - `succeeded`: customer record was created or already existed (idempotent
 *   replay still counts as succeeded — no duplicate was produced).
 * - `failed`: writer raised; sanitised error code/message persisted.
 * - `skipped_dry_run`: dry_run=true approval — no customer write attempted.
 */
export type WriteLogStatus = 'pending' | 'succeeded' | 'failed' | 'skipped_dry_run';

/**
 * A persisted write-log entry.
 *
 * `write_log_id` is an opaque string. In memory mode it is a random UUID;
 * in Feishu mode it is the real Feishu Base `record_id`. Callers MUST NOT
 * assume any prefix.
 *
 * PII rules:
 * - `errorCode` is a short machine code (e.g. `FEISHU_API_ERROR`,
 *   `FEISHU_NETWORK_ERROR`, `FEISHU_COMMIT_FAILED`) — never a raw Feishu
 *   message.
 * - `redactedErrorMessage` is the sanitised error message produced by
 *   `FeishuApiError` (phone numbers masked, app_secret never included).
 *   The raw Feishu response body must NOT be persisted here.
 */
export interface WriteLogRecord {
  write_log_id: string;
  ingestion_id: string;
  /**
   * Feishu table ID of the target business table (e.g. the customer table).
   * Persisted so auditors can identify the destination without parsing
   * free-text.
   */
  target_table_id: string;
  /**
   * The business record ID produced (or already existing) on success.
   * Undefined when status is `failed` or `skipped_dry_run`.
   */
  business_record_id?: string;
  status: WriteLogStatus;
  /**
   * Short machine-readable error code. Undefined on success / dry-run.
   */
  error_code?: string;
  /**
   * Sanitised error message (phone-masked, no app_secret). Undefined on
   * success / dry-run.
   */
  redacted_error_message?: string;
  created_at: string;
}

/**
 * A write-log entry before it has been assigned a `write_log_id` by the
 * repository. `create()` accepts this shape and returns a complete
 * `WriteLogRecord`.
 */
export type NewWriteLogRecord = Omit<WriteLogRecord, 'write_log_id'>;

/**
 * Persistence boundary for write-log entries.
 *
 * Idempotency contract for `create()`:
 * - If an existing log with terminal `succeeded` status exists for the same
 *   `(ingestion_id, target_table_id)` tuple, `create()` MUST return it
 *   verbatim — a retry of the same successful write must not produce a
 *   duplicate.
 * - If an existing log has a non-terminal status (`failed` / `pending` /
 *   `skipped_dry_run`), `create()` MUST create a new entry so the audit
 *   trail captures each commit attempt as a distinct event. This is
 *   critical for retry-after-commit_failed observability: the first
 *   failed attempt and the later successful retry each get their own log.
 *
 * The Feishu implementation achieves this by searching by `摄入 ID` before
 * creating; the memory implementation by scanning the ingestion's log set.
 */
export interface WriteLogRepository {
  create(record: NewWriteLogRecord): Promise<WriteLogRecord>;
  findByIngestionId(ingestionId: string): Promise<WriteLogRecord[]>;
  save(record: WriteLogRecord): Promise<void>;
}
