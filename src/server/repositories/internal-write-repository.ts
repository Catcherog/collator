import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WriteTable } from '../business/write-plan.js';
import type { WriteErrorDetail } from '../../contracts/screenshot-api-v1.js';

export type InternalWriteStatus =
  | 'not_started'
  | 'preview_generated'
  | 'confirmed'
  | 'executing'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'result_unknown'
  | 'needs_reconciliation'
  | 'partial';

export type InternalWriteLogStatus =
  | 'intent'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'reconciled'
  | 'not_attempted';

export interface InternalWriteResultItem {
  entity_type: WriteTable;
  /** Alias only; the bound raw table ID is represented by a digest. */
  target_table_id: string;
  business_record_id: string | null;
  created: boolean;
  status: 'succeeded' | 'failed' | 'unknown' | 'not_attempted';
  error_code?: string;
  write_log_id?: string;
  /**
   * Redacted failure diagnostic: feishu_code / feishu_message / request_id /
   * offending field. Persisted so a partial write can be triaged after the
   * fact without re-running it (AC-05 / AC-06).
   */
  error_detail?: WriteErrorDetail;
}

export interface InternalControlledWriteResult {
  status: 'succeeded' | 'failed' | 'result_unknown' | 'needs_reconciliation' | 'partial';
  write_results: InternalWriteResultItem[];
  transaction_snapshot_id?: string;
  error_code?: string;
  additional_create_calls: number;
  completed_at?: string;
  reconciliation?: 'unique' | 'none' | 'multiple' | 'unavailable';
}

export interface InternalWritePreview {
  preview_id: string;
  nonce: string;
  ingestion_id: string;
  candidate_id: string;
  candidate_digest: string;
  governance_digest: string;
  authoritative_plan_digest: string;
  operator: string;
  target_tables: WriteTable[];
  target_table_digests: Partial<Record<WriteTable, string>>;
  base_token_digest?: string;
  created_at: string;
  expires_at: string;
  status: InternalWriteStatus;
  confirmed_by?: string;
  confirmed_at?: string;
  executed_by?: string;
  executed_at?: string;
  result?: InternalControlledWriteResult;
}

export interface NewInternalWritePreview extends Omit<InternalWritePreview, 'status'> {
  status?: InternalWriteStatus;
}

export interface InternalWriteLog {
  write_log_id: string;
  ingestion_id: string;
  preview_id: string;
  entity_type: WriteTable;
  /** Hash only.  Raw table IDs are intentionally excluded from this log. */
  logical_write_key: string;
  target_table_id_digest: string;
  business_record_id: string | null;
  request_started_at: string;
  request_completed_at?: string;
  operator: string;
  status: InternalWriteLogStatus;
  error_code?: string;
  resolved_at?: string;
}

export type NewInternalWriteLog = Omit<InternalWriteLog, 'write_log_id'> & {
  write_log_id?: string;
};

export interface InternalWriteRepository {
  createPreview(input: NewInternalWritePreview): Promise<InternalWritePreview>;
  findPreview(previewId: string): Promise<InternalWritePreview | null>;
  confirm(previewId: string, operator: string, nonce: string, now?: string): Promise<InternalWritePreview>;
  markExecuting(previewId: string, now?: string): Promise<InternalWritePreview>;
  markVerifying(previewId: string, now?: string): Promise<InternalWritePreview>;
  complete(previewId: string, result: InternalControlledWriteResult, executedBy?: string, executedAt?: string): Promise<InternalWritePreview>;
  completeExecution(previewId: string, result: InternalControlledWriteResult, executedBy?: string, executedAt?: string): Promise<InternalWritePreview>;
  completeReconciliation(previewId: string, result: InternalControlledWriteResult, executedBy?: string, executedAt?: string): Promise<InternalWritePreview>;
  appendWriteLog(input: NewInternalWriteLog): Promise<InternalWriteLog>;
  updateWriteLog(
    previewId: string,
    entityType: WriteTable,
    patch: Partial<Pick<InternalWriteLog, 'business_record_id' | 'status' | 'error_code' | 'resolved_at' | 'request_completed_at'>>,
  ): Promise<InternalWriteLog>;
  findWriteLogs(previewId: string): Promise<InternalWriteLog[]>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureNotExpired(preview: InternalWritePreview, now: string): void {
  if (Date.parse(preview.expires_at) <= Date.parse(now)) {
    throw new Error('INTERNAL_WRITE_PREVIEW_EXPIRED');
  }
}

function transition(preview: InternalWritePreview, next: InternalWriteStatus, now: string): InternalWritePreview {
  ensureNotExpired(preview, now);
  preview.status = next;
  return preview;
}

class InternalWriteStore {
  readonly previews = new Map<string, InternalWritePreview>();
  readonly logs = new Map<string, InternalWriteLog>();

