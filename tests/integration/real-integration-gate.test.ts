// real-integration-gate.test.ts
// Workstream E: 真实纵向集成 Gate 验证测试。
//
// 覆盖：
//   AC-E10: 默认启动仍为安全的非真实写入模式
//   AC-E17: SCREENSHOT_OCR_ENGINE 未配置时非 Demo 模式不得自动用 Mock
//   AC-E19: 应用日志/Git Diff/测试证据均无 Secret
//   AC-E20: 门禁组合参数化测试证明任一条件缺失均不调 Create Record API
//
// 运行：npx vitest run tests/integration/real-integration-gate.test.ts

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadFeishuWriteConfig,
  isRealWriteAllowed,
  type FeishuWriteConfig,
} from '../../src/server/config/feishu-write-config.js';
import { createOcrEngineFromEnv } from '../../src/ocr/ocr-engine-factory.js';
import { OcrConfigError } from '../../src/server/config/ocr-config.js';
import { GuardedBatchWriter } from '../../src/server/business/guarded-batch-writer.js';
import type {
  BatchWriterPort,
  TransactionalBatchWriterInput,
  TransactionalBatchWriterResult,
} from '../../src/server/business/transactional-batch-writer.js';

// ============================================================================
// 辅助：no-op inner writer — 记录 writeBatch 是否被调用
// ============================================================================

function createSpyInnerWriter(): { writer: BatchWriterPort; callCount: number } {
  let callCount = 0;
  const writer: BatchWriterPort = {
    async writeBatch(
      _input: TransactionalBatchWriterInput,
    ): Promise<TransactionalBatchWriterResult> {
      callCount++;
      return {
        write_results: [],
        transaction_snapshot_id: 'spy_snapshot',
        status: 'committed',
        records_created: 0,
        records_rolled_back: 0,
      };
    },
  };
  return { writer, get callCount() { return callCount; } };
}

/** 全条件通过的门禁配置 */
function allPassConfig(): FeishuWriteConfig {
  return {
    taskRepository: 'feishu',
    dryRun: false,
    enableRealFeishuWrite: true,
    feishuWriteEnv: 'test',
    testWhitelist: {
      baseAppToken: 'test_base_token',
      tableIds: ['tblCustomer', 'tblProject', 'tblModel'],
    },
  };
}

/** 全字段填满的写入输入 */
const baseInput = {
  ingestionId: 'ing_test_001',
  normalizedFields: { 客户姓名: '匿名' },
  targetTables: ['customer' as const],
  governanceDecision: { decision: 'PASS' },
  targetBaseToken: 'test_base_token',
  customerTableId: 'tblCustomer',
  projectTableId: 'tblProject',
  modelTableId: 'tblModel',
};

// ============================================================================
// AC-E10: 默认启动安全（非真实写入模式）
// ============================================================================

describe('AC-E10: Default startup is safe (no real write enabled)', () => {
  it('loadFeishuWriteConfig({}) blocks all writes — condition 1 (taskRepository)', () => {
    const config = loadFeishuWriteConfig({});
    expect(config.taskRepository).toBe('memory');
    const result = isRealWriteAllowed(config, { decision: 'PASS' }, 'base', 'tbl');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('condition 1');
  });

  it('default env has dryRun=true — condition 2 blocks', () => {
    const config = loadFeishuWriteConfig({});
    expect(config.dryRun).toBe(true);
  });

  it('default env has enableRealFeishuWrite=false — condition 3 blocks', () => {
    const config = loadFeishuWriteConfig({});
    expect(config.enableRealFeishuWrite).toBe(false);
  });

  it('default env has feishuWriteEnv=undefined — condition 4 blocks', () => {
    const config = loadFeishuWriteConfig({});
    expect(config.feishuWriteEnv).toBeUndefined();
  });

  it('default env has empty whitelist — condition 5 blocks', () => {
    const config = loadFeishuWriteConfig({});
    expect(config.testWhitelist.tableIds).toHaveLength(0);
  });

  it('GuardedBatchWriter with default config blocks and never calls inner writer', async () => {
    const config = loadFeishuWriteConfig({});
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(config, spy.writer);

    const result = await guarded.writeBatch(baseInput);

    expect(result.status).toBe('blocked');
    expect(result.gate.allowed).toBe(false);
    expect(spy.callCount).toBe(0);
  });
});

