// runner.ts
// Phase 2F: Gate C-Core 评测 Runner 主逻辑
//
// 职责：
// 1. 加载 fixture。
// 2. 对每条 fixture 调用 runCleaningPipeline（复用 Phase 2C 生产入口）。
// 3. 比较实际输出与 expected，计算指标，生成报告。
// 4. 返回退出码：0=PASS，1=FAIL，2=Runner/环境错误。
//
// 设计约束：
// - 不得复制业务逻辑（必须调用 src/server/cleaning/pipeline/cleaning-pipeline.ts）。
// - 不调用 Dify、LLM、飞书、数据库或任何外部网络。
// - 错误比较使用 code+field/stage，不比较文案。

import { runCleaningPipeline } from '../server/cleaning/pipeline/cleaning-pipeline.js';
import { loadFixtures, FixtureLoaderError, DEFAULT_FIXTURE_PATH } from './fixture-loader.js';
import { compareFixture } from './comparator.js';
import { computeMetrics, isGatePassed } from './metrics.js';
import { buildReport, writeReport, DEFAULT_REPORT_DIR } from './reporter.js';
import { DEFAULT_GATE_THRESHOLDS, EXIT_CODE } from './types.js';
import type {
  CaseComparison,
  EvaluationFixture,
  EvaluationReport,
  ExitCode,
  GateThresholds,
} from './types.js';

// ---------------------------------------------------------------------------
// 运行选项
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** 评测集文件路径，默认 DEFAULT_FIXTURE_PATH */
  fixturePath?: string;
  /** 报告输出目录，默认 DEFAULT_REPORT_DIR */
  outputDir?: string;
  /** Gate 门槛，默认 DEFAULT_GATE_THRESHOLDS */
  thresholds?: GateThresholds;
  /** 是否写入报告文件，默认 true */
  writeReports?: boolean;
}

export interface RunResult {
  report: EvaluationReport;
  exitCode: ExitCode;
  writtenPaths?: {
    jsonPath: string;
    markdownPath: string;
    latestJsonPath: string;
    latestMarkdownPath: string;
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 运行 Gate C-Core 评测。
 *
 * @throws FixtureLoaderError 当 fixture 加载或结构校验失败时（exitCode=2）
 * @throws Error 当 Pipeline 执行出现非预期异常时（exitCode=2）
 */
export function runEvaluation(options: RunOptions = {}): RunResult {
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE_PATH;
  const outputDir = options.outputDir ?? DEFAULT_REPORT_DIR;
  const thresholds = options.thresholds ?? DEFAULT_GATE_THRESHOLDS;
  const writeReports = options.writeReports ?? true;

  // 1. 加载 fixture（失败时抛出，由 CLI 层捕获并退出 2）
  const loaded = loadFixtures(fixturePath);
  const fixtures: EvaluationFixture[] = loaded.fixtures;

  // 2. 逐条执行 Pipeline 并比较
  const comparisons: CaseComparison[] = [];
  for (const fixture of fixtures) {
    let result;
    try {
      result = runCleaningPipeline(fixture.candidate);
    } catch (err) {
      // Pipeline 不应抛出未捕获异常；若抛出，记录为 case 失败并继续
      // 这样可以输出完整报告而不是中断整个评测
      const errorMessage = err instanceof Error ? err.message : String(err);
      comparisons.push({
        case_id: fixture.case_id,
        passed: false,
        field_matches: [],
        pipeline_error_match: false,
        validation_error_match: false,
        validation_warning_match: false,
        success_match: false,
        interception_match: false,
        actual: {
          success: false,
          standardizedRecord: {},
          pipeline_error_codes: [{ stage: 'format_clean', code: 'RUNNER_EXCEPTION' }],
          validation_error_codes: [],
          validation_warning_codes: [],
          pipeline_version: 'unknown',
        },
        expected: fixture.expected,
        discrepancies: [`Pipeline 执行抛出异常: ${errorMessage}`],
      });
      continue;
    }
    comparisons.push(compareFixture(fixture, result));
  }

  // 3. 计算指标
  const metrics = computeMetrics(comparisons, fixtures, thresholds);

  // 4. 构造报告
  const pipelineVersion = extractPipelineVersion(comparisons);
  const report = buildReport(
    comparisons,
    metrics,
    loaded.resolvedPath,
    pipelineVersion,
    thresholds
  );

  // 5. 写入文件
  let writtenPaths: RunResult['writtenPaths'];
  if (writeReports) {
    writtenPaths = writeReport(report, outputDir);
  }

  // 6. 判定退出码
  const gatePassed = isGatePassed(metrics);
  const exitCode: ExitCode = gatePassed ? EXIT_CODE.GATE_PASS : EXIT_CODE.GATE_FAIL;

  return { report, exitCode, writtenPaths };
}

/**
 * 从 comparisons 中提取 Pipeline 版本（取第一条非 'unknown' 的版本）。
 */
function extractPipelineVersion(comparisons: CaseComparison[]): string {
  for (const c of comparisons) {
    if (c.actual.pipeline_version && c.actual.pipeline_version !== 'unknown') {
      return c.actual.pipeline_version;
    }
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// 重新导出常见符号（便于 CLI 调用）
// ---------------------------------------------------------------------------

export { FixtureLoaderError };