  createPreview(input: NewInternalWritePreview): InternalWritePreview {
    if (this.previews.has(input.preview_id)) throw new Error('INTERNAL_WRITE_PREVIEW_EXISTS');
    const preview: InternalWritePreview = {
      ...clone(input),
      status: input.status ?? 'preview_generated',
    };
    this.previews.set(preview.preview_id, preview);
    return clone(preview);
  }

  findPreview(previewId: string): InternalWritePreview | null {
    const preview = this.previews.get(previewId);
    return preview ? clone(preview) : null;
  }

  confirm(previewId: string, operator: string, nonce: string, now: string): InternalWritePreview {
    const preview = this.previews.get(previewId);
    if (!preview) throw new Error('INTERNAL_WRITE_PREVIEW_NOT_FOUND');
    if (preview.operator !== operator) throw new Error('INTERNAL_WRITE_OPERATOR_MISMATCH');
    if (preview.nonce !== nonce) throw new Error('INTERNAL_WRITE_NONCE_MISMATCH');
    if (preview.status === 'confirmed' || preview.status === 'executing' || preview.status === 'verifying') {
      return clone(preview);
    }
    if (preview.status !== 'preview_generated') throw new Error('INTERNAL_WRITE_PREVIEW_NOT_CONFIRMABLE');
    transition(preview, 'confirmed', now);
    preview.confirmed_by = operator;
    preview.confirmed_at = now;
    this.previews.set(previewId, preview);
    return clone(preview);
  }

  mark(previewId: string, next: InternalWriteStatus, now: string): InternalWritePreview {
    const preview = this.previews.get(previewId);
    if (!preview) throw new Error('INTERNAL_WRITE_PREVIEW_NOT_FOUND');
    if (preview.status === 'succeeded' || preview.status === 'result_unknown' || preview.status === 'partial' || preview.status === 'needs_reconciliation') {
      return clone(preview);
    }
    if (next === 'executing' && preview.status !== 'confirmed') throw new Error('INTERNAL_WRITE_PREVIEW_NOT_CONFIRMED');
    if (next === 'verifying' && preview.status !== 'executing') throw new Error('INTERNAL_WRITE_PREVIEW_NOT_EXECUTING');
    transition(preview, next, now);
    this.previews.set(previewId, preview);
    return clone(preview);
  }

  complete(
    previewId: string,
    result: InternalControlledWriteResult,
    executedBy?: string,
    executedAt = new Date().toISOString(),
  ): InternalWritePreview {
    return this.completeWithSource(previewId, result, executedBy, executedAt, 'generic');
  }

  completeExecution(
    previewId: string,
    result: InternalControlledWriteResult,
    executedBy?: string,
    executedAt = new Date().toISOString(),
  ): InternalWritePreview {
    return this.completeWithSource(previewId, result, executedBy, executedAt, 'execution');
  }

  completeReconciliation(
    previewId: string,
    result: InternalControlledWriteResult,
    executedBy?: string,
    executedAt = new Date().toISOString(),
  ): InternalWritePreview {
    return this.completeWithSource(previewId, result, executedBy, executedAt, 'reconciliation');
  }

