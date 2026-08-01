import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type RunManifestStatus =
  | 'generated'
  | 'confirmed'
  | 'consumed'
  | 'succeeded'
  | 'failed'
  | 'compensation_required'
  | 'compensated'
  | 'compensation_failed';

export type CreatedPilotRecordState = 'CREATED' | 'DELETED' | 'DELETE_FAILED';

export interface CreatedPilotRecord {
  entity: 'customer' | 'project' | 'model';
  recordId: string;
  createdAt: string;
  state: CreatedPilotRecordState;
  deletedAt?: string;
  errorCode?: string;
}

export interface CreateRunManifestInput {
  previewId: string;
  ingestionId: string;
  runId: string;
  previewDigest: string;
  operator: string;
  createdAt: string;
  expiresAt: string;
}

export interface ProductionPilotRunManifest extends CreateRunManifestInput {
  nonce: string;
  status: RunManifestStatus;
  confirmedAt?: string;
  consumedAt?: string;
  completedAt?: string;
  createdRecords: CreatedPilotRecord[];
}

export type RunManifestStateErrorCode =
  | 'RUN_MANIFEST_NOT_FOUND'
  | 'RUN_MANIFEST_STATE_INVALID'
  | 'RUN_MANIFEST_EXPIRED'
  | 'RUN_MANIFEST_OPERATOR_MISMATCH'
  | 'RUN_MANIFEST_RECORD_NOT_FOUND'
  | 'RUN_MANIFEST_RECORD_DUPLICATE'
  | 'RUN_MANIFEST_STORAGE_INVALID';

export class RunManifestStateError extends Error {
  readonly code: RunManifestStateErrorCode;

  constructor(code: RunManifestStateErrorCode, message: string) {
    super(message);
    this.name = 'RunManifestStateError';
    this.code = code;
  }
}

export interface RunManifestRepository {
  createGenerated(input: CreateRunManifestInput): Promise<ProductionPilotRunManifest>;
  findByPreviewId(previewId: string): Promise<ProductionPilotRunManifest | null>;
  findByRunId(runId: string): Promise<ProductionPilotRunManifest | null>;
  confirm(
    previewId: string,
    operator: string,
    now: string
  ): Promise<ProductionPilotRunManifest>;
  consume(previewId: string, now: string): Promise<ProductionPilotRunManifest>;
  recordCreated(
    previewId: string,
    record: Omit<CreatedPilotRecord, 'state'> & { state?: CreatedPilotRecordState }
  ): Promise<ProductionPilotRunManifest>;
  markCompensationRequired(previewId: string): Promise<ProductionPilotRunManifest>;
  markRecordDeleted(
    previewId: string,
    entity: CreatedPilotRecord['entity'],
    recordId: string,
    now?: string
  ): Promise<ProductionPilotRunManifest>;
  markRecordDeleteFailed(
    previewId: string,
    entity: CreatedPilotRecord['entity'],
    recordId: string,
    errorCode: string
  ): Promise<ProductionPilotRunManifest>;
  completeCompensation(
    previewId: string,
    success: boolean,
    now?: string
  ): Promise<ProductionPilotRunManifest>;
  completeSuccess(previewId: string, now?: string): Promise<ProductionPilotRunManifest>;
  findPendingCompensation(): Promise<ProductionPilotRunManifest[]>;
}

function cloneManifest(manifest: ProductionPilotRunManifest): ProductionPilotRunManifest {
  return JSON.parse(JSON.stringify(manifest)) as ProductionPilotRunManifest;
}

function createManifest(input: CreateRunManifestInput): ProductionPilotRunManifest {
  return {
    ...input,
    nonce: randomUUID(),
    status: 'generated',
    createdRecords: [],
  };
}

function requireManifest(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string
): ProductionPilotRunManifest {
  const manifest = manifests.get(previewId);
  if (!manifest) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_NOT_FOUND',
      `No production-pilot run manifest exists for preview ${previewId}`
    );
  }
  return manifest;
}

function assertOperator(manifest: ProductionPilotRunManifest, operator: string): void {
  if (manifest.operator !== operator) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_OPERATOR_MISMATCH',
      `Operator ${operator} is not authorized for preview ${manifest.previewId}`
    );
  }
}

function assertStatus(
  manifest: ProductionPilotRunManifest,
  expected: RunManifestStatus,
  operation: string
): void {
  if (manifest.status !== expected) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `Cannot ${operation} manifest ${manifest.previewId} while status is ${manifest.status}`
    );
  }
}

