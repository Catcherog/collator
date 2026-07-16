// comparator.ts
// Phase 2F: 单条 fixture 比较器
//
// 职责：
// 1. 对单条 fixture 执行 PipelineResult 与 expected 的比较。
// 2. 错误比较使用稳定的 (stage, code) 或 (field, code) 元组，不比较文案。
// 3. 错误集合采用「完全集合相等」语义（确定性管道要求相同输入产生相同输出）。
// 4. 不输出原始 PII（手机号、客户姓名原文等），discrepancies 仅描述结构差异。
//
// 不调用任何外部网络。

import type { PipelineResult } from '../server/cleaning/pipeline/cleaning-pipeline.js';
import type {
  CaseComparison,
  EvaluationFixture,
  ExpectedPipelineError,
  ExpectedValidationIssue,
  FieldMatch,
  ActualResultSummary,
} from './types.js';

// ---------------------------------------------------------------------------
// 深度相等
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    // 顺序敏感（多选字段在 fixture 中预先排序；Pipeline 不打乱顺序）
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 错误集合比较
// ---------------------------------------------------------------------------

interface ErrorSetDiff<T> {
  match: boolean;
  missing: T[]; // expected 中存在但 actual 中不存在
  extra: T[];   // actual 中存在但 expected 中不存在
}

function comparePipelineErrorSets(
  actual: Array<{ stage: string; code: string }>,
  expected: ExpectedPipelineError[]
): ErrorSetDiff<ExpectedPipelineError> {
  const actualKeySet = new Set(actual.map(e => `${e.stage}::${e.code}`));
  const expectedKeySet = new Set(expected.map(e => `${e.stage}::${e.code}`));

  const missing = expected.filter(e => !actualKeySet.has(`${e.stage}::${e.code}`));
  const extra = actual
    .filter(a => !expectedKeySet.has(`${a.stage}::${a.code}`))
    .map(a => ({ stage: a.stage, code: a.code }));

  return {
    match: missing.length === 0 && extra.length === 0,
    missing,
    extra,
  };
}

function compareValidationIssueSets(
  actual: Array<{ field: string; code: string }>,
  expected: ExpectedValidationIssue[]
): ErrorSetDiff<ExpectedValidationIssue> {
  const actualKeySet = new Set(actual.map(e => `${e.field}::${e.code}`));
  const expectedKeySet = new Set(expected.map(e => `${e.field}::${e.code}`));

  const missing = expected.filter(e => !actualKeySet.has(`${e.field}::${e.code}`));
  const extra = actual
    .filter(a => !expectedKeySet.has(`${a.field}::${a.code}`))
    .map(a => ({ field: a.field, code: a.code }));

  return {
    match: missing.length === 0 && extra.length === 0,
    missing,
    extra,
  };
}

// ---------------------------------------------------------------------------
// 结果摘要提取（脱敏）
// ---------------------------------------------------------------------------

function buildActualSummary(result: PipelineResult): ActualResultSummary {
  const validationErrors = result.validation?.errors ?? [];
  const validationWarnings = result.validation?.warnings ?? [];

  return {
    success: result.success,
    standardizedRecord: result.standardizedRecord,
    pipeline_error_codes: result.errors.map(e => ({ stage: e.stage, code: e.code })),
    validation_error_codes: validationErrors.map(e => ({ field: e.field, code: e.code })),
    validation_warning_codes: validationWarnings.map(e => ({ field: e.field, code: e.code })),
    pipeline_version: result.pipelineVersion,
  };
}

// ---------------------------------------------------------------------------
// 单条比较
// ---------------------------------------------------------------------------

/**
 * 比较单条 fixture 的 PipelineResult 与 expected。
 *
 * @param fixture 评测 fixture
 * @param actual Pipeline 实际执行结果
 * @returns CaseComparison 含逐项匹配与差异描述
 */
