// feishu-write-config.test.ts
// Workstream C / Amendment 6: 双层放行门单元测试。
//
// AC-C01 / AC-E20: 参数化验证门的 6 个条件 —— 任一条件缺失 → allowed=false。
// AC-C12: 门禁 reason 不得包含任何密钥/令牌/PII。
// AC-C02 / AC-C03: 治理非 PASS（REVIEW / REJECT）→ blocked。
//
// 运行：vitest run tests/unit/feishu/feishu-write-config.test.ts

import { describe, it, expect } from 'vitest';
import {
  loadFeishuWriteConfig,
  isRealWriteAllowed,
  type FeishuWriteConfig,
} from '../../../src/server/config/feishu-write-config.js';

// ============================================================================
// 基线：全部 6 条件满足 → allowed=true
// ============================================================================

const ALL_PASS_CONFIG: FeishuWriteConfig = {
  taskRepository: 'feishu',
  dryRun: false,
  enableRealFeishuWrite: true,
  feishuWriteEnv: 'test',
  testWhitelist: {
    baseAppToken: 'base_test_001',
    tableIds: ['tblCustomer', 'tblProject', 'tblModel'],
  },
};

const PASS_GOVERNANCE = { decision: 'PASS' as const };
const TARGET_BASE = 'base_test_001';
const TARGET_TABLE = 'tblProject';

describe('isRealWriteAllowed — baseline', () => {
  it('returns allowed=true when all 6 conditions are met', () => {
    const result = isRealWriteAllowed(ALL_PASS_CONFIG, PASS_GOVERNANCE, TARGET_BASE, TARGET_TABLE);
    expect(result.allowed).toBe(true);
    expect(result.reason).toMatch(/all 6 gate conditions met/i);
  });
});

// ============================================================================
// 参数化：每个条件单独缺失 → allowed=false（AC-C01 / AC-E20）
// ============================================================================

describe('isRealWriteAllowed — each condition missing blocks the gate', () => {
  it('condition 1: TASK_REPOSITORY != feishu → blocked', () => {
    const cfg = { ...ALL_PASS_CONFIG, taskRepository: 'memory' as const };
    const r = isRealWriteAllowed(cfg, PASS_GOVERNANCE, TARGET_BASE, TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 1 of 6/);
    expect(r.reason).toMatch(/TASK_REPOSITORY/i);
  });

  it('condition 2: DRY_RUN=true → blocked', () => {
    const cfg = { ...ALL_PASS_CONFIG, dryRun: true };
    const r = isRealWriteAllowed(cfg, PASS_GOVERNANCE, TARGET_BASE, TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 2 of 6/);
    expect(r.reason).toMatch(/DRY_RUN/i);
  });

  it('condition 3: ENABLE_REAL_FEISHU_WRITE=false → blocked', () => {
    const cfg = { ...ALL_PASS_CONFIG, enableRealFeishuWrite: false };
    const r = isRealWriteAllowed(cfg, PASS_GOVERNANCE, TARGET_BASE, TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 3 of 6/);
    expect(r.reason).toMatch(/ENABLE_REAL_FEISHU_WRITE/i);
  });

  it('condition 4: FEISHU_WRITE_ENV=production → blocked (production not enabled this batch)', () => {
    const cfg = { ...ALL_PASS_CONFIG, feishuWriteEnv: 'production' as const };
    const r = isRealWriteAllowed(cfg, PASS_GOVERNANCE, TARGET_BASE, TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 4 of 6/);
  });

  it('condition 4: FEISHU_WRITE_ENV missing (undefined) → blocked (no default)', () => {
    const cfg = { ...ALL_PASS_CONFIG, feishuWriteEnv: undefined };
    const r = isRealWriteAllowed(cfg, PASS_GOVERNANCE, TARGET_BASE, TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 4 of 6/);
  });

  it('condition 5: target table not in whitelist → blocked', () => {
    const r = isRealWriteAllowed(ALL_PASS_CONFIG, PASS_GOVERNANCE, TARGET_BASE, 'tblNotWhitelisted');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 5 of 6/);
    expect(r.reason).toMatch(/not in the test whitelist/i);
  });

  it('condition 5: empty whitelist → blocked', () => {
    const cfg = { ...ALL_PASS_CONFIG, testWhitelist: { baseAppToken: 'base_test_001', tableIds: [] } };
    const r = isRealWriteAllowed(cfg, PASS_GOVERNANCE, TARGET_BASE, TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 5 of 6/);
    expect(r.reason).toMatch(/empty/i);
  });

  it('condition 5: target base token mismatch → blocked', () => {
    const r = isRealWriteAllowed(ALL_PASS_CONFIG, PASS_GOVERNANCE, 'base_other', TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 5 of 6/);
    expect(r.reason).toMatch(/base token does not match/i);
  });

  it('condition 5: target table id undefined → blocked', () => {
    const r = isRealWriteAllowed(ALL_PASS_CONFIG, PASS_GOVERNANCE, TARGET_BASE, undefined);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 5 of 6/);
  });

  it('condition 6: governance NEEDS_REVIEW (review) → blocked (AC-C03)', () => {
    const r = isRealWriteAllowed(ALL_PASS_CONFIG, { decision: 'NEEDS_REVIEW' }, TARGET_BASE, TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 6 of 6/);
    expect(r.reason).toMatch(/NEEDS_REVIEW/i);
  });

  it('condition 6: governance BLOCKED (reject) → blocked (AC-C03)', () => {
    const r = isRealWriteAllowed(ALL_PASS_CONFIG, { decision: 'BLOCKED' }, TARGET_BASE, TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 6 of 6/);
    expect(r.reason).toMatch(/BLOCKED/i);
  });

  it('condition 6: governance empty decision → blocked', () => {
    const r = isRealWriteAllowed(ALL_PASS_CONFIG, { decision: '' }, TARGET_BASE, TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 6 of 6/);
  });

  it('condition 6: accepts a bare decision string', () => {
    const ok = isRealWriteAllowed(ALL_PASS_CONFIG, 'PASS', TARGET_BASE, TARGET_TABLE);
    expect(ok.allowed).toBe(true);
    const blocked = isRealWriteAllowed(ALL_PASS_CONFIG, 'NEEDS_REVIEW', TARGET_BASE, TARGET_TABLE);
    expect(blocked.allowed).toBe(false);
  });
});

