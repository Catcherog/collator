import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeReport, buildReport } from '../../../src/evaluation/reporter.js';
import type { CaseComparison, MetricsResult } from '../../../src/evaluation/types.js';
import { DEFAULT_GATE_THRESHOLDS } from '../../../src/evaluation/types.js';

function makeMetrics(overrides: Partial<MetricsResult> = {}): MetricsResult {
  const base = {
    total_cases: 1,
    passed_cases: 1,
    field_accuracy: { name: 'field_accuracy', numerator: 1, denominator: 1, rate: 1.0 as const, threshold: 0.9, passed: true },
    required_field_recall: { name: 'required_field_recall', numerator: 1, denominator: 1, rate: 1.0 as const, threshold: 0.95, passed: true },
    enum_precision: { name: 'enum_precision', numerator: 0, denominator: 0, rate: 'NOT_APPLICABLE' as const, threshold: 0.95, passed: true },
    error_interception_rate: { name: 'error_interception_rate', numerator: 0, denominator: 0, rate: 'NOT_APPLICABLE' as const, threshold: 0.95, passed: true },
    persistence_check: { name: 'persistence_check', numerator: 0, denominator: 0, rate: 'NOT_APPLICABLE' as const, threshold: 0, passed: true },
  };
  return { ...base, ...overrides };
}

function makeComparison(overrides: Partial<CaseComparison> = {}): CaseComparison {
  return {
    case_id: 'TEST-001',
    passed: true,
    field_matches: [],
    pipeline_error_match: true,
    validation_error_match: true,
    validation_warning_match: true,
    success_match: true,
    interception_match: true,
    actual: {
      success: true,
      standardizedRecord: {},
      pipeline_error_codes: [],
      validation_error_codes: [],
      validation_warning_codes: [],
      pipeline_version: '2c.1.0',
    },
    expected: {
      normalized_fields: {},
      pipeline_errors: [],
      validation_errors: [],
      validation_warnings: [],
      success: true,
    },
    discrepancies: [],
    ...overrides,
  };
}

describe('reporter - buildReport', () => {
  it('所有指标 PASS 时 gate_result=PASS', () => {
    const report = buildReport([makeComparison()], makeMetrics(), '/path/to/fixture.jsonl', '2c.1.0', DEFAULT_GATE_THRESHOLDS);
    expect(report.gate_result).toBe('PASS');
    expect(report.total_cases).toBe(1);
    expect(report.passed_cases).toBe(1);
  });

  it('任一指标 FAIL 时 gate_result=FAIL', () => {
    const metrics = makeMetrics({
      field_accuracy: { name: 'field_accuracy', numerator: 5, denominator: 10, rate: 0.5, threshold: 0.9, passed: false },
    });
    const report = buildReport([makeComparison()], metrics, '/path', '2c.1.0', DEFAULT_GATE_THRESHOLDS);
    expect(report.gate_result).toBe('FAIL');
  });
});

describe('reporter - writeReport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-report-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入 JSON 和 Markdown 文件', () => {
    const report = buildReport([makeComparison()], makeMetrics(), '/path', '2c.1.0', DEFAULT_GATE_THRESHOLDS);
    const paths = writeReport(report, tmpDir);
    expect(fs.existsSync(paths.jsonPath)).toBe(true);
    expect(fs.existsSync(paths.markdownPath)).toBe(true);
    expect(fs.existsSync(paths.latestJsonPath)).toBe(true);
    expect(fs.existsSync(paths.latestMarkdownPath)).toBe(true);
  });

  it('JSON 文件可解析', () => {
    const report = buildReport([makeComparison()], makeMetrics(), '/path', '2c.1.0', DEFAULT_GATE_THRESHOLDS);
    const paths = writeReport(report, tmpDir);
    const content = fs.readFileSync(paths.jsonPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.gate_result).toBe(report.gate_result);
    expect(parsed.total_cases).toBe(report.total_cases);
  });

  it('Markdown 包含指标表格', () => {
    const report = buildReport([makeComparison()], makeMetrics(), '/path', '2c.1.0', DEFAULT_GATE_THRESHOLDS);
    const paths = writeReport(report, tmpDir);
    const content = fs.readFileSync(paths.markdownPath, 'utf-8');
    expect(content).toContain('field_accuracy');
    expect(content).toContain('required_field_recall');
    expect(content).toContain('## 指标');
  });

  it('失败 case 出现在 Markdown 中', () => {
    const failedComparison = makeComparison({
      case_id: 'FAIL-001',
      passed: false,
      discrepancies: ['字段 X 不匹配'],
    });
    const report = buildReport([failedComparison], makeMetrics(), '/path', '2c.1.0', DEFAULT_GATE_THRESHOLDS);
    const paths = writeReport(report, tmpDir);
    const content = fs.readFileSync(paths.markdownPath, 'utf-8');
    expect(content).toContain('FAIL-001');
    expect(content).toContain('字段 X 不匹配');
  });

  it('latest 文件与 timestamped 文件内容一致', () => {
    const report = buildReport([makeComparison()], makeMetrics(), '/path', '2c.1.0', DEFAULT_GATE_THRESHOLDS);
    const paths = writeReport(report, tmpDir);
    const tsContent = fs.readFileSync(paths.jsonPath, 'utf-8');
    const latestContent = fs.readFileSync(paths.latestJsonPath, 'utf-8');
    expect(tsContent).toBe(latestContent);
  });

  it('Markdown 不输出原始字符串值（脱敏）', () => {
    const failedComparison = makeComparison({
      case_id: 'LEAK-001',
      passed: false,
      field_matches: [{ field: '客户姓名', expected: '张三', actual: '李四', match: false }],
      discrepancies: ['字段 客户姓名: 期望 <string len=2> 实际 <string len=2>'],
    });
    const report = buildReport([failedComparison], makeMetrics(), '/path', '2c.1.0', DEFAULT_GATE_THRESHOLDS);
    const paths = writeReport(report, tmpDir);
    const content = fs.readFileSync(paths.markdownPath, 'utf-8');
    expect(content).not.toContain('张三');
    expect(content).not.toContain('李四');
  });
});
