import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLegacyExport,
  loadLegacyClass,
  clearLegacyExportCache,
  getLegacyExportCacheStats,
} from '../../../src/server/cleaning/legacy-module-loader.js';
import { LegacyAdapterError } from '../../../src/server/cleaning/errors.js';

describe('LegacyModuleLoader', () => {
  beforeEach(() => {
    clearLegacyExportCache();
  });

  it('SAFE 模块可加载并执行', () => {
    const isEqual = loadLegacyExport<(...args: unknown[]) => unknown>('benchmark/metrics.js', 'isEqual');
    expect(typeof isEqual).toBe('function');
    expect((isEqual as (a: unknown, b: unknown) => boolean)(1, 1)).toBe(true);
  });

  it('重复加载命中缓存', () => {
    loadLegacyExport('benchmark/metrics.js', 'isEqual');
    const firstStats = getLegacyExportCacheStats();
    expect(firstStats.exports).toBe(1);

    loadLegacyExport('benchmark/metrics.js', 'isEqual');
    const secondStats = getLegacyExportCacheStats();
    expect(secondStats.exports).toBe(1);
  });

  it('UNSAFE 模块拒绝加载', () => {
    expect(() => loadLegacyExport('core/data-cleaner.js', 'createCleaner')).toThrow(LegacyAdapterError);
    try {
      loadLegacyExport('core/data-cleaner.js', 'createCleaner');
    } catch (err) {
      expect(err).toBeInstanceOf(LegacyAdapterError);
      expect((err as LegacyAdapterError).code).toBe('LEGACY_MODULE_UNSAFE');
    }
  });

  it('BLOCKED 模块拒绝加载（HTML 实体污染）', () => {
    expect(() => loadLegacyExport('agent/index.js', 'createAgent')).toThrow(LegacyAdapterError);
    try {
      loadLegacyExport('agent/index.js', 'createAgent');
    } catch (err) {
      expect(err).toBeInstanceOf(LegacyAdapterError);
      expect((err as LegacyAdapterError).code).toBe('LEGACY_MODULE_UNSAFE');
    }
  });

  it('未 Profile 模块拒绝加载', () => {
    expect(() => loadLegacyExport('not/exist.js', 'foo')).toThrow(LegacyAdapterError);
    try {
      loadLegacyExport('not/exist.js', 'foo');
    } catch (err) {
      expect((err as LegacyAdapterError).code).toBe('LEGACY_MODULE_NOT_PROFILED');
    }
  });

  it('路径穿越拒绝加载', () => {
    expect(() => loadLegacyExport('../package.json', 'foo')).toThrow(LegacyAdapterError);
    expect(() => loadLegacyExport('../../../etc/passwd', 'foo')).toThrow(LegacyAdapterError);
  });

  it('不在 allowedExports 的导出被拒绝', () => {
    expect(() => loadLegacyExport('utils/index.js', 'createLogger')).toThrow(LegacyAdapterError);
    try {
      loadLegacyExport('utils/index.js', 'createLogger');
    } catch (err) {
      expect((err as LegacyAdapterError).code).toBe('LEGACY_EXPORT_NOT_ALLOWED');
      expect((err as LegacyAdapterError).exportName).toBe('createLogger');
    }
  });

  it('加载 Class 形状正确', () => {
    const QualityScorer = loadLegacyClass('core/quality-scorer.js', 'QualityScorer');
    expect(typeof QualityScorer).toBe('function');
    const instance = new QualityScorer();
    expect(typeof instance.score).toBe('function');
  });

  it('错误信息不泄露绝对路径', () => {
    try {
      loadLegacyExport('not/exist.js', 'foo');
      expect.fail('应抛出异常');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toMatch(/^[A-Za-z]:\\/);
      expect(message).not.toContain(':\\\\');
    }
  });
});