  private completeWithSource(
    previewId: string,
    result: InternalControlledWriteResult,
    executedBy: string | undefined,
    executedAt: string,
    source: 'generic' | 'execution' | 'reconciliation',
  ): InternalWritePreview {
    const preview = this.previews.get(previewId);
    if (!preview) throw new Error('INTERNAL_WRITE_PREVIEW_NOT_FOUND');

    // A successful reconciliation is a terminal commit.  Every stale
    // execution callback must observe it and become a no-op.
    if (preview.status === 'succeeded') return clone(preview);

    const allowedStatuses = source === 'execution'
      ? ['executing', 'verifying', 'result_unknown']
      : source === 'reconciliation'
        ? ['result_unknown', 'needs_reconciliation']
        : result.status === 'succeeded'
          ? ['executing', 'verifying', 'result_unknown', 'needs_reconciliation']
          : ['executing', 'verifying', 'result_unknown'];
    if (!allowedStatuses.includes(preview.status)) return clone(preview);
    if (source === 'reconciliation' && !['succeeded', 'needs_reconciliation'].includes(result.status)) {
      return clone(preview);
    }

    const status: InternalWriteStatus = result.status;
    preview.status = status;
    preview.result = clone(result);
    preview.executed_by = executedBy ?? preview.operator;
    preview.executed_at = executedAt;
    this.previews.set(previewId, preview);
    return clone(preview);
  }

  appendWriteLog(input: NewInternalWriteLog): InternalWriteLog {
    const log: InternalWriteLog = {
      ...clone(input),
      write_log_id: input.write_log_id ?? randomUUID(),
    };
    this.logs.set(log.write_log_id, log);
    return clone(log);
  }

  updateWriteLog(
    previewId: string,
    entityType: WriteTable,
    patch: Partial<Pick<InternalWriteLog, 'business_record_id' | 'status' | 'error_code' | 'resolved_at' | 'request_completed_at'>>,
  ): InternalWriteLog {
    const log = Array.from(this.logs.values()).find(
      (candidate) => candidate.preview_id === previewId && candidate.entity_type === entityType,
    );
    if (!log) throw new Error('INTERNAL_WRITE_LOG_NOT_FOUND');
    Object.assign(log, clone(patch));
    this.logs.set(log.write_log_id, log);
    return clone(log);
  }

  findWriteLogs(previewId: string): InternalWriteLog[] {
    return Array.from(this.logs.values())
      .filter((log) => log.preview_id === previewId)
      .map(clone);
  }

  toJson(): { previews: InternalWritePreview[]; logs: InternalWriteLog[] } {
    return {
      previews: Array.from(this.previews.values()).map(clone),
      logs: Array.from(this.logs.values()).map(clone),
    };
  }

  restore(input: { previews?: InternalWritePreview[]; logs?: InternalWriteLog[] }): void {
    for (const preview of input.previews ?? []) {
      this.previews.set(preview.preview_id, clone(preview));
    }
    for (const log of input.logs ?? []) {
      this.logs.set(log.write_log_id, clone(log));
    }
  }
}

export class InMemoryInternalWriteRepository implements InternalWriteRepository {
  private readonly store = new InternalWriteStore();

  async createPreview(input: NewInternalWritePreview): Promise<InternalWritePreview> {
    return this.store.createPreview(input);
  }

  async findPreview(previewId: string): Promise<InternalWritePreview | null> {
    return this.store.findPreview(previewId);
  }

  async confirm(previewId: string, operator: string, nonce: string, now = new Date().toISOString()): Promise<InternalWritePreview> {
    return this.store.confirm(previewId, operator, nonce, now);
  }

  async markExecuting(previewId: string, now = new Date().toISOString()): Promise<InternalWritePreview> {
    return this.store.mark(previewId, 'executing', now);
  }

  async markVerifying(previewId: string, now = new Date().toISOString()): Promise<InternalWritePreview> {
    return this.store.mark(previewId, 'verifying', now);
  }

  async complete(previewId: string, result: InternalControlledWriteResult, executedBy?: string, executedAt?: string): Promise<InternalWritePreview> {
    return this.store.complete(previewId, result, executedBy, executedAt);
  }

