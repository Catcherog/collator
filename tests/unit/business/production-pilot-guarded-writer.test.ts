import { describe, expect, it, vi } from 'vitest';
import { GuardedBatchWriter } from '../../../src/server/business/guarded-batch-writer.js';
import type {
  BatchWriterPort,
  TransactionalBatchWriterInput,
  TransactionalBatchWriterResult,
} from '../../../src/server/business/transactional-batch-writer.js';
import type { FeishuWriteConfig } from '../../../src/server/config/feishu-write-config.js';
import {
  confirmProductionWritePreview,
  previewProductionWrite,
} from '../../../src/server/config/production-pilot.js';

const BASE = 'base_prod_pilot';
const TABLES = {
  customer: 'tbl_customer_prod',
  project: 'tbl_project_prod',
} as const;

function pilotConfig(overrides: Partial<FeishuWriteConfig> = {}): FeishuWriteConfig {
  return {
    taskRepository: 'feishu',
    dryRun: false,
    enableRealFeishuWrite: true,
    feishuWriteEnv: 'production-pilot',
    testWhitelist: { tableIds: [] },
    writeMode: 'production-pilot',
    productionPilotWhitelist: {
      baseAppToken: BASE,
      tableIds: [TABLES.customer, TABLES.project],
    },
    productionPilot: {
      enabled: true,
      maxRecords: 2,
      pilotRunId: 'pilot-run-001',
      notificationsEnabled: false,
    },
    ...overrides,
  };
}

const DURABLE_PILOT_REPOSITORIES = {
  auditLogRepository: true,
  writeLogRepository: true,
  runManifestRepository: true,
};

function createSpyInner(): { inner: BatchWriterPort; calls: number } {
  const state = { calls: 0 };
  const inner: BatchWriterPort = {
    writeBatch: vi.fn(async (_input: TransactionalBatchWriterInput): Promise<TransactionalBatchWriterResult> => {
      state.calls += 1;
      return {
        write_results: [
          {
            entity_type: 'customer',
            target_table_id: TABLES.customer,
            business_record_id: 'rec_customer_001',
            created: true,
            status: 'succeeded',
          },
          {
            entity_type: 'project',
            target_table_id: TABLES.project,
            business_record_id: 'rec_project_001',
            created: true,
            status: 'succeeded',
          },
        ],
        transaction_snapshot_id: 'txn_pilot_001',
        status: 'committed',
        records_created: 2,
        records_rolled_back: 0,
      };
    }),
  };
  return { inner, get calls() { return state.calls; } };
}

function input(overrides: Record<string, unknown> = {}) {
  const previewRequest = {
    ingestionId: 'ing_pilot_001',
    targetTables: ['customer', 'project'] as Array<'customer' | 'project'>,
    targetTableIds: TABLES,
    targetBaseToken: BASE,
  };
  const preview = confirmProductionWritePreview(previewProductionWrite(previewRequest));
  return {
    ingestionId: previewRequest.ingestionId,
    normalizedFields: { 项目名称: '脱敏项目' },
    targetTables: previewRequest.targetTables,
    customerTableId: TABLES.customer,
    projectTableId: TABLES.project,
    governanceDecision: { decision: 'PASS' },
    targetBaseToken: BASE,
    pilotRunId: 'pilot-run-001',
    humanConfirmed: true,
    productionPilotPreview: preview,
    ...overrides,
  };
}

describe('GuardedBatchWriter — production-pilot', () => {
  it('delegates only after a confirmed public-safe preview and human confirmation', async () => {
    const spy = createSpyInner();
    const guarded = new GuardedBatchWriter(pilotConfig(), spy.inner, DURABLE_PILOT_REPOSITORIES);

    const result = await guarded.writeBatch(input());

    expect(result.status).toBe('committed');
    expect(result.gate.allowed).toBe(true);
    expect(spy.calls).toBe(1);
    expect(spy.inner.writeBatch).toHaveBeenCalledWith(
      expect.objectContaining({ verifyAfterWrite: true }),
    );
  });

  it.each([
    ['preview missing', { productionPilotPreview: undefined }],
    ['human confirmation missing', { humanConfirmed: false }],
    ['run id mismatch', { pilotRunId: 'pilot-run-002' }],
    ['target table outside whitelist', { projectTableId: 'tbl_other' }],
  ])('%s blocks without delegating', async (_label, overrides) => {
    const spy = createSpyInner();
    const guarded = new GuardedBatchWriter(pilotConfig(), spy.inner);

    const result = await guarded.writeBatch(input(overrides));

    expect(result.status).toBe('blocked');
    expect(result.error_code).toBe('GATE_BLOCKED');
    expect(spy.calls).toBe(0);
  });

  it('blocks when any durable pilot repository is not assembled', async () => {
    const spy = createSpyInner();
    const guarded = new GuardedBatchWriter(pilotConfig(), spy.inner, {
      ...DURABLE_PILOT_REPOSITORIES,
      runManifestRepository: false,
    });

    const result = await guarded.writeBatch(input());

    expect(result.status).toBe('blocked');
    expect(result.gate.reason).toContain('durable repositories');
    expect(spy.calls).toBe(0);
  });

  it('generic production mode is blocked even when the pilot flags are otherwise enabled', async () => {
    const spy = createSpyInner();
    const guarded = new GuardedBatchWriter(
      pilotConfig({ feishuWriteEnv: 'production', writeMode: 'blocked' }),
      spy.inner
    );

    const result = await guarded.writeBatch(input());

    expect(result.status).toBe('blocked');
    expect(spy.calls).toBe(0);
  });
});
