import { describe, expect, it, vi } from 'vitest';
import { InMemoryTaskRepository } from '../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryAuditLogRepository } from '../../src/server/repositories/audit/in-memory-audit-repository.js';
import {
  InMemoryInternalWriteRepository,
} from '../../src/server/repositories/internal-write-repository.js';
import {
  isInternalControlledWriteAllowed,
  loadFeishuWriteConfig,
  type FeishuWriteConfig,
} from '../../src/server/config/feishu-write-config.js';
import { computeInternalControlledWritePlan } from '../../src/server/business/write-plan.js';
import {
  InternalWriteQueue,
  type InternalWriteExecutionContext,
  type InternalWriteQueueExecution,
} from '../../src/server/business/internal-write-queue.js';
import { ScreenshotService } from '../../src/server/services/screenshot-service.js';
import { MockOcrEngine, type ScreenshotOcrEngine } from '../../src/server/services/screenshot-ocr-adapter.js';
import type {
  FullGovernanceResult,
  ScreenshotGovernanceClient,
} from '../../src/server/governance/screenshot-governance-client.js';
import type { GuardedWriteBatchInput } from '../../src/server/business/guarded-batch-writer.js';
import {
  InternalWriteResultUnknownError,
} from '../../src/server/domain/errors.js';

const BASE = 'base_internal_test';
const TABLES = {
  customer: 'tbl_internal_customer',
  project: 'tbl_internal_project',
  model: 'tbl_internal_model',
} as const;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function internalConfig(overrides: Record<string, string> = {}): FeishuWriteConfig {
  return loadFeishuWriteConfig({
    TASK_REPOSITORY: 'feishu',
    DRY_RUN: 'false',
    ENABLE_REAL_FEISHU_WRITE: 'true',
    FEISHU_WRITE_ENV: 'internal-controlled',
    ENABLE_INTERNAL_CONTROLLED_WRITE: 'true',
    INTERNAL_WRITE_MAX_CONCURRENCY: '1',
    INTERNAL_WRITE_REQUIRE_HUMAN_CONFIRMATION: 'true',
    INTERNAL_WRITE_AUTO_RETRY_CREATE: 'false',
    INTERNAL_WRITE_RECONCILIATION_ENABLED: 'true',
    FEISHU_INTERNAL_CONTROLLED_BASE_APP_TOKEN: BASE,
    FEISHU_INTERNAL_CONTROLLED_TABLE_IDS: Object.values(TABLES).join(','),
    FEISHU_CUSTOMER_WRITE_KEY_FIELD: 'Collator 摄入 ID',
    FEISHU_PROJECT_WRITE_KEY_FIELD: 'Collator 摄入 ID',
    FEISHU_MODEL_WRITE_KEY_FIELD: 'Collator 摄入 ID',
    ...overrides,
  });
}

function passGovernance(candidateId: string, projectType: 'client' | 'creative' = 'client'): FullGovernanceResult {
  const now = new Date().toISOString();
  return {
    schema_version: 'v1',
    candidate_id: candidateId,
    decision: 'PASS',
    classification: { entity_type: 'project', project_type: projectType, confidence: 0.99 },
    rule_version: 'internal-test-rules',
    violations: [],
    write: { status: 'NOT_ATTEMPTED', target_table: 'project', target_record_id: null },
    review: { status: 'NOT_REQUIRED', review_task_id: null },
    audit: {
      audit_id: 'audit_internal_test',
      timestamp: now,
      source_record_id: 'source_internal_test',
      idempotency_key: 'idem_internal_test',
      rule_version: 'internal-test-rules',
    },
  };
}

class DeterministicTrustedOcrEngine implements ScreenshotOcrEngine {
  readonly engine = 'tesseract';

  constructor(private readonly projectType: 'client' | 'creative' = 'client') {}

  async extract() {
    const text_blocks = this.projectType === 'creative'
      ? [
          { type: 'text' as const, text: '样片创作项目' },
          { type: 'date' as const, text: '2026年8月15日' },
        ]
      : [
          { type: 'name' as const, text: '李女士' },
          { type: 'text' as const, text: '客片拍摄项目' },
          { type: 'price' as const, text: '预算5000-8000元' },
        ];
    return {
      engine: this.engine,
      ocr_version: 'tesseract-test-double-1',
      text_blocks,
      raw_text: text_blocks.map((block) => block.text).join('\n'),
      confidence: 0.99,
      processed_at: new Date().toISOString(),
    };
  }
}

class PassGovernanceClient implements ScreenshotGovernanceClient {
  constructor(private readonly projectType: 'client' | 'creative' = 'client') {}

  async callPreWriteFull(candidate: Parameters<ScreenshotGovernanceClient['callPreWriteFull']>[0]): Promise<FullGovernanceResult> {
    return passGovernance(candidate.candidate_id, this.projectType);
  }
}

type WriterMode = 'success' | 'unknown' | 'partial';