  async completeExecution(previewId: string, result: InternalControlledWriteResult, executedBy?: string, executedAt?: string): Promise<InternalWritePreview> {
    return this.store.completeExecution(previewId, result, executedBy, executedAt);
  }

  async completeReconciliation(previewId: string, result: InternalControlledWriteResult, executedBy?: string, executedAt?: string): Promise<InternalWritePreview> {
    return this.store.completeReconciliation(previewId, result, executedBy, executedAt);
  }

  async appendWriteLog(input: NewInternalWriteLog): Promise<InternalWriteLog> {
    return this.store.appendWriteLog(input);
  }

  async updateWriteLog(previewId: string, entityType: WriteTable, patch: Partial<Pick<InternalWriteLog, 'business_record_id' | 'status' | 'error_code' | 'resolved_at' | 'request_completed_at'>>): Promise<InternalWriteLog> {
    return this.store.updateWriteLog(previewId, entityType, patch);
  }

  async findWriteLogs(previewId: string): Promise<InternalWriteLog[]> {
    return this.store.findWriteLogs(previewId);
  }
}

export class FileInternalWriteRepository implements InternalWriteRepository {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async readStore(): Promise<InternalWriteStore> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as { previews?: InternalWritePreview[]; logs?: InternalWriteLog[] };
      const store = new InternalWriteStore();
      store.restore(parsed);
      return store;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new InternalWriteStore();
      throw error;
    }
  }

  private async writeStore(store: InternalWriteStore): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, JSON.stringify(store.toJson(), null, 2), 'utf8');
      await rename(tempPath, this.filePath);
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  private async update<T>(operation: (store: InternalWriteStore) => T): Promise<T> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      const result = operation(store);
      await this.writeStore(store);
      return clone(result);
    });
  }

  async createPreview(input: NewInternalWritePreview): Promise<InternalWritePreview> {
    return this.update((store) => store.createPreview(input));
  }

  async findPreview(previewId: string): Promise<InternalWritePreview | null> {
    return this.enqueue(async () => (await this.readStore()).findPreview(previewId));
  }

  async confirm(previewId: string, operator: string, nonce: string, now = new Date().toISOString()): Promise<InternalWritePreview> {
    return this.update((store) => store.confirm(previewId, operator, nonce, now));
  }

  async markExecuting(previewId: string, now = new Date().toISOString()): Promise<InternalWritePreview> {
    return this.update((store) => store.mark(previewId, 'executing', now));
  }

  async markVerifying(previewId: string, now = new Date().toISOString()): Promise<InternalWritePreview> {
    return this.update((store) => store.mark(previewId, 'verifying', now));
  }

  async complete(previewId: string, result: InternalControlledWriteResult, executedBy?: string, executedAt?: string): Promise<InternalWritePreview> {
    return this.update((store) => store.complete(previewId, result, executedBy, executedAt));
  }

  async completeExecution(previewId: string, result: InternalControlledWriteResult, executedBy?: string, executedAt?: string): Promise<InternalWritePreview> {
    return this.update((store) => store.completeExecution(previewId, result, executedBy, executedAt));
  }

  async completeReconciliation(previewId: string, result: InternalControlledWriteResult, executedBy?: string, executedAt?: string): Promise<InternalWritePreview> {
    return this.update((store) => store.completeReconciliation(previewId, result, executedBy, executedAt));
  }

  async appendWriteLog(input: NewInternalWriteLog): Promise<InternalWriteLog> {
    return this.update((store) => store.appendWriteLog(input));
  }

  async updateWriteLog(previewId: string, entityType: WriteTable, patch: Partial<Pick<InternalWriteLog, 'business_record_id' | 'status' | 'error_code' | 'resolved_at' | 'request_completed_at'>>): Promise<InternalWriteLog> {
    return this.update((store) => store.updateWriteLog(previewId, entityType, patch));
  }

  async findWriteLogs(previewId: string): Promise<InternalWriteLog[]> {
    return this.enqueue(async () => (await this.readStore()).findWriteLogs(previewId));
  }
}
