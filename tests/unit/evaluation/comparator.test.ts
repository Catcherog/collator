import { describe, it, expect } from 'vitest';
import { compareFixture } from '../../../src/evaluation/comparator.js';
import type { EvaluationFixture } from '../../../src/evaluation/types.js';
import type { PipelineResult } from '../../../src/server/cleaning/pipeline/cleaning-pipeline.js';

function makeFixture(overrides: Partial<EvaluationFixture> = {}): EvaluationFixture {
  return {
    case_id: 'TEST-001',
    source: 'synthetic',
    scenario_tags: [],
    candidate: {
      schemaKey: 'customer',
      recordType: 'customer_consultation',
      data: { 客户姓名: '张三', 联系方式: '13800138000' },
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
    ...overrides,
  };
}

function makeResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    standardizedRecord: { 客户姓名: '张三', 联系方式: '13800138000' },
    validation: { status: 'passed', errors: [], warnings: [], score: 100, sanitizedData: {} },
    errors: [],
    warnings: [],
    corrections: [],
    qualityReport: null,
    stages: [],
    pipelineVersion: '2c.1.0',
    success: true,
    ...overrides,
  };
}

describe('comparator - 字段比较', () => {
  it('所有字段匹配时 passed=true', () => {
    const fixture = makeFixture();
    const result = makeResult();
    const c = compareFixture(fixture, result);
    expect(c.passed).toBe(true);
    expect(c.field_matches.every(f => f.match)).toBe(true);
  });

  it('字段值不匹配时 passed=false', () => {
    const fixture = makeFixture();
    const result = makeResult({
      standardizedRecord: { 客户姓名: '李四', 联系方式: '13800138000' },
    });
    const c = compareFixture(fixture, result);
    expect(c.passed).toBe(false);
    const mismatched = c.field_matches.find(f => f.field === '客户姓名');
    expect(mismatched?.match).toBe(false);
  });

  it('数组字段顺序敏感', () => {
    const fixture = makeFixture({
      candidate: { schemaKey: 'customer', recordType: 'customer_consultation', data: { 意向风格: ['A', 'B'] } },
      expected: {
        normalized_fields: { 意向风格: ['A', 'B'] },
        pipeline_errors: [],
        validation_errors: [],
        validation_warnings: [],
        success: true,
      },
      scoring: {
        evaluated_fields: ['意向风格'],
        required_fields: [],
        enum_fields: ['意向风格'],
        expect_intercepted: false,
      },
    });
    const result = makeResult({ standardizedRecord: { 意向风格: ['B', 'A'] } });
    const c = compareFixture(fixture, result);
    expect(c.passed).toBe(false);
  });
});

describe('comparator - 错误集合比较', () => {
  it('pipeline_errors 顺序无关匹配', () => {
    const fixture = makeFixture({
      expected: {
        normalized_fields: {},
        pipeline_errors: [
          { stage: 'format_clean', code: 'ERR_A' },
          { stage: 'validate', code: 'ERR_B' },
        ],
        validation_errors: [],
        validation_warnings: [],
        success: false,
      },
      scoring: {
        evaluated_fields: [],
        required_fields: [],
        enum_fields: [],
        expect_intercepted: true,
      },
    });
    const result = makeResult({
      errors: [
        { stage: 'validate', code: 'ERR_B', message: 'm' },
        { stage: 'format_clean', code: 'ERR_A', message: 'm' },
      ],
      success: false,
      standardizedRecord: {},
    });
    const c = compareFixture(fixture, result);
    expect(c.pipeline_error_match).toBe(true);
  });

  it('validation_errors 缺失时 match=false', () => {
    const fixture = makeFixture({
      expected: {
        normalized_fields: {},
        pipeline_errors: [],
        validation_errors: [{ field: '联系方式', code: 'FORMAT_ERROR' }],
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
    const result = makeResult({
      validation: { status: 'passed', errors: [], warnings: [], score: 100, sanitizedData: {} },
      success: true,
      standardizedRecord: {},
    });
    const c = compareFixture(fixture, result);
    expect(c.validation_error_match).toBe(false);
    expect(c.passed).toBe(false);
  });

  it('validation_errors 多出时 match=false', () => {
    const fixture = makeFixture({
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
    const result = makeResult({
      validation: {
        status: 'failed',
        errors: [{ field: '联系方式', code: 'FORMAT_ERROR', message: 'm', severity: 'error' as const }],
        warnings: [],
        score: 50,
        sanitizedData: {},
      },
      success: true,
      standardizedRecord: {},
    });
    const c = compareFixture(fixture, result);
    expect(c.validation_error_match).toBe(false);
  });
});

describe('comparator - success 与 interception', () => {
  it('success 不匹配时 passed=false', () => {
    const fixture = makeFixture({ expected: { ...makeFixture().expected, success: true } });
    const result = makeResult({ success: false, errors: [{ stage: 'format_clean', code: 'X', message: 'm' }] });
    const c = compareFixture(fixture, result);
    expect(c.success_match).toBe(false);
    expect(c.passed).toBe(false);
  });

  it('interception 不匹配时 passed=false', () => {
    const fixture = makeFixture({
      scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: true },
      expected: { normalized_fields: {}, pipeline_errors: [{ stage: 'format_clean', code: 'X' }], validation_errors: [], validation_warnings: [], success: false },
    });
    const result = makeResult({ success: true, errors: [], standardizedRecord: {} });
    const c = compareFixture(fixture, result);
    expect(c.interception_match).toBe(false);
  });

  it('interception 匹配（期望拦截且实际拦截）', () => {
    const fixture = makeFixture({
      scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: true },
      expected: { normalized_fields: {}, pipeline_errors: [{ stage: 'format_clean', code: 'UNSUPPORTED_RECORD_TYPE' }], validation_errors: [], validation_warnings: [], success: false },
    });
    const result = makeResult({
      success: false,
      errors: [{ stage: 'format_clean', code: 'UNSUPPORTED_RECORD_TYPE', message: 'm' }],
      standardizedRecord: {},
    });
    const c = compareFixture(fixture, result);
    expect(c.interception_match).toBe(true);
  });
});

describe('comparator - 脱敏', () => {
  it('discrepancies 不输出原始字符串内容', () => {
    const fixture = makeFixture();
    const result = makeResult({ standardizedRecord: { 客户姓名: '李四', 联系方式: '13800138000' } });
    const c = compareFixture(fixture, result);
    const discrepancyText = c.discrepancies.join(' ');
    expect(discrepancyText).not.toContain('李四');
    expect(discrepancyText).toContain('<string');
  });
});
