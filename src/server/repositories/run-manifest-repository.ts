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

export type CreateIntentState = 'PENDING' | 'CREATED' | 'NOT_FOUND';

export type PilotEntity = 'customer' | 'project' | 'model';

export interface CreateRecordIntent {
  entity: PilotEntity;
  tableId: string;
  ingestionId: string;
  operationKey: string;
  clientToken: string;
  createdAt: string;
  state: CreateIntentState;
  recordId?: string;
  resolvedAt?: string;
}

export interface CreatedPilotRecord {
  entity: PilotEntity;
  recordId: string;
  createdAt: string;
  state: CreatedPilotRecordState;
  operationKey?: string;
  tableId?: string;
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
  /** Server-owned bindings. They are persisted but never accepted from the execute request. */
  candidateDigest?: string;
  governanceDigest?: string;
  authoritativePlanDigest?: string;
  targetTables?: PilotEntity[];
  targetTableDigests?: Partial<Record<PilotEntity, string>>;
  baseTokenDigest?: string;
}

export interface ProductionPilotRunManifest extends CreateRunManifestInput {
  nonce: string;
  status: RunManifestStatus;
  confirmedAt?: string;
  consumedAt?: string;
  completedAt?: string;
  createdRecords: CreatedPilotRecord[];
  createIntents: CreateRecordIntent[];
}

export type RunManifestStateErrorCode =
  | 'RUN_MANIFEST_NOT_FOUND'
  | 'RUN_MANIFEST_STATE_INVALID'
  | 'RUN_MANIFEST_EXPIRED'
  | 'RUN_MANIFEST_OPERATOR_MISMATCH'
  | 'RUN_MANIFEST_RECORD_NOT_FOUND'
  | 'RUN_MANIFEST_RECORD_DUPLICATE'
  | 'RUN_MANIFEST_NONCE_MISMATCH'
  | 'RUN_MANIFEST_CREATE_INTENT_NOT_FOUND'
  | 'RUN_MANIFEST_RECOVERY_AMBIGUOUS'
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
    now: string,
    nonce?: string
  ): Promise<ProductionPilotRunManifest>;
  consume(
    previewId: string,
    now: string,
    operator?: string,
    nonce?: string
  ): Promise<ProductionPilotRunManifest>;
  recordCreateIntent(
    previewId: string,
    intent: Omit<CreateRecordIntent, 'state'> & { state?: CreateIntentState }
  ): Promise<ProductionPilotRunManifest>;
  markCreateIntentResolved(
    previewId: string,
    operationKey: string,
    state: Exclude<CreateIntentState, 'PENDING'>,
    recordId?: string,
    now?: string
  ): Promise<ProductionPilotRunManifest>;
  recordCreated(
    previewId: string,
    record: Omit<CreatedPilotRecord, 'state'> & {
      state?: CreatedPilotRecordState;
      operationKey?: string;
    }
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
  validate(): Promise<void>;
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
    createIntents: [],
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

function assertNonce(manifest: ProductionPilotRunManifest, nonce: string | undefined): void {
  if (nonce !== undefined && manifest.nonce !== nonce) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_NONCE_MISMATCH',
      `Nonce does not match production-pilot preview ${manifest.previewId}`
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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameServerBindings(
  existing: ProductionPilotRunManifest,
  input: CreateRunManifestInput,
): boolean {
  return existing.candidateDigest === input.candidateDigest
    && existing.governanceDigest === input.governanceDigest
    && existing.authoritativePlanDigest === input.authoritativePlanDigest
    && existing.baseTokenDigest === input.baseTokenDigest
    && sameJson(existing.targetTables, input.targetTables)
    && sameJson(existing.targetTableDigests, input.targetTableDigests);
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
        || !sameServerBindings(existing, input)
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
  now: string,
  nonce?: string
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  assertStatus(manifest, 'generated', 'confirm');
  assertOperator(manifest, operator);
  assertNonce(manifest, nonce);
  assertNotExpired(manifest, now);
  manifest.status = 'confirmed';
  manifest.confirmedAt = now;
  return manifest;
}

function applyConsume(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  now: string,
  operator?: string,
  nonce?: string
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  assertStatus(manifest, 'confirmed', 'consume');
  if (operator !== undefined) assertOperator(manifest, operator);
  assertNonce(manifest, nonce);
  assertNotExpired(manifest, now);
  manifest.status = 'consumed';
  manifest.consumedAt = now;
  return manifest;
}

function applyCreateIntent(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  intent: Omit<CreateRecordIntent, 'state'> & { state?: CreateIntentState }
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  const state = intent.state ?? 'PENDING';
  if (state === 'CREATED' && !intent.recordId) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `CREATE_INTENT ${intent.operationKey} requires a record id when created`
    );
  }
  if (state === 'NOT_FOUND' && intent.recordId !== undefined) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `CREATE_INTENT ${intent.operationKey} cannot carry a record id when not found`
    );
  }
  if (!['consumed', 'compensation_required'].includes(manifest.status)) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `Cannot record a CREATE_INTENT while manifest ${previewId} is ${manifest.status}`
    );
  }
  const existing = manifest.createIntents.find((candidate) => candidate.operationKey === intent.operationKey);
  if (existing) {
    if (
      existing.entity !== intent.entity
      || existing.tableId !== intent.tableId
      || existing.clientToken !== intent.clientToken
      || existing.ingestionId !== intent.ingestionId
    ) {
      throw new RunManifestStateError(
        'RUN_MANIFEST_STATE_INVALID',
        `CREATE_INTENT ${intent.operationKey} is bound to a different record operation`
      );
    }
    return manifest;
  }
  manifest.createIntents.push({ ...intent, state });
  return manifest;
}

