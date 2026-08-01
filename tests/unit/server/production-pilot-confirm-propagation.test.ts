import { describe, expect, it } from 'vitest';
import { InMemoryTaskRepository } from '../../../src/server/repositories/in-memory-task-repository.js';
import type { TaskRepository } from '../../../src/server/repositories/task-repository.js';
import type { IngestionTask } from '../../../src/server/domain/ingestion.js';
import { InMemoryAuditLogRepository } from '../../../src/server/repositories/audit/in-memory-audit-repository.js';
import { InMemoryRunManifestRepository } from '../../../src/server/repositories/run-manifest-repository.js';
import { InMemoryWriteLogRepository } from '../../../src/server/repositories/in-memory-write-log-repository.js';
import { ScreenshotService } from '../../../src/server/services/screenshot-service.js';
import { MockOcrEngine } from '../../../src/server/services/screenshot-ocr-adapter.js';
import type { ScreenshotGovernanceClient, FullGovernanceResult } from '../../../src/server/governance/screenshot-governance-client.js';
import type { GuardedWriteBatchInput } from '../../../src/server/business/guarded-batch-writer.js';
import type { TransactionalBatchWriterResult } from '../../../src/server/business/transactional-batch-writer.js';

class PassGovernanceClient implements ScreenshotGovernanceClient {
  async callPreWriteFull(candidate: Parameters<ScreenshotGovernanceClient['callPreWriteFull']>[0]): Promise<FullGovernanceResult> {
    const now = new Date().toISOString();
    return {
      schema_version: 'v1', candidate_id: candidate.candidate_id, decision: 'PASS',
      classification: { entity_type: 'project', project_type: 'client', confidence: 0.99 },
      rule_version: 'pilot-test-rules', violations: [],
      write: { status: 'NOT_ATTEMPTED', target_table: 'project', target_record_id: null },
      review: { status: 'NOT_REQUIRED', review_task_id: null },
      audit: {
        audit_id: 'audit_pilot_propagation', timestamp: now,
        source_record_id: candidate.source.record_id,
        idempotency_key: candidate.idempotency_key,
        rule_version: 'pilot-test-rules',
      },
    };
  }
}

class CaptureBatchWriter {
  input?: GuardedWriteBatchInput;
  calls = 0;
  async preflight(): Promise<{ allowed: boolean; reason: string }> {
    return { allowed: true, reason: 'test preflight allowed' };
  }
  async writeBatch(input: GuardedWriteBatchInput): Promise<TransactionalBatchWriterResult> {
    this.calls += 1;
    this.input = input;
    return {
      write_results: [
        { entity_type: 'customer', target_table_id: 'tbl_customer_pilot', business_record_id: 'rec_customer_pilot', created: true, status: 'succeeded' },
        { entity_type: 'project', target_table_id: 'tbl_project_pilot', business_record_id: 'rec_project_pilot', created: true, status: 'succeeded' },
      ],
      transaction_snapshot_id: 'txn_pilot_propagation', status: 'committed', records_created: 2,
      records_rolled_back: 0, post_write_verified: true,
    };
  }

  async recoverPendingCompensations(): Promise<Array<{ previewId: string; status: 'compensated' | 'compensation_failed' }>> {
    return [];
  }
}

class FailingWriteSucceededAuditRepository extends InMemoryAuditLogRepository {
  failWriteSucceeded = true;

  async record(event: Parameters<InMemoryAuditLogRepository['record']>[0]) {
    if (this.failWriteSucceeded && event.event_type === 'write_succeeded') throw new Error('simulated audit outage');
    return super.record(event);
  }
}

class CrashOnWriteSucceededTaskRepository implements TaskRepository {
  readonly delegate = new InMemoryTaskRepository();
  failNextWriteSucceeded = false;

  findById(ingestionId: string): Promise<IngestionTask | null> {
    return this.delegate.findById(ingestionId);
  }

  findByIdempotencyKey(key: string): Promise<IngestionTask | null> {
    return this.delegate.findByIdempotencyKey(key);
  }

