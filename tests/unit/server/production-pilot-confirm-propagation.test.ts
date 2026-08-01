import { describe, expect, it } from 'vitest';
import { InMemoryTaskRepository } from '../../../src/server/repositories/in-memory-task-repository.js';
import { InMemoryAuditLogRepository } from '../../../src/server/repositories/audit/in-memory-audit-repository.js';
import { ScreenshotService } from '../../../src/server/services/screenshot-service.js';
import { MockOcrEngine } from '../../../src/server/services/screenshot-ocr-adapter.js';
import type { ScreenshotGovernanceClient, FullGovernanceResult } from '../../../src/server/governance/screenshot-governance-client.js';
import type { GuardedWriteBatchInput } from '../../../src/server/business/guarded-batch-writer.js';
import type { TransactionalBatchWriterResult } from '../../../src/server/business/transactional-batch-writer.js';
import {
  confirmProductionWritePreview,
  previewProductionWrite,
} from '../../../src/server/config/production-pilot.js';

class PassGovernanceClient implements ScreenshotGovernanceClient {
  async callPreWriteFull(candidate: Parameters<ScreenshotGovernanceClient['callPreWriteFull']>[0]): Promise<FullGovernanceResult> {
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
        audit_id: 'audit_pilot_test',
        timestamp: now,
        source_record_id: candidate.source.record_id,
        idempotency_key: candidate.idempotency_key,
        rule_version: 'pilot-test-rules',
      },
    };
  }
}

class CaptureBatchWriter {
  input?: GuardedWriteBatchInput;

  async writeBatch(input: GuardedWriteBatchInput): Promise<TransactionalBatchWriterResult> {
    this.input = input;
    return {
      write_results: [
        {
          entity_type: 'customer',
          target_table_id: 'tbl_customer_pilot',
          business_record_id: 'rec_customer_pilot',
          created: true,
          status: 'succeeded',
        },
        {
          entity_type: 'project',
          target_table_id: 'tbl_project_pilot',
          business_record_id: 'rec_project_pilot',
          created: true,
          status: 'succeeded',
        },
      ],
      transaction_snapshot_id: 'txn_pilot_test',
      status: 'committed',
      records_created: 2,
      records_rolled_back: 0,
      post_write_verified: true,
    };
  }
}

class CompensationBatchWriter {
  async writeBatch(_input: GuardedWriteBatchInput): Promise<TransactionalBatchWriterResult> {
    return {
      write_results: [
        {
          entity_type: 'project',
          target_table_id: 'tbl_project_pilot',
          business_record_id: 'rec_project_pilot',
          created: true,
          status: 'failed',
          error_code: 'POST_WRITE_VERIFY_FAILED',
        },
      ],
      transaction_snapshot_id: 'txn_pilot_compensation',
      status: 'rolled_back',
      records_created: 1,
      records_rolled_back: 1,
      error_code: 'POST_WRITE_VERIFY_FAILED',
      post_write_verified: false,
    };
  }
}

describe('ScreenshotService production-pilot confirmation propagation', () => {
  it('passes pilot_run_id, human confirmation, and preview to the guarded writer', async () => {
    const repository = new InMemoryTaskRepository();
    const auditLogRepository = new InMemoryAuditLogRepository();
    const writer = new CaptureBatchWriter();
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
    });

    const created = await service.createScreenshot({
      source_system: 'test',
      source_record_id: 'source_pilot_001',
      submitted_at: new Date().toISOString(),
      image_base64: Buffer.from('pilot').toString('base64'),
    });
    const evidence = await service.getScreenshotEvidence(created.ingestion_id);
    const preview = confirmProductionWritePreview(previewProductionWrite({
      ingestionId: created.ingestion_id,
      targetTables: ['customer', 'project'],
      targetTableIds: {
        customer: 'tbl_customer_pilot',
        project: 'tbl_project_pilot',
      },
      targetBaseToken: 'base_pilot',
    }));

    const result = await service.confirmWrite(created.ingestion_id, {
      reviewer_id: 'reviewer_pilot',
      candidate_v1_id: evidence.candidate_v1.candidate_id,
      pilot_run_id: 'pilot-run-001',
      human_confirmed: true,
      production_pilot_preview: preview,
    });

    expect(result.status).toBe('write_succeeded');
    expect(writer.input?.pilotRunId).toBe('pilot-run-001');
    expect(writer.input?.humanConfirmed).toBe(true);
    expect(writer.input?.productionPilotPreview?.previewId).toBe(preview.previewId);

    const events = await auditLogRepository.findByIngestionId(created.ingestion_id);
    const eventTypes = events.map((event) => event.event_type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      'pilot_preview_generated',
      'pilot_confirmed',
      'pilot_write_started',
      'pilot_record_created',
      'pilot_relation_verified',
      'pilot_write_completed',
    ]));
    const serializedEvents = JSON.stringify(events);
    expect(serializedEvents).not.toContain('base_pilot');
    expect(serializedEvents).not.toContain('tbl_customer_pilot');
    expect(serializedEvents).not.toContain('pilot-run-001');
  });

  it('records compensation outcome without persisting raw target identifiers', async () => {
    const repository = new InMemoryTaskRepository();
    const auditLogRepository = new InMemoryAuditLogRepository();
    const service = new ScreenshotService(repository, {
      ocrEngine: new MockOcrEngine(),
      governanceClient: new PassGovernanceClient(),
      batchWriter: new CompensationBatchWriter(),
      feishuWriteContext: {
        targetBaseToken: 'base_pilot',
        projectTableId: 'tbl_project_pilot',
      },
      auditLogRepository,
    });

    const created = await service.createScreenshot({
      source_system: 'test',
      source_record_id: 'source_pilot_compensation_001',
      submitted_at: new Date().toISOString(),
      image_base64: Buffer.from('pilot-compensation').toString('base64'),
    });
    const evidence = await service.getScreenshotEvidence(created.ingestion_id);
    const preview = confirmProductionWritePreview(previewProductionWrite({
      ingestionId: created.ingestion_id,
      targetTables: ['project'],
      targetTableIds: { project: 'tbl_project_pilot' },
      targetBaseToken: 'base_pilot',
    }));

    const result = await service.confirmWrite(created.ingestion_id, {
      reviewer_id: 'reviewer_pilot',
      candidate_v1_id: evidence.candidate_v1.candidate_id,
      pilot_run_id: 'pilot-run-compensation-001',
      human_confirmed: true,
      production_pilot_preview: preview,
      target_tables: ['project'],
    });

    expect(result.status).toBe('write_failed');
    const events = await auditLogRepository.findByIngestionId(created.ingestion_id);
    expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining([
      'pilot_write_failed',
      'pilot_compensation_started',
      'pilot_compensation_completed',
    ]));
    const serializedEvents = JSON.stringify(events);
    expect(serializedEvents).not.toContain('base_pilot');
    expect(serializedEvents).not.toContain('tbl_project_pilot');
    expect(serializedEvents).not.toContain('pilot-run-compensation-001');
  });
});
