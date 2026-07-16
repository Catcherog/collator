import { describe, it, expect, beforeEach } from 'vitest';
import {
  isEqual,
  accuracy,
  computeFieldAccuracy,
  computeStatusMatch,
  computeCasePassed,
  computeWER,
  computeCRA,
} from '../../../../src/server/cleaning/adapters/benchmark-adapter.js';
import { clearLegacyExportCache } from '../../../../src/server/cleaning/legacy-module-loader.js';

describe('benchmark-adapter', () => {
  beforeEach(() => {
    clearLegacyExportCache();
  });

  it('isEqual 比较标量与数组', () => {
    expect(isEqual(1, 1)).toBe(true);
    expect(isEqual([1, 2], [2, 1])).toBe(true);
    expect(isEqual('a', 'b')).toBe(false);
  });

  it('accuracy 计算百分比', () => {
    expect(accuracy(90, 100)).toBe(90);
    expect(accuracy(0, 0)).toBe(0);
  });

  it('computeFieldAccuracy 计算字段准确率', () => {
    const result = computeFieldAccuracy({ a: 1, b: 2 }, { a: 1, b: 3 });
    expect(result.rate).toBe(50);
    expect(result.correct).toBe(1);
    expect(result.total).toBe(2);
  });

  it('computeStatusMatch 状态匹配', () => {
    const result = computeStatusMatch('passed', true, [], []);
    expect(result.statusMatched).toBe(true);
  });

  it('computeCasePassed 综合判定', () => {
    const sm = computeStatusMatch('passed', true, [], []);
    expect(computeCasePassed(sm, true)).toBe(true);
    expect(computeCasePassed(sm, false)).toBe(false);
  });

  it('computeWER 计算词错误率', () => {
    expect(computeWER('hello world', 'hello world')).toBe(0);
    expect(computeWER('hello world', 'hello')).toBeGreaterThan(0);
  });

  it('computeCRA 计算字符准确率', () => {
    expect(computeCRA('hello', 'hello')).toBe(100);
    expect(computeCRA('hello', 'hallo')).toBeLessThan(100);
  });
});