// ============================================================================
// AC-E17: OCR_ENGINE 未配置时 fail-closed（不静默回退 Mock）
// ============================================================================

describe('AC-E17: SCREENSHOT_OCR_ENGINE unset → fail closed (no silent mock)', () => {
  it('createOcrEngineFromEnv({}) throws OcrConfigError', () => {
    expect(() => createOcrEngineFromEnv({})).toThrow(OcrConfigError);
  });

  it('createOcrEngineFromEnv with empty SCREENSHOT_OCR_ENGINE throws OcrConfigError', () => {
    expect(() =>
      createOcrEngineFromEnv({ SCREENSHOT_OCR_ENGINE: '' }),
    ).toThrow(OcrConfigError);
  });

  it('createOcrEngineFromEnv with unknown engine name throws OcrConfigError', () => {
    expect(() =>
      createOcrEngineFromEnv({ SCREENSHOT_OCR_ENGINE: 'nonexistent' }),
    ).toThrow(OcrConfigError);
  });

  it('createOcrEngineFromEnv with mock explicitly returns engine (no throw)', () => {
    const engine = createOcrEngineFromEnv({ SCREENSHOT_OCR_ENGINE: 'mock' });
    expect(engine).toBeDefined();
  });
});

// ============================================================================
// AC-E19: 无 Secret 泄露
// ============================================================================

