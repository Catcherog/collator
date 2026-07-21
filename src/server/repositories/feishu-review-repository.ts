// feishu-review-repository.ts
// TASK-002: 飞书版审核仓库，将 ReviewRecord 持久化到飞书 Base 审核表。
// 不透明 review_record_id 直接使用飞书返回的真实 record_id。

import type { FeishuClient, FeishuRecord } from '../feishu/feishu-client.js';
import {
  normalizeFeishuJson,
  normalizeFeishuText,
} from '../feishu/normalize-text.js';
import type {
  NewReviewRecord,
  ReviewRecord,
  ReviewRepository,
} from './review-repository.js';

/**
 * Field names in the "Collator 审核任务" Feishu table.
 * Kept in one place so future schema changes only touch here.
 */
const FIELD = {
  ingestionId: '摄入 ID',
  status: '状态',
  candidate: '候选 JSON',
  normalized: '标准化结果 JSON',
  validation: '校验结果 JSON',
  reviewer: '审核人',
  decision: '审核决定',
  corrections: '人工修正 JSON',
  updatedAt: '更新时间',
} as const;

export interface FeishuReviewRepositoryOptions {
  reviewTableId: string;
}

/**
 * Production-grade ReviewRepository backed by a Feishu Base table.
 *
 * Storage strategy:
 * - Indexed columns (`摄入 ID`, `状态`, `审核人`, `审核决定`, `更新时间`)
 *   mirror key review fields for queryability.
 * - JSON-evidence fields (`候选 JSON`, `标准化结果 JSON`, `校验结果 JSON`,
 *   `人工修正 JSON`) carry the structured pipeline output. Reads always
 *   reconstruct the review from these fields.
 *
 * Idempotency:
 * - `create()` first searches by `摄入 ID`. If a record exists, it is
 *   returned verbatim — no duplicate is created. Otherwise a new record is
 *   created and the real Feishu `record_id` becomes `review_record_id`.
 * - `save()` updates by `review_record_id`.
 *
 * Error handling:
 * - JSON parse failures mention only the field name and the record_id; the
 *   raw (potentially sensitive) candidate content is never echoed back.
 */
export class FeishuReviewRepository implements ReviewRepository {
  constructor(
    private readonly client: FeishuClient,
    private readonly options: FeishuReviewRepositoryOptions
  ) {}

  async findByIngestionId(ingestionId: string): Promise<ReviewRecord | null> {
    const records = await this.client.searchRecords(this.options.reviewTableId, {
      filter: {
        conjunction: 'and',
        conditions: [
          { field_name: FIELD.ingestionId, operator: 'is', value: [ingestionId] },
        ],
      },
      page_size: 2,
    });
    if (records.length === 0) return null;
    return this.parseRecord(records[0]);
  }

  async create(record: NewReviewRecord): Promise<ReviewRecord> {
    // Idempotency: if a review already exists for this ingestion, return it.
    const existing = await this.findByIngestionId(record.ingestion_id);
    if (existing) return existing;

    const fields = this.buildFields(record);
    const recordId = await this.client.createRecord(
      this.options.reviewTableId,
      fields
    );
    // Return the input data plus the real Feishu record_id.
    return {
      ...record,
      review_record_id: recordId,
    };
  }

  async save(record: ReviewRecord): Promise<void> {
    const fields = this.buildFields(record);
    await this.client.updateRecord(
      this.options.reviewTableId,
      record.review_record_id,
      fields
    );
  }

  /**
   * Build the Feishu field payload from a review record (new or existing).
   * JSON evidence is serialized with JSON.stringify; datetime is epoch ms.
   */
  private buildFields(record: NewReviewRecord | ReviewRecord): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      [FIELD.ingestionId]: record.ingestion_id,
      [FIELD.status]: record.status,
      [FIELD.candidate]: JSON.stringify(record.candidate),
      [FIELD.normalized]: JSON.stringify(record.normalized_fields),
      [FIELD.validation]: JSON.stringify(record.validation),
      [FIELD.updatedAt]: new Date(record.updated_at).getTime(),
    };
    if (record.reviewer_id !== undefined) {
      fields[FIELD.reviewer] = record.reviewer_id;
    }
    if (record.review_decision !== undefined) {
      fields[FIELD.decision] = record.review_decision;
    }
    if (record.corrections !== undefined) {
      fields[FIELD.corrections] = JSON.stringify(record.corrections);
    }
    return fields;
  }

  /**
   * Reconstruct a ReviewRecord from a Feishu record.
   * Throws a descriptive error (field name + record_id) for malformed JSON;
   * never includes the raw candidate content in the error message.
   */
  private parseRecord(record: FeishuRecord): ReviewRecord {
    const fields = record.fields;
    const ingestionId = this.readScalar(fields, FIELD.ingestionId, record.record_id);
    const status = this.readScalar(fields, FIELD.status, record.record_id) as ReviewRecord['status'];
    const updatedAtMs = this.readScalar(fields, FIELD.updatedAt, record.record_id);
    const updatedAt = typeof updatedAtMs === 'number'
      ? new Date(updatedAtMs).toISOString()
      : String(updatedAtMs);

    const candidate = this.readJson(
      fields,
      FIELD.candidate,
      record.record_id
    ) as ReviewRecord['candidate'];
    const normalizedFields = this.readJson(
      fields,
      FIELD.normalized,
      record.record_id
    ) as Record<string, unknown>;
    const validation = this.readJson(
      fields,
      FIELD.validation,
      record.record_id
    ) as Record<string, unknown>;

    const result: ReviewRecord = {
      review_record_id: record.record_id,
      ingestion_id: ingestionId as string,
      status,
      candidate,
      normalized_fields: normalizedFields,
      validation,
      updated_at: updatedAt,
    };

    const reviewer = this.readOptionalScalar(fields, FIELD.reviewer, record.record_id);
    if (reviewer !== undefined) result.reviewer_id = reviewer as string;

    const decision = this.readOptionalScalar(fields, FIELD.decision, record.record_id);
    if (decision !== undefined) {
      result.review_decision = decision as ReviewRecord['review_decision'];
    }

    if (fields[FIELD.corrections] !== undefined) {
      result.corrections = this.readJson(
        fields,
        FIELD.corrections,
        record.record_id
      ) as Record<string, unknown>;
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
    // Text fields: delegate to the shared normaliser, which handles all
    // three legal Feishu return shapes (string, {text}, Array<{text}>)
    // and rejects unsupported shapes with a diagnostic error.
    return normalizeFeishuText(raw, {
      repository: 'FeishuReviewRepository',
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
    return normalizeFeishuText(raw, {
      repository: 'FeishuReviewRepository',
      fieldName,
      recordId,
      required: false,
    });
  }

  private readJson(
    fields: Record<string, unknown>,
    fieldName: string,
    recordId: string
  ): unknown {
    // Delegate both text-shape normalisation and JSON parsing to the
    // shared helper. Errors distinguish "text structure" failures from
    // "JSON parse" failures, and never echo the raw (potentially
    // sensitive) field content.
    return normalizeFeishuJson(
      fields[fieldName],
      {
        repository: 'FeishuReviewRepository',
        fieldName,
        recordId,
        required: true,
      }
    );
  }
}
