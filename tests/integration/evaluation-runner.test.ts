// evaluation-runner.test.ts
// Phase 2F: Gate C-Core 评测 Runner 集成测试
//
// 覆盖：
// 1. 端到端运行真实 fixture（tests/fixtures/customer-consultation-50.jsonl）验证 Gate PASS
// 2. 退出码验证：0=PASS, 1=指标未达标, 2=Runner/fixture 错误
// 3. 禁止网络访问：断言 Runner 执行期间不发起任何外部网络调用

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runEvaluation, FixtureLoaderError } from '../../src/evaluation/runner.js';
import { DEFAULT_FIXTURE_PATH } from '../../src/evaluation/fixture-loader.js';
import { EXIT_CODE } from '../../src/evaluation/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REAL_FIXTURE_PATH = path.resolve(REPO_ROOT, DEFAULT_FIXTURE_PATH);

// ---------------------------------------------------------------------------
// 临时 fixture 辅助
// ---------------------------------------------------------------------------

const tmpFiles: string[] = [];

function createTmpFixture(content: string): string {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(
    tmpDir,
    `collator-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`
  );
  fs.writeFileSync(tmpFile, content, 'utf-8');
  tmpFiles.push(tmpFile);
  return tmpFile;
}

function cleanupTmpFiles(): void {
  for (const f of tmpFiles) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // 忽略清理失败
    }
  }
  tmpFiles.length = 0;
}

// 构造一条会 PASS 的最小 fixture
function makePassingFixtureJson(caseId: string): string {
  return JSON.stringify({
    case_id: caseId,
    source: 'synthetic',
    scenario_tags: ['valid', 'minimal'],
    candidate: {
      schemaKey: 'customer',
      recordType: 'customer_consultation',
      data: { 客户姓名: '张三', 联系方式: '13800138000' },
      dateContext: { referenceDate: '2026-06-01' },
    },
    expected: {
      normalized_fields: { 客户姓名: '张三', 联系方式: '13800138000' },
      pipeline_errors: [],
      validation_errors: [],
      validation_warnings: [],
      success: true,
    },
    scoring: {
      evaluated_fields: ['客户姓名', '联系方式'],
      required_fields: ['客户姓名', '联系方式'],
      enum_fields: [],
      expect_intercepted: false,
    },
  });
}

