import { describe, it, expect, beforeEach } from 'vitest';
import { calculateQualityScore } from '../../../../src/server/cleaning/adapters/quality-adapter.js';
import { clearLegacyExportCache } from '../../../../src/server/cleaning/legacy-module-loader.js';

describe('quality-adapter', () => {
  beforeEach(() => {
    clearLegacyExportCache();
  });

  it('无错误时质量分较高', () => {
    const report = calculateQualityScore([
      { schemaKey: 'customer', errors: [], warnings: [] },
    ]);
    expect(report.score).toBeGreaterThanOrEqual(80);
  });

  it('errors 数量 > 0 时质量分 ≤ 49', () => {
    const report = calculateQualityScore([
      {
        schemaKey: 'customer',
        errors: [
          { field: '联系方式', code: 'FORMAT_ERROR', message: '格式错误', severity: 'error' },
          { field: '客户姓名', code: 'REQUIRED_MISSING', message: '必填缺失', severity: 'error' },
        ],
        warnings: [],
      },
    ]);
    expect(report.score).toBeLessThanOrEqual(49);
  });

  it('返回结果可序列化', () => {
    const report = calculateQualityScore([
      { schemaKey: 'customer', errors: [], warnings: [] },
    ]);
    expect(() => JSON.stringify(report)).not.toThrow();
  });
});
