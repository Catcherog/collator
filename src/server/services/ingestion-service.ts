import { createHash, randomUUID } from 'crypto';
import type {
  CandidateCallbackRequest,
  CreateIngestionRequest,
  IngestionResponse,
  IngestionTask,
  RejectRequest,
  ReviewDecision,
} from '../domain/ingestion.js';
import { BadRequestError, ConflictError, NotFoundError } from '../domain/errors.js';
import type { TaskRepository } from '../repositories/task-repository.js';

function computeIdempotencyKey(req: CreateIngestionRequest): string {
  const normalizedContent = req.content.trim();
  const data = `${req.source_system}|${req.source_record_id}|${req.target_domain}|${normalizedContent}`;
  return createHash('sha256').update(data).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

export class IngestionService {
  private readonly pendingCreations = new Map<string, Promise<IngestionResponse>>();

  constructor(private readonly repository: TaskRepository) {}

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
    const task = await this.getIngestion(ingestionId);

    if (task.candidate) {
      // Idempotent replay: return existing review record
      return {
        ingestion_id: task.ingestion_id,
        status: task.status,
        review_record_id: task.review_record_id ?? '',
      };
    }

    const reviewRecordId = `rec_review_${randomUUID().replace(/-/g, '')}`;
    const now = nowIso();

    const updated: IngestionTask = {
      ...task,
      status: 'pending_review',
      candidate: req.candidate,
      workflow_run_id: req.workflow_run_id,
      review_record_id: reviewRecordId,
      updated_at: now,
    };

    await this.repository.save(updated);

    return {
      ingestion_id: updated.ingestion_id,
      status: updated.status,
      review_record_id: reviewRecordId,
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