// 构造一条会让指标不达标的 fixture：期望的字段值与实际不符
function makeFailingFixtureJson(caseId: string): string {
  return JSON.stringify({
    case_id: caseId,
    source: 'synthetic',
    scenario_tags: ['expected-mismatch'],
    candidate: {
      schemaKey: 'customer',
      recordType: 'customer_consultation',
      data: { 客户姓名: '张三', 联系方式: '13800138000' },
      dateContext: { referenceDate: '2026-06-01' },
    },
    expected: {
      // 故意期望一个不存在的字段值，触发 field_accuracy < 阈值
      normalized_fields: { 客户姓名: '不存在的名字', 联系方式: '13800138000' },
      pipeline_errors: [],
      validation_errors: [],
      validation_warnings: [],
      success: true,
    },
    scoring: {
      evaluated_fields: ['客户姓名', '联系方式'],
      required_fields: ['客户姓名', '联系方式'],
      enum_fields: [],
      expect_intercepted: false,
    },
  });
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('Phase 2F Evaluation Runner - 集成测试', () => {
  afterEach(() => {
    cleanupTmpFiles();
    vi.restoreAllMocks();
  });

  // 1. 端到端运行真实 fixture，验证 Gate PASS
  describe('端到端运行真实 fixture', () => {
    it('使用默认 fixture (customer-consultation-50.jsonl) 运行并 Gate PASS', () => {
      // 前置：fixture 文件存在
      expect(fs.existsSync(REAL_FIXTURE_PATH)).toBe(true);

      const result = runEvaluation({
        fixturePath: REAL_FIXTURE_PATH,
        // 使用临时输出目录，避免污染 artifacts/evaluation
        outputDir: path.join(os.tmpdir(), `collator-eval-report-${Date.now()}`),
      });

      // 退出码 0 = Gate 通过
      expect(result.exitCode).toBe(EXIT_CODE.GATE_PASS);

      // 报告基本字段
      expect(result.report.total_cases).toBe(50);
      expect(result.report.passed_cases).toBe(50);
      expect(result.report.gate_result).toBe('PASS');

      // Pipeline 版本非 unknown（说明实际执行了 Pipeline）
      expect(result.report.pipeline_version).not.toBe('unknown');
      expect(result.report.pipeline_version).toBeTruthy();

      // 所有指标均通过
      const m = result.report.metrics;
      expect(m.field_accuracy.passed).toBe(true);
      expect(m.required_field_recall.passed).toBe(true);
      expect(m.enum_precision.passed).toBe(true);
      expect(m.error_interception_rate.passed).toBe(true);
      expect(m.persistence_check.passed).toBe(true);

      // 门槛验证
      expect(m.field_accuracy.rate).not.toBe('NOT_APPLICABLE');
      if (m.field_accuracy.rate !== 'NOT_APPLICABLE') {
        expect(m.field_accuracy.rate).toBeGreaterThanOrEqual(m.field_accuracy.threshold);
      }
    });

    it('使用绝对路径的 fixture 运行，写入报告文件到临时目录', () => {
      const tmpOutputDir = path.join(os.tmpdir(), `collator-eval-out-${Date.now()}`);

      const result = runEvaluation({
        fixturePath: REAL_FIXTURE_PATH,
        outputDir: tmpOutputDir,
      });

      expect(result.exitCode).toBe(EXIT_CODE.GATE_PASS);
      expect(result.writtenPaths).toBeDefined();
      if (result.writtenPaths) {
        expect(fs.existsSync(result.writtenPaths.jsonPath)).toBe(true);
        expect(fs.existsSync(result.writtenPaths.markdownPath)).toBe(true);
        expect(fs.existsSync(result.writtenPaths.latestJsonPath)).toBe(true);
        expect(fs.existsSync(result.writtenPaths.latestMarkdownPath)).toBe(true);
      }
    });
  });

  // 2. 退出码验证
  describe('退出码验证', () => {
    it('退出码 0：所有指标达标时返回 GATE_PASS', () => {
      const fixturePath = createTmpFixture(makePassingFixtureJson('INT-PASS-001'));
      const result = runEvaluation({
        fixturePath,
        outputDir: path.join(os.tmpdir(), `collator-eval-pass-${Date.now()}`),
      });

      expect(result.exitCode).toBe(EXIT_CODE.GATE_PASS);
      expect(result.report.gate_result).toBe('PASS');
      expect(result.report.passed_cases).toBe(1);
    });

    it('退出码 1：指标未达标时返回 GATE_FAIL', () => {
      // 单条 fixture，field_accuracy = 0/2 = 0% < 90%
      const fixturePath = createTmpFixture(makeFailingFixtureJson('INT-FAIL-001'));
      const result = runEvaluation({
        fixturePath,
        outputDir: path.join(os.tmpdir(), `collator-eval-fail-${Date.now()}`),
      });

      expect(result.exitCode).toBe(EXIT_CODE.GATE_FAIL);
      expect(result.report.gate_result).toBe('FAIL');
      expect(result.report.passed_cases).toBe(0);

      // field_accuracy 应未通过
      const m = result.report.metrics;
      expect(m.field_accuracy.passed).toBe(false);
      if (m.field_accuracy.rate !== 'NOT_APPLICABLE') {
        expect(m.field_accuracy.rate).toBeLessThan(m.field_accuracy.threshold);
      }
    });

    it('退出码 2：fixture 文件不存在时抛出 FixtureLoaderError', () => {
      const nonExistentPath = path.join(os.tmpdir(), `collator-not-exist-${Date.now()}.jsonl`);

      expect(() =>
        runEvaluation({
          fixturePath: nonExistentPath,
          outputDir: path.join(os.tmpdir(), `collator-eval-err-${Date.now()}`),
        })
      ).toThrow(FixtureLoaderError);
    });

    it('退出码 2：fixture 结构损坏时抛出 FixtureLoaderError', () => {
      // 缺少 case_id
      const brokenFixture = JSON.stringify({
        source: 'synthetic',
        scenario_tags: ['broken'],
        candidate: {
          schemaKey: 'customer',
          recordType: 'customer_consultation',
          data: {},
          dateContext: { referenceDate: '2026-06-01' },
        },
        expected: {
          normalized_fields: {},
          pipeline_errors: [],
          validation_errors: [],
          validation_warnings: [],
          success: true,
        },
        scoring: {
          evaluated_fields: [],
          required_fields: [],
          enum_fields: [],
          expect_intercepted: false,
        },
      });
      const fixturePath = createTmpFixture(brokenFixture);

      expect(() =>
        runEvaluation({
          fixturePath,
          outputDir: path.join(os.tmpdir(), `collator-eval-broken-${Date.now()}`),
        })
      ).toThrow(FixtureLoaderError);
    });

    it('writeReports=false 时不写入文件但仍返回报告与退出码', () => {
      const fixturePath = createTmpFixture(makePassingFixtureJson('INT-NOWRITE-001'));
      const result = runEvaluation({
        fixturePath,
        writeReports: false,
      });

      expect(result.exitCode).toBe(EXIT_CODE.GATE_PASS);
      expect(result.writtenPaths).toBeUndefined();
      expect(result.report).toBeDefined();
      expect(result.report.total_cases).toBe(1);
    });
  });

  // 3. 禁止网络访问验证
  describe('禁止网络访问', () => {
    // 禁止网络模块列表：Runner/Pipeline 不应 import 任何网络相关模块
    const BANNED_MODULES = [
      'node:child_process',
      'node:http',
      'node:https',
      'node:net',
      'node:tls',
      'node:dns',
      'node:dgram',
      'undici',
      'axios',
      'node-fetch',
      'got',
      'request',
    ];

    /**
     * 收集 evaluation 模块与 CLI 入口的所有源码路径。
     * Runner 的完整调用链：run-evaluation.ts → runner.ts → fixture-loader/comparator/metrics/reporter → runCleaningPipeline
     */
    function collectEvaluationSourceFiles(): string[] {
      const files: string[] = [];
      const evalDir = path.resolve(REPO_ROOT, 'src', 'evaluation');
      for (const f of fs.readdirSync(evalDir)) {
        if (f.endsWith('.ts')) {
          files.push(path.join(evalDir, f));
        }
      }
      // CLI 入口
      const cliPath = path.resolve(REPO_ROOT, 'scripts', 'run-evaluation.ts');
      if (fs.existsSync(cliPath)) files.push(cliPath);
      return files;
    }

    it('Runner 执行期间不调用 globalThis.fetch', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('Runner 不应发起 fetch 网络调用');
      });

      const result = runEvaluation({
        fixturePath: REAL_FIXTURE_PATH,
        outputDir: path.join(os.tmpdir(), `collator-eval-no-fetch-${Date.now()}`),
        writeReports: false,
      });

      expect(result.exitCode).toBe(EXIT_CODE.GATE_PASS);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('evaluation 模块与 CLI 入口源码不 import 任何网络相关模块', () => {
      const sourceFiles = collectEvaluationSourceFiles();
      expect(sourceFiles.length).toBeGreaterThan(0);

      const violations: string[] = [];
      for (const file of sourceFiles) {
        const source = fs.readFileSync(file, 'utf-8');
        for (const banned of BANNED_MODULES) {
          // 匹配 import ... from 'banned' 或 require('banned') 或 import('banned')
          const importPattern = new RegExp(
            `(from\\s+['"]${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"])|` +
              `(require\\s*\\(\\s*['"]${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*\\))|` +
              `(import\\s*\\(\\s*['"]${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*\\))`
          );
          if (importPattern.test(source)) {
            violations.push(`${path.relative(REPO_ROOT, file)}: import ${banned}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  // 4. 门槛边界行为
  describe('门槛边界行为', () => {
    it('自定义门槛高于实际指标时 Gate FAIL', () => {
      // 单条全 PASS 的 fixture，field_accuracy = 100%
      // 但把门槛设为 >100%，应触发 FAIL
      const fixturePath = createTmpFixture(makePassingFixtureJson('INT-THRESHOLD-001'));
      const result = runEvaluation({
        fixturePath,
        outputDir: path.join(os.tmpdir(), `collator-eval-thresh-${Date.now()}`),
        thresholds: {
          field_accuracy: 1.01, // 不可达门槛
          required_field_recall: 0.95,
          enum_precision: 0.95,
          error_interception_rate: 0.95,
        },
        writeReports: false,
      });

      expect(result.exitCode).toBe(EXIT_CODE.GATE_FAIL);
      expect(result.report.gate_result).toBe('FAIL');
      expect(result.report.metrics.field_accuracy.passed).toBe(false);
    });

    it('自定义门槛低于实际指标时 Gate PASS', () => {
      const fixturePath = createTmpFixture(makePassingFixtureJson('INT-THRESHOLD-002'));
      const result = runEvaluation({
        fixturePath,
        outputDir: path.join(os.tmpdir(), `collator-eval-thresh-low-${Date.now()}`),
        thresholds: {
          field_accuracy: 0.0,
          required_field_recall: 0.0,
          enum_precision: 0.0,
          error_interception_rate: 0.0,
        },
        writeReports: false,
      });

      expect(result.exitCode).toBe(EXIT_CODE.GATE_PASS);
      expect(result.report.gate_result).toBe('PASS');
    });
  });
});