function applyMarkCreateIntentResolved(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  operationKey: string,
  state: Exclude<CreateIntentState, 'PENDING'>,
  recordId: string | undefined,
  now: string
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  if (state === 'CREATED' && !recordId) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `CREATE_INTENT ${operationKey} requires a record id when resolved as CREATED`
    );
  }
  if (state === 'NOT_FOUND' && recordId !== undefined) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `CREATE_INTENT ${operationKey} cannot carry a record id when resolved as NOT_FOUND`
    );
  }
  if (!['consumed', 'compensation_required'].includes(manifest.status)) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `Cannot resolve a CREATE_INTENT while manifest ${previewId} is ${manifest.status}`
    );
  }
  const intent = manifest.createIntents.find((candidate) => candidate.operationKey === operationKey);
  if (!intent) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_CREATE_INTENT_NOT_FOUND',
      `No CREATE_INTENT ${operationKey} exists for ${previewId}`
    );
  }
  if (intent.state !== 'PENDING') {
    if (intent.state === state && intent.recordId === recordId) return manifest;
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `CREATE_INTENT ${operationKey} is already resolved for ${previewId}`
    );
  }
  intent.state = state;
  intent.recordId = recordId;
  intent.resolvedAt = now;
  return manifest;
}

function applyRecordCreated(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  record: Omit<CreatedPilotRecord, 'state'> & { state?: CreatedPilotRecordState; operationKey?: string }
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  if (!['consumed', 'compensation_required'].includes(manifest.status)) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `Cannot record a created record while manifest ${previewId} is ${manifest.status}`
    );
  }
  if (manifest.createIntents.length > 0 && !record.operationKey) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_STATE_INVALID',
      `CREATE_CONFIRMED for ${previewId} must reference its CREATE_INTENT`
    );
  }
  const intent = record.operationKey
    ? manifest.createIntents.find((candidate) => candidate.operationKey === record.operationKey)
    : undefined;
  if (record.operationKey && !intent) {
    throw new RunManifestStateError(
      'RUN_MANIFEST_CREATE_INTENT_NOT_FOUND',
      `No CREATE_INTENT ${record.operationKey} exists for ${previewId}`
    );
  }
  if (intent) {
    if (intent.entity !== record.entity || intent.tableId !== record.tableId) {
      throw new RunManifestStateError(
        'RUN_MANIFEST_STATE_INVALID',
        `CREATE_CONFIRMED ${record.operationKey} does not match its CREATE_INTENT`
      );
    }
    if (intent.state === 'CREATED' && intent.recordId === record.recordId) return manifest;
    if (intent.state !== 'PENDING') {
      throw new RunManifestStateError(
        'RUN_MANIFEST_STATE_INVALID',
        `CREATE_INTENT ${intent.operationKey} is not pending for ${previewId}`
      );
    }
    intent.state = 'CREATED';
    intent.recordId = record.recordId;
    intent.resolvedAt = record.createdAt;
  }
  const duplicate = manifest.createdRecords.some(
    (created) => created.entity === record.entity && created.recordId === record.recordId
  );
  if (duplicate) {
    return manifest;
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
  if (!['confirmed', 'consumed', 'failed', 'succeeded'].includes(manifest.status)) {
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
    this.manifests.set(manifest.previewId, {
      ...manifest,
      createdRecords: manifest.createdRecords === undefined ? [] : manifest.createdRecords,
      createIntents: manifest.createIntents === undefined ? [] : manifest.createIntents,
    });
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

  confirm(previewId: string, operator: string, now: string, nonce?: string): ProductionPilotRunManifest {
    return applyConfirm(this.manifests, previewId, operator, now, nonce);
  }

  consume(previewId: string, now: string, operator?: string, nonce?: string): ProductionPilotRunManifest {
    return applyConsume(this.manifests, previewId, now, operator, nonce);
  }

  recordCreateIntent(
    previewId: string,
    intent: Omit<CreateRecordIntent, 'state'> & { state?: CreateIntentState }
  ): ProductionPilotRunManifest {
    return applyCreateIntent(this.manifests, previewId, intent);
  }

  markCreateIntentResolved(
    previewId: string,
    operationKey: string,
    state: Exclude<CreateIntentState, 'PENDING'>,
    recordId?: string,
    now = new Date().toISOString()
  ): ProductionPilotRunManifest {
    return applyMarkCreateIntentResolved(this.manifests, previewId, operationKey, state, recordId, now);
  }

  recordCreated(
    previewId: string,
    record: Omit<CreatedPilotRecord, 'state'> & { state?: CreatedPilotRecordState; operationKey?: string }
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
    const now = Date.now();
    return Array.from(this.manifests.values()).filter((manifest) => {
      if (['compensation_required', 'compensation_failed'].includes(manifest.status)) return true;
      if (manifest.status === 'consumed') {
        return manifest.createdRecords.some((record) => record.state !== 'DELETED')
          || manifest.createIntents.some((intent) => intent.state === 'PENDING');
      }
      return manifest.status === 'confirmed' && new Date(manifest.expiresAt).getTime() <= now;
    });
  }

  validate(): void {
    const entities = new Set<PilotEntity>(['customer', 'project', 'model']);
    const recordStates = new Set<CreatedPilotRecordState>(['CREATED', 'DELETED', 'DELETE_FAILED']);
    const intentStates = new Set<CreateIntentState>(['PENDING', 'CREATED', 'NOT_FOUND']);
    const statuses = new Set<RunManifestStatus>([
      'generated', 'confirmed', 'consumed', 'succeeded', 'failed',
      'compensation_required', 'compensated', 'compensation_failed',
    ]);
    for (const manifest of this.manifests.values()) {
      const targetTablesValid = manifest.targetTables === undefined
        || (
          Array.isArray(manifest.targetTables)
          && manifest.targetTables.length > 0
          && new Set(manifest.targetTables).size === manifest.targetTables.length
          && manifest.targetTables.every((table) => entities.has(table))
        );
      const targetDigestsValid = manifest.targetTableDigests === undefined
        || (
          typeof manifest.targetTableDigests === 'object'
          && manifest.targetTableDigests !== null
          && !Array.isArray(manifest.targetTableDigests)
          && Object.values(manifest.targetTableDigests).every((digest) => typeof digest === 'string')
        );
      const recordsValid = Array.isArray(manifest.createdRecords)
        && manifest.createdRecords.every((record) => (
          record
          && entities.has(record.entity)
          && typeof record.recordId === 'string'
          && typeof record.createdAt === 'string'
          && recordStates.has(record.state)
          && (record.operationKey === undefined || typeof record.operationKey === 'string')
          && (record.tableId === undefined || typeof record.tableId === 'string')
        ));
      const intentsValid = Array.isArray(manifest.createIntents)
        && manifest.createIntents.every((intent) => (
          intent
          && entities.has(intent.entity)
          && typeof intent.tableId === 'string'
          && typeof intent.ingestionId === 'string'
          && typeof intent.operationKey === 'string'
          && typeof intent.clientToken === 'string'
          && typeof intent.createdAt === 'string'
          && intentStates.has(intent.state)
          && (intent.recordId === undefined || typeof intent.recordId === 'string')
          && (intent.resolvedAt === undefined || typeof intent.resolvedAt === 'string')
          && (intent.state !== 'CREATED' || typeof intent.recordId === 'string')
          && (intent.state !== 'NOT_FOUND' || intent.recordId === undefined)
        ));
      if (
        !manifest.previewId
        || !manifest.ingestionId
        || !manifest.runId
        || !manifest.nonce
        || !manifest.previewDigest
        || !manifest.operator
        || !manifest.createdAt
        || !manifest.expiresAt
        || !statuses.has(manifest.status)
        || !targetTablesValid
        || !targetDigestsValid
        || !recordsValid
        || !intentsValid
      ) {
        throw new RunManifestStateError(
          'RUN_MANIFEST_STORAGE_INVALID',
          'Run manifest store contains an invalid manifest'
        );
      }
    }
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
    now: string,
    nonce?: string
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.confirm(previewId, operator, now, nonce));
  }

  async consume(
    previewId: string,
    now: string,
    operator?: string,
    nonce?: string
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.consume(previewId, now, operator, nonce));
  }

  async recordCreateIntent(
    previewId: string,
    intent: Omit<CreateRecordIntent, 'state'> & { state?: CreateIntentState }
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.recordCreateIntent(previewId, intent));
  }

  async markCreateIntentResolved(
    previewId: string,
    operationKey: string,
    state: Exclude<CreateIntentState, 'PENDING'>,
    recordId?: string,
    now = new Date().toISOString()
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.markCreateIntentResolved(previewId, operationKey, state, recordId, now));
  }

  async recordCreated(
    previewId: string,
    record: Omit<CreatedPilotRecord, 'state'> & { state?: CreatedPilotRecordState; operationKey?: string }
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

  async validate(): Promise<void> {
    this.store.validate();
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
      store.validate();
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
    now: string,
    nonce?: string
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.confirm(previewId, operator, now, nonce));
  }

  async consume(
    previewId: string,
    now: string,
    operator?: string,
    nonce?: string
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.consume(previewId, now, operator, nonce));
  }

  async recordCreateIntent(
    previewId: string,
    intent: Omit<CreateRecordIntent, 'state'> & { state?: CreateIntentState }
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.recordCreateIntent(previewId, intent));
  }

  async markCreateIntentResolved(
    previewId: string,
    operationKey: string,
    state: Exclude<CreateIntentState, 'PENDING'>,
    recordId?: string,
    now = new Date().toISOString()
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.markCreateIntentResolved(previewId, operationKey, state, recordId, now));
  }

  async recordCreated(
    previewId: string,
    record: Omit<CreatedPilotRecord, 'state'> & { state?: CreatedPilotRecordState; operationKey?: string }
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

  async validate(): Promise<void> {
    await this.enqueue(async () => {
      await this.readStore();
    });
  }
}

function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
