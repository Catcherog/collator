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
  normalized_fields?: Record<string, unknown>;
  warnings: Array<{ field: string; code: string; message: string }>;
  errors: Array<{ field: string; code: string; message: string }>;
  duplicate_candidates: Array<Record<string, unknown>>;
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
