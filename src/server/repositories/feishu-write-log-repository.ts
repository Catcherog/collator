// feishu-write-log-repository.ts
// TASK-003: 飞书版写入日志仓库，将 WriteLogRecord 持久化到飞书 Base 写入日志表。
// 不透明 write_log_id 直接使用飞书返回的真实 record_id。

import {
  createStableClientToken,
  type FeishuClient,
  type FeishuRecord,
} from '../feishu/feishu-client.js';
import { normalizeFeishuText } from '../feishu/normalize-text.js';
import type {
  NewWriteLogRecord,
  WriteLogRecord,
  WriteLogRepository,
} from './write-log-repository.js';

/**
 * Field names in the "Collator 写入日志" Feishu table.
 * Kept in one place so future schema changes only touch here.
 */
const FIELD = {
  writeLogId: '写入日志 ID',
  ingestionId: '摄入 ID',
  targetTableId: '目标表 ID',
  businessRecordId: '业务记录 ID',
  status: '写入状态',
  errorCode: '错误码',
  redactedErrorMessage: '脱敏错误消息',
  createdAt: '创建时间',
} as const;

export interface FeishuWriteLogRepositoryOptions {
  writeLogTableId: string;
}

/**
 * Production-grade WriteLogRepository backed by a Feishu Base table.
 *
 * Storage strategy mirrors FeishuReviewRepository:
 * - Indexed columns (`摄入 ID`, `写入状态`, `目标表 ID`, `创建时间`)
 *   mirror key log fields for queryability.
 * - Optional business-record / error fields are written only when present.
 * - Datetime is epoch milliseconds (Feishu datetime field format).
 *
 * Idempotency:
 * - `create()` first searches by `摄入 ID`. If a succeeded record exists
 *   for the same `(ingestion_id, target_table_id)` tuple, it is returned.
 *   A stable `client_token` also protects the succeeded-log create across
 *   concurrent processes and ambiguous retries. Failed/skipped attempts
 *   remain distinct audit events.
 * - `save()` updates by `write_log_id`.
 *
 * Error handling:
 * - JSON / scalar parse failures mention only the field name and the
 *   record_id; the raw (potentially sensitive) error message content is
 *   never echoed back beyond what `FeishuApiError` already sanitised.
 */
export class FeishuWriteLogRepository implements WriteLogRepository {
  constructor(
    private readonly client: FeishuClient,
    private readonly options: FeishuWriteLogRepositoryOptions
  ) {}

  async findByIngestionId(ingestionId: string): Promise<WriteLogRecord[]> {
    const records = await this.client.searchRecords(this.options.writeLogTableId, {
      filter: {
        conjunction: 'and',
        conditions: [
          { field_name: FIELD.ingestionId, operator: 'is', value: [ingestionId] },
        ],
      },
      page_size: 50,
    });
    return records.map((r) => this.parseRecord(r));
  }

  async create(record: NewWriteLogRecord): Promise<WriteLogRecord> {
    // Idempotency on (ingestion_id, target_table_id) tuple ONLY when an
    // existing log has terminal `succeeded` status: a retry of the same
    // successful write returns the existing log (no duplicate). For
    // `failed` / `pending` / `skipped_dry_run` logs a new entry is created
    // so the audit trail captures each commit attempt as a distinct event.
    // This is critical for retry-after-commit_failed observability: the
    // first failed attempt and the later successful retry each get their
    // own log entry.
    const existing = await this.findByIngestionId(record.ingestion_id);
    for (const log of existing) {
      if (
        log.target_table_id === record.target_table_id &&
        log.status === 'succeeded'
      ) {
        return log;
      }
    }

    const fields = this.buildFields(record);
    const clientToken = record.status === 'succeeded'
      ? createStableClientToken(
          `write-log:${this.options.writeLogTableId}:${record.ingestion_id}:${record.target_table_id}:succeeded`
        )
      : undefined;
    const recordId = await this.client.createRecord(
      this.options.writeLogTableId,
      fields,
      clientToken
    );
    return {
      ...record,
      write_log_id: recordId,
    };
  }

  async save(record: WriteLogRecord): Promise<void> {
    const fields = this.buildFields(record);
    await this.client.updateRecord(
      this.options.writeLogTableId,
      record.write_log_id,
      fields
    );
  }