class FakeInternalBatchWriter {
  calls = 0;
  active = 0;
  maxActive = 0;
  delayMs = 5;
  writeGate?: Promise<void>;
  readonly writeStarted = deferred<void>();
  readonly writeSettled = deferred<void>();
  readonly inputs: GuardedWriteBatchInput[] = [];
  mode: WriterMode = 'success';
  readonly findByIngestionId = vi.fn(async (_entity: string, _ingestionId: string) => [] as string[]);
  readonly verifyExistingByIngestion = vi.fn(async (
    _entity: string,
    _recordId: string,
    _input: unknown,
  ): Promise<void> => undefined);

  async preflight(input: GuardedWriteBatchInput): Promise<{ allowed: boolean; reason: string }> {
    this.inputs.push(input);
    return { allowed: true, reason: 'fake internal preflight allowed' };
  }

  async writeBatch(input: GuardedWriteBatchInput): Promise<{
    write_results: Array<{
      entity_type: 'customer' | 'project' | 'model';
      target_table_id: string;
      business_record_id: string | null;
      created: boolean;
      status: 'succeeded' | 'failed' | 'unknown';
      error_code?: string;
    }>;
    transaction_snapshot_id: string;
    status: 'committed' | 'partial' | 'unknown';
    records_created: number;
    records_rolled_back: number;
    post_write_verified: boolean;
    error_code?: string;
  }> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.writeStarted.resolve();
    try {
      if (this.mode === 'unknown') {
        throw new InternalWriteResultUnknownError();
      }
      if (this.writeGate) {
        await this.writeGate;
      } else if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      const tables = input.targetTables ?? [];
      const writeResults = tables.map((entity_type, index) => ({
        entity_type,
        target_table_id: TABLES[entity_type],
        business_record_id: this.mode === 'partial' && index === tables.length - 1
          ? null
          : `rec_${entity_type}_${this.calls}_${index}`,
        created: !(this.mode === 'partial' && index === tables.length - 1),
        status: this.mode === 'partial' && index === tables.length - 1
          ? 'failed' as const
          : 'succeeded' as const,
        ...(this.mode === 'partial' && index === tables.length - 1
          ? { error_code: 'RELATION_VERIFICATION_FAILED' }
          : {}),
      }));
      return {
        write_results: writeResults,
        transaction_snapshot_id: `txn_internal_${this.calls}`,
        status: this.mode === 'partial' ? 'partial' : 'committed',
        records_created: writeResults.filter((result) => result.created).length,
        records_rolled_back: 0,
        post_write_verified: this.mode !== 'partial',
        ...(this.mode === 'partial' ? { error_code: 'RELATION_VERIFICATION_FAILED' } : {}),
      };
    } finally {
      this.active -= 1;
      this.writeSettled.resolve();
    }
  }
}

class ObservableInternalWriteQueue extends InternalWriteQueue {
  calls = 0;
  readonly secondEnqueued = deferred<void>();

  override runWithSettlement<T>(
    operation: (context: InternalWriteExecutionContext) => Promise<T>,
    timeoutMs?: number,
  ): InternalWriteQueueExecution<T> {
    this.calls += 1;
    const execution = super.runWithSettlement(operation, timeoutMs);
    if (this.calls === 2) this.secondEnqueued.resolve();
    return execution;
  }
}

async function createInternalContext(
  mode: WriterMode = 'success',
  internalWriteTimeoutMs?: number,
  config: FeishuWriteConfig = internalConfig(),
  projectType: 'client' | 'creative' = 'client',
  internalWriteQueue: InternalWriteQueue = new InternalWriteQueue(),
) {
  const repository = new InMemoryTaskRepository();
  const internalWriteRepository = new InMemoryInternalWriteRepository();
  const writer = new FakeInternalBatchWriter();
  writer.mode = mode;
  const ocrEngine = new DeterministicTrustedOcrEngine(projectType);
  const service = new ScreenshotService(repository, {
    ocrEngine,
    governanceClient: new PassGovernanceClient(projectType),
    batchWriter: writer,
    auditLogRepository: new InMemoryAuditLogRepository(),
    internalWriteRepository,
    internalWriteQueue,
    internalWriteConfig: config,
    internalWriteTimeoutMs,
    feishuWriteContext: {
      targetBaseToken: BASE,
      customerTableId: TABLES.customer,
      projectTableId: TABLES.project,
      modelTableId: TABLES.model,
    },
  });
  const created = await service.createScreenshot({
    source_system: 'internal-test',
    source_record_id: `source_${Math.random()}`,
    submitted_at: new Date().toISOString(),
    image_base64: Buffer.from(`internal-${Math.random()}`).toString('base64'),
  });
  const evidence = await service.getScreenshotEvidence(created.ingestion_id);
  return {
    service,
    repository,
    internalWriteRepository,
    writer,
    ingestionId: created.ingestion_id,
    candidateId: evidence.candidate_v1.candidate_id,
  };
}