  async save(task: IngestionTask): Promise<void> {
    const evidence = task.pipeline_evidence as {
      screenshot_state?: { screenshot_status?: string };
    } | undefined;
    if (this.failNextWriteSucceeded && evidence?.screenshot_state?.screenshot_status === 'write_succeeded') {
      this.failNextWriteSucceeded = false;
      throw new Error('simulated task-store crash after external write');
    }
    await this.delegate.save(task);
  }
}

class CrashOnceManifestRepository extends InMemoryRunManifestRepository {
  failNextCompleteSuccess = false;

  async completeSuccess(previewId: string, now?: string) {
    if (this.failNextCompleteSuccess) {
      this.failNextCompleteSuccess = false;
      throw new Error('simulated manifest commit crash');
    }
    return super.completeSuccess(previewId, now);
  }
}

class FailingPilotConfirmationAuditRepository extends InMemoryAuditLogRepository {
  async record(event: Parameters<InMemoryAuditLogRepository['record']>[0]) {
    if (event.event_type === 'pilot_confirmed') throw new Error('simulated confirmation audit outage');
    return super.record(event);
  }
}

async function setup(
  auditLogRepository: InMemoryAuditLogRepository = new InMemoryAuditLogRepository(),
  overrides: {
    repository?: TaskRepository;
    runManifestRepository?: InMemoryRunManifestRepository;
    writer?: CaptureBatchWriter;
  } = {},
) {
  const repository = overrides.repository ?? new InMemoryTaskRepository();
  const runManifestRepository = overrides.runManifestRepository ?? new InMemoryRunManifestRepository();
  const writer = overrides.writer ?? new CaptureBatchWriter();
  const service = new ScreenshotService(repository, {
    ocrEngine: new MockOcrEngine(),
    governanceClient: new PassGovernanceClient(),
    batchWriter: writer,
    feishuWriteContext: {
      targetBaseToken: 'base_pilot',
      customerTableId: 'tbl_customer_pilot',
      projectTableId: 'tbl_project_pilot',
    },
    auditLogRepository,
    writeLogRepository: new InMemoryWriteLogRepository(),
    runManifestRepository,
    productionPilotRunId: 'pilot-run-propagation',
  });
  const created = await service.createScreenshot({
    source_system: 'test', source_record_id: `source_${Date.now()}`,
    submitted_at: new Date().toISOString(),
    image_base64: Buffer.from(`pilot-${Date.now()}`).toString('base64'),
  });
  const evidence = await service.getScreenshotEvidence(created.ingestion_id);
  return { service, writer, repository, runManifestRepository, auditLogRepository, ingestionId: created.ingestion_id, candidateId: evidence.candidate_v1.candidate_id };
}

async function authorize(context: Awaited<ReturnType<typeof setup>>) {
  const preview = await context.service.createProductionPilotPreview(
    context.ingestionId,
    { candidate_v1_id: context.candidateId },
    'operator-propagation',
  );
  await context.service.confirmProductionPilotPreview(
    preview.preview_id,
    'operator-propagation',
    preview.nonce,
  );
  return preview;
}