function assertNotExpired(manifest: ProductionPilotRunManifest, now: string): void {
  if (new Date(now).getTime() >= new Date(manifest.expiresAt).getTime()) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_EXPIRED',
      `Production-pilot preview ${manifest.previewId} expired at ${manifest.expiresAt}`
    );
  }
}

function findByRunIdInMap(
  manifests: Map<string, ProductionPilotRunManifest>,
  runId: string
): ProductionPilotRunManifest | null {
  for (const manifest of manifests.values()) {
    if (manifest.runId === runId) {
      return manifest;
    }
  }
  return null;
}

function applyCreateGenerated(
  manifests: Map<string, ProductionPilotRunManifest>,
  input: CreateRunManifestInput
): ProductionPilotRunManifest {
  const existing = manifests.get(input.previewId);
  if (existing) {
    if (existing.status === 'generated') {
      if (
        existing.ingestionId !== input.ingestionId
        || existing.runId !== input.runId
        || existing.previewDigest !== input.previewDigest
        || existing.operator !== input.operator
      ) {
        throw new RunManifestStateError(
          'RUN_MANIFEST_STATE_INVALID',
          `Preview ${input.previewId} is already bound to a different run context`
        );
      }
      return existing;
    }
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `Preview ${input.previewId} already has terminal or in-flight status ${existing.status}`
    );
  }

  const existingRun = findByRunIdInMap(manifests, input.runId);
  if (existingRun) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `Run ${input.runId} is already bound to preview ${existingRun.previewId}`
    );
  }

  const manifest = createManifest(input);
  manifests.set(manifest.previewId, manifest);
  return manifest;
}

function applyConfirm(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  operator: string,
  now: string
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  assertStatus(manifest, 'generated', 'confirm');
  assertOperator(manifest, operator);
  assertNotExpired(manifest, now);
  manifest.status = 'confirmed';
  manifest.confirmedAt = now;
  return manifest;
}

function applyConsume(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  now: string
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  assertStatus(manifest, 'confirmed', 'consume');
  assertNotExpired(manifest, now);
  manifest.status = 'consumed';
  manifest.consumedAt = now;
  return manifest;
}

function applyRecordCreated(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  record: Omit<CreatedPilotRecord, 'state'> & { state?: CreatedPilotRecordState }
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  if (!['consumed', 'compensation_required', 'failed', 'succeeded'].includes(manifest.status)) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `Cannot record a created record while manifest ${previewId} is ${manifest.status}`
    );
  }
  const duplicate = manifest.createdRecords.some(
    (created) => created.entity === record.entity && created.recordId === record.recordId
  );
  if (duplicate) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_RECORD_DUPLICATE',
      `Record ${record.entity}/${record.recordId} is already recorded for ${previewId}`
    );
  }
  manifest.createdRecords.push({
    ...record,
    state: record.state ?? 'CREATED',
  });
  return manifest;
}

function applyMarkCompensationRequired(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  if (manifest.status === 'compensation_required') {
    return manifest;
  }
  if (!['consumed', 'failed', 'succeeded'].includes(manifest.status)) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `Cannot start compensation while manifest ${previewId} is ${manifest.status}`
    );
  }
  manifest.status = 'compensation_required';
  return manifest;
}

function applyMarkRecordDeleted(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  entity: CreatedPilotRecord['entity'],
  recordId: string,
  now: string
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  const record = manifest.createdRecords.find(
    (created) => created.entity === entity && created.recordId === recordId
  );
  if (!record) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_RECORD_NOT_FOUND',
      `Record ${entity}/${recordId} is not recorded for ${previewId}`
    );
  }
  record.state = 'DELETED';
  record.deletedAt = now;
  record.errorCode = undefined;
  return manifest;
}

function applyMarkRecordDeleteFailed(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  entity: CreatedPilotRecord['entity'],
  recordId: string,
  errorCode: string
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  const record = manifest.createdRecords.find(
    (created) => created.entity === entity && created.recordId === recordId
  );
  if (!record) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_RECORD_NOT_FOUND',
      `Record ${entity}/${recordId} is not recorded for ${previewId}`
    );
  }
  record.state = 'DELETE_FAILED';
  record.errorCode = errorCode;
  return manifest;
}

function applyCompleteCompensation(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  success: boolean,
  now: string
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  if (!['compensation_required', 'compensation_failed'].includes(manifest.status)) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `Cannot complete compensation while manifest ${previewId} is ${manifest.status}`
    );
  }
  manifest.status = success ? 'compensated' : 'compensation_failed';
  manifest.completedAt = now;
  return manifest;
}