async function authorize(context: Awaited<ReturnType<typeof createInternalContext>>) {
  const preview = await context.service.createInternalWritePreview(
    context.ingestionId,
    { candidate_v1_id: context.candidateId },
    'operator-internal',
  );
  await context.service.confirmInternalWritePreview(
    preview.preview_id,
    { nonce: preview.nonce, candidate_v1_id: context.candidateId },
    'operator-internal',
  );
  return preview;
}

describe('internal-controlled configuration and authoritative plan', () => {
  it('defaults disabled and rejects unsafe concurrency/retry settings', () => {
    const config = loadFeishuWriteConfig({});
    expect(config.internalControlledWrite?.enabled).toBe(false);
    expect(config.internalControlledWrite?.maxConcurrency).toBe(1);
    expect(config.internalControlledWrite?.requireHumanConfirmation).toBe(true);
    expect(config.internalControlledWrite?.autoRetryCreate).toBe(false);

    expect(() => loadFeishuWriteConfig({
      FEISHU_WRITE_ENV: 'internal-controlled',
      ENABLE_INTERNAL_CONTROLLED_WRITE: 'true',
      INTERNAL_WRITE_MAX_CONCURRENCY: '2',
    })).toThrow(/INTERNAL_WRITE_MAX_CONCURRENCY/);
  });

  it('uses exact internal plans: client customer+project, creative model+project, unknown zero writes', () => {
    expect(computeInternalControlledWritePlan(
      { normalized_fields: { project_type: 'client', customer_ref: '客户', model_ref: '模特' } },
    )).toEqual(['customer', 'project']);
    expect(computeInternalControlledWritePlan(
      { normalized_fields: { project_type: 'creative', customer_ref: '客户', model_ref: '模特' } },
    )).toEqual(['model', 'project']);
    expect(computeInternalControlledWritePlan(
      { normalized_fields: { project_type: 'unknown', customer_ref: '客户', model_ref: '模特' } },
    )).toEqual([]);
  });

  it('blocks before Create when confirmation, operator, or plan binding is missing', () => {
    const config = internalConfig();
    const base = {
      governanceDecision: 'PASS' as const,
      targetBaseToken: BASE,
      targetTableId: TABLES.customer,
      targetTables: ['customer', 'project'] as const,
      targetTableIds: TABLES,
      candidateId: 'candidate_001',
      requestedCandidateId: 'candidate_001',
      candidateDigest: 'candidate_digest',
      governanceDigest: 'governance_digest',
      authoritativePlanDigest: 'plan_digest',
      operator: 'operator-internal',
      humanConfirmed: true,
      dryRun: false,
      preview: {
        status: 'confirmed' as const,
        candidateDigest: 'candidate_digest',
        governanceDigest: 'governance_digest',
        authoritativePlanDigest: 'plan_digest',
        operator: 'operator-internal',
      },
    };
    expect(isInternalControlledWriteAllowed(config, { ...base, humanConfirmed: false }).allowed).toBe(false);
    expect(isInternalControlledWriteAllowed(config, { ...base, operator: 'spoofed' }).allowed).toBe(false);
    expect(isInternalControlledWriteAllowed(config, { ...base, requestedCandidateId: 'other' }).allowed).toBe(false);
  });
});

