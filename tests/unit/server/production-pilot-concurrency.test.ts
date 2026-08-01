import { describe, expect, it } from 'vitest';
import type { IngestionTask } from '../../../src/server/domain/ingestion.js';
import type {
  AuditLogRecord,
} from '../../../src/audit/audit-log-repository.js';
import { InMemoryAuditLogRepository } from '../../../src/server/repositories/audit/in-memory-audit-repository.js';
import { InMemoryTaskRepository } from '../../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryRunManifestRepository } from '../../../src/server/repositories/run-manifest-repository.js';
import { InMemoryWriteLogRepository } from '../../../src/server/repositories/in-memory-write-log-repository.js';
import { ScreenshotService } from '../../../src/server/services/screenshot-service.js';
import { MockOcrEngine } from '../../../src/server/services/screenshot-ocr-adapter.js';
import type {
  ScreenshotGovernanceClient,
  FullGovernanceResult,
} from '../../../src/server/governance/screenshot-governance-client.js';
import type { GuardedWriteBatchInput } from '../../../src/server/business/guarded-batch-writer.js';
import type { TransactionalBatchWriterResult } from '../../../src/server/business/transactional-batch-writer.js';

class PassGovernanceClient implements ScreenshotGovernanceClient {
  async callPreWriteFull(
    candidate: Parameters<ScreenshotGovernanceClient['callPreWriteFull']>[0],
  ): Promise<FullGovernanceResult> {
    const now = new Date().toISOString();
    return {
      schema_version: 'v1',
      candidate_id: candidate.candidate_id,
      decision: 'PASS',
      classification: { entity_type: 'project', project_type: 'client', confidence: 0.99 },
      rule_version: 'pilot-concurrency-rules',
      violations: [],
      write: { status: 'NOT_ATTEMPTED', target_table: 'project', target_record_id: null },
      review: { status: 'NOT_REQUIRED', review_task_id: null },
      audit: {
        audit_id: 'audit_pilot_concurrency',
        timestamp: now,
        source_record_id: candidate.source.record_id,
        idempotency_key: candidate.idempotency_key,
        rule_version: 'pilot-concurrency-rules',
      },
    };
  }
}

class RecordingAuditRepository extends InMemoryAuditLogRepository {
  calls = 0;

  override async record(event: AuditLogRecord): Promise<AuditLogRecord> {
    this.calls += 1;
    return super.record(event);
  }
}

class PilotWriter {
  calls = 0;
  input?: GuardedWriteBatchInput;
  beforeReturn?: () => Promise<void>;

  async preflight(): Promise<{ allowed: boolean; reason: string }> {
    return { allowed: true, reason: 'test preflight allowed' };
  }

  async writeBatch(input: GuardedWriteBatchInput): Promise<TransactionalBatchWriterResult> {
    this.calls += 1;
    this.input = input;
    await this.beforeReturn?.();
    return {
      write_results: [
        {
          entity_type: 'project',
          target_table_id: 'tbl_project_pilot',
          business_record_id: 'rec_project_pilot',
          created: true,
          status: 'succeeded',
        },
      ],
      transaction_snapshot_id: 'txn_pilot_concurrency',
      status: 'committed',
      records_created: 1,
      records_rolled_back: 0,
      post_write_verified: true,
    };
  }

  async recoverPendingCompensations(): Promise<Array<{
    previewId: string;
    status: 'compensated' | 'compensation_failed';
  }>> {
    return [];
  }
}

async function setup(overrides: {
  auditLogRepository?: RecordingAuditRepository;
  writer?: PilotWriter;
} = {}) {
  const repository = new InMemoryTaskRepository();
  const runManifestRepository = new InMemoryRunManifestRepository();
  const auditLogRepository = overrides.auditLogRepository ?? new RecordingAuditRepository();
  const writer = overrides.writer ?? new PilotWriter();
  const writeContext = {
    targetBaseToken: 'base_pilot',
    customerTableId: 'tbl_customer_pilot',
    projectTableId: 'tbl_project_pilot',
  };
  const service = new ScreenshotService(repository, {
    ocrEngine: new MockOcrEngine(),
    governanceClient: new PassGovernanceClient(),
    batchWriter: writer,
    auditLogRepository,
    writeLogRepository: new InMemoryWriteLogRepository(),
    runManifestRepository,
    productionPilotRunId: 'pilot-run-concurrency',
    feishuWriteContext: writeContext,
  });

  const created = await service.createScreenshot({
    source_system: 'test',
    source_record_id: `source_${Date.now()}_${Math.random()}`,
    submitted_at: new Date().toISOString(),
    image_base64: Buffer.from(`pilot-${Date.now()}-${Math.random()}`).toString('base64'),
  });
  const evidence = await service.getScreenshotEvidence(created.ingestion_id);
  return {
    service,
    repository,
    runManifestRepository,
    auditLogRepository,
    writer,
    writeContext,
    ingestionId: created.ingestion_id,
    candidateId: evidence.candidate_v1.candidate_id,
  };
}

async function authorize(context: Awaited<ReturnType<typeof setup>>) {
  const preview = await context.service.createProductionPilotPreview(
    context.ingestionId,
    { candidate_v1_id: context.candidateId },
    'operator-concurrency',
  );
  await context.service.confirmProductionPilotPreview(
    preview.preview_id,
    'operator-concurrency',
    preview.nonce,
  );
  return preview;
}