export function compareFixture(
  fixture: EvaluationFixture,
  actual: PipelineResult
): CaseComparison {
  const { expected, scoring } = fixture;
  const discrepancies: string[] = [];

  // 1. 字段比较：仅比较 scoring.evaluated_fields 中列出的字段
  const fieldMatches: FieldMatch[] = scoring.evaluated_fields.map(field => {
    const expectedValue = expected.normalized_fields[field];
    const actualValue = resultField(actual, field);
    const match = deepEqual(actualValue, expectedValue);
    if (!match) {
      discrepancies.push(
        `字段 ${field}: 期望 ${formatValue(expectedValue)} 实际 ${formatValue(actualValue)}`
      );
    }
    return { field, expected: expectedValue, actual: actualValue, match };
  });

  // 2. pipeline_errors 集合比较
  const pipelineDiff = comparePipelineErrorSets(
    actual.errors.map(e => ({ stage: e.stage, code: e.code })),
    expected.pipeline_errors
  );
  if (!pipelineDiff.match) {
    if (pipelineDiff.missing.length > 0) {
      discrepancies.push(
        `pipeline_errors 缺失: ${pipelineDiff.missing.map(e => `${e.stage}/${e.code}`).join(', ')}`
      );
    }
    if (pipelineDiff.extra.length > 0) {
      discrepancies.push(
        `pipeline_errors 多出: ${pipelineDiff.extra.map(e => `${e.stage}/${e.code}`).join(', ')}`
      );
    }
  }

  // 3. validation_errors 集合比较
  const actualValErrors = (actual.validation?.errors ?? []).map(e => ({
    field: e.field,
    code: e.code,
  }));
  const valErrorDiff = compareValidationIssueSets(actualValErrors, expected.validation_errors);
  if (!valErrorDiff.match) {
    if (valErrorDiff.missing.length > 0) {
      discrepancies.push(
        `validation_errors 缺失: ${valErrorDiff.missing.map(e => `${e.field}/${e.code}`).join(', ')}`
      );
    }
    if (valErrorDiff.extra.length > 0) {
      discrepancies.push(
        `validation_errors 多出: ${valErrorDiff.extra.map(e => `${e.field}/${e.code}`).join(', ')}`
      );
    }
  }

  // 4. validation_warnings 集合比较
  const actualValWarnings = (actual.validation?.warnings ?? []).map(e => ({
    field: e.field,
    code: e.code,
  }));
  const valWarningDiff = compareValidationIssueSets(actualValWarnings, expected.validation_warnings);
  if (!valWarningDiff.match) {
    if (valWarningDiff.missing.length > 0) {
      discrepancies.push(
        `validation_warnings 缺失: ${valWarningDiff.missing.map(e => `${e.field}/${e.code}`).join(', ')}`
      );
    }
    if (valWarningDiff.extra.length > 0) {
      discrepancies.push(
        `validation_warnings 多出: ${valWarningDiff.extra.map(e => `${e.field}/${e.code}`).join(', ')}`
      );
    }
  }

  // 5. success 比较
  const successMatch = actual.success === expected.success;
  if (!successMatch) {
    discrepancies.push(`success: 期望 ${expected.success} 实际 ${actual.success}`);
  }

  // 6. interception 比较：actual.success === false 视为被拦截
  const actualIntercepted = actual.success === false;
  const interceptionMatch = actualIntercepted === scoring.expect_intercepted;
  if (!interceptionMatch) {
    discrepancies.push(
      `interception: 期望 ${scoring.expect_intercepted ? '拦截' : '通过'} 实际 ${actualIntercepted ? '拦截' : '通过'}`
    );
  }

  const allFieldsMatch = fieldMatches.every(f => f.match);
  const passed =
    allFieldsMatch &&
    pipelineDiff.match &&
    valErrorDiff.match &&
    valWarningDiff.match &&
    successMatch &&
    interceptionMatch;

  return {
    case_id: fixture.case_id,
    passed,
    field_matches: fieldMatches,
    pipeline_error_match: pipelineDiff.match,
    validation_error_match: valErrorDiff.match,
    validation_warning_match: valWarningDiff.match,
    success_match: successMatch,
    interception_match: interceptionMatch,
    actual: buildActualSummary(actual),
    expected,
    discrepancies,
  };
}

/**
 * 从 PipelineResult.standardizedRecord 中安全取值。
 * standardizedRecord 是 Record<string, unknown>，直接索引即可。
 */
function resultField(result: PipelineResult, field: string): unknown {
  return result.standardizedRecord[field];
}

/**
 * 格式化值用于 discrepancy 描述。
 * 不输出原始 PII；数组/对象用 JSON 摘要，原始类型直接 toString。
 */
function formatValue(value: unknown): string {
  if (value === undefined) return '<undefined>';
  if (value === null) return '<null>';
  if (typeof value === 'string') return `<string len=${value.length}>`;
  if (typeof value === 'number') return `<number ${value}>`;
  if (typeof value === 'boolean') return `<boolean ${value}>`;
  if (Array.isArray(value)) return `<array len=${value.length}>`;
  return `<object keys=${Object.keys(value as Record<string, unknown>).length}>`;
}
