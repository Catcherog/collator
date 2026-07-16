// metrics.ts
// Phase 2F: Gate C-Core 指标计算
//
// 指标定义：
// 1. field_accuracy         = (匹配的 evaluated_fields 数) / (evaluated_fields 总数)
// 2. required_field_recall  = (有值的 required_fields 数) / (未拦截 fixture 的 required_fields 总数)
// 3. enum_precision         = (匹配的 enum_fields 数) / (enum_fields 总数)
// 4. error_interception_rate = (实际被拦截的 fixture 数) / (期望被拦截的 fixture 数)
// 5. persistence_check      = NOT_APPLICABLE（本阶段不涉及持久化）
//
// 不调用任何外部网络。

import type {
  CaseComparison,
  EvaluationFixture,
  GateThresholds,
  MetricValue,
  MetricsResult,
} from './types.js';
import { DEFAULT_GATE_THRESHOLDS } from './types.js';

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function computeRate(numerator: number, denominator: number): number | 'NOT_APPLICABLE' {
  if (denominator === 0) return 'NOT_APPLICABLE';
  return numerator / denominator;
}

function buildMetric(
  name: string,
  numerator: number,
  denominator: number,
  threshold: number
): MetricValue {
  const rate = computeRate(numerator, denominator);
  return {
    name,
    numerator,
    denominator,
    rate,
    threshold,
    // NOT_APPLICABLE 视为通过（不参与门槛判定）
    passed: rate === 'NOT_APPLICABLE' ? true : rate >= threshold,
  };
}

// ---------------------------------------------------------------------------
// 指标计算
// ---------------------------------------------------------------------------

/**
 * 计算 Gate C-Core 全量指标。
 *
 * @param comparisons 所有 fixture 的比较结果
 * @param fixtures 原始 fixture 列表（与 comparisons 顺序一致）
 * @param thresholds 门槛（默认 DEFAULT_GATE_THRESHOLDS）
 */
export function computeMetrics(
  comparisons: CaseComparison[],
  fixtures: EvaluationFixture[],
  thresholds: GateThresholds = DEFAULT_GATE_THRESHOLDS
): MetricsResult {
  if (comparisons.length !== fixtures.length) {
    throw new Error(
      `computeMetrics: comparisons 与 fixtures 长度不一致 (${comparisons.length} vs ${fixtures.length})`
    );
  }

  // 1. field_accuracy
  let fieldTotal = 0;
  let fieldMatched = 0;
  for (const c of comparisons) {
    for (const fm of c.field_matches) {
      fieldTotal++;
      if (fm.match) fieldMatched++;
    }
  }
  const field_accuracy = buildMetric(
    'field_accuracy',
    fieldMatched,
    fieldTotal,
    thresholds.field_accuracy
  );

  // 2. required_field_recall: 仅统计 expect_intercepted=false 且 expected 中该字段有值的 fixture
  //    （故意缺必填字段的校验失败 case 不计入分母，因为它们期望字段缺失）
  let reqTotal = 0;
  let reqFilled = 0;
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    const c = comparisons[i];
    if (f.scoring.expect_intercepted) continue;
    for (const field of f.scoring.required_fields) {
      const expectedValue = f.expected.normalized_fields[field];
      if (isEmptyValue(expectedValue)) continue; // 期望缺失的字段不计入分母
      reqTotal++;
      const actualValue = c.actual.standardizedRecord[field];
      if (!isEmptyValue(actualValue)) reqFilled++;
    }
  }
  const required_field_recall = buildMetric(
    'required_field_recall',
    reqFilled,
    reqTotal,
    thresholds.required_field_recall
  );

  // 3. enum_precision: 所有 enum_fields（拦截 case 的 enum_fields 通常为空）
  let enumTotal = 0;
  let enumMatched = 0;
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    const c = comparisons[i];
    for (const field of f.scoring.enum_fields) {
      enumTotal++;
      const fm = c.field_matches.find(m => m.field === field);
      if (fm && fm.match) enumMatched++;
    }
  }
  const enum_precision = buildMetric(
    'enum_precision',
    enumMatched,
    enumTotal,
    thresholds.enum_precision
  );

  // 4. error_interception_rate
  let interceptTotal = 0;
  let interceptMatched = 0;
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    const c = comparisons[i];
    if (f.scoring.expect_intercepted) {
      interceptTotal++;
      if (c.actual.success === false) interceptMatched++;
    }
  }
  const error_interception_rate = buildMetric(
    'error_interception_rate',
    interceptMatched,
    interceptTotal,
    thresholds.error_interception_rate
  );

  // 5. persistence_check: 本阶段不涉及持久化
  const persistence_check: MetricValue = {
    name: 'persistence_check',
    numerator: 0,
    denominator: 0,
    rate: 'NOT_APPLICABLE',
    threshold: 0,
    passed: true,
  };

  const total_cases = comparisons.length;
  const passed_cases = comparisons.filter(c => c.passed).length;

  return {
    total_cases,
    passed_cases,
    field_accuracy,
    required_field_recall,
    enum_precision,
    error_interception_rate,
    persistence_check,
  };
}

// ---------------------------------------------------------------------------
// Gate 判定
// ---------------------------------------------------------------------------

/**
 * 判定 Gate 是否通过。
 * 通过条件：所有非 NOT_APPLICABLE 指标都达到门槛。
 */
export function isGatePassed(metrics: MetricsResult): boolean {
  const checks: Array<MetricValue> = [
    metrics.field_accuracy,
    metrics.required_field_recall,
    metrics.enum_precision,
    metrics.error_interception_rate,
    metrics.persistence_check,
  ];
  return checks.every(m => m.passed);
}
