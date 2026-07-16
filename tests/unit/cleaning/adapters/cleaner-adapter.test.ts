import { describe, it, expect } from 'vitest';
import {
  adaptFormatClean,
  adaptEnumMapClean,
} from '../../../../src/server/cleaning/adapters/cleaner-adapter.js';

describe('cleaner-adapter', () => {
  const dateContext = { referenceDate: '2026-06-01' };

  it('adaptFormatClean 清洗手机号与文本', () => {
    const input = {
      客户姓名: '  张三  ',
      联系方式: '138-0013-8000',
    };
    const result = adaptFormatClean('customer', input, { dateContext });
    expect(result.data['客户姓名']).toBe('张三');
    expect(result.data['联系方式']).toBe('13800138000');
    expect(result.corrections.length).toBeGreaterThan(0);
  });

  it('adaptFormatClean 解析日期与预算', () => {
    const input = {
      咨询时间: '今天',
      预算区间: '1k左右',
    };
    const result = adaptFormatClean('customer', input, { dateContext });
    expect(result.data['咨询时间']).toBe('2026-06-01');
    expect(result.data['预算区间']).toBe('1000-2000元');
  });

  it('adaptEnumMapClean 映射来源渠道同义词', () => {
    const input = {
      来源渠道: '小红书',
    };
    const result = adaptEnumMapClean('customer', input);
    expect(result.data['来源渠道']).toBe('小红书');
  });

  it('adaptEnumMapClean 映射风格同义词', () => {
    const input = {
      意向风格: '小清新',
    };
    const result = adaptEnumMapClean('customer', input);
    expect(result.data['意向风格']).toBe('日系清新');
    expect(result.corrections.length).toBe(1);
  });

  it('输入对象不被修改', () => {
    const input = {
      客户姓名: '  张三  ',
      联系方式: '138-0013-8000',
    };
    const snapshot = JSON.stringify(input);
    adaptFormatClean('customer', input, { dateContext });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('输出可 JSON.stringify', () => {
    const input = {
      客户姓名: '张三',
      意向风格: '小清新',
    };
    const result = adaptEnumMapClean('customer', input);
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
