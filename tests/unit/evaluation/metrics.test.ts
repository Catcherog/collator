import { describe, it, expect } from 'vitest';
import { computeMetrics, isGatePassed } from '../../../src/evaluation/metrics.js';
import type { CaseComparison, EvaluationFixture } from '../../../src/evaluation/types.js';
import { DEFAULT_GATE_THRESHOLDS } from '../../../src/evaluation/types.js';

function makeComparison(overrides: Partial<CaseComparison> = {}): CaseComparison {
  return {
    case_id: 'TEST-001',
    passed: true,
    field_matches: [{ field: '客户姓名', expected: '张三', actual: '张三', match: true }],
    pipeline_error_match: true,
    validation_error_match: true,
    validation_warning_match: true,
    success_match: true,
    interception_match: true,
    actual: {
      success: true,
      standardizedRecord: { 客户姓名: '张三' },
      pipeline_error_codes: [],
      validation_error_codes: [],
      validation_warning_codes: [],
      pipeline_version: '2c.1.0',
    },
    expected: {
      normalized_fields: { 客户姓名: '张三' },
      pipeline_errors: [],
      validation_errors: [],
      validation_warnings: [],
      success: true,
    },
    discrepancies: [],
    ...overrides,
  };
}

function makeFixture(overrides: Partial<EvaluationFixture> = {}): EvaluationFixture {
  return {
    case_id: 'TEST-001',
    source: 'synthetic',
    scenario_tags: [],
    candidate: { schemaKey: 'customer', recordType: 'customer_consultation', data: {} },
    expected: {
      normalized_fields: { 客户姓名: '张三' },
      pipeline_errors: [],
      validation_errors: [],
      validation_warnings: [],
      success: true,
    },
    scoring: {
      evaluated_fields: ['客户姓名'],
      required_fields: ['客户姓名'],
      enum_fields: [],
      expect_intercepted: false,
    },
    ...overrides,
  };
}

describe('metrics - field_accuracy', () => {
  it('全部字段匹配时 rate=1.0', () => {
    const comparisons = [makeComparison()];
    const fixtures = [makeFixture()];
    const m = computeMetrics(comparisons, fixtures);
    expect(m.field_accuracy.rate).toBe(1.0);
    expect(m.field_accuracy.passed).toBe(true);
  });

  it('部分字段不匹配时 rate 正确计算', () => {
    const comparisons = [
      makeComparison({
        field_matches: [
          { field: 'A', expected: 'x', actual: 'x', match: true },
          { field: 'B', expected: 'y', actual: 'z', match: false },
        ],
      }),
    ];
    const fixtures = [makeFixture({ scoring: { evaluated_fields: ['A', 'B'], required_fields: [], enum_fields: [], expect_intercepted: false } })];
    const m = computeMetrics(comparisons, fixtures);
    expect(m.field_accuracy.numerator).toBe(1);
    expect(m.field_accuracy.denominator).toBe(2);
    expect(m.field_accuracy.rate).toBe(0.5);
    expect(m.field_accuracy.passed).toBe(false);
  });

  it('零分母时 rate=NOT_APPLICABLE', () => {
    const comparisons = [makeComparison({ field_matches: [] })];
    const fixtures = [makeFixture({ scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: false } })];
    const m = computeMetrics(comparisons, fixtures);
    expect(m.field_accuracy.rate).toBe('NOT_APPLICABLE');
    expect(m.field_accuracy.passed).toBe(true);
  });
});

describe('metrics - 门槛边界', () => {
  it('rate 恰好等于门槛时 PASS', () => {
    // 构造 9/10 = 0.9，门槛 0.9
    const comparisons: CaseComparison[] = [];
    for (let i = 0; i < 10; i++) {
      comparisons.push(
        makeComparison({
          case_id: `T-${i}`,
          field_matches: [{ field: 'f', expected: 'x', actual: 'x', match: i < 9 }],
        })
      );
    }
    const fixtures: EvaluationFixture[] = comparisons.map((_c, i) =>
      makeFixture({
        case_id: `T-${i}`,
        scoring: { evaluated_fields: ['f'], required_fields: [], enum_fields: [], expect_intercepted: false },
      })
    );
    const thresholds = { ...DEFAULT_GATE_THRESHOLDS, field_accuracy: 0.9 };
    const m = computeMetrics(comparisons, fixtures, thresholds);
    expect(m.field_accuracy.rate).toBe(0.9);
    expect(m.field_accuracy.passed).toBe(true);
  });

  it('rate 低于门槛时 FAIL', () => {
    const comparisons: CaseComparison[] = [];
    for (let i = 0; i < 10; i++) {
      comparisons.push(
        makeComparison({
          case_id: `T-${i}`,
          field_matches: [{ field: 'f', expected: 'x', actual: 'x', match: i < 8 }],
        })
      );
    }
    const fixtures: EvaluationFixture[] = comparisons.map((_c, i) =>
      makeFixture({
        case_id: `T-${i}`,
        scoring: { evaluated_fields: ['f'], required_fields: [], enum_fields: [], expect_intercepted: false },
      })
    );
    const thresholds = { ...DEFAULT_GATE_THRESHOLDS, field_accuracy: 0.9 };
    const m = computeMetrics(comparisons, fixtures, thresholds);
    expect(m.field_accuracy.rate).toBe(0.8);
    expect(m.field_accuracy.passed).toBe(false);
  });
});

