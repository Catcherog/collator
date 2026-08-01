import { describe, expect, it } from 'vitest';
import { InMemoryTaskRepository } from '../../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryAuditLogRepository } from '../../../src/server/repositories/audit/in-memory-audit-repository.js';
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
      rule_version: 'pilot-test-rules',
      violations: [],
      write: { status: 'NOT_ATTEMPTED', target_table: 'project', target_record_id: null },
      review: { status: 'NOT_REQUIRED', review_task_id: null },
      audit: {
        audit_id: 'audit_pilot_state_machine',
        timestamp: now,
        source_record_id: candidate.source.record_id,
        idempotency_key: candidate.idempotency_key,
        rule_version: 'pilot-test-rules',
      },
    };
  }
}

class CaptureBatchWriter {
  calls = 0;
  input?: GuardedWriteBatchInput;

  async preflight(): Promise<{ allowed: boolean; reason: string }> {
    return { allowed: true, reason: 'test preflight allowed' };
  }

  async writeBatch(input: GuardedWriteBatchInput): Promise<TransactionalBatchWriterResult> {
    this.calls += 1;
    this.input = input;
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
      transaction_snapshot_id: 'txn_pilot_state_machine',
      status: 'committed',
      records_created: 1,
      records_rolled_back: 0,
      post_write_verified: true,
    };
  }
}

async function createService() {
  const runManifestRepository = new InMemoryRunManifestRepository();
  const writer = new CaptureBatchWriter();
  const service = new ScreenshotService(new InMemoryTaskRepository(), {
    ocrEngine: new MockOcrEngine(),
    governanceClient: new PassGovernanceClient(),
    batchWriter: writer,
    auditLogRepository: new InMemoryAuditLogRepository(),
    writeLogRepository: new InMemoryWriteLogRepository(),
    runManifestRepository,
    productionPilotRunId: 'pilot-run-state-machine',
    feishuWriteContext: {
      targetBaseToken: 'base_pilot',
      customerTableId: 'tbl_customer_pilot',
      projectTableId: 'tbl_project_pilot',
    },
  });

  const created = await service.createScreenshot({
    source_system: 'test',
    source_record_id: 'source_pilot_state_machine',
    submitted_at: new Date().toISOString(),
    image_base64: Buffer.from('pilot-state-machine').toString('base64'),
  });
  const evidence = await service.getScreenshotEvidence(created.ingestion_id);

  return {
    service,
    writer,
    runManifestRepository,
    ingestionId: created.ingestion_id,
    candidateId: evidence.candidate_v1.candidate_id,
  };
}

describe('production-pilot server-owned state machine', () => {
  it('requires separate server preview, operator confirmation, and opaque-token execution', async () => {
    const context = await createService();

    const preview = await context.service.createProductionPilotPreview(
      context.ingestionId,
      { candidate_v1_id: context.candidateId },
      'operator-state-machine',
    );

    expect(preview.preview_id).toBeTruthy();
    expect(preview.nonce).toBeTruthy();
    expect(preview.status).toBe('generated');
    expect(context.writer.calls).toBe(0);
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('generated');

    await context.service.confirmProductionPilotPreview(
      preview.preview_id,
      'operator-state-machine',
      preview.nonce,
    );
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('confirmed');

    const result = await context.service.confirmWrite(
      context.ingestionId,
      {
        reviewer_id: 'spoofed-body-operator',
        candidate_v1_id: context.candidateId,
        production_pilot_preview_id: preview.preview_id,
        production_pilot_nonce: preview.nonce,
      },
      'operator-state-machine',
    );

    expect(result.status).toBe('write_succeeded');
    expect(context.writer.calls).toBe(1);
    expect(context.writer.input?.pilotPreviewId).toBe(preview.preview_id);
    expect((context.writer.input as unknown as Record<string, unknown>).humanConfirmed).toBeUndefined();
    expect((context.writer.input as unknown as Record<string, unknown>).productionPilotPreview).toBeUndefined();
    expect((await context.runManifestRepository.findByPreviewId(preview.preview_id))?.status)
      .toBe('succeeded');
  });

  it('does not allow an unauthenticated operator to create or confirm a preview', async () => {
    const context = await createService();

    await expect(
      context.service.createProductionPilotPreview(
        context.ingestionId,
        { candidate_v1_id: context.candidateId },
        '',
      ),
    ).rejects.toThrow('operator');
  });
});
