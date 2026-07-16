// run-evaluation.ts
// Phase 2F: Gate C-Core 评测 CLI 薄入口
//
// 用法:
//   npm run evaluate                              # 使用默认 fixture 与门槛
//   npm run evaluate -- --fixture <path>          # 指定 fixture
//   npm run evaluate -- --output-dir <dir>        # 指定报告输出目录
//   npm run evaluate -- --help                    # 帮助
//
// 退出码:
//   0 = Gate 通过
//   1 = 指标未达标
//   2 = Runner/fixture/环境错误

import { runEvaluation, FixtureLoaderError } from '../src/evaluation/runner.js';
import { EXIT_CODE } from '../src/evaluation/types.js';
import type { ExitCode } from '../src/evaluation/types.js';

interface ParsedArgs {
  fixturePath?: string;
  outputDir?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--fixture') {
      args.fixturePath = argv[++i];
    } else if (a === '--output-dir') {
      args.outputDir = argv[++i];
    } else if (a.startsWith('--fixture=')) {
      args.fixturePath = a.slice('--fixture='.length);
    } else if (a.startsWith('--output-dir=')) {
      args.outputDir = a.slice('--output-dir='.length);
    } else {
      throw new Error(`未识别的参数: ${a}`);
    }
  }
  return args;
}

function printHelp(): void {
  const lines = [
    'Phase 2F Gate C-Core 评测 Runner',
    '',
    '用法:',
    '  npm run evaluate',
    '  npm run evaluate -- --fixture <path>',
    '  npm run evaluate -- --output-dir <dir>',
    '  npm run evaluate -- --help',
    '',
    '选项:',
    '  --fixture <path>      评测集 JSONL 文件路径 (默认 tests/fixtures/customer-consultation-50.jsonl)',
    '  --output-dir <dir>    报告输出目录 (默认 artifacts/evaluation)',
    '  --help, -h            显示帮助',
    '',
    '退出码:',
    '  0 = Gate 通过',
    '  1 = 指标未达标',
    '  2 = Runner/fixture/环境错误',
  ];
  console.log(lines.join('\n'));
}

function printSummary(result: { report: import('../src/evaluation/types.js').EvaluationReport; exitCode: ExitCode; writtenPaths?: { jsonPath: string; markdownPath: string; latestJsonPath: string; latestMarkdownPath: string } }): void {
  const { report, exitCode, writtenPaths } = result;
  console.log('');
  console.log('=== Phase 2F Gate C-Core 评测摘要 ===');
  console.log(`生成时间: ${report.generated_at}`);
  console.log(`Pipeline 版本: ${report.pipeline_version}`);
  console.log(`评测集: ${report.fixture_path}`);
  console.log(`总 case 数: ${report.total_cases}`);
  console.log(`通过 case 数: ${report.passed_cases}`);
  console.log(`Gate 结果: ${report.gate_result}`);
  console.log('');
  console.log('指标:');
  console.log(`  field_accuracy          : ${formatMetric(report.metrics.field_accuracy)}`);
  console.log(`  required_field_recall   : ${formatMetric(report.metrics.required_field_recall)}`);
  console.log(`  enum_precision          : ${formatMetric(report.metrics.enum_precision)}`);
  console.log(`  error_interception_rate : ${formatMetric(report.metrics.error_interception_rate)}`);
  console.log(`  persistence_check       : ${formatMetric(report.metrics.persistence_check)}`);
  console.log('');
  console.log(`退出码: ${exitCode} (${exitCode === 0 ? 'PASS' : exitCode === 1 ? 'FAIL' : 'ERROR'})`);
  if (writtenPaths) {
    console.log(`报告已写入:`);
    console.log(`  JSON     : ${writtenPaths.jsonPath}`);
    console.log(`  Markdown : ${writtenPaths.markdownPath}`);
    console.log(`  Latest JSON: ${writtenPaths.latestJsonPath}`);
    console.log(`  Latest MD  : ${writtenPaths.latestMarkdownPath}`);
  }
  console.log('');
}

function formatMetric(m: import('../src/evaluation/types.js').MetricValue): string {
  const rate = m.rate === 'NOT_APPLICABLE' ? 'N/A' : `${(m.rate * 100).toFixed(2)}%`;
  const threshold = m.rate === 'NOT_APPLICABLE' ? 'N/A' : `${(m.threshold * 100).toFixed(2)}%`;
  const status = m.passed ? 'PASS' : 'FAIL';
  return `${m.numerator}/${m.denominator} = ${rate} (门槛 ${threshold}) [${status}]`;
}

function main(): ExitCode {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`参数解析失败: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_CODE.RUNNER_ERROR;
  }

  if (args.help) {
    printHelp();
    return EXIT_CODE.GATE_PASS;
  }

  try {
    const result = runEvaluation({
      fixturePath: args.fixturePath,
      outputDir: args.outputDir,
    });
    printSummary(result);
    return result.exitCode;
  } catch (err) {
    if (err instanceof FixtureLoaderError) {
      console.error(`[FixtureLoaderError] ${err.message}`);
      return EXIT_CODE.RUNNER_ERROR;
    }
    console.error(`[RunnerError] ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    return EXIT_CODE.RUNNER_ERROR;
  }
}

const code = main();
process.exit(code);
