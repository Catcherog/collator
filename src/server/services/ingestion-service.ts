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
import {
  BadRequestError,
  ConflictError,
  FeishuCommitFailedError,
  NotFoundError,
} from '../domain/errors.js';
import type { TaskRepository } from '../repositories/task-repository.js';
import type { NewReviewRecord, ReviewRepository } from '../repositories/review-repository.js';
import type {
  WriteLogRepository,
} from '../repositories/write-log-repository.js';
import type {
  CustomerRecordWriter,
} from '../business/customer-record-writer.js';
import { FeishuApiError } from '../feishu/feishu-errors.js';
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
  private readonly pendingApprovals = new Map<string, Promise<IngestionTask>>();

  constructor(
    private readonly repository: TaskRepository,
    private readonly reviewRepository: ReviewRepository,
    /**
     * Optional customer-record writer. A non-dry-run approval fails closed
     * when the TASK-003 commit dependencies are absent. The legacy path is
     * retained only for dry-run compatibility.
     *
     * When present, approve() runs the full TASK-003 commit flow:
     * pending_review → approved → committing → completed / commit_failed.
     */
    private readonly customerRecordWriter?: CustomerRecordWriter,
    /**
     * Optional write-log repository. When `customerRecordWriter` is
     * present this must also be present so the audit trail is persisted.
     * Partial dependency injection is rejected by the constructor.
     */
    private readonly writeLogRepository?: WriteLogRepository
  ) {
    if (Boolean(customerRecordWriter) !== Boolean(writeLogRepository)) {
      throw new Error(
        'Customer record writer and write-log repository must be configured together'
      );
    }
  }

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
    // Per-ingestion serialization: concurrent approve calls for the same
    // ingestion share a single in-flight promise so the commit flow runs
    // once and all callers observe the same final task. This is critical
    // for commit_failed retries — without serialization two concurrent
    // retries could both think no customer write has happened yet.
    const inFlight = this.pendingApprovals.get(ingestionId);
    if (inFlight) return inFlight;

    const promise = this.doApprove(ingestionId, req).finally(() => {
      this.pendingApprovals.delete(ingestionId);
    });
    this.pendingApprovals.set(ingestionId, promise);
    return promise;
  }

  private async doApprove(ingestionId: string, req: ReviewDecision): Promise<IngestionTask> {
    const task = await this.getIngestion(ingestionId);

    if (task.status === 'completed') {
      throw new ConflictError('Ingestion already completed');
    }

    if (task.status === 'review_rejected') {
      throw new ConflictError('Rejected ingestion cannot be approved');
    }

    if (!['pending_review', 'commit_failed', 'approved', 'committing'].includes(task.status)) {
      throw new ConflictError('Ingestion is not awaiting approval');
    }

    if (task.review_record_id && task.review_record_id !== req.review_record_id) {
      throw new BadRequestError('Review record ID mismatch');
    }

    if (!task.dry_run && (!this.customerRecordWriter || !this.writeLogRepository)) {
      throw new Error('Customer commit flow is not configured');
    }

    // Re-map corrections (TASK-002 supports English corrections keys) and
    // re-run the deterministic cleaning pipeline so the persisted
    // normalized_fields reflect the human-approved final values. The
    // original task.normalized_fields is never mutated in place.
    const finalNormalizedFields = this.applyCorrections(task, req.corrections);

    const now = nowIso();
    // Stage 1: pending_review (or commit_failed retry) -> approved.
    // Persist the approved snapshot before attempting the customer write
    // so a crash between approve and commit leaves the task in a
    // recoverable state with the human decision captured.
    const approvedTask: IngestionTask = {
      ...task,
      status: 'approved',
      reviewer_id: req.reviewer_id,
      review_decision:
        req.corrections && Object.keys(req.corrections).length > 0
          ? 'modified'
          : 'approved',
      normalized_fields: finalNormalizedFields,
      updated_at: now,
    };
    await this.repository.save(approvedTask);

    // Legacy dry-run compatibility path. Non-dry-run approvals fail closed
    // above when the commit dependencies are absent.
    if (!this.customerRecordWriter || !this.writeLogRepository) {
      const completedTask: IngestionTask = {
        ...approvedTask,
        status: 'completed',
        updated_at: nowIso(),
      };
      await this.repository.save(completedTask);
      return completedTask;
    }

    if (approvedTask.dry_run) {
      return this.handleDryRunApprove(approvedTask);
    }

    return this.handleCommitFlow(approvedTask, finalNormalizedFields);
  }

  /**
   * Merge human corrections into the task's normalised fields. Corrections
   * may use English keys (TASK-002 candidate schema) or Chinese canonical
   * keys; English keys are mapped through `mapCustomerCandidate` before
   * being merged. The pipeline is then re-run on the merged result so
   * enum mapping / format cleaning / validation reflect the final
   * human-approved values.
   *
   * Returns a fresh object; the task input is not mutated.
   */
  private applyCorrections(
    task: IngestionTask,
    corrections?: Record<string, unknown>
  ): Record<string, unknown> {
    if (!corrections || Object.keys(corrections).length === 0) {
      return task.normalized_fields ?? {};
    }
    // Map corrections through the same English->Chinese mapper used for
    // candidates. Chinese keys pass through; English keys are translated;
    // unknown keys are dropped (with warnings we discard here since the
    // human explicitly typed them — the merge below still includes any
    // Chinese keys verbatim).
    const { mappedFields } = mapCustomerCandidate(corrections);
    const merged = { ...(task.normalized_fields ?? {}), ...mappedFields };
    // Re-run the deterministic pipeline so enum mapping, format cleaning,
    // and validation reflect the corrected values. We only persist the
    // standardizedRecord; pipeline evidence is already on the task from
    // the candidate stage and we don't want to overwrite it with a
    // corrections-only run.
    const result = runCleaningPipeline({
      schemaKey: 'customer',
      recordType: task.target_domain,
      data: merged,
    });
    if (result.success) {
      return result.standardizedRecord;
    }
    // If the corrected values fail the pipeline, persist the raw merge
    // so the human can see what they entered. The pipeline failure
    // does not block the commit flow — the human reviewer is the
    // final authority.
    return merged;
  }

  /**
   * dry_run=true path: no customer write, write log status=skipped_dry_run,
   * task status=completed. business_record_id remains undefined.
   */
  private async handleDryRunApprove(
    approvedTask: IngestionTask
  ): Promise<IngestionTask> {
    const now = nowIso();
    // Persist a skipped_dry_run write log so auditors can see the
    // human approval happened even though no customer record was
    // written.
    try {
      await this.writeLogRepository!.create({
        ingestion_id: approvedTask.ingestion_id,
        target_table_id: 'dry_run',
        status: 'skipped_dry_run',
        created_at: now,
      });
    } catch (e) {
      throw new FeishuCommitFailedError(
        `Dry-run audit failed: ${(e as Error)?.name ?? 'UnknownError'}`
      );
    }

    const completedTask: IngestionTask = {
      ...approvedTask,
      status: 'completed',
      updated_at: now,
    };
    await this.repository.save(completedTask);

    return completedTask;
  }

  /**
   * Full commit flow: approved -> committing -> try customer write ->
   * completed (success) / commit_failed (failure).
   *
   * On failure the task is persisted as `commit_failed` and a sanitised
   * write-log entry is created before re-throwing `FeishuCommitFailedError`
   * so the HTTP layer returns 502.
   */
  private async handleCommitFlow(
    approvedTask: IngestionTask,
    finalNormalizedFields: Record<string, unknown>
  ): Promise<IngestionTask> {
    const targetTableId = this.getCustomerTableId();

    // Stage 2: approved -> committing.
    const committingTask: IngestionTask = {
      ...approvedTask,
      status: 'committing',
      updated_at: nowIso(),
    };
    await this.repository.save(committingTask);

    // Stage 3: try customer write.
    let businessRecordId: string;
    try {
      const result = await this.customerRecordWriter!.write({
        ingestionId: committingTask.ingestion_id,
        normalizedFields: finalNormalizedFields,
      });
      businessRecordId = result.business_record_id;
    } catch (e) {
      // Persist commit_failed and a sanitised write-log entry before
      // re-throwing. The HTTP layer converts FeishuCommitFailedError to
      // HTTP 502; any other error type surfaces as INTERNAL_ERROR (500)
      // but the task state is still recoverable.
      const failedTask: IngestionTask = {
        ...committingTask,
        status: 'commit_failed',
        // Both FeishuApiError (raw from lower-level Feishu calls) and
        // FeishuCommitFailedError (wrapped by FeishuCustomerRecordWriter)
        // are classified as FEISHU_COMMIT_FAILED per TASK-003 spec: any
        // Feishu-side commit failure surfaces as HTTP 502 with this code.
        error_code:
          e instanceof FeishuCommitFailedError || e instanceof FeishuApiError
            ? 'FEISHU_COMMIT_FAILED'
            : 'COMMIT_FAILED',
        error_message: this.sanitiseCommitErrorMessage(e),
        updated_at: nowIso(),
      };
      await this.repository.save(failedTask);

      try {
        await this.writeLogRepository!.create({
          ingestion_id: failedTask.ingestion_id,
          target_table_id: targetTableId,
          status: 'failed',
          error_code: failedTask.error_code,
          redacted_error_message: failedTask.error_message,
          created_at: failedTask.updated_at,
        });
      } catch {
        // Write-log failure must not mask the original commit failure.
      }

      // Re-throw FeishuCommitFailedError as-is; wrap unknown errors so
      // the HTTP layer returns 502 (the caller can retry idempotently).
      if (e instanceof FeishuCommitFailedError) throw e;
      throw new FeishuCommitFailedError(
        `Commit failed: ${(e as Error)?.name ?? 'UnknownError'}`
      );
    }

    const completedAt = nowIso();
    try {
      await this.writeLogRepository!.create({
        ingestion_id: committingTask.ingestion_id,
        target_table_id: targetTableId,
        business_record_id: businessRecordId,
        status: 'succeeded',
        created_at: completedAt,
      });
    } catch (e) {
      const failedTask: IngestionTask = {
        ...committingTask,
        status: 'commit_failed',
        error_code: 'COMMIT_AUDIT_FAILED',
        error_message: this.sanitiseCommitErrorMessage(e),
        updated_at: nowIso(),
      };
      await this.repository.save(failedTask);
      throw new FeishuCommitFailedError(
        `Commit audit failed: ${(e as Error)?.name ?? 'UnknownError'}`
      );
    }

    // Stage 4: committing -> completed only after the succeeded audit entry
    // is durable. A retry can safely reuse the same customer record.
    const completedTask: IngestionTask = {
      ...committingTask,
      status: 'completed',
      business_record_id: businessRecordId,
      // Clear any prior commit_failed error fields on successful retry.
      error_code: undefined,
      error_message: undefined,
      updated_at: completedAt,
    };
    await this.repository.save(completedTask);

    return completedTask;
  }

  /**
   * Derive the customer table ID for the write log's `target_table_id`
   * field. We read it from the writer's options if available; otherwise
   * fall back to the opaque string 'customer' so auditors still have a
   * stable label.
   */
  private getCustomerTableId(): string {
    const writer = this.customerRecordWriter as
      | { options?: { customerTableId?: string } }
      | undefined;
    return writer?.options?.customerTableId ?? 'customer';
  }

  /**
   * Sanitise a commit error message for write-log persistence.
   * FeishuApiError already redacts phones and excludes app_secret; we
   * pass its message through. Unknown errors are reduced to their
   * `name` so no internal stack trace or PII leaks into the audit log.
   */
  private sanitiseCommitErrorMessage(e: unknown): string {
    if (e instanceof FeishuApiError) {
      return e.message;
    }
    if (e instanceof FeishuCommitFailedError) {
      return e.message;
    }
    return `Commit failed: ${(e as Error)?.name ?? 'UnknownError'}`;
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