async function advanceManifest(
  context: Awaited<ReturnType<typeof setup>>,
  status: 'consumed' | 'executing' | 'verifying' | 'committing',
) {
  const preview = await authorize(context);
  await context.runManifestRepository.consume(
    preview.preview_id,
    new Date().toISOString(),
    'operator-concurrency',
    preview.nonce,
  );
  if (status === 'executing' || status === 'verifying' || status === 'committing') {
    await context.runManifestRepository.markExecuting(preview.preview_id);
  }
  if (status === 'verifying' || status === 'committing') {
    await context.runManifestRepository.markVerifying(preview.preview_id);
  }
  if (status === 'committing') {
    await context.runManifestRepository.markCommitting(preview.preview_id, {
      writeResults: [],
      transactionSnapshot: {
        snapshot_id: 'txn_pending',
        status: 'committed',
        records_created: 0,
        records_rolled_back: 0,
      },
      expected_task_version: 1,
      expected_candidate_digest: 'candidate'.repeat(16),
      expected_governance_digest: 'governance'.repeat(8),
      expected_authoritative_plan_digest: 'plan'.repeat(16),
      auditEvents: [],
    });
  }
  return preview;
}

async function mutateTask(
  context: Awaited<ReturnType<typeof setup>>,
  mutation: (task: IngestionTask) => void,
) {
  const task = await context.repository.findById(context.ingestionId);
  if (!task) throw new Error('test task missing');
  mutation(task);
  await context.repository.save(task);
}

describe('production-pilot concurrency fences', () => {
  it.each(['consumed', 'executing', 'verifying', 'committing'] as const)(
    'rejects corrections while the manifest is %s',
    async (status) => {
      const context = await setup();
      await advanceManifest(context, status);
      const before = await context.repository.findById(context.ingestionId);

      await expect(
        context.service.submitCorrections(context.ingestionId, {
          reviewer_id: 'reviewer-concurrency',
          corrections: { customer_ref: 'concurrent-edit' },
        }),
      ).rejects.toMatchObject({ code: 'PRODUCTION_PILOT_MUTATION_LOCKED' });

      expect(await context.repository.findById(context.ingestionId)).toEqual(before);
    },
  );

  it('fails closed when the task version changes before pilot success is saved', async () => {
    const context = await setup();
    context.writer.beforeReturn = async () => {
      await mutateTask(context, (task) => {
        task.warnings.push({
          field: 'concurrency',
          code: 'CONCURRENT_TASK_UPDATE',
          message: 'concurrent task update',
        });
      });
    };
    const preview = await authorize(context);

    const result = await context.service.confirmWrite(
      context.ingestionId,
      {
        reviewer_id: 'operator-concurrency',
        candidate_v1_id: context.candidateId,
        production_pilot_preview_id: preview.preview_id,
        production_pilot_nonce: preview.nonce,
      },
      'operator-concurrency',
    );

    expect(result.status).toBe('write_failed');
    expect(result.error_code).toBe('PILOT_TASK_VERSION_CONFLICT');
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('committing');
    const currentTask = await context.repository.findById(context.ingestionId);
    expect(currentTask?.task_version).toBeGreaterThan(1);
    expect(currentTask?.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CONCURRENT_TASK_UPDATE' }),
    ]));
    expect(currentTask?.pipeline_evidence).toEqual(expect.objectContaining({
      screenshot_state: expect.objectContaining({
        screenshot_status: expect.not.stringMatching('write_succeeded'),
      }),
    }));
  });

  it('does not write audit or success state during recovery after a candidate digest mismatch', async () => {
    const auditLogRepository = new RecordingAuditRepository();
    const context = await setup({ auditLogRepository });
    const preview = await authorize(context);
    auditLogRepository.calls = 0;
    const originalRecord = auditLogRepository.record.bind(auditLogRepository);
    let failOnce = true;
    auditLogRepository.record = async (event: AuditLogRecord) => {
      if (failOnce && event.event_type === 'pilot_write_completed') {
        failOnce = false;
        throw new Error('simulated commit audit outage');
      }
      return originalRecord(event);
    };

    const result = await context.service.confirmWrite(
      context.ingestionId,
      {
        reviewer_id: 'operator-concurrency',
        candidate_v1_id: context.candidateId,
        production_pilot_preview_id: preview.preview_id,
        production_pilot_nonce: preview.nonce,
      },
      'operator-concurrency',
    );
    expect(result.status).toBe('write_failed');
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('committing');

    await mutateTask(context, (task) => {
      const state = (task.pipeline_evidence as { screenshot_state: { candidate_v1: { normalized_fields: Record<string, unknown> } } })
        .screenshot_state;
      state.candidate_v1.normalized_fields.customer_ref = 'recovery-mismatch';
    });
    const callsBeforeRecovery = auditLogRepository.calls;

    expect(await context.service.recoverPendingProductionPilotRuns()).toEqual([
      { previewId: preview.preview_id, status: 'commit_recovery_failed' },
    ]);
    expect(auditLogRepository.calls).toBe(callsBeforeRecovery);
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('committing');
    expect((await context.repository.findById(context.ingestionId))?.pipeline_evidence)
      .toEqual(expect.objectContaining({
        screenshot_state: expect.objectContaining({
          screenshot_status: expect.not.stringMatching('write_succeeded'),
        }),
      }));
  });
});
