// reporter.ts
// Phase 2F: 评测报告生成
//
// 输出：
// - artifacts/evaluation/report-{timestamp}.json  完整结构化报告
// - artifacts/evaluation/report-{timestamp}.md    人类可读 Markdown 摘要
// - artifacts/evaluation/latest.json              最新报告副本
// - artifacts/evaluation/latest.md                最新 Markdown 副本
//
// 报告中不输出原始 PII（手机号、客户姓名原文）。
// 失败 case 仅展示 discrepancies 与字段匹配摘要，不展示 standardizedRecord 原文。

import fs from 'node:fs';
import path from 'node:path';
import type {
  EvaluationReport,
  MetricValue,
  CaseComparison,
} from './types.js';

// ---------------------------------------------------------------------------
// 路径辅助
// ---------------------------------------------------------------------------

export const DEFAULT_REPORT_DIR = 'artifacts/evaluation';

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// ---------------------------------------------------------------------------
// Markdown 生成
// ---------------------------------------------------------------------------

function formatRate(rate: number | 'NOT_APPLICABLE'): string {
  if (rate === 'NOT_APPLICABLE') return 'N/A';
  return `${(rate * 100).toFixed(2)}%`;
}

function formatMetricRow(m: MetricValue): string {
  const rate = formatRate(m.rate);
  const threshold = m.rate === 'NOT_APPLICABLE' ? 'N/A' : `${(m.threshold * 100).toFixed(2)}%`;
  const status = m.passed ? 'PASS' : 'FAIL';
  return `| ${m.name} | ${m.numerator} / ${m.denominator} | ${rate} | ${threshold} | ${status} |`;
}

function buildMarkdown(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push('# Phase 2F Gate C-Core 评测报告');
  lines.push('');
  lines.push(`- 生成时间: ${report.generated_at}`);
  lines.push(`- Pipeline 版本: ${report.pipeline_version}`);
  lines.push(`- 评测集: ${report.fixture_path}`);
  lines.push(`- 总 case 数: ${report.total_cases}`);
  lines.push(`- 通过 case 数: ${report.passed_cases}`);
  lines.push(`- Gate 结果: **${report.gate_result}**`);
  lines.push('');

  lines.push('## 指标');
  lines.push('');
  lines.push('| 指标 | 分子/分母 | 通过率 | 门槛 | 状态 |');
  lines.push('|------|-----------|--------|------|------|');
  lines.push(formatMetricRow(report.metrics.field_accuracy));
  lines.push(formatMetricRow(report.metrics.required_field_recall));
  lines.push(formatMetricRow(report.metrics.enum_precision));
  lines.push(formatMetricRow(report.metrics.error_interception_rate));
  lines.push(formatMetricRow(report.metrics.persistence_check));
  lines.push('');

  const failedCases = report.case_comparisons.filter(c => !c.passed);
  lines.push(`## 失败 Case (${failedCases.length})`);
  lines.push('');
  if (failedCases.length === 0) {
    lines.push('无失败 case。');
  } else {
    for (const c of failedCases) {
      lines.push(`### ${c.case_id}`);
      lines.push('');
      lines.push(`- success_match: ${c.success_match} (expected=${c.expected.success}, actual=${c.actual.success})`);
      lines.push(`- pipeline_error_match: ${c.pipeline_error_match}`);
      lines.push(`- validation_error_match: ${c.validation_error_match}`);
      lines.push(`- validation_warning_match: ${c.validation_warning_match}`);
      lines.push(`- interception_match: ${c.interception_match}`);
      lines.push(`- pipeline_version: ${c.actual.pipeline_version}`);
      lines.push('');
      const mismatchedFields = c.field_matches.filter(f => !f.match);
      if (mismatchedFields.length > 0) {
        lines.push('字段差异:');
        for (const fm of mismatchedFields) {
          lines.push(`  - ${fm.field}`);
        }
        lines.push('');
      }
      if (c.discrepancies.length > 0) {
        lines.push('差异详情:');
        for (const d of c.discrepancies) {
          lines.push(`  - ${d}`);
        }
        lines.push('');
      }
    }
  }

  // 通过 case 概览
  const passedCases = report.case_comparisons.filter(c => c.passed);
  lines.push(`## 通过 Case 概览 (${passedCases.length})`);
  lines.push('');
  if (passedCases.length > 0) {
    lines.push('case_id 列表: ' + passedCases.map(c => c.case_id).join(', '));
  } else {
    lines.push('无通过 case。');
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 报告写入
// ---------------------------------------------------------------------------

export interface WrittenReports {
  jsonPath: string;
  markdownPath: string;
  latestJsonPath: string;
  latestMarkdownPath: string;
}

/**
 * 将评测报告写入文件系统。
 *
 * @param report 完整评测报告
 * @param outputDir 输出目录（默认 artifacts/evaluation）
 * @returns 实际写入的文件路径
 */
export function writeReport(
  report: EvaluationReport,
  outputDir: string = DEFAULT_REPORT_DIR
): WrittenReports {
  const absDir = path.resolve(process.cwd(), outputDir);
  ensureDir(absDir);

  const ts = timestamp();
  const jsonName = `report-${ts}.json`;
  const mdName = `report-${ts}.md`;

  const jsonPath = path.join(absDir, jsonName);
  const markdownPath = path.join(absDir, mdName);
  const latestJsonPath = path.join(absDir, 'latest.json');
  const latestMarkdownPath = path.join(absDir, 'latest.md');

  const jsonContent = JSON.stringify(report, null, 2);
  const mdContent = buildMarkdown(report);

  fs.writeFileSync(jsonPath, jsonContent, 'utf-8');
  fs.writeFileSync(markdownPath, mdContent, 'utf-8');
  fs.writeFileSync(latestJsonPath, jsonContent, 'utf-8');
  fs.writeFileSync(latestMarkdownPath, mdContent, 'utf-8');

  return { jsonPath, markdownPath, latestJsonPath, latestMarkdownPath };
}

// ---------------------------------------------------------------------------
// 报告构造（从 comparisons + metrics）
// ---------------------------------------------------------------------------

/**
 * 构造完整评测报告对象。
 */
export function buildReport(
  comparisons: CaseComparison[],
  metrics: EvaluationReport['metrics'],
  fixturePath: string,
  pipelineVersion: string,
  thresholds: EvaluationReport['thresholds']
): EvaluationReport {
  const total_cases = comparisons.length;
  const passed_cases = comparisons.filter(c => c.passed).length;
  const gate_result: 'PASS' | 'FAIL' = (
    metrics.field_accuracy.passed &&
    metrics.required_field_recall.passed &&
    metrics.enum_precision.passed &&
    metrics.error_interception_rate.passed &&
    metrics.persistence_check.passed
  ) ? 'PASS' : 'FAIL';

  return {
    generated_at: new Date().toISOString(),
    pipeline_version: pipelineVersion,
    fixture_path: fixturePath,
    total_cases,
    passed_cases,
    gate_result,
    metrics,
    case_comparisons: comparisons,
    thresholds,
  };
}
