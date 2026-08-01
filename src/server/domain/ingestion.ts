export type IngestionStatus =
  | 'received'
  | 'dispatching'
  | 'extracting'
  | 'candidate_received'
  | 'validating'
  | 'pending_review'
  | 'approved'
  | 'committing'
  | 'completed'
  | 'dispatch_failed'
  | 'extract_failed'
  | 'validation_failed'
  | 'review_rejected'
  | 'commit_failed'
  | 'write_result_unknown'
  | 'write_needs_reconciliation'
  | 'write_partial'
  | 'rollback_required'
  | 'rolled_back';

export interface CreateIngestionRequest {
  source_system: string;
  source_record_id: string;
  source_type: string;
  target_domain: string;
  content: string;
  submitted_at: string;
  timezone?: string;
  submitted_by?: string;
  dry_run?: boolean;
}

export interface CandidateRecord {
  schema_name: string;
  schema_version: string;
  prompt_version: string;
  fields: Record<string, unknown>;
  field_confidence: Record<string, number>;
  evidence: Record<string, string>;
}

export interface CandidateCallbackRequest {
  candidate: CandidateRecord;
  workflow_run_id?: string;
}

export interface ReviewDecision {
  reviewer_id: string;
  review_record_id: string;
  corrections?: Record<string, unknown>;
}

export interface RejectRequest {
  reviewer_id: string;
  reason_code: string;
  reason: string;
}

export interface IngestionTask {
  ingestion_id: string;
  /** Monotonic optimistic-concurrency version for persisted task snapshots. */
  task_version?: number;
  idempotency_key: string;
  status: IngestionStatus;
  source_system: string;
  source_record_id: string;
  source_type: string;
  target_domain: string;
  content: string;
  submitted_at: string;
  timezone: string;
  submitted_by?: string;
  dry_run: boolean;
  attempt_count: number;
  workflow_run_id?: string;
  candidate?: CandidateRecord;
  /**
   * Untouched deep copy of the original Candidate received on the callback.
   * Preserved as audit evidence so unknown fields and original PII shapes
   * remain available even after canonical mapping replaces `candidate`.
   */
  raw_candidate?: CandidateRecord;
  normalized_fields?: Record<string, unknown>;
  warnings: Array<{ field: string; code: string; message: string }>;
  errors: Array<{ field: string; code: string; message: string }>;
  duplicate_candidates: Array<Record<string, unknown>>;
  /**
   * Typed Pipeline evidence snapshot persisted on both success and failure
   * paths. Stored as a generic object so the domain layer does not depend
   * on the cleaning-pipeline module shape; the service layer populates it
   * with `pipelineVersion`, `stages`, `validation`, `corrections`,
   * `warnings`, `errors`, `qualityReport`, and `success`.
   */
  pipeline_evidence?: Record<string, unknown>;
  review_record_id?: string;
  reviewer_id?: string;
  review_decision?: 'approved' | 'rejected' | 'modified';
  business_record_id?: string;
  error_code?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface IngestionResponse {
  ingestion_id: string;
  status: IngestionStatus;
  idempotent_replay: boolean;
}
