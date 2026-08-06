import { describe, expect, it } from 'vitest';
import {
  isProductionPilotWriteAllowed,
  loadFeishuWriteConfig,
  type FeishuWriteConfig,
} from '../../../src/server/config/feishu-write-config.js';
import { sha256Hex } from '../../../src/server/config/production-pilot.js';
import { InMemoryRunManifestRepository } from '../../../src/server/repositories/run-manifest-repository.js';

const BASE = 'base_prod_pilot';
const TABLES = {
  customer: 'tbl_customer_prod',
  project: 'tbl_project_prod',
} as const;

function allPassConfig(): FeishuWriteConfig {
  return {
    taskRepository: 'feishu',
    dryRun: false,
    enableRealFeishuWrite: true,
    feishuWriteEnv: 'production-pilot',
    testWhitelist: { tableIds: [] },
    writeMode: 'production-pilot',
    productionPilotWhitelist: { baseAppToken: BASE, tableIds: Object.values(TABLES) },
    productionPilot: {
      enabled: true,
      maxRecords: 2,
      pilotRunId: 'pilot-run-001',
      notificationsEnabled: false,
    },
  };
}

async function consumedManifest() {
  const repository = new InMemoryRunManifestRepository();
  await repository.createGenerated({
    previewId: 'preview_gate_001',
    ingestionId: 'ing_pilot_001',
    runId: 'pilot-run-001',
    previewDigest: 'a'.repeat(64),
    operator: 'operator-001',
    createdAt: '2026-08-01T07:00:00.000Z',
    expiresAt: '2026-08-01T08:00:00.000Z',
    targetTables: ['customer', 'project'],
    targetTableDigests: {
      customer: sha256Hex(TABLES.customer),
      project: sha256Hex(TABLES.project),
    },
    baseTokenDigest: sha256Hex(BASE),
  });
  await repository.confirm('preview_gate_001', 'operator-001', '2026-08-01T07:00:01.000Z');
  return repository.consume('preview_gate_001', '2026-08-01T07:00:02.000Z', 'operator-001');
}

function gateInput(manifest: Awaited<ReturnType<typeof consumedManifest>>) {
  return {
    ingestionId: 'ing_pilot_001',
    governanceDecision: 'PASS',
    targetBaseToken: BASE,
    targetTableId: TABLES.project,
    targetTables: ['customer', 'project'] as const,
    targetTableIds: TABLES,
    repositoryReadiness: {
      auditLogRepository: true,
      writeLogRepository: true,
      runManifestRepository: true,
    },
    pilotRunId: 'pilot-run-001',
    operator: 'operator-001',
    manifest,
  };
}

describe('production-pilot configuration', () => {
  it('defaults to a blocked, zero-record, notification-off configuration', () => {
    const config = loadFeishuWriteConfig({});
    expect(config.writeMode).toBe('blocked');
    expect(config.productionPilot?.enabled).toBe(false);
    expect(config.productionPilot?.maxRecords).toBe(0);
    expect(config.productionPilot?.pilotRunId).toBeUndefined();
    expect(config.productionPilot?.notificationsEnabled).toBe(false);
    expect(config.productionPilotWhitelist?.tableIds).toEqual([]);
  });

  it('parses production-pilot independently from generic production', () => {
    const config = loadFeishuWriteConfig({
      TASK_REPOSITORY: 'feishu',
      DRY_RUN: 'false',
      ENABLE_REAL_FEISHU_WRITE: 'true',
      FEISHU_WRITE_ENV: 'production-pilot',
      ENABLE_PRODUCTION_PILOT: 'true',
      PRODUCTION_PILOT_MAX_RECORDS: '2',
      PRODUCTION_PILOT_RUN_ID: 'pilot-run-001',
      ENABLE_PRODUCTION_PILOT_NOTIFICATIONS: 'true',
      FEISHU_PRODUCTION_PILOT_BASE_APP_TOKEN: BASE,
      FEISHU_PRODUCTION_PILOT_TABLE_IDS: `${TABLES.customer}, ${TABLES.project}`,
    });
    expect(config.writeMode).toBe('production-pilot');
    expect(config.productionPilot?.pilotRunId).toBe('pilot-run-001');
    expect(loadFeishuWriteConfig({ FEISHU_WRITE_ENV: 'production' }).writeMode).toBe('blocked');
  });
});

describe('production-pilot gate', () => {
  it('allows only when a consumed server-owned manifest matches the execution context', async () => {
    const manifest = await consumedManifest();
    const result = isProductionPilotWriteAllowed(allPassConfig(), gateInput(manifest));
    expect(result.allowed).toBe(true);
  });

  it.each([
    ['wrong write mode', { writeMode: 'blocked' as const }, {}],
    ['pilot disabled', { productionPilot: { ...allPassConfig().productionPilot!, enabled: false } }, {}],
    ['wrong run id', {}, { pilotRunId: 'pilot-run-002' }],
    ['operator missing', {}, { operator: undefined }],
    ['manifest missing', {}, { manifest: undefined }],
    ['record limit exceeded', {}, { targetTables: ['customer', 'project', 'model'] as const }],
    ['duplicate target plan', {}, { targetTables: ['customer', 'customer'] as const }],
  ])('%s blocks before a Create Record call', async (_label, configOverride, inputOverride) => {
    const manifest = await consumedManifest();
    const result = isProductionPilotWriteAllowed(
      { ...allPassConfig(), ...configOverride },
      { ...gateInput(manifest), ...inputOverride },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).not.toContain(BASE);
    expect(result.reason).not.toContain(TABLES.project);
  });
});