// ============================================================================
// 条件评估顺序：低编号条件的失败优先于高编号条件
// ============================================================================

describe('isRealWriteAllowed — evaluation order', () => {
  it('reports condition 1 before condition 6 when both fail', () => {
    const cfg = { ...ALL_PASS_CONFIG, taskRepository: 'memory' as const };
    const r = isRealWriteAllowed(cfg, { decision: 'BLOCKED' }, TARGET_BASE, TARGET_TABLE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/condition 1 of 6/);
  });
});

// ============================================================================
// loadFeishuWriteConfig: 环境变量解析
// ============================================================================

describe('loadFeishuWriteConfig — env parsing', () => {
  it('parses a fully-enabled test env', () => {
    const cfg = loadFeishuWriteConfig({
      TASK_REPOSITORY: 'feishu',
      DRY_RUN: 'false',
      ENABLE_REAL_FEISHU_WRITE: 'true',
      FEISHU_WRITE_ENV: 'test',
      FEISHU_TEST_BASE_APP_TOKEN: 'base_test_001',
      FEISHU_TEST_TABLE_IDS: 'tblCustomer, tblProject , tblModel',
    });
    expect(cfg.taskRepository).toBe('feishu');
    expect(cfg.dryRun).toBe(false);
    expect(cfg.enableRealFeishuWrite).toBe(true);
    expect(cfg.feishuWriteEnv).toBe('test');
    expect(cfg.testWhitelist.baseAppToken).toBe('base_test_001');
    expect(cfg.testWhitelist.tableIds).toEqual(['tblCustomer', 'tblProject', 'tblModel']);
  });

  it('parses DRY_RUN="false" as false (not the zod coerce gotcha)', () => {
    expect(loadFeishuWriteConfig({ DRY_RUN: 'false' }).dryRun).toBe(false);
    expect(loadFeishuWriteConfig({ DRY_RUN: 'true' }).dryRun).toBe(true);
    expect(loadFeishuWriteConfig({}).dryRun).toBe(true); // default true (safe)
  });

  it('defaults ENABLE_REAL_FEISHU_WRITE to false (fail-closed)', () => {
    expect(loadFeishuWriteConfig({}).enableRealFeishuWrite).toBe(false);
    expect(loadFeishuWriteConfig({ ENABLE_REAL_FEISHU_WRITE: 'false' }).enableRealFeishuWrite).toBe(false);
    expect(loadFeishuWriteConfig({ ENABLE_REAL_FEISHU_WRITE: 'yes' }).enableRealFeishuWrite).toBe(false);
    expect(loadFeishuWriteConfig({ ENABLE_REAL_FEISHU_WRITE: 'true' }).enableRealFeishuWrite).toBe(true);
  });

  it('FEISHU_WRITE_ENV has NO default — missing/unrecognised → undefined (blocked)', () => {
    expect(loadFeishuWriteConfig({}).feishuWriteEnv).toBeUndefined();
    expect(loadFeishuWriteConfig({ FEISHU_WRITE_ENV: 'staging' }).feishuWriteEnv).toBeUndefined();
    expect(loadFeishuWriteConfig({ FEISHU_WRITE_ENV: 'production' }).feishuWriteEnv).toBe('production');
  });

  it('parses comma-separated table ids, trimming and dropping empties', () => {
    expect(loadFeishuWriteConfig({ FEISHU_TEST_TABLE_IDS: ' a ,, b , ' }).testWhitelist.tableIds).toEqual(['a', 'b']);
    expect(loadFeishuWriteConfig({}).testWhitelist.tableIds).toEqual([]);
  });

  it('treats non-feishu TASK_REPOSITORY as memory', () => {
    expect(loadFeishuWriteConfig({ TASK_REPOSITORY: 'memory' }).taskRepository).toBe('memory');
    expect(loadFeishuWriteConfig({ TASK_REPOSITORY: 'garbage' }).taskRepository).toBe('memory');
  });
});