  /**
   * Build the Feishu field payload from a write-log record (new or existing).
   * Datetime is epoch milliseconds; optional fields are written only when
   * present so the Feishu cell stays empty rather than holding the string
   * "undefined".
   */
  private buildFields(record: NewWriteLogRecord | WriteLogRecord): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      [FIELD.ingestionId]: record.ingestion_id,
      [FIELD.targetTableId]: record.target_table_id,
      [FIELD.status]: record.status,
      [FIELD.createdAt]: new Date(record.created_at).getTime(),
    };
    if ('write_log_id' in record && typeof record.write_log_id === 'string') {
      fields[FIELD.writeLogId] = record.write_log_id;
    }
    if (record.business_record_id !== undefined) {
      fields[FIELD.businessRecordId] = record.business_record_id;
    }
    if (record.error_code !== undefined) {
      fields[FIELD.errorCode] = record.error_code;
    }
    if (record.redacted_error_message !== undefined) {
      fields[FIELD.redactedErrorMessage] = record.redacted_error_message;
    }
    return fields;
  }

  /**
   * Reconstruct a WriteLogRecord from a Feishu record.
   * Throws a descriptive error (field name + record_id) for malformed data;
   * never includes the raw error-message content in the thrown message.
   */
  private parseRecord(record: FeishuRecord): WriteLogRecord {
    const fields = record.fields;
    const ingestionId = this.readScalar(fields, FIELD.ingestionId, record.record_id) as string;
    const targetTableId = this.readScalar(
      fields,
      FIELD.targetTableId,
      record.record_id
    ) as string;
    const status = this.readScalar(fields, FIELD.status, record.record_id) as WriteLogRecord['status'];
    const createdAtMs = this.readScalar(fields, FIELD.createdAt, record.record_id);
    const createdAt = typeof createdAtMs === 'number'
      ? new Date(createdAtMs).toISOString()
      : String(createdAtMs);

    const result: WriteLogRecord = {
      write_log_id: record.record_id,
      ingestion_id: ingestionId,
      target_table_id: targetTableId,
      status,
      created_at: createdAt,
    };

    const businessRecordId = this.readOptionalScalar(fields, FIELD.businessRecordId, record.record_id);
    if (businessRecordId !== undefined) {
      result.business_record_id = businessRecordId as string;
    }
    const errorCode = this.readOptionalScalar(fields, FIELD.errorCode, record.record_id);
    if (errorCode !== undefined) {
      result.error_code = errorCode as string;
    }
    const redactedErrorMessage = this.readOptionalScalar(
      fields,
      FIELD.redactedErrorMessage,
      record.record_id
    );
    if (redactedErrorMessage !== undefined) {
      result.redacted_error_message = redactedErrorMessage as string;
    }
    return result;
  }

  private readScalar(
    fields: Record<string, unknown>,
    fieldName: string,
    recordId: string
  ): unknown {
    const raw = fields[fieldName];
    // Datetime fields are returned as numbers (epoch ms). Preserve the
    // numeric value so callers can distinguish datetime from text.
    if (typeof raw === 'number') {
      return raw;
    }
    // Select fields may be returned as [{ name: '...' }] arrays. This is
    // NOT a text-field shape; preserve select-field handling here so the
    // shared text normaliser is not applied to it.
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null && 'name' in raw[0]) {
      return (raw[0] as { name: string }).name;
    }
    // Text fields: delegate to the shared normaliser, which handles all
    // three legal Feishu return shapes (string, {text}, Array<{text}>)
    // and rejects unsupported shapes with a diagnostic error.
    return normalizeFeishuText(raw, {
      repository: 'FeishuWriteLogRepository',
      fieldName,
      recordId,
      required: true,
    });
  }

  private readOptionalScalar(
    fields: Record<string, unknown>,
    fieldName: string,
    recordId: string
  ): unknown {
    const raw = fields[fieldName];
    if (typeof raw === 'number') {
      return raw;
    }
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null && 'name' in raw[0]) {
      return (raw[0] as { name: string }).name;
    }
    return normalizeFeishuText(raw, {
      repository: 'FeishuWriteLogRepository',
      fieldName,
      recordId,
      required: false,
    });
  }
}
