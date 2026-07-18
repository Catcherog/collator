import { createHash, randomUUID } from 'crypto';
import type {
  CandidateCallbackRequest,
  CandidateRecord,
  CreateIngestionRequest,
  IngestionResponse,
  IngestionTask,
  RejectRequest,
  ReviewDecision,
} from '../domain/ingestion.js';
import { BadRequestError, ConflictError, NotFoundError } from '../domain/errors.js';
import type { TaskRepository } from '../repositories/task-repository.js';
import type { NewReviewRecord, ReviewRepository } from '../repositories/review-repository.js';
import { mapCustomerCandidate } from '../mapping/customer-candidate-mapper.js';
import { runCleaningPipeline } from '../cleaning/pipeline/cleaning-pipeline.js';
import { sanitizeWarningText } from '../security/redaction.js';

function computeIdempotencyKey(req: CreateIngestionRequest): string {
  const normalizedContent = req.content.trim();
  const data = `${req.source_system}|${req.source_record_id}|${req.target_domain}|${normalizedContent}`;
  return createHash('sha256').update(data).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Build the typed Pipeline evidence snapshot persisted on the task.
 * Mapper warnings are kept separate (on `task.warnings`) so the two warning
 * sources remain distinguishable in audit/diagnosis.
 */
function buildPipelineEvidence(result: ReturnType<typeof runCleaningPipeline>): Record<string, unknown> {
  return {
    pipelineVersion: result.pipelineVersion,
    stages: result.stages,
    validation: result.validation,
    corrections: result.corrections,
    warnings: result.warnings,
    errors: result.errors,
    qualityReport: result.qualityReport,
    success: result.success,
  };
}

/**
 * Apply sanitization to mapper warnings before they are persisted or returned.
 * An attacker-controlled unknown Candidate key could otherwise smuggle a
 * phone number or a local filesystem path through `warning.field` and
 * `warning.message`.
 */
function sanitizeMapperWarnings(
  warnings: Array<{ field: string; code: string; message: string }>
): Array<{ field: string; code: string; message: string }> {
  return warnings.map((w) => ({
    field: sanitizeWarningText(w.field),
    code: w.code,
    message: sanitizeWarningText(w.message),
  }));
}

export class IngestionService {
  private readonly pendingCreations = new Map<string, Promise<IngestionResponse>>();
  private readonly pendingCandidates = new Map<
    string,
    Promise<{ ingestion_id: string; status: string; review_record_id: string }>
  >();

  constructor(
    private readonly repository: TaskRepository,
    private readonly reviewRepository: ReviewRepository
  ) {}

  async createIngestion(req: CreateIngestionRequest): Promise<IngestionResponse> {
    if (req.target_domain !== 'customer_consultation') {
      throw new BadRequestError(`V1 only supports target_domain=customer_consultation, got ${req.target_domain}`);
    }

    if (!req.content || req.content.trim().length === 0) {
      throw new BadRequestError('content is required');
    }

    const idempotencyKey = computeIdempotencyKey(req);

    const inFlight = this.pendingCreations.get(idempotencyKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.doCreateIngestion(req, idempotencyKey).finally(() => {
      this.pendingCreations.delete(idempotencyKey);
    });

    this.pendingCreations.set(idempotencyKey, promise);
    return promise;
  }

  private async doCreateIngestion(
    req: CreateIngestionRequest,
    idempotencyKey: string
  ): Promise<IngestionResponse> {
    const existing = await this.repository.findByIdempotencyKey(idempotencyKey);

    if (existing) {
      return {
        ingestion_id: existing.ingestion_id,
        status: existing.status,
        idempotent_replay: true,
      };
    }

    const ingestionId = `ing_${randomUUID().replace(/-/g, '')}`;
    const now = nowIso();
    const task: IngestionTask = {
      ingestion_id: ingestionId,
      idempotency_key: idempotencyKey,
      status: 'received',
      source_system: req.source_system,
      source_record_id: req.source_record_id,
      source_type: req.source_type,
      target_domain: req.target_domain,
      content: req.content,
      submitted_at: req.submitted_at,
      timezone: req.timezone ?? 'Asia/Shanghai',
      submitted_by: req.submitted_by,
      dry_run: req.dry_run ?? true,
      attempt_count: 1,
      warnings: [],
      errors: [],
      duplicate_candidates: [],
      created_at: now,
      updated_at: now,
    };

    await this.repository.save(task);

    return {
      ingestion_id: ingestionId,
      status: 'received',
      idempotent_replay: false,
    };
  }

  async getIngestion(ingestionId: string): Promise<IngestionTask> {
    const task = await this.repository.findById(ingestionId);
    if (!task) {
      throw new NotFoundError(`Ingestion ${ingestionId} not found`);
    }
    return task;
  }

  async receiveCandidate(
    ingestionId: string,
    req: CandidateCallbackRequest
  ): Promise<{ ingestion_id: string; status: string; review_record_id: string }> {
    // Per-ingestion serialization: concurrent callbacks for the same ingestion
    // share a single in-flight promise so the pipeline runs once and all
    // callers observe the same review_record_id.
    const inFlight = this.pendingCandidates.get(ingestionId);
    if (inFlight) return inFlight;

    const promise = this.doReceiveCandidate(ingestionId, req).finally(() => {
      this.pendingCandidates.delete(ingestionId);
    });
    this.pendingCandidates.set(ingestionId, promise);
    return promise;
  }

  private async doReceiveCandidate(
    ingestionId: string,
    req: CandidateCallbackRequest
  ): Promise<{ ingestion_id: string; status: string; review_record_id: string }> {
    const task = await this.getIngestion(ingestionId);

    // Idempotent replay: candidate already processed (success or failure).
    // Return existing review_record_id (empty string when validation_failed).
    if (task.candidate) {
      return {
        ingestion_id: task.ingestion_id,
        status: task.status,
        review_record_id: task.review_record_id ?? '',
      };
    }

    // Step 1: Map candidate fields to the canonical Chinese schema.
    // The original Candidate is deep-cloned and persisted verbatim as raw
    // audit evidence (P0-02); only `mappedFields` feeds the Pipeline and
    // `normalized_fields`.
    const { mappedFields, warnings: mapperWarnings } = mapCustomerCandidate(
      req.candidate.fields
    );
    const sanitizedMapperWarnings = sanitizeMapperWarnings(mapperWarnings);
    const rawCandidate = deepClone(req.candidate) as CandidateRecord;
    const canonicalCandidate: CandidateRecord = { ...req.candidate, fields: mappedFields };

    // Step 2: Run the deterministic cleaning pipeline.
    const pipelineResult = runCleaningPipeline({
      schemaKey: 'customer',
      recordType: task.target_domain,
      data: mappedFields,
    });
    const pipelineEvidence = buildPipelineEvidence(pipelineResult);

    const now = nowIso();

    // Convert pipeline errors to the task's {field, code, message} shape,
    // using `stage` as the field identifier.
    const pipelineErrorsAsTaskErrors = pipelineResult.errors.map((e) => ({
      field: e.stage,
      code: e.code,
      message: e.message,
    }));

    // Step 3: On pipeline failure, save task as validation_failed and create no review.
    // Pipeline evidence is still persisted (P0-03) so the failure path keeps
    // the audit trail needed for diagnosis.
    if (!pipelineResult.success) {
      const failed: IngestionTask = {
        ...task,
        status: 'validation_failed',
        candidate: canonicalCandidate,
        raw_candidate: rawCandidate,
        workflow_run_id: req.workflow_run_id,
        warnings: sanitizedMapperWarnings,
        errors: pipelineErrorsAsTaskErrors,
        pipeline_evidence: pipelineEvidence,
        updated_at: now,
      };
      await this.repository.save(failed);
      return {
        ingestion_id: failed.ingestion_id,
        status: 'validation_failed',
        review_record_id: '',
      };
    }

    // Step 4: On success, create the review record with full pipeline evidence.
    // The review record shares the same pipeline evidence object as the task
    // to avoid duplicate transformation logic (P0-03). Raw Candidate evidence
    // is stored under `validation.rawCandidate` so the Feishu JSON evidence
    // column is reused without adding new Base fields (P0-02).
    const newReview: NewReviewRecord = {
      ingestion_id: task.ingestion_id,
      status: 'pending_review',
      candidate: canonicalCandidate,
      normalized_fields: pipelineResult.standardizedRecord,
      validation: {
        pipelineVersion: pipelineResult.pipelineVersion,
        stages: pipelineResult.stages,
        validation: pipelineResult.validation,
        corrections: pipelineResult.corrections,
        warnings: pipelineResult.warnings,
        errors: pipelineResult.errors,
        qualityReport: pipelineResult.qualityReport,
        rawCandidate,
      },
      updated_at: now,
    };
    const review = await this.reviewRepository.create(newReview);

    const updated: IngestionTask = {
      ...task,
      status: 'pending_review',
      candidate: canonicalCandidate,
      raw_candidate: rawCandidate,
      workflow_run_id: req.workflow_run_id,
      review_record_id: review.review_record_id,
      normalized_fields: pipelineResult.standardizedRecord,
      warnings: sanitizedMapperWarnings,
      errors: pipelineErrorsAsTaskErrors,
      pipeline_evidence: pipelineEvidence,
      updated_at: now,
    };
    await this.repository.save(updated);

    return {
      ingestion_id: updated.ingestion_id,
      status: 'pending_review',
      review_record_id: review.review_record_id,
    };
  }

  async approve(ingestionId: string, req: ReviewDecision): Promise<IngestionTask> {
    const task = await this.getIngestion(ingestionId);

    if (task.status === 'completed') {
      throw new ConflictError('Ingestion already completed');
    }

    if (task.status === 'review_rejected') {
      throw new ConflictError('Rejected ingestion cannot be approved');
    }

    if (task.review_record_id && task.review_record_id !== req.review_record_id) {
      throw new BadRequestError('Review record ID mismatch');
    }

    const now = nowIso();
    const updated: IngestionTask = {
      ...task,
      status: 'completed',
      reviewer_id: req.reviewer_id,
      review_decision: req.corrections && Object.keys(req.corrections).length > 0 ? 'modified' : 'approved',
      normalized_fields: req.corrections
        ? { ...(task.normalized_fields ?? {}), ...req.corrections }
        : task.normalized_fields,
      updated_at: now,
    };

    await this.repository.save(updated);
    return updated;
  }

  async reject(ingestionId: string, req: RejectRequest): Promise<IngestionTask> {
    const task = await this.getIngestion(ingestionId);

    if (task.status === 'completed') {
      throw new ConflictError('Completed ingestion cannot be rejected');
    }

    if (task.status === 'review_rejected') {
      // Idempotent
      return task;
    }

    const now = nowIso();
    const updated: IngestionTask = {
      ...task,
      status: 'review_rejected',
      reviewer_id: req.reviewer_id,
      review_decision: 'rejected',
      error_code: req.reason_code,
      error_message: req.reason,
      updated_at: now,
    };

    await this.repository.save(updated);
    return updated;
  }
}