describe('metrics - required_field_recall', () => {
  it('期望有值的必填字段全部填充时 rate=1.0', () => {
    const comparisons = [
      makeComparison({
        actual: {
          success: true,
          standardizedRecord: { 客户姓名: '张三', 联系方式: '13800138000' },
          pipeline_error_codes: [],
          validation_error_codes: [],
          validation_warning_codes: [],
          pipeline_version: '2c.1.0',
        },
      }),
    ];
    const fixtures = [
      makeFixture({
        expected: { normalized_fields: { 客户姓名: '张三', 联系方式: '13800138000' }, pipeline_errors: [], validation_errors: [], validation_warnings: [], success: true },
        scoring: { evaluated_fields: [], required_fields: ['客户姓名', '联系方式'], enum_fields: [], expect_intercepted: false },
      }),
    ];
    const m = computeMetrics(comparisons, fixtures);
    expect(m.required_field_recall.numerator).toBe(2);
    expect(m.required_field_recall.denominator).toBe(2);
    expect(m.required_field_recall.rate).toBe(1.0);
  });

  it('故意缺必填字段的 case 不计入分母', () => {
    // expected.normalized_fields 中客户姓名无值（故意缺失）
    const comparisons = [
      makeComparison({
        actual: {
          success: true,
          standardizedRecord: { 联系方式: '13800138000' },
          pipeline_error_codes: [],
          validation_error_codes: [{ field: '客户姓名', code: 'REQUIRED_MISSING' }],
          validation_warning_codes: [],
          pipeline_version: '2c.1.0',
        },
      }),
    ];
    const fixtures = [
      makeFixture({
        expected: { normalized_fields: { 联系方式: '13800138000' }, pipeline_errors: [], validation_errors: [{ field: '客户姓名', code: 'REQUIRED_MISSING' }], validation_warnings: [], success: true },
        scoring: { evaluated_fields: ['联系方式'], required_fields: ['客户姓名', '联系方式'], enum_fields: [], expect_intercepted: false },
      }),
    ];
    const m = computeMetrics(comparisons, fixtures);
    // 客户姓名：expected 无值 → 不计入分母
    // 联系方式：expected 有值，actual 有值 → numerator=1, denominator=1
    expect(m.required_field_recall.numerator).toBe(1);
    expect(m.required_field_recall.denominator).toBe(1);
    expect(m.required_field_recall.rate).toBe(1.0);
  });

  it('expect_intercepted=true 的 fixture 不计入分母', () => {
    const comparisons = [
      makeComparison({
        actual: {
          success: false,
          standardizedRecord: {},
          pipeline_error_codes: [{ stage: 'format_clean', code: 'UNSUPPORTED_RECORD_TYPE' }],
          validation_error_codes: [],
          validation_warning_codes: [],
          pipeline_version: '2c.1.0',
        },
      }),
    ];
    const fixtures = [
      makeFixture({
        expected: { normalized_fields: {}, pipeline_errors: [{ stage: 'format_clean', code: 'UNSUPPORTED_RECORD_TYPE' }], validation_errors: [], validation_warnings: [], success: false },
        scoring: { evaluated_fields: [], required_fields: ['客户姓名', '联系方式'], enum_fields: [], expect_intercepted: true },
      }),
    ];
    const m = computeMetrics(comparisons, fixtures);
    expect(m.required_field_recall.denominator).toBe(0);
    expect(m.required_field_recall.rate).toBe('NOT_APPLICABLE');
  });
});

describe('metrics - error_interception_rate', () => {
  it('期望拦截且实际拦截时 rate=1.0', () => {
    const comparisons = [
      makeComparison({
        actual: { ...makeComparison().actual, success: false },
      }),
    ];
    const fixtures = [
      makeFixture({
        scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: true },
      }),
    ];
    const m = computeMetrics(comparisons, fixtures);
    expect(m.error_interception_rate.numerator).toBe(1);
    expect(m.error_interception_rate.rate).toBe(1.0);
  });

  it('期望拦截但实际未拦截时 rate=0', () => {
    const comparisons = [makeComparison()]; // actual.success=true
    const fixtures = [
      makeFixture({
        scoring: { evaluated_fields: [], required_fields: [], enum_fields: [], expect_intercepted: true },
      }),
    ];
    const m = computeMetrics(comparisons, fixtures);
    expect(m.error_interception_rate.numerator).toBe(0);
    expect(m.error_interception_rate.rate).toBe(0);
  });
});

describe('metrics - persistence_check', () => {
  it('始终为 NOT_APPLICABLE', () => {
    const m = computeMetrics([makeComparison()], [makeFixture()]);
    expect(m.persistence_check.rate).toBe('NOT_APPLICABLE');
    expect(m.persistence_check.passed).toBe(true);
  });
});

describe('isGatePassed', () => {
  it('所有指标 PASS 时 Gate PASS', () => {
    const comparisons = [makeComparison()];
    const fixtures = [makeFixture()];
    const m = computeMetrics(comparisons, fixtures);
    expect(isGatePassed(m)).toBe(true);
  });

  it('任一指标 FAIL 时 Gate FAIL', () => {
    const comparisons: CaseComparison[] = [];
    for (let i = 0; i < 10; i++) {
      comparisons.push(
        makeComparison({
          case_id: `T-${i}`,
          field_matches: [{ field: 'f', expected: 'x', actual: 'x', match: i < 5 }], // 50% < 90%
        })
      );
    }
    const fixtures: EvaluationFixture[] = comparisons.map((_c, i) =>
      makeFixture({
        case_id: `T-${i}`,
        scoring: { evaluated_fields: ['f'], required_fields: [], enum_fields: [], expect_intercepted: false },
      })
    );
    const m = computeMetrics(comparisons, fixtures);
    expect(isGatePassed(m)).toBe(false);
  });
});