describe('ScreenshotService production-pilot confirmation propagation', () => {
  it('passes only the server manifest binding and opaque token to the guarded writer', async () => {
    const context = await setup();
    const preview = await authorize(context);
    const result = await context.service.confirmWrite(
      context.ingestionId,
      {
        reviewer_id: 'spoofed-body-operator',
        candidate_v1_id: context.candidateId,
        production_pilot_preview_id: preview.preview_id,
        production_pilot_nonce: preview.nonce,
      },
      'operator-propagation',
    );

    expect(result.status).toBe('write_succeeded');
    expect(context.writer.input?.pilotPreviewId).toBe(preview.preview_id);
    expect(context.writer.input?.operator).toBe('operator-propagation');
    expect((context.writer.input as unknown as Record<string, unknown>).humanConfirmed).toBeUndefined();
    expect((context.writer.input as unknown as Record<string, unknown>).productionPilotPreview).toBeUndefined();
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status).toBe('succeeded');
  });

  it('does not report pilot success when the final audit write fails', async () => {
    const auditLogRepository = new FailingWriteSucceededAuditRepository();
    const context = await setup(auditLogRepository);
    const preview = await authorize(context);
    const result = await context.service.confirmWrite(
      context.ingestionId,
      {
        reviewer_id: 'operator-propagation',
        candidate_v1_id: context.candidateId,
        production_pilot_preview_id: preview.preview_id,
        production_pilot_nonce: preview.nonce,
      },
      'operator-propagation',
    );

    expect(result.status).toBe('write_failed');
    expect(result.error_code).toBe('PILOT_AUDIT_PERSIST_FAILED');
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('committing');
    expect((await context.repository.findById(context.ingestionId))?.pipeline_evidence?.screenshot_state)
      .toEqual(expect.objectContaining({ screenshot_status: expect.not.stringMatching('write_succeeded') }));

    auditLogRepository.failWriteSucceeded = false;
    expect(await context.service.recoverPendingProductionPilotRuns()).toEqual([
      { previewId: preview.preview_id, status: 'committed' },
    ]);
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('succeeded');
    expect((await context.repository.findById(context.ingestionId))?.pipeline_evidence?.screenshot_state)
      .toEqual(expect.objectContaining({ screenshot_status: 'write_succeeded' }));
  });

  it('restarts a COMMITTING run after task persistence crashes without compensating records', async () => {
    const taskRepository = new CrashOnWriteSucceededTaskRepository();
    const context = await setup(new InMemoryAuditLogRepository(), { repository: taskRepository });
    const preview = await authorize(context);
    taskRepository.failNextWriteSucceeded = true;

    const result = await context.service.confirmWrite(
      context.ingestionId,
      {
        reviewer_id: 'operator-propagation',
        candidate_v1_id: context.candidateId,
        production_pilot_preview_id: preview.preview_id,
        production_pilot_nonce: preview.nonce,
      },
      'operator-propagation',
    );

    expect(result.status).toBe('write_failed');
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('committing');
    expect(await context.service.recoverPendingProductionPilotRuns()).toEqual([
      { previewId: preview.preview_id, status: 'committed' },
    ]);
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('succeeded');
  });

  it('replays a task-visible success when manifest completion crashes', async () => {
    const runManifestRepository = new CrashOnceManifestRepository();
    const context = await setup(new InMemoryAuditLogRepository(), { runManifestRepository });
    const preview = await authorize(context);
    runManifestRepository.failNextCompleteSuccess = true;

    const result = await context.service.confirmWrite(
      context.ingestionId,
      {
        reviewer_id: 'operator-propagation',
        candidate_v1_id: context.candidateId,
        production_pilot_preview_id: preview.preview_id,
        production_pilot_nonce: preview.nonce,
      },
      'operator-propagation',
    );

    expect(result.status).toBe('write_failed');
    expect((await context.repository.findById(context.ingestionId))?.pipeline_evidence?.screenshot_state)
      .toEqual(expect.objectContaining({ screenshot_status: 'write_succeeded' }));
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('committing');
    expect(await context.service.recoverPendingProductionPilotRuns()).toEqual([
      { previewId: preview.preview_id, status: 'committed' },
    ]);
  });

  it('does not leave a confirmed preview executable when confirmation audit persistence fails', async () => {
    const context = await setup(new FailingPilotConfirmationAuditRepository());
    const preview = await context.service.createProductionPilotPreview(
      context.ingestionId,
      { candidate_v1_id: context.candidateId },
      'operator-propagation',
    );

    await expect(
      context.service.confirmProductionPilotPreview(
        preview.preview_id,
        'operator-propagation',
        preview.nonce,
      ),
    ).rejects.toThrow('confirmation audit');
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('compensated');
  });

  it('rejects a client target-plan override before the writer is called', async () => {
    const context = await setup();
    const preview = await authorize(context);
    const result = await context.service.confirmWrite(
      context.ingestionId,
      {
        reviewer_id: 'operator-propagation',
        candidate_v1_id: context.candidateId,
        target_tables: ['project'],
        production_pilot_preview_id: preview.preview_id,
        production_pilot_nonce: preview.nonce,
      },
      'operator-propagation',
    );

    expect(result.error_code).toBe('TARGET_PLAN_MISMATCH');
    expect(context.writer.calls).toBe(0);
  });
});
