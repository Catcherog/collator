// customer-record-writer.ts
// TASK-003: 客户主表幂等写入器。
// 仅写入已确认中文字段白名单 + Collator 摄入 ID；写入前按摄入 ID 精确查询；
// 创建时使用稳定 client_token 作为最终幂等边界；日期字段转换为飞书 epoch 毫秒。

import {
  createStableClientToken,
  type FeishuClient,
} from '../feishu/feishu-client.js';
import { FeishuApiError } from '../feishu/feishu-errors.js';
import { FeishuCommitFailedError } from '../domain/errors.js';
import { assertExpectedFields } from './post-write-verification.js';
import { CreateLifecyclePersistenceError, type CreateRecordLifecycle } from './create-lifecycle.js';

/**
 * Whitelist of customer-table business fields the writer is allowed to
 * populate. Any other key in `normalizedFields` is silently dropped
 * before the create call — the customer table's existing business
 * fields, automation, permissions and history must not be touched.
 *
 * Mirrors `CUSTOMER_FIELD_MAP` in `customer-candidate-mapper.ts` plus
 * the technical `Collator 摄入 ID` idempotency key.
 */
const CUSTOMER_FIELD_WHITELIST = [
  '客户姓名',
  '联系方式',
  '来源渠道',
  '咨询时间',
  '拍摄类型',
  '预算区间',
  '意向风格',
  '跟进记录',
  '好评记录',
] as const;

const COLLATOR_INGESTION_ID_FIELD = 'Collator 摄入 ID';

/**
 * Fields whose values are ISO 8601 datetimes and must be converted to
 * Feishu datetime cells (epoch milliseconds). Other datetime fields
 * outside this set are written as-is; if Feishu rejects them the call
 * surfaces as `FEISHU_COMMIT_FAILED`.
 */
const DATETIME_FIELDS = new Set<string>(['咨询时间']);

/**
 * Fields that are Feishu MultiSelect (type=4) in the customer table.
 * Feishu requires an array of option strings; a bare string is rejected
 * with `MultiSelectFieldConvFail` (code=1254063). String values are
 * wrapped in a single-element array; arrays pass through unchanged.
 *
 * Discovered via Gate D real-Feishu run (TASK-003-GATE-D-TEXT-NORMALIZATION).
 */
const MULTISELECT_FIELDS = new Set<string>(['意向风格']);

export interface CustomerRecordWriterResult {
  /**
   * The real Feishu record_id of the customer record. On `created=false`
   * this is the pre-existing record's ID (idempotent replay).
   */
  business_record_id: string;
  /**
   * `true` when a new record was created. `false` when an existing
   * record was found by `Collator 摄入 ID` and reused (no duplicate
   * produced).
   */
  created: boolean;
}

export interface CustomerRecordWriterInput {
  ingestionId: string;
  normalizedFields: Record<string, unknown>;
  createLifecycle?: CreateRecordLifecycle;
  /** Server-owned deterministic logical key for internal-controlled writes. */
  internalWriteKey?: string;
}

/**
 * Persistence-boundary contract for the customer-record writer.
 *
 * Implementations MUST be idempotent on `ingestionId`: a retry after a
 * transient failure (network timeout, commit_failed retry) must NOT
 * produce a duplicate customer record. The Feishu implementation
 * searches by `Collator 摄入 ID` as a fast replay path and supplies a
 * stable UUIDv4 `client_token` when creating. The server-side operation
 * token is the final boundary for concurrent or ambiguous retries.
 *
 * Implementations MUST throw `FeishuCommitFailedError` on any failure
 * (network error, API rejection, malformed response). Detailed cause
 * is sanitised by `FeishuApiError` (phone numbers masked, app_secret
 * never included) and the caller persists it into the write log.
 */
