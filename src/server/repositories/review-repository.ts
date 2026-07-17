// review-repository.ts
// TASK-002: 审核记录合同 + 不透明 review_record_id 接口。
// 内存与飞书实现共享同一合同；调用方不应假设 ID 形式（如 rec_review_）。

import type { CandidateRecord } from '../domain/ingestion.js';

export type ReviewStatus = 'pending_review' | 'approved' | 'rejected';
export type ReviewDecision = 'approved' | 'rejected' | 'modified';

/**
 * A persisted review record.
 *
 * `review_record_id` is an opaque string. In memory mode it is a random UUID;
 * in Feishu mode it is the real Feishu Base `record_id`. Callers MUST NOT
 * assume any prefix (e.g. `rec_review_`).
 */
export interface ReviewRecord {
  review_record_id: string;
  ingestion_id: string;
  status: ReviewStatus;
  candidate: CandidateRecord;
  normalized_fields: Record<string, unknown>;
  /**
   * Pipeline validation evidence. Stored as a generic object to allow
   * `validation`, `corrections`, `warnings`, `errors`, `qualityReport`,
   * `stages`, and `pipelineVersion` to evolve without breaking the schema.
   */
  validation: Record<string, unknown>;
  reviewer_id?: string;
  review_decision?: ReviewDecision;
  corrections?: Record<string, unknown>;
  updated_at: string;
}

/**
 * A review record before it has been assigned a `review_record_id` by the
 * repository. `create()` accepts this shape and returns a complete
 * `ReviewRecord`.
 */
export type NewReviewRecord = Omit<ReviewRecord, 'review_record_id'>;

/**
 * Persistence boundary for review records.
 *
 * Implementations MUST be idempotent on `create()` for the same
 * `ingestion_id`: calling `create()` twice for the same ingestion MUST NOT
 * produce two records — the second call returns the existing record (Feishu
 * mode) or the same logical record (memory mode).
 */
export interface ReviewRepository {
  findByIngestionId(ingestionId: string): Promise<ReviewRecord | null>;
  create(record: NewReviewRecord): Promise<ReviewRecord>;
  save(record: ReviewRecord): Promise<void>;
}
