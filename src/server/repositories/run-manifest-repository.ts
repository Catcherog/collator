import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WriteResult } from '../../contracts/screenshot-api-v1.js';
import type { AuditEventType } from '../../audit/audit-log-repository.js';

export type RunManifestStatus =
  | 'generated'
  | 'confirmed'
  | 'consumed'
  | 'executing'
  | 'verifying'
  | 'committing'
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

export interface ProductionPilotAuditEvent {
  eventType: AuditEventType;
  resultStatus?: string;
  details?: Record<string, unknown>;
}

export interface ProductionPilotCommitPayload {
  writeResults: WriteResult[];
  transactionSnapshot: {
    snapshot_id: string;
    status: 'committed' | 'rolled_back' | 'partial';
    records_created: number;
    records_rolled_back: number;
  };
  expected_task_version: number;
  expected_candidate_digest: string;
  expected_governance_digest: string;
  expected_authoritative_plan_digest: string;
  auditEvents: ProductionPilotAuditEvent[];
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
  executionStartedAt?: string;
  verifyingAt?: string;
  committingAt?: string;
  commitPayload?: ProductionPilotCommitPayload;
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
  markExecuting(previewId: string, now?: string): Promise<ProductionPilotRunManifest>;
  markVerifying(previewId: string, now?: string): Promise<ProductionPilotRunManifest>;
  markCommitting(
    previewId: string,
    payload: ProductionPilotCommitPayload,
    now?: string
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
  findPendingCommits(): Promise<ProductionPilotRunManifest[]>;
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

function applyMarkExecuting(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  now: string,
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  if (manifest.status === 'executing') return manifest;
  assertStatus(manifest, 'consumed', 'start execution');
  manifest.status = 'executing';
  manifest.executionStartedAt = now;
  return manifest;
}

function applyMarkVerifying(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  now: string,
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  if (manifest.status === 'verifying') return manifest;
  assertStatus(manifest, 'executing', 'start verification');
  manifest.status = 'verifying';
  manifest.verifyingAt = now;
  return manifest;
}

function applyMarkCommitting(
  manifests: Map<string, ProductionPilotRunManifest>,
  previewId: string,
  payload: ProductionPilotCommitPayload,
  now: string,
): ProductionPilotRunManifest {
  const manifest = requireManifest(manifests, previewId);
  if (manifest.status === 'committing') {
    if (!sameJson(manifest.commitPayload, payload)) {
      throw new RunManifestStateError(
        'RUN_MANIFEST_STATE_INVALID',
        `Commit payload for ${previewId} changed while commit recovery is in flight`
      );
    }
    return manifest;
  }
  assertStatus(manifest, 'verifying', 'start commit');
  manifest.status = 'committing';
  manifest.committingAt = now;
  manifest.commitPayload = cloneValue(payload);
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
  if (!['consumed', 'executing', 'verifying', 'compensation_required'].includes(manifest.status)) {
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
  if (!['consumed', 'executing', 'verifying', 'compensation_required'].includes(manifest.status)) {
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
  if (!['consumed', 'executing', 'verifying', 'compensation_required'].includes(manifest.status)) {
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
  if (manifest.status === 'compensation_failed') {
    manifest.status = 'compensation_required';
    return manifest;
  }
  if (!['confirmed', 'consumed', 'executing', 'verifying', 'failed', 'succeeded'].includes(manifest.status)) {
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
  if (manifest.status === 'succeeded') return manifest;
  if (!['committing', 'succeeded'].includes(manifest.status)) {
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

  markExecuting(previewId: string, now: string): ProductionPilotRunManifest {
    return applyMarkExecuting(this.manifests, previewId, now);
  }

  markVerifying(previewId: string, now: string): ProductionPilotRunManifest {
    return applyMarkVerifying(this.manifests, previewId, now);
  }

  markCommitting(
    previewId: string,
    payload: ProductionPilotCommitPayload,
    now: string,
  ): ProductionPilotRunManifest {
    return applyMarkCommitting(this.manifests, previewId, payload, now);
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
      if (['consumed', 'executing', 'verifying'].includes(manifest.status)) {
        // A consumed/executing manifest is unfinished even when the process
        // died before CREATE_INTENT. Recovery must close that window rather
        // than treating an empty manifest as a successful no-op.
        return true;
      }
      return manifest.status === 'confirmed' && new Date(manifest.expiresAt).getTime() <= now;
    });
  }

  findPendingCommits(): ProductionPilotRunManifest[] {
    return Array.from(this.manifests.values()).filter((manifest) => manifest.status === 'committing');
  }

  validate(): void {
    const entities = new Set<PilotEntity>(['customer', 'project', 'model']);
    const recordStates = new Set<CreatedPilotRecordState>(['CREATED', 'DELETED', 'DELETE_FAILED']);
    const intentStates = new Set<CreateIntentState>(['PENDING', 'CREATED', 'NOT_FOUND']);
    const statuses = new Set<RunManifestStatus>([
      'generated', 'confirmed', 'consumed', 'executing', 'verifying', 'committing', 'succeeded', 'failed',
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
      const commitPayloadValid = manifest.commitPayload === undefined
        || (
          manifest.commitPayload
          && Array.isArray(manifest.commitPayload.writeResults)
          && manifest.commitPayload.writeResults.every((result) => (
            result
            && entities.has(result.entity_type)
            && typeof result.target_table_id === 'string'
            && (result.business_record_id === null || typeof result.business_record_id === 'string')
            && typeof result.created === 'boolean'
            && ['succeeded', 'failed', 'rolled_back', 'not_attempted'].includes(result.status)
          ))
          && manifest.commitPayload.transactionSnapshot
          && typeof manifest.commitPayload.transactionSnapshot.snapshot_id === 'string'
          && ['committed', 'rolled_back', 'partial'].includes(manifest.commitPayload.transactionSnapshot.status)
          && Number.isInteger(manifest.commitPayload.transactionSnapshot.records_created)
          && Number.isInteger(manifest.commitPayload.transactionSnapshot.records_rolled_back)
          && Number.isInteger(manifest.commitPayload.expected_task_version)
          && typeof manifest.commitPayload.expected_candidate_digest === 'string'
          && typeof manifest.commitPayload.expected_governance_digest === 'string'
          && typeof manifest.commitPayload.expected_authoritative_plan_digest === 'string'
          && Array.isArray(manifest.commitPayload.auditEvents)
          && manifest.commitPayload.auditEvents.every((event) => (
            event
            && typeof event.eventType === 'string'
            && typeof event.resultStatus !== 'object'
            && (event.details === undefined || (
              typeof event.details === 'object'
              && event.details !== null
              && !Array.isArray(event.details)
            ))
          ))
        );
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
        || !commitPayloadValid
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

  async markExecuting(
    previewId: string,
    now = new Date().toISOString(),
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.markExecuting(previewId, now));
  }

  async markVerifying(
    previewId: string,
    now = new Date().toISOString(),
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.markVerifying(previewId, now));
  }

  async markCommitting(
    previewId: string,
    payload: ProductionPilotCommitPayload,
    now = new Date().toISOString(),
  ): Promise<ProductionPilotRunManifest> {
    return cloneManifest(this.store.markCommitting(previewId, payload, now));
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

  async findPendingCommits(): Promise<ProductionPilotRunManifest[]> {
    return this.store.findPendingCommits().map(cloneManifest);
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

  private enqueue<T>(operation: (assertLockOwner: () => Promise<void>) => Promise<T>): Promise<T> {
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

  private async withFileLock<T>(operation: (assertLockOwner: () => Promise<void>) => Promise<T>): Promise<T> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const startedAt = Date.now();
    let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
    let lockToken: string | undefined;
    while (!lockHandle) {
      try {
        lockHandle = await open(this.lockPath, 'wx');
        lockToken = randomUUID();
        await lockHandle.writeFile(JSON.stringify({
          token: lockToken,
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }), 'utf8');
        await lockHandle.sync();
      } catch (error) {
        await lockHandle?.close().catch(() => undefined);
        lockHandle = undefined;
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

    const assertLockOwner = async (): Promise<void> => {
      if (!lockToken) {
        throw new RunManifestStateError(
          'RUN_MANIFEST_STORAGE_INVALID',
          `Run manifest lock ${this.lockPath} has no owner token`
        );
      }
      try {
        const raw = await readFile(this.lockPath, 'utf8');
        const parsed = JSON.parse(raw) as { token?: unknown };
        if (parsed.token !== lockToken) {
          throw new RunManifestStateError(
            'RUN_MANIFEST_STORAGE_INVALID',
            `Run manifest lock ownership was lost for ${this.filePath}`
          );
        }
      } catch (error) {
        if (error instanceof RunManifestStateError) throw error;
        throw new RunManifestStateError(
          'RUN_MANIFEST_STORAGE_INVALID',
          `Run manifest lock ownership could not be verified for ${this.filePath}`
        );
      }
    };
    const heartbeat = setInterval(() => {
      void lockHandle?.utimes(new Date(), new Date()).catch(() => undefined);
    }, 5_000);

    try {
      await assertLockOwner();
      const result = await operation(assertLockOwner);
      await assertLockOwner();
      return result;
    } finally {
      clearInterval(heartbeat);
      await lockHandle.close();
      try {
        const raw = await readFile(this.lockPath, 'utf8');
        const parsed = JSON.parse(raw) as { token?: unknown };
        if (parsed.token === lockToken) {
          await unlink(this.lockPath).catch(() => undefined);
        }
      } catch {
        // The lock may have been reclaimed by a newer owner. Owner fencing
        // prevents this process from deleting that owner's lock.
      }
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

  private async writeStore(
    store: ManifestStateStore,
    assertLockOwner: () => Promise<void>,
  ): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await assertLockOwner();
      const temporaryHandle = await open(temporaryPath, 'w');
      try {
        await temporaryHandle.writeFile(JSON.stringify(store.toArray(), null, 2), 'utf8');
        await temporaryHandle.sync();
      } finally {
        await temporaryHandle.close();
      }
      await assertLockOwner();
      await rename(temporaryPath, this.filePath);
      await this.syncDirectory();
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async syncDirectory(): Promise<void> {
    let directoryHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      directoryHandle = await open(dirname(this.filePath), 'r');
      await directoryHandle.sync();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows does not expose a synchronizable directory handle. The file
      // fsync plus atomic rename still applies; unsupported directory fsync is
      // explicit rather than pretending this JSON journal is a database WAL.
      if (!['EINVAL', 'ENOTSUP', 'EBADF', 'EISDIR', 'EPERM'].includes(code ?? '')) {
        throw error;
      }
    } finally {
      await directoryHandle?.close().catch(() => undefined);
    }
  }

  private async update<T>(operation: (store: ManifestStateStore) => T): Promise<T> {
    return this.enqueue(async (assertLockOwner) => {
      const store = await this.readStore();
      const result = operation(store);
      await this.writeStore(store, assertLockOwner);
      return cloneValue(result);
    });
  }

  async createGenerated(input: CreateRunManifestInput): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.createGenerated(input));
  }

  async findByPreviewId(previewId: string): Promise<ProductionPilotRunManifest | null> {
    return this.enqueue(async (assertLockOwner) => {
      const store = await this.readStore();
      const manifest = store.findByPreviewId(previewId);
      await assertLockOwner();
      return manifest ? cloneManifest(manifest) : null;
    });
  }

  async findByRunId(runId: string): Promise<ProductionPilotRunManifest | null> {
    return this.enqueue(async (assertLockOwner) => {
      const store = await this.readStore();
      const manifest = store.findByRunId(runId);
      await assertLockOwner();
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

  async markExecuting(
    previewId: string,
    now = new Date().toISOString(),
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.markExecuting(previewId, now));
  }

  async markVerifying(
    previewId: string,
    now = new Date().toISOString(),
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.markVerifying(previewId, now));
  }

  async markCommitting(
    previewId: string,
    payload: ProductionPilotCommitPayload,
    now = new Date().toISOString(),
  ): Promise<ProductionPilotRunManifest> {
    return this.update((store) => store.markCommitting(previewId, payload, now));
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
    return this.enqueue(async (assertLockOwner) => {
      const store = await this.readStore();
      await assertLockOwner();
      return store.findPendingCompensation().map(cloneManifest);
    });
  }

  async findPendingCommits(): Promise<ProductionPilotRunManifest[]> {
    return this.enqueue(async (assertLockOwner) => {
      const store = await this.readStore();
      await assertLockOwner();
      return store.findPendingCommits().map(cloneManifest);
    });
  }

  async validate(): Promise<void> {
    await this.enqueue(async (assertLockOwner) => {
      await this.readStore();
      await assertLockOwner();
    });
  }
}

function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