export interface CustomerRecordWriter {
  write(input: CustomerRecordWriterInput): Promise<CustomerRecordWriterResult>;
  verifyRecord?(recordId: string, input: CustomerRecordWriterInput): Promise<void>;
  findByIngestionId?(ingestionId: string): Promise<string[]>;
  /**
   * Delete a customer record by its exact Feishu record_id. Used for
   * transactional rollback / cleanup compensation (AC-C10). Implementations
   * MUST delete only by exact record_id and MUST NEVER search by name.
   *
   * Optional on the interface for backward compatibility with test doubles
   * that only stub `write`; the concrete `FeishuCustomerRecordWriter`
   * implements it. Callers MUST guard (`if (writer.deleteRecord)`) before
   * invoking.
   */
  deleteRecord?(recordId: string): Promise<void>;
}

export interface FeishuCustomerRecordWriterOptions {
  customerTableId: string;
  /** Schema-authoritative marker field; defaults to the existing field. */
  ingestionIdField?: string;
}

/**
 * Production-grade CustomerRecordWriter backed by a Feishu Base customer
 * table.
 *
 * Idempotency strategy:
 * 1. Search the customer table by `Collator 摄入 ID` for the given
 *    ingestion ID.
 * 2. If a record exists, return its `record_id` with `created=false`.
 * 3. Otherwise build a field payload from the whitelist, convert
 *    datetime fields to epoch ms, and `createRecord` with a stable
 *    UUIDv4 `client_token`. Return the resulting `record_id` with
 *    `created=true`.
 *
 * PII / safety:
 * - Only the whitelisted Chinese business fields + `Collator 摄入 ID`
 *   are written. Unknown fields in `normalizedFields` are dropped.
 * - On any FeishuClient error, the message is sanitised by
 *   `FeishuApiError` (phones masked, no app_secret) and the writer
 *   throws `FeishuCommitFailedError` so the service returns HTTP 502.
 * - The original `normalizedFields` object is never mutated.
 */
export class FeishuCustomerRecordWriter implements CustomerRecordWriter {
  constructor(
    private readonly client: FeishuClient,
    private readonly options: FeishuCustomerRecordWriterOptions
  ) {}