function applyCompleteSuccess(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  now: string
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  if (!['consumed', 'succeeded'].includes(manifest.status)) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `Cannot complete success while manifest ${previewId} is ${manifest.status}`
    );
  }
  manifest.status = 'succeeded';
  manifest.completedAt = now;
  return manifest;
}

class ManifestStateStore {
  private readonly manifests = new Map<string, ProductionPilotRunManifest>();

  restore(manifest: ProductionPilotRunManifest): void {
    this.manifests.set(manifest.previewId, manifest);
  }

  toArray(): ProductionPilotRunManifest[] {
    return Array.from(this.manifests.values());
  }

  createGenerated(input: CreateRunManifestInput): ProductionPilotRunManifest {
    return applyCreateGenerated(this.manifests, input);
  }

  findByPreviewId(previewId: string): ProductionPilotRunManifest | null {
    return this.manifests.get(previewId) ?? null;
  }

  findByRunId(runId: string): ProductionPilotRunManifest | null {
    return findByRunIdInMap(this.manifests, runId);
  }

  confirm(previewId: string, operator: string, now: string): ProductionPilotRunManifest {
    return applyConfirm(this.manifests, previewId, operator, now);
  }

  consume(previewId: string, now: string): ProductionPilotRunManifest {
    return applyConsume(this.manifests, previewId, now);
  }

  recordCreated(
    previewId: string,
    record: Omit<CreatedPilotRecord, 'state'> & { state?: CreatedPilotRecordState }
  ): ProductionPilotRunManifest {
    return applyRecordCreated(this.manifests, previewId, record);
  }

  markCompensationRequired(previewId: string): ProductionPilotRunManifest {
    return applyMarkCompensationRequired(this.manifests, previewId);
  }

  markRecordDeleted(
    previewId: string,
    entity: CreatedPilotRecord['entity'],
    recordId: string,
    now: string
  ): ProductionPilotRunManifest {
    return applyMarkRecordDeleted(this.manifests, previewId, entity, recordId, now);
  }

  markRecordDeleteFailed(
    previewId: string,
    entity: CreatedPilotRecord['entity'],
    recordId: string,
    errorCode: string
  ): ProductionPilotRunManifest {
    return applyMarkRecordDeleteFailed(this.manifests, previewId, entity, recordId, errorCode);
  }

  completeCompensation(
    previewId: string,
    success: boolean,
    now: string
  ): ProductionPilotRunManifest {
    return applyCompleteCompensation(this.manifests, previewId, success, now);
  }

  completeSuccess(previewId: string, now: string): ProductionPilotRunManifest {
    return applyCompleteSuccess(this.manifests, previewId, now);
  }

  findPendingCompensation(): ProductionPilotRunManifest[] {
    return Array.from(this.manifests.values()).filter((manifest) =>
      ['compensation_required', 'compensation_failed'].includes(manifest.status)
    );
  }
}

export class InMemoryRunManifestRepository implements RunManifestRepository {
  private readonly store = new ManifestStateStore();

  async createGenerated(input: CreateRunManifestInput): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.createGenerated(input));
  }

  async findByPreviewId(previewId: string): Promise<ProductionPilotRunManifest | null> {
    const manifest = this.store.findByPreviewId(previewId);
    return manifest ? cloneManifest(manifest) : null;
  }

  async findByRunId(runId: string): Promise<ProductionPilotRunManifest | null> {
    const manifest = this.store.findByRunId(runId);
    return manifest ? cloneManifest(manifest) : null;
  }

  async confirm(
    previewId: string,
    operator: string,
    now: string
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.confirm(previewId, operator, now));
  }

  async consume(previewId: string, now: string): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.consume(previewId, now));
  }

  async recordCreated(
    previewId: string,
    record: Omit<CreatedPilotRecord, 'state'> & { state?: CreatedPilotRecordState }
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.recordCreated(previewId, record));
  }

  async markCompensationRequired(previewId: string): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.markCompensationRequired(previewId));
  }

  async markRecordDeleted(
    previewId: string,
    entity: CreatedPilotRecord['entity'],
    recordId: string,
    now = new Date().toISOString()
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.markRecordDeleted(previewId, entity, recordId, now));
  }

  async markRecordDeleteFailed(
    previewId: string,
    entity: CreatedPilotRecord['entity'],
    recordId: string,
    errorCode: string
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.markRecordDeleteFailed(previewId, entity, recordId, errorCode));
  }

  async completeCompensation(
    previewId: string,
    success: boolean,
    now = new Date().toISOString()
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.completeCompensation(previewId, success, now));
  }

  async completeSuccess(
    previewId: string,
    now = new Date().toISOString()
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.completeSuccess(previewId, now));
  }

  async findPendingCompensation(): Promise<ProductionPilotRunManifest[]> {
    return this.store.findPendingCompensation().map(cloneManifest);
  }
}

