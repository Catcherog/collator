import { describe, expect, it } from 'vitest';
import {
  isProductionPilotWriteAllowed,
  loadFeishuWriteConfig,
  type FeishuWriteConfig,
} from '../../../src/server/config/feishu-write-config.js';
import {
  confirmProductionWritePreview,
  previewProductionWrite,
  type ProductionWritePreviewRequest,
} from '../../../src/server/config/production-pilot.js';

const REQUEST: ProductionWritePreviewRequest = {
  ingestionId: 'ing_pilot_001',
  targetTables: ['customer', 'project'],
  targetTableIds: {
    customer: 'tbl_customer_prod',
    project: 'tbl_project_prod',
  },
  targetBaseToken: 'base_prod_pilot',
};

function allPassConfig(): FeishuWriteConfig {
  return {
    taskRepository: 'feishu',
    dryRun: false,
    enableRealFeishuWrite: true,
    feishuWriteEnv: 'production-pilot',
    testWhitelist: { tableIds: [] },
    writeMode: 'production-pilot',
    productionPilotWhitelist: {
      baseAppToken: 'base_prod_pilot',
      tableIds: ['tbl_customer_prod', 'tbl_project_prod'],
    },
    productionPilot: {
      enabled: true,
      maxRecords: 2,
      pilotRunId: 'pilot-run-001',
      notificationsEnabled: false,
    },
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
      FEISHU_PRODUCTION_PILOT_BASE_APP_TOKEN: 'base_prod_pilot',
      FEISHU_PRODUCTION_PILOT_TABLE_IDS: 'tbl_customer_prod, tbl_project_prod',
    });

    expect(config.feishuWriteEnv).toBe('production-pilot');
    expect(config.writeMode).toBe('production-pilot');
    expect(config.productionPilot).toEqual({
      enabled: true,
      maxRecords: 2,
      pilotRunId: 'pilot-run-001',
      notificationsEnabled: true,
    });
    expect(config.productionPilotWhitelist).toEqual({
      baseAppToken: 'base_prod_pilot',
      tableIds: ['tbl_customer_prod', 'tbl_project_prod'],
    });

    expect(loadFeishuWriteConfig({ FEISHU_WRITE_ENV: 'production' }).writeMode).toBe('blocked');
  });
});

describe('production-pilot preview', () => {
  it('contains only irreversible digests and no raw identifiers', () => {
    const preview = previewProductionWrite(REQUEST);
    const serialized = JSON.stringify(preview);

    expect(preview.plannedRecordCount).toBe(2);
    expect(preview.confirmed).toBe(false);
    expect(serialized).not.toContain(REQUEST.ingestionId);
    expect(serialized).not.toContain(REQUEST.targetBaseToken);
    expect(serialized).not.toContain('tbl_customer_prod');
    expect(serialized).not.toContain('tbl_project_prod');
  });

  it('requires an explicit confirmation transition', () => {
    const preview = previewProductionWrite(REQUEST);
    const confirmed = confirmProductionWritePreview(preview);

    expect(preview.confirmed).toBe(false);
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.previewId).toBe(preview.previewId);
  });
});

describe('production-pilot gate', () => {
  it('allows only when every pilot condition is satisfied', () => {
    const preview = confirmProductionWritePreview(previewProductionWrite(REQUEST));
    const result = isProductionPilotWriteAllowed(allPassConfig(), {
      ingestionId: REQUEST.ingestionId,
      governanceDecision: 'PASS',
      targetBaseToken: REQUEST.targetBaseToken,
      targetTableId: REQUEST.targetTableIds.project,
      targetTables: REQUEST.targetTables,
      targetTableIds: REQUEST.targetTableIds,
      pilotRunId: 'pilot-run-001',
      humanConfirmed: true,
      preview,
    });

    expect(result.allowed).toBe(true);
  });

  it.each([
    ['wrong write mode', { writeMode: 'blocked' as const }, {}],
    ['pilot disabled', { productionPilot: { ...allPassConfig().productionPilot!, enabled: false } }, {}],
    ['wrong run id', {}, { pilotRunId: 'pilot-run-002' }],
    ['human confirmation missing', {}, { humanConfirmed: false }],
    ['preview confirmation missing', {}, { preview: previewProductionWrite(REQUEST) }],
    ['record limit exceeded', {}, { targetTables: ['customer', 'project', 'model'] as const }],
    ['duplicate target plan', {}, { targetTables: ['customer', 'customer'] as const }],
  ])('%s blocks before a Create Record call', (_label, configOverride, inputOverride) => {
    const preview = confirmProductionWritePreview(previewProductionWrite(REQUEST));
    const result = isProductionPilotWriteAllowed({ ...allPassConfig(), ...configOverride }, {
      ingestionId: REQUEST.ingestionId,
      governanceDecision: 'PASS',
      targetBaseToken: REQUEST.targetBaseToken,
      targetTableId: REQUEST.targetTableIds.project,
      targetTables: REQUEST.targetTables,
      targetTableIds: REQUEST.targetTableIds,
      pilotRunId: 'pilot-run-001',
      humanConfirmed: true,
      preview,
      ...inputOverride,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).not.toContain(REQUEST.targetBaseToken);
    expect(result.reason).not.toContain(REQUEST.targetTableIds.project);
  });
});