describe('InternalWriteQueue', () => {
  it('serializes writes and continues after a failed operation', async () => {
    const queue = new InternalWriteQueue();
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const run = (name: string, fail = false) => queue.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      events.push(`${name}:end`);
      if (fail) throw new Error('expected queue failure');
      return name;
    });

    await expect(run('first', true)).rejects.toThrow('expected queue failure');
    await expect(Promise.all([run('second'), run('third')])).resolves.toEqual(['second', 'third']);
    expect(maxActive).toBe(1);
    expect(events).toEqual([
      'first:start', 'first:end',
      'second:start', 'second:end',
      'third:start', 'third:end',
    ]);
  });

  it('starts each execution timeout only after the request acquires the queue slot', async () => {
    vi.useFakeTimers();
    try {
      const queue = new InternalWriteQueue();
      const firstGate = deferred<void>();
      const firstStarted = deferred<void>();
      let secondStarted = false;
      const first = queue.runWithSettlement(async () => {
        firstStarted.resolve();
        await firstGate.promise;
        return 'first';
      }, 10);
      void first.responsePromise.catch(() => undefined);

      await firstStarted.promise;
      const second = queue.runWithSettlement(async () => {
        secondStarted = true;
        return 'second';
      }, 10);
      void second.responsePromise.catch(() => undefined);

      await vi.advanceTimersByTimeAsync(100);
      expect(secondStarted).toBe(false);
      expect(queue.active).toBe(1);

      firstGate.resolve();
      await first.settlementPromise;
      await expect(second.responsePromise).resolves.toBe('second');
      expect(secondStarted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ScreenshotService internal-controlled write flow', () => {
  it('blocks Preview when persisted OCR evidence came from mock/manual adapters', async () => {
    const repository = new InMemoryTaskRepository();
    const writer = new FakeInternalBatchWriter();
    const service = new ScreenshotService(repository, {
      ocrEngine: new MockOcrEngine(),
      governanceClient: new PassGovernanceClient(),
      batchWriter: writer,
      auditLogRepository: new InMemoryAuditLogRepository(),
      internalWriteRepository: new InMemoryInternalWriteRepository(),
      internalWriteQueue: new InternalWriteQueue(),
      internalWriteConfig: internalConfig(),
      feishuWriteContext: {
        targetBaseToken: BASE,
        customerTableId: TABLES.customer,
        projectTableId: TABLES.project,
        modelTableId: TABLES.model,
      },
    });
    const created = await service.createScreenshot({
      source_system: 'internal-test',
      source_record_id: `source_mock_ocr_${Math.random()}`,
      submitted_at: new Date().toISOString(),
      image_base64: Buffer.from('internal-mock-ocr').toString('base64'),
    });
    const evidence = await service.getScreenshotEvidence(created.ingestion_id);

    await expect(service.createInternalWritePreview(
      created.ingestion_id,
      { candidate_v1_id: evidence.candidate_v1.candidate_id },
      'operator-internal',
    )).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('requires persisted OCR evidence from tesseract or feishu'),
    });
    expect(writer.calls).toBe(0);
  });

  it('fails closed when the SOP governance client is not configured', async () => {
    const repository = new InMemoryTaskRepository();
    const internalWriteRepository = new InMemoryInternalWriteRepository();
    const writer = new FakeInternalBatchWriter();
    const service = new ScreenshotService(repository, {
      ocrEngine: new DeterministicTrustedOcrEngine(),
      batchWriter: writer,
      auditLogRepository: new InMemoryAuditLogRepository(),
      internalWriteRepository,
      internalWriteQueue: new InternalWriteQueue(),
      internalWriteConfig: internalConfig(),
      feishuWriteContext: {
        targetBaseToken: BASE,
        customerTableId: TABLES.customer,
        projectTableId: TABLES.project,
        modelTableId: TABLES.model,
      },
    });
    const created = await service.createScreenshot({
      source_system: 'internal-test',
      source_record_id: `source_no_sop_${Math.random()}`,
      submitted_at: new Date().toISOString(),
      image_base64: Buffer.from('internal-no-sop').toString('base64'),
    });
    const evidence = await service.getScreenshotEvidence(created.ingestion_id);

    await expect(service.createInternalWritePreview(
      created.ingestion_id,
      { candidate_v1_id: evidence.candidate_v1.candidate_id },
      'operator-internal',
    )).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('SOP governance client'),
    });
    expect(writer.calls).toBe(0);
  });

  it('returns INTERNAL_WRITE_DISABLED before any write when the lane is off', async () => {
    const disabledConfig = internalConfig({ ENABLE_INTERNAL_CONTROLLED_WRITE: 'false' });
    const context = await createInternalContext('success', undefined, disabledConfig);
    await expect(context.service.createInternalWritePreview(
      context.ingestionId,
      { candidate_v1_id: context.candidateId },
      'operator-internal',
    )).rejects.toMatchObject({ code: 'INTERNAL_WRITE_DISABLED' });
    expect(context.writer.calls).toBe(0);
  });

  it('requires the complete FeishuWriteConfig and never accepts a partial lane subsection', async () => {
    const partialConfig = {
      ...internalConfig().internalControlledWrite,
    } as unknown as FeishuWriteConfig;
    const context = await createInternalContext('success', undefined, partialConfig);

    await expect(context.service.createInternalWritePreview(
      context.ingestionId,
      { candidate_v1_id: context.candidateId },
      'operator-internal',
    )).rejects.toMatchObject({ code: 'INTERNAL_WRITE_DISABLED' });
    expect(context.writer.calls).toBe(0);
  });

  it.each([
    ['TASK_REPOSITORY', 'memory'],
    ['DRY_RUN', 'true'],
    ['ENABLE_REAL_FEISHU_WRITE', 'false'],
    ['FEISHU_WRITE_ENV', 'test'],
  ])('blocks the internal lane when full Feishu config gate %s=%s is unsafe', async (key, value) => {
    const context = await createInternalContext('success', undefined, internalConfig({ [key]: value }));
    const preview = await authorize(context);

    await expect(context.service.executeInternalControlledWrite(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'operator-internal',
    )).rejects.toMatchObject({ code: 'INTERNAL_WRITE_GATE_BLOCKED' });
    expect(context.writer.calls).toBe(0);
  });

  it('requires authenticated human confirmation and never calls the writer early', async () => {
    const context = await createInternalContext();
    const preview = await context.service.createInternalWritePreview(
      context.ingestionId,
      { candidate_v1_id: context.candidateId },
      'operator-internal',
    );

    await expect(context.service.executeInternalControlledWrite(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'operator-internal',
    )).rejects.toMatchObject({ code: 'INTERNAL_WRITE_REQUIRES_HUMAN_CONFIRMATION' });
    expect(context.writer.calls).toBe(0);

    await expect(context.service.confirmInternalWritePreview(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'spoofed-operator',
    )).rejects.toMatchObject({ code: 'INTERNAL_WRITE_OPERATOR_MISMATCH' });
    await expect(context.service.confirmInternalWritePreview(
      preview.preview_id,
      { nonce: 'wrong-nonce', candidate_v1_id: context.candidateId },
      'operator-internal',
    )).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(context.writer.calls).toBe(0);
  });

  it('rejects a stale preview after candidate correction without writing', async () => {
    const context = await createInternalContext();
    const preview = await authorize(context);
    await context.service.submitCorrections(context.ingestionId, {
      reviewer_id: 'operator-internal',
      corrections: { 客户姓名: '已修正' },
    });

    await expect(context.service.executeInternalControlledWrite(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'operator-internal',
    )).rejects.toMatchObject({ code: 'INTERNAL_WRITE_PREVIEW_STALE' });
    expect(context.writer.calls).toBe(0);
  });

  it('serializes same-preview double click and replays success without another write', async () => {
    const context = await createInternalContext();
    const preview = await authorize(context);
    const request = { nonce: preview.nonce, candidate_v1_id: context.candidateId };
    const first = context.service.executeInternalControlledWrite(preview.preview_id, request, 'operator-internal');
    const second = context.service.executeInternalControlledWrite(preview.preview_id, request, 'operator-internal');

    await expect(second).rejects.toMatchObject({ code: 'INTERNAL_WRITE_ALREADY_IN_PROGRESS' });
    const firstResult = await first;
    expect(firstResult.status).toBe('succeeded');
    expect(context.writer.calls).toBe(1);

    const replay = await context.service.executeInternalControlledWrite(preview.preview_id, request, 'operator-internal');
    expect(replay.status).toBe('succeeded');
    expect(context.writer.calls).toBe(1);
    expect(replay.write_results).toEqual(firstResult.write_results);
  });

  it('preserves unknown results and never retries Create automatically', async () => {
    const context = await createInternalContext('unknown');
    const preview = await authorize(context);
    const result = await context.service.executeInternalControlledWrite(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'operator-internal',
    );

    expect(result.status).toBe('result_unknown');
    expect(result.error_code).toBe('INTERNAL_WRITE_RESULT_UNKNOWN');
    expect(context.writer.calls).toBe(1);
    const stored = await context.internalWriteRepository.findPreview(preview.preview_id);
    expect(stored?.status).toBe('result_unknown');
  });

  it('persists result_unknown at timeout while the single queue slot drains', async () => {
    vi.useFakeTimers();
    try {
      const context = await createInternalContext('success', 10);
      const writeGate = deferred<void>();
      context.writer.writeGate = writeGate.promise;
      const preview = await authorize(context);
      const execution = context.service.executeInternalControlledWrite(
        preview.preview_id,
        { nonce: preview.nonce, candidate_v1_id: context.candidateId },
        'operator-internal',
      );
      await context.writer.writeStarted.promise;
      await vi.advanceTimersByTimeAsync(10);
      const result = await execution;

      expect(result.status).toBe('result_unknown');
      expect(result.error_code).toBe('INTERNAL_WRITE_RESULT_UNKNOWN');
      expect(context.writer.calls).toBe(1);
      expect(context.writer.active).toBe(1);
      const stored = await context.internalWriteRepository.findPreview(preview.preview_id);
      expect(stored?.status).toBe('result_unknown');
      expect(stored?.result?.status).toBe('result_unknown');

      writeGate.resolve();
      await context.writer.writeSettled.promise;
      expect(context.writer.active).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the execution guard until the underlying timeout operation settles', async () => {
    vi.useFakeTimers();
    try {
      const context = await createInternalContext('success', 10);
      const writeGate = deferred<void>();
      context.writer.writeGate = writeGate.promise;
      const preview = await authorize(context);
      const request = { nonce: preview.nonce, candidate_v1_id: context.candidateId };
      const execution = context.service.executeInternalControlledWrite(
        preview.preview_id,
        request,
        'operator-internal',
      );
      await context.writer.writeStarted.promise;
      await vi.advanceTimersByTimeAsync(10);
      const result = await execution;

      expect(result.status).toBe('result_unknown');
      await expect(context.service.executeInternalControlledWrite(
        preview.preview_id,
        request,
        'operator-internal',
      )).rejects.toMatchObject({ code: 'INTERNAL_WRITE_ALREADY_IN_PROGRESS' });
      context.writer.findByIngestionId.mockResolvedValue(['rec_reconciled']);
      await expect(context.service.reconcileInternalControlledWrite(
        preview.preview_id,
        'operator-internal',
      )).rejects.toMatchObject({ code: 'INTERNAL_WRITE_ALREADY_IN_PROGRESS' });

      writeGate.resolve();
      await context.writer.writeSettled.promise;
      expect(context.writer.active).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a queued preview confirmed, then executes it once after the queue wait', async () => {
    vi.useFakeTimers();
    try {
      const queue = new ObservableInternalWriteQueue();
      const first = await createInternalContext('success', 10, internalConfig(), 'client', queue);
      const second = await createInternalContext('success', 10, internalConfig(), 'client', queue);
      const firstGate = deferred<void>();
      first.writer.writeGate = firstGate.promise;
      second.writer.delayMs = 0;
      const firstPreview = await authorize(first);
      const secondPreview = await authorize(second);
      const firstExecution = first.service.executeInternalControlledWrite(
        firstPreview.preview_id,
        { nonce: firstPreview.nonce, candidate_v1_id: first.candidateId },
        'operator-internal',
      );
      await first.writer.writeStarted.promise;

      const secondExecution = second.service.executeInternalControlledWrite(
        secondPreview.preview_id,
        { nonce: secondPreview.nonce, candidate_v1_id: second.candidateId },
        'operator-internal',
      );
      await queue.secondEnqueued.promise;
      await vi.advanceTimersByTimeAsync(100);

      expect(second.writer.calls).toBe(0);
      expect((await second.internalWriteRepository.findPreview(secondPreview.preview_id))?.status).toBe('confirmed');

      firstGate.resolve();
      const [firstResult, secondResult] = await Promise.all([firstExecution, secondExecution]);
      expect(firstResult.status).toBe('result_unknown');
      expect(secondResult.status).toBe('succeeded');
      expect(second.writer.calls).toBe(1);
      const storedSecond = await second.internalWriteRepository.findPreview(secondPreview.preview_id);
      expect(storedSecond?.status).toBe(secondResult.status);
      expect(storedSecond?.result).toEqual(secondResult);

      const replay = await second.service.executeInternalControlledWrite(
        secondPreview.preview_id,
        { nonce: secondPreview.nonce, candidate_v1_id: second.candidateId },
        'operator-internal',
      );
      expect(replay.status).toBe('succeeded');
      expect(second.writer.calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['success', 'succeeded'],
    ['unknown', 'result_unknown'],
    ['partial', 'partial'],
  ] as const)('returns only a result whose terminal status is durable (%s)', async (mode, expectedStatus) => {
    const context = await createInternalContext(mode);
    const preview = await authorize(context);
    const result = await context.service.executeInternalControlledWrite(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'operator-internal',
    );
    const stored = await context.internalWriteRepository.findPreview(preview.preview_id);

    expect(result.status).toBe(expectedStatus);
    expect(stored?.status).toBe(result.status);
    expect(stored?.result).toEqual(result);
  });

  it('does not return a requested result when durable completion rejects the transition', async () => {
    const context = await createInternalContext();
    const preview = await authorize(context);
    vi.spyOn(context.internalWriteRepository, 'completeExecution').mockImplementation(async (previewId) => {
      const current = await context.internalWriteRepository.findPreview(previewId);
      if (!current) throw new Error('INTERNAL_WRITE_PREVIEW_NOT_FOUND');
      return current;
    });

    await expect(context.service.executeInternalControlledWrite(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'operator-internal',
    )).rejects.toMatchObject({ code: 'INTERNAL_WRITE_STATE_TRANSITION_CONFLICT' });
    const stored = await context.internalWriteRepository.findPreview(preview.preview_id);
    expect(stored?.status).toBe('executing');
    expect(stored?.result).toBeUndefined();
  });

  it('reconciles a unique marker match without creating or deleting a record', async () => {
    const context = await createInternalContext('unknown');
    const preview = await authorize(context);
    await context.service.executeInternalControlledWrite(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'operator-internal',
    );
    context.writer.findByIngestionId.mockResolvedValue(['rec_reconciled_customer']);

    const result = await context.service.reconcileInternalControlledWrite(
      preview.preview_id,
      'operator-internal',
    );
    expect(result.status).toBe('succeeded');
    expect(result.additional_create_calls).toBe(0);
    expect(result.write_results.some((item) => item.business_record_id === 'rec_reconciled_customer')).toBe(true);
    expect(context.writer.calls).toBe(1);
    expect(context.writer.verifyExistingByIngestion).toHaveBeenCalled();
  });

  it('does not mark a unique marker match succeeded when field or relation verification fails', async () => {
    const context = await createInternalContext('unknown');
    const preview = await authorize(context);
    await context.service.executeInternalControlledWrite(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'operator-internal',
    );
    context.writer.findByIngestionId.mockImplementation(async (entity: string) => (
      entity === 'customer' ? ['cus_1'] : ['prj_1']
    ));
    context.writer.verifyExistingByIngestion.mockImplementation(async (entity: string) => {
      if (entity === 'project') throw new Error('relation mismatch');
    });

    const result = await context.service.reconcileInternalControlledWrite(
      preview.preview_id,
      'operator-internal',
    );
    expect(result.status).toBe('needs_reconciliation');
    expect(result.error_code).toBe('RELATION_VERIFICATION_FAILED');
    expect(result.additional_create_calls).toBe(0);
    expect(context.writer.calls).toBe(1);
    expect(context.writer.verifyExistingByIngestion).toHaveBeenCalledTimes(2);
  });

  it('verifies the creative Model and Project relation before reconciliation success', async () => {
    const context = await createInternalContext('unknown', undefined, internalConfig(), 'creative');
    const preview = await authorize(context);
    await context.service.executeInternalControlledWrite(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'operator-internal',
    );
    context.writer.findByIngestionId.mockImplementation(async (entity: string) => (
      entity === 'model' ? ['mod_1'] : ['prj_1']
    ));

    const result = await context.service.reconcileInternalControlledWrite(
      preview.preview_id,
      'operator-internal',
    );
    expect(result.status).toBe('succeeded');
    expect(context.writer.verifyExistingByIngestion).toHaveBeenCalledWith(
      'project',
      'prj_1',
      expect.objectContaining({
        relationContext: { customerRecordId: undefined, modelRecordId: 'mod_1' },
      }),
    );
    expect(context.writer.calls).toBe(1);
  });

  it('keeps none and multiple reconciliation outcomes unresolved without creating', async () => {
    const noneContext = await createInternalContext('unknown');
    const nonePreview = await authorize(noneContext);
    await noneContext.service.executeInternalControlledWrite(
      nonePreview.preview_id,
      { nonce: nonePreview.nonce, candidate_v1_id: noneContext.candidateId },
      'operator-internal',
    );
    noneContext.writer.findByIngestionId.mockResolvedValue([]);
    const noneResult = await noneContext.service.reconcileInternalControlledWrite(
      nonePreview.preview_id,
      'operator-internal',
    );
    expect(noneResult.status).toBe('needs_reconciliation');
    expect(noneResult.reconciliation).toBe('none');
    expect(noneResult.additional_create_calls).toBe(0);
    expect(noneContext.writer.calls).toBe(1);

    const multipleContext = await createInternalContext('unknown');
    const multiplePreview = await authorize(multipleContext);
    await multipleContext.service.executeInternalControlledWrite(
      multiplePreview.preview_id,
      { nonce: multiplePreview.nonce, candidate_v1_id: multipleContext.candidateId },
      'operator-internal',
    );
    multipleContext.writer.findByIngestionId.mockResolvedValue(['rec_a', 'rec_b']);
    const multipleResult = await multipleContext.service.reconcileInternalControlledWrite(
      multiplePreview.preview_id,
      'operator-internal',
    );
    expect(multipleResult.status).toBe('needs_reconciliation');
    expect(multipleResult.error_code).toBe('DUPLICATE_CANDIDATES_FOUND');
    expect(multipleResult.reconciliation).toBe('multiple');
    expect(multipleResult.additional_create_calls).toBe(0);
    expect(multipleContext.writer.calls).toBe(1);
  });

  it('keeps partial record IDs and does not automatically delete business records', async () => {
    const context = await createInternalContext('partial');
    const preview = await authorize(context);
    const result = await context.service.executeInternalControlledWrite(
      preview.preview_id,
      { nonce: preview.nonce, candidate_v1_id: context.candidateId },
      'operator-internal',
    );

    expect(result.status).toBe('partial');
    expect(result.error_code).toBe('INTERNAL_WRITE_PARTIAL');
    expect(result.write_results[0]?.business_record_id).toMatch(/^rec_customer_/);
    expect(context.writer.calls).toBe(1);
  });

  it('preserves ambiguous states in the task and final-result API', async () => {
    const unknownContext = await createInternalContext('unknown');
    const unknownPreview = await authorize(unknownContext);
    await unknownContext.service.executeInternalControlledWrite(
      unknownPreview.preview_id,
      { nonce: unknownPreview.nonce, candidate_v1_id: unknownContext.candidateId },
      'operator-internal',
    );
    const unknownStatus = await unknownContext.service.getScreenshotStatus(unknownContext.ingestionId);
    const unknownFinal = await unknownContext.service.getFinalResult(unknownContext.ingestionId);
    expect(unknownStatus.status).toBe('write_result_unknown');
    expect(unknownStatus.write?.status).toBe('unknown');
    expect(unknownFinal.final_status).toBe('write_result_unknown');
    expect(unknownFinal.governance_result_v1.write.status).toBe('unknown');
    expect(unknownFinal.write_logs[0]?.status).toBe('unknown');
    expect(unknownFinal.write_logs[0]?.error_code).toBe('INTERNAL_WRITE_RESULT_UNKNOWN');

    const partialContext = await createInternalContext('partial');
    const partialPreview = await authorize(partialContext);
    await partialContext.service.executeInternalControlledWrite(
      partialPreview.preview_id,
      { nonce: partialPreview.nonce, candidate_v1_id: partialContext.candidateId },
      'operator-internal',
    );
    const partialTask = await partialContext.repository.findById(partialContext.ingestionId);
    const partialFinal = await partialContext.service.getFinalResult(partialContext.ingestionId);
    expect(partialTask?.status).toBe('write_partial');
    expect(partialFinal.final_status).toBe('write_partial');
    expect(partialFinal.governance_result_v1.write.status).toBe('partial');
    expect(partialFinal.write_logs.some((log) => log.status === 'failed')).toBe(true);
    expect(partialFinal.write_logs.some((log) => log.business_record_id?.startsWith('rec_customer_'))).toBe(true);

    const needsContext = await createInternalContext('unknown');
    const needsPreview = await authorize(needsContext);
    await needsContext.service.executeInternalControlledWrite(
      needsPreview.preview_id,
      { nonce: needsPreview.nonce, candidate_v1_id: needsContext.candidateId },
      'operator-internal',
    );
    needsContext.writer.findByIngestionId.mockResolvedValue([]);
    const needsResult = await needsContext.service.reconcileInternalControlledWrite(
      needsPreview.preview_id,
      'operator-internal',
    );
    const needsStatus = await needsContext.service.getScreenshotStatus(needsContext.ingestionId);
    const needsFinal = await needsContext.service.getFinalResult(needsContext.ingestionId);
    expect(needsResult.status).toBe('needs_reconciliation');
    expect(needsStatus.status).toBe('write_needs_reconciliation');
    expect(needsFinal.final_status).toBe('write_needs_reconciliation');
    expect(needsFinal.governance_result_v1.write.status).toBe('needs_reconciliation');
  });
});

describe('internal preview repository', () => {
  it('stores preview and write-log state without raw table ids in logs', async () => {
    const repository = new InMemoryInternalWriteRepository();
    const preview = await repository.createPreview({
      preview_id: 'preview_repository_001',
      nonce: 'nonce_repository_001',
      ingestion_id: 'ing_repository_001',
      candidate_id: 'candidate_repository_001',
      candidate_digest: 'a'.repeat(64),
      governance_digest: 'b'.repeat(64),
      authoritative_plan_digest: 'c'.repeat(64),
      operator: 'operator-repository',
      target_tables: ['customer', 'project'],
      target_table_digests: { customer: 'd'.repeat(64), project: 'e'.repeat(64) },
      created_at: '2026-08-02T00:00:00.000Z',
      expires_at: '2026-08-02T01:00:00.000Z',
    });
    expect(preview.status).toBe('preview_generated');
    expect(JSON.stringify(preview)).not.toContain(TABLES.customer);
    await repository.appendWriteLog({
      ingestion_id: preview.ingestion_id,
      preview_id: preview.preview_id,
      entity_type: 'customer',
      logical_write_key: 'f'.repeat(64),
      target_table_id_digest: 'd'.repeat(64),
      business_record_id: null,
      request_started_at: '2026-08-02T00:00:01.000Z',
      operator: 'operator-repository',
      status: 'intent',
    });
    const serialized = JSON.stringify(await repository.findWriteLogs(preview.preview_id));
    expect(serialized).not.toContain(TABLES.customer);
  });

  it('does not regress a succeeded terminal result to unknown, failed, or partial', async () => {
    const repository = new InMemoryInternalWriteRepository();
    const now = new Date();
    const preview = await repository.createPreview({
      preview_id: 'preview_terminal_001',
      nonce: 'nonce_terminal_001',
      ingestion_id: 'ing_terminal_001',
      candidate_id: 'candidate_terminal_001',
      candidate_digest: 'a'.repeat(64),
      governance_digest: 'b'.repeat(64),
      authoritative_plan_digest: 'c'.repeat(64),
      operator: 'operator-terminal',
      target_tables: ['customer'],
      target_table_digests: { customer: 'd'.repeat(64) },
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 60_000).toISOString(),
    });
    await repository.confirm(preview.preview_id, 'operator-terminal', preview.nonce, now.toISOString());
    await repository.markExecuting(preview.preview_id, now.toISOString());
    const succeeded = {
      status: 'succeeded' as const,
      write_results: [{
        entity_type: 'customer' as const,
        target_table_id: 'customer',
        business_record_id: 'cus_terminal',
        created: false,
        status: 'succeeded' as const,
      }],
      additional_create_calls: 0,
    };
    await repository.complete(preview.preview_id, succeeded, 'operator-terminal', now.toISOString());

    for (const status of ['result_unknown', 'failed', 'partial'] as const) {
      await repository.complete(preview.preview_id, {
        status,
        write_results: [{
          entity_type: 'customer',
          target_table_id: 'customer',
          business_record_id: null,
          created: false,
          status: status === 'failed' ? 'failed' : 'unknown',
        }],
        error_code: `STALE_${status.toUpperCase()}`,
        additional_create_calls: 0,
      }, 'operator-terminal', now.toISOString());
      const stored = await repository.findPreview(preview.preview_id);
      expect(stored?.status).toBe('succeeded');
      expect(stored?.result).toEqual(succeeded);
    }
  });
});