export class FileRunManifestRepository implements RunManifestRepository {
  private operationTail: Promise<void> = Promise.resolve();
  private readonly lockPath: string;

  constructor(private readonly filePath: string) {
    this.lockPath = `${filePath}.lock`;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(
      () => this.withFileLock(operation),
      () => this.withFileLock(operation)
    );
    this.operationTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const startedAt = Date.now();
    let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
    while (!lockHandle) {
      try {
        lockHandle = await open(this.lockPath, 'wx');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        try {
          const lockStats = await stat(this.lockPath);
          if (Date.now() - lockStats.mtimeMs > 30_000) {
            await unlink(this.lockPath).catch(() => undefined);
            continue;
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw statError;
          }
        }
        if (Date.now() - startedAt > 5_000) {
          throw new RunManifestStateError(
            'RUN_MANIFEST_STORAGE_INVALID',
            `Timed out waiting for run manifest lock ${this.filePath}`
          );
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }

    try {
      return await operation();
    } finally {
      await lockHandle.close();
      await unlink(this.lockPath).catch(() => undefined);
    }
  }

  private async readStore(): Promise<ManifestStateStore> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new RunManifestStateError(
          'RUN_MANIFEST_STORAGE_INVALID',
          `Run manifest store ${this.filePath} must contain an array`
        );
      }
      const store = new ManifestStateStore();
      for (const item of parsed) {
        if (!item || typeof item !== 'object' || typeof (item as { previewId?: unknown }).previewId !== 'string') {
          throw new RunManifestStateError(
            'RUN_MANIFEST_STORAGE_INVALID',
            `Run manifest store ${this.filePath} contains an invalid entry`
          );
        }
        store.restore(item as ProductionPilotRunManifest);
      }
      return store;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new ManifestStateStore();
      }
      throw error;
    }
  }

  private async writeStore(store: ManifestStateStore): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(store.toArray(), null, 2), 'utf8');
    await rename(temporaryPath, this.filePath);
  }

  private async update<T>(operation: (store: ManifestStateStore) => T): Promise<T> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      const result = operation(store);
      await this.writeStore(store);
      return cloneValue(result);
    });
  }

  async createGenerated(input: CreateRunManifestInput): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.createGenerated(input));
  }

  async findByPreviewId(previewId: string): Promise<ProductionPilotRunManifest | null> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      const manifest = store.findByPreviewId(previewId);
      return manifest ? cloneManifest(manifest) : null;
    });
  }

  async findByRunId(runId: string): Promise<ProductionPilotRunManifest | null> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      const manifest = store.findByRunId(runId);
      return manifest ? cloneManifest(manifest) : null;
    });
  }

  async confirm(
    previewId: string,
    operator: string,
    now: string
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.confirm(previewId, operator, now));
  }

  async consume(previewId: string, now: string): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.consume(previewId, now));
  }

  async recordCreated(
    previewId: string,
    record: Omit<CreatedPilotRecord, 'state'> & { state?: CreatedPilotRecordState }
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.recordCreated(previewId, record));
  }

  async markCompensationRequired(previewId: string): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.markCompensationRequired(previewId));
  }

  async markRecordDeleted(
    previewId: string,
    entity: CreatedPilotRecord['entity'],
    recordId: string,
    now = new Date().toISOString()
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.markRecordDeleted(previewId, entity, recordId, now));
  }

  async markRecordDeleteFailed(
    previewId: string,
    entity: CreatedPilotRecord['entity'],
    recordId: string,
    errorCode: string
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.markRecordDeleteFailed(previewId, entity, recordId, errorCode));
  }

  async completeCompensation(
    previewId: string,
    success: boolean,
    now = new Date().toISOString()
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.completeCompensation(previewId, success, now));
  }

  async completeSuccess(
    previewId: string,
    now = new Date().toISOString()
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.completeSuccess(previewId, now));
  }

  async findPendingCompensation(): Promise<ProductionPilotRunManifest[]> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      return store.findPendingCompensation().map(cloneManifest);
    });
  }
}

function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
