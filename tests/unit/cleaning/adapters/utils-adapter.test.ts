import { describe, it, expect } from 'vitest';
import {
  sanitizePhone,
  sanitizeText,
  isValidPhone,
  isValidWechat,
  parseAmount,
  parseDate,
  normalizeBudget,
  chineseToNum,
  findMatchingStyle,
  findMatchingShootType,
} from '../../../../src/server/cleaning/adapters/utils-adapter.js';

describe('utils-adapter', () => {
  it('sanitizePhone 去除空格与括号', () => {
    expect(sanitizePhone('138-0013-8000')).toBe('13800138000');
    expect(sanitizePhone('（138）00138000')).toBe('13800138000');
  });

  it('sanitizeText 合并连续空白', () => {
    expect(sanitizeText('  你好   世界  ')).toBe('你好 世界');
  });

  it('isValidPhone 校验中国手机号', () => {
    expect(isValidPhone('13800138000')).toBe(true);
    expect(isValidPhone('1380013800')).toBe(false);
    expect(isValidPhone('23800138000')).toBe(false);
  });

  it('isValidWechat 校验微信号', () => {
    expect(isValidWechat('abc123')).toBe(true);
    expect(isValidWechat('13800138000')).toBe(true);
    expect(isValidWechat('123abc')).toBe(false);
  });

  it('parseAmount 解析金额', () => {
    expect(parseAmount('2k')).toEqual({ value: 2000, approximate: true });
    expect(parseAmount('1500元')).toEqual({ value: 1500, approximate: false });
    expect(parseAmount('无')).toBeNull();
  });

  it('parseDate 使用基准日期上下文', () => {
    const context = { referenceDate: '2026-06-01' };
    expect(parseDate('今天', context)).toBe('2026-06-01');
    expect(parseDate('明天', context)).toBe('2026-06-02');
    expect(parseDate('2025-12-31', context)).toBe('2025-12-31');
  });

  it('parseDate 无上下文返回 null', () => {
    expect(parseDate('今天')).toBeNull();
  });

  it('normalizeBudget 解析预算区间', () => {
    expect(normalizeBudget('1k左右')).toEqual({ interval: '1000-2000元', confidence: 0.9 });
    expect(normalizeBudget('5k以上')).toEqual({ interval: '5000元以上', confidence: 0.9 });
    expect(normalizeBudget('随便')).toEqual({ interval: null, confidence: 0 });
  });

  it('chineseToNum 转换中文数字', () => {
    expect(chineseToNum('十五')).toBe(15);
    expect(chineseToNum('二十三')).toBe(23);
    expect(chineseToNum('十')).toBe(10);
  });

  it('findMatchingStyle 匹配风格同义词', () => {
    const synonyms = { '日系清新': ['小清新'] };
    expect(findMatchingStyle('小清新', synonyms)).toEqual({ style: '日系清新', confidence: 0.85 });
    expect(findMatchingStyle('不存在', synonyms)).toBeNull();
  });

  it('findMatchingShootType 匹配拍摄类型', () => {
    const mapping = {
      亲子: { synonyms: ['宝宝照'], confidence: 0.98, needsConfirmation: false },
    };
    expect(findMatchingShootType('宝宝照', mapping)).toEqual({ type: '亲子', confidence: 0.98, needsConfirmation: false });
  });

  it('纯函数不修改输入', () => {
    const input = { a: 1 };
    sanitizeText(input as unknown as string);
    expect(input).toEqual({ a: 1 });
  });
});
