import { describe, it, expect, beforeEach, vi } from 'vitest';

// 使用顶层 vi.mock，通过可控制的 mock 函数覆盖各阶段错误路径
const mockAdaptFormatClean = vi.fn();
const mockAdaptEnumMapClean = vi.fn();
const mockAdaptValidateRecord = vi.fn();
const mockCalculateQualityScore = vi.fn();

vi.mock('../../../../src/server/cleaning/adapters/cleaner-adapter.js', () => ({
  adaptFormatClean: (...args: unknown[]) => mockAdaptFormatClean(...args),
  adaptEnumMapClean: (...args: unknown[]) => mockAdaptEnumMapClean(...args),
}));

vi.mock('../../../../src/server/cleaning/adapters/rules-adapter.js', () => ({
  adaptValidateRecord: (...args: unknown[]) => mockAdaptValidateRecord(...args),
}));

vi.mock('../../../../src/server/cleaning/adapters/quality-adapter.js', () => ({
  calculateQualityScore: (...args: unknown[]) => mockCalculateQualityScore(...args),
}));

import { runCleaningPipeline } from '../../../../src/server/cleaning/pipeline/cleaning-pipeline.js';
import type { PipelineCandidate } from '../../../../src/server/cleaning/pipeline/cleaning-pipeline.js';

const validCandidate: PipelineCandidate = {
  schemaKey: 'customer',
  recordType: 'customer_consultation',
  data: { 客户姓名: '张三', 联系方式: '13800138000' },
  dateContext: { referenceDate: '2026-06-01' },
};

// 模拟成功返回值
const mockCleanResult = (data: Record<string, unknown>) => ({
  data: { ...data },
  corrections: [],
  warnings: [],
});

const mockValidationResult = {
  status: 'passed' as const,
  score: 95,
  errors: [],
  warnings: [],
  missingFields: [],
};

const mockQualityReport = {
  score: 95,
  level: 'high' as const,
  issues: [],
  summary: 'OK',
};

describe('CleaningPipeline - 阶段错误路径', () => {
  beforeEach(() => {
    mockAdaptFormatClean.mockReset();
    mockAdaptEnumMapClean.mockReset();
    mockAdaptValidateRecord.mockReset();
    mockCalculateQualityScore.mockReset();

    // 默认成功行为
    mockAdaptFormatClean.mockReturnValue(mockCleanResult({ 客户姓名: '张三', 联系方式: '13800138000' }));
    mockAdaptEnumMapClean.mockReturnValue(mockCleanResult({ 客户姓名: '张三', 联系方式: '13800138000' }));
    mockAdaptValidateRecord.mockReturnValue(mockValidationResult);
    mockCalculateQualityScore.mockReturnValue(mockQualityReport);
  });

  it('format_clean 阶段失败后返回统一错误，后续阶段 skipped', () => {
    mockAdaptFormatClean.mockImplementation(() => {
      throw new Error('格式清洗失败 13800138000');
    });

    const result = runCleaningPipeline(validCandidate);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].stage).toBe('format_clean');
    expect(result.errors[0].code).toBe('PIPELINE_STAGE_FAILED');
    // 手机号被脱敏
    expect(result.errors[0].message).not.toMatch(/13800138000/);
    expect(result.errors[0].message).toContain('1**********');

    // 后续阶段全部 skipped
    expect(result.stages[0].status).toBe('failed');
    expect(result.stages.slice(1).every(s => s.status === 'skipped')).toBe(true);
  });

  it('enum_map_clean 阶段失败后返回统一错误，后续阶段 skipped', () => {
    mockAdaptEnumMapClean.mockImplementation(() => {
      throw new Error('枚举映射失败');
    });

    const result = runCleaningPipeline(validCandidate);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].stage).toBe('enum_map_clean');

    expect(result.stages[0].status).toBe('completed');
    expect(result.stages[1].status).toBe('failed');
    expect(result.stages.slice(2).every(s => s.status === 'skipped')).toBe(true);
  });

  it('validate 阶段失败后返回统一错误，后续阶段 skipped', () => {
    mockAdaptValidateRecord.mockImplementation(() => {
      throw new Error('校验失败');
    });

    const result = runCleaningPipeline(validCandidate);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].stage).toBe('validate');

    expect(result.stages[0].status).toBe('completed');
    expect(result.stages[1].status).toBe('completed');
    expect(result.stages[2].status).toBe('failed');
    expect(result.stages[3].status).toBe('skipped');
  });

  it('quality_assessment 阶段失败后返回统一错误', () => {
    mockCalculateQualityScore.mockImplementation(() => {
      throw new Error('质量评估失败');
    });

    const result = runCleaningPipeline(validCandidate);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].stage).toBe('quality_assessment');

    expect(result.stages[0].status).toBe('completed');
    expect(result.stages[1].status).toBe('completed');
    expect(result.stages[2].status).toBe('completed');
    expect(result.stages[3].status).toBe('failed');

    // validation 结果仍然保留
    expect(result.validation).not.toBeNull();
  });

  it('错误对象包含 code 属性时的传播', () => {
    const error = new Error('测试错误') as Error & { code: string };
    error.code = 'CUSTOM_ERROR_CODE';
    mockAdaptFormatClean.mockImplementation(() => {
      throw error;
    });

    const result = runCleaningPipeline(validCandidate);

    expect(result.errors[0].code).toBe('CUSTOM_ERROR_CODE');
  });
});