describe('AC-E19: No secrets in source code or gate reasons', () => {
  // 扫描 Workstream E 接线的源文件，确认无硬编码 Secret
  const sourceFiles = [
    'src/server/app.ts',
    'src/server/services/screenshot-service.ts',
    'src/server/business/guarded-batch-writer.ts',
    'src/server/config/feishu-write-config.ts',
    'src/ocr/ocr-engine-factory.ts',
  ];

  // 硬编码 Secret 模式（不匹配环境变量名引用，只匹配实际值）
  const secretPatterns = [
    /app_secret\s*[:=]\s*["'][a-zA-Z0-9]{16,}["']/i,
    /app_id\s*[:=]\s*["']cli_[a-zA-Z0-9]+["']/i,
    /access_token\s*[:=]\s*["'][a-zA-Z0-9_-]{20,}["']/i,
    /base_app_token\s*[:=]\s*["'][a-zA-Z0-9_-]{15,}["']/i,
  ];

  for (const file of sourceFiles) {
    it(`${file} contains no hardcoded secrets`, () => {
      const content = readFileSync(resolve(process.cwd(), file), 'utf-8');
      for (const pattern of secretPatterns) {
        expect(content).not.toMatch(pattern);
      }
    });
  }

  it('gate block reasons are static strings — no env values leaked', () => {
    // 即使 env 中有 Secret 值，gate reason 也不应包含它们
    const config = loadFeishuWriteConfig({
      FEISHU_APP_SECRET: 'super-secret-value-12345',
      FEISHU_APP_ID: 'cli_test_app_id',
      FEISHU_BASE_APP_TOKEN: 'base_token_value',
    });
    const result = isRealWriteAllowed(config, { decision: 'PASS' }, 'base', 'tbl');
    expect(result.allowed).toBe(false);
    expect(result.reason).not.toContain('super-secret-value-12345');
    expect(result.reason).not.toContain('cli_test_app_id');
    expect(result.reason).not.toContain('base_token_value');
  });
});

// ============================================================================
// AC-E20: 门禁组合参数化测试（任一条件缺失均不调 Create Record API）
// ============================================================================

describe('AC-E20: Gate blocks on any missing condition (parameterized)', () => {
  // 条件 1: taskRepository 必须为 'feishu'
  it('blocks when taskRepository=memory (condition 1)', async () => {
    const cfg = { ...allPassConfig(), taskRepository: 'memory' as const };
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(cfg, spy.writer);
    const result = await guarded.writeBatch(baseInput);
    expect(result.status).toBe('blocked');
    expect(spy.callCount).toBe(0);
  });

  // 条件 2: dryRun 必须为 false
  it('blocks when dryRun=true (condition 2)', async () => {
    const cfg = { ...allPassConfig(), dryRun: true };
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(cfg, spy.writer);
    const result = await guarded.writeBatch(baseInput);
    expect(result.status).toBe('blocked');
    expect(spy.callCount).toBe(0);
  });

  // 条件 3: enableRealFeishuWrite 必须为 true
  it('blocks when enableRealFeishuWrite=false (condition 3)', async () => {
    const cfg = { ...allPassConfig(), enableRealFeishuWrite: false };
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(cfg, spy.writer);
    const result = await guarded.writeBatch(baseInput);
    expect(result.status).toBe('blocked');
    expect(spy.callCount).toBe(0);
  });

  // 条件 4: feishuWriteEnv 必须为 'test'
  it('blocks when feishuWriteEnv=production (condition 4)', async () => {
    const cfg = { ...allPassConfig(), feishuWriteEnv: 'production' as const };
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(cfg, spy.writer);
    const result = await guarded.writeBatch(baseInput);
    expect(result.status).toBe('blocked');
    expect(spy.callCount).toBe(0);
  });

  it('blocks when feishuWriteEnv=undefined (condition 4)', async () => {
    const cfg = { ...allPassConfig(), feishuWriteEnv: undefined };
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(cfg, spy.writer);
    const result = await guarded.writeBatch(baseInput);
    expect(result.status).toBe('blocked');
    expect(spy.callCount).toBe(0);
  });

  // 条件 5: 目标表不在白名单
  it('blocks when target table not whitelisted (condition 5)', async () => {
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(allPassConfig(), spy.writer);
    const result = await guarded.writeBatch({
      ...baseInput,
      customerTableId: 'tblNotWhitelisted',
    });
    expect(result.status).toBe('blocked');
    expect(spy.callCount).toBe(0);
  });

  it('blocks when whitelist is empty (condition 5)', async () => {
    const cfg = {
      ...allPassConfig(),
      testWhitelist: { baseAppToken: 'test_base_token', tableIds: [] },
    };
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(cfg, spy.writer);
    const result = await guarded.writeBatch(baseInput);
    expect(result.status).toBe('blocked');
    expect(spy.callCount).toBe(0);
  });

  it('blocks when target base token mismatches whitelist (condition 5)', async () => {
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(allPassConfig(), spy.writer);
    const result = await guarded.writeBatch({
      ...baseInput,
      targetBaseToken: 'wrong_base_token',
    });
    expect(result.status).toBe('blocked');
    expect(spy.callCount).toBe(0);
  });

  // 条件 6: SOP 治理决定必须为 PASS
  it('blocks when governance=NEEDS_REVIEW (condition 6)', async () => {
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(allPassConfig(), spy.writer);
    const result = await guarded.writeBatch({
      ...baseInput,
      governanceDecision: { decision: 'NEEDS_REVIEW' },
    });
    expect(result.status).toBe('blocked');
    expect(spy.callCount).toBe(0);
  });

  it('blocks when governance=BLOCKED (condition 6)', async () => {
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(allPassConfig(), spy.writer);
    const result = await guarded.writeBatch({
      ...baseInput,
      governanceDecision: { decision: 'BLOCKED' },
    });
    expect(result.status).toBe('blocked');
    expect(spy.callCount).toBe(0);
  });

  // 全条件满足 → 放行
  it('allows write when ALL 6 conditions met + governance=PASS', async () => {
    const spy = createSpyInnerWriter();
    const guarded = new GuardedBatchWriter(allPassConfig(), spy.writer);
    const result = await guarded.writeBatch(baseInput);
    expect(result.status).toBe('committed');
    expect(result.gate.allowed).toBe(true);
    expect(spy.callCount).toBe(1);
  });
});