// ============================================================================
// AC-C12: 门禁 reason 不泄露密钥
// ============================================================================

describe('isRealWriteAllowed — secret redaction (AC-C12)', () => {
  const SECRET_APP_SECRET = 'SUPER_SECRET_APP_SECRET_VALUE_xyz';
  const SECRET_APP_ID = 'cli_secret_app_id_999';

  it('never echoes env secrets in any blocked reason', () => {
    // Load config with secrets present in env (they are NOT consumed by the
    // gate config, but assert they cannot leak via reasons regardless).
    const cfg = loadFeishuWriteConfig({
      TASK_REPOSITORY: 'feishu',
      DRY_RUN: 'false',
      ENABLE_REAL_FEISHU_WRITE: 'true',
      FEISHU_WRITE_ENV: 'test',
      FEISHU_TEST_BASE_APP_TOKEN: 'base_test_001',
      FEISHU_TEST_TABLE_IDS: 'tblProject',
      FEISHU_APP_ID: SECRET_APP_ID,
      FEISHU_APP_SECRET: SECRET_APP_SECRET,
    });

    // Exercise every blocked branch and collect reasons.
    const reasons: string[] = [];
    reasons.push(isRealWriteAllowed({ ...cfg, taskRepository: 'memory' }, PASS_GOVERNANCE, TARGET_BASE, 'tblProject').reason);
    reasons.push(isRealWriteAllowed({ ...cfg, dryRun: true }, PASS_GOVERNANCE, TARGET_BASE, 'tblProject').reason);
    reasons.push(isRealWriteAllowed({ ...cfg, enableRealFeishuWrite: false }, PASS_GOVERNANCE, TARGET_BASE, 'tblProject').reason);
    reasons.push(isRealWriteAllowed({ ...cfg, feishuWriteEnv: 'production' }, PASS_GOVERNANCE, TARGET_BASE, 'tblProject').reason);
    reasons.push(isRealWriteAllowed(cfg, PASS_GOVERNANCE, TARGET_BASE, 'tblOther').reason);
    reasons.push(isRealWriteAllowed(cfg, { decision: 'NEEDS_REVIEW' }, TARGET_BASE, 'tblProject').reason);
    reasons.push(isRealWriteAllowed(cfg, PASS_GOVERNANCE, 'base_test_001', 'tblProject').reason); // allowed

    for (const reason of reasons) {
      expect(reason).not.toContain(SECRET_APP_SECRET);
      expect(reason).not.toContain(SECRET_APP_ID);
    }
  });
});