  async write(input: CustomerRecordWriterInput): Promise<CustomerRecordWriterResult> {
    const ingestionIdField = this.options.ingestionIdField ?? COLLATOR_INGESTION_ID_FIELD;
    // Step 1: idempotent search by Collator 摄入 ID.
    let existing;
    try {
      existing = await this.client.searchRecords(this.options.customerTableId, {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              field_name: ingestionIdField,
              operator: 'is',
              value: [input.ingestionId],
            },
          ],
        },
        page_size: 2,
      });
    } catch (e) {
      throw this.toCommitFailed(e);
    }

    if (existing.length > 0) {
      return {
        business_record_id: existing[0].record_id,
        created: false,
      };
    }

    // Step 2: build whitelisted field payload + create.
    const fields = this.buildFields(input.normalizedFields, input.ingestionId);
    const operationKey = input.internalWriteKey
      ?? `customer-record:${this.options.customerTableId}:${input.ingestionId}`;
    const clientToken = createStableClientToken(operationKey);
    await input.createLifecycle?.beforeCreate?.({
      entity: 'customer',
      tableId: this.options.customerTableId,
      ingestionId: input.ingestionId,
      operationKey,
      clientToken,
      createdAt: new Date().toISOString(),
    });
    let recordId: string;
    try {
      recordId = await this.client.createRecord(
        this.options.customerTableId,
        fields,
        clientToken
      );
      try {
        await input.createLifecycle?.afterCreate?.(recordId);
      } catch (error) {
        throw new CreateLifecyclePersistenceError(recordId, error);
      }
    } catch (e) {
      if (e instanceof CreateLifecyclePersistenceError) {
        throw e;
      }
      throw this.toCommitFailed(e);
    }
    return {
      business_record_id: recordId,
      created: true,
    };
  }

  /**
   * Delete a customer record by its exact Feishu record_id (AC-C10).
   *
   * Deletes ONLY by record_id — never searches by name or any other field.
   * Any FeishuClient error is wrapped in `FeishuCommitFailedError` with
   * sanitised messaging (no app_secret / PII leakage).
   */
  async deleteRecord(recordId: string): Promise<void> {
    try {
      await this.client.deleteRecord(this.options.customerTableId, recordId);
    } catch (e) {
      throw this.toCommitFailed(e);
    }
  }

  async findByIngestionId(ingestionId: string): Promise<string[]> {
    const ingestionIdField = this.options.ingestionIdField ?? COLLATOR_INGESTION_ID_FIELD;
    const records = await this.client.searchRecords(this.options.customerTableId, {
      filter: {
        conjunction: 'and',
        conditions: [{
          field_name: ingestionIdField,
          operator: 'is',
          value: [ingestionId],
        }],
      },
      page_size: 10,
    });
    return records.map((record) => record.record_id);
  }

  async verifyRecord(recordId: string, input: CustomerRecordWriterInput): Promise<void> {
    const record = await this.client.getRecord(this.options.customerTableId, recordId);
    assertExpectedFields(record.fields, this.buildFields(input.normalizedFields, input.ingestionId));
  }

  /**
   * Build the Feishu field payload from the normalised fields.
   * - Only whitelisted Chinese business fields are copied through.
   * - `Collator 摄入 ID` is set to the ingestion ID (technical
   *   idempotency key — must NOT be re-used to carry business values).
   * - Datetime fields listed in `DATETIME_FIELDS` are converted from
   *   ISO 8601 to epoch milliseconds.
   * - MultiSelect fields listed in `MULTISELECT_FIELDS` wrap a bare
   *   string into a single-element array; arrays pass through unchanged.
   * - Input is never mutated; the returned object is a fresh copy.
   */
  private buildFields(
    normalizedFields: Record<string, unknown>,
    ingestionId: string
  ): Record<string, unknown> {
    const ingestionIdField = this.options.ingestionIdField ?? COLLATOR_INGESTION_ID_FIELD;
    const fields: Record<string, unknown> = {
      [ingestionIdField]: ingestionId,
    };
    for (const key of CUSTOMER_FIELD_WHITELIST) {
      const value = normalizedFields[key];
      if (value === undefined || value === null) continue;
      if (DATETIME_FIELDS.has(key) && typeof value === 'string') {
        const ms = Date.parse(value);
        // Only convert when the value parses cleanly; otherwise pass
        // the raw string through and let Feishu reject it (surfaced
        // as FEISHU_COMMIT_FAILED). This avoids silently dropping a
        // malformed date.
        fields[key] = Number.isNaN(ms) ? value : ms;
      } else if (MULTISELECT_FIELDS.has(key)) {
        // Feishu MultiSelect (type=4) requires an array of option
        // strings. A bare string is rejected with code=1254063
        // (MultiSelectFieldConvFail). Wrap strings; pass arrays
        // through unchanged. Non-string/non-array values are passed
        // as-is so Feishu surfaces the type mismatch as
        // FEISHU_COMMIT_FAILED rather than silent coercion.
        fields[key] = Array.isArray(value) ? value : [value];
      } else {
        fields[key] = value;
      }
    }
    return fields;
  }

  /**
   * Wrap any FeishuClient error into FeishuCommitFailedError.
   * `FeishuApiError` already redacts phone numbers and never includes
   * app_secret; we surface its message verbatim so the sanitised text
   * reaches the write log. Non-FeishuApiError errors are wrapped with
   * a generic network-error code so no internal stack trace leaks.
   */
  private toCommitFailed(e: unknown): FeishuCommitFailedError {
    if (e instanceof FeishuApiError) {
      return new FeishuCommitFailedError(
        `Feishu API error (code=${e.code}): ${e.message}`,
        e.code < 0,
      );
    }
    // Unknown error: do not propagate message verbatim (may contain
    // internal paths, stack traces, or PII). Surface a generic cause.
    return new FeishuCommitFailedError(
      `Feishu commit failed: ${(e as Error)?.name ?? 'UnknownError'}`
    );
  }
}
