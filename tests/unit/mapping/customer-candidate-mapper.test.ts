import { describe, it, expect } from 'vitest';
import {
  mapCustomerCandidate,
  type CandidateMappingResult,
} from '../../../src/server/mapping/customer-candidate-mapper.js';

const ENGLISH_FIELDS = {
  customer_name: '张三',
  contact: '13800000000',
  source_channel: '小红书',
  consultation_time: '2026-07-15T10:00:00.000Z',
  shooting_type: '写真',
  budget: '3000-5000元',
  style_preferences: '简约',
  follow_up_notes: '已加微信',
  review_record: '好评1',
};

const CHINESE_FIELDS = {
  客户姓名: '张三',
  联系方式: '13800000000',
  来源渠道: '小红书',
  咨询时间: '2026-07-15T10:00:00.000Z',
  拍摄类型: '写真',
  预算区间: '3000-5000元',
  意向风格: '简约',
  跟进记录: '已加微信',
  好评记录: '好评1',
};

describe('mapCustomerCandidate', () => {
  it('maps the nine canonical English keys to Chinese schema fields', () => {
    const result = mapCustomerCandidate(ENGLISH_FIELDS);
    expect(result.warnings).toEqual([]);
    expect(result.mappedFields).toEqual(CHINESE_FIELDS);
  });

  it('accepts canonical Chinese fields unchanged', () => {
    const input = { ...CHINESE_FIELDS };
    const result = mapCustomerCandidate(input);
    expect(result.warnings).toEqual([]);
    expect(result.mappedFields).toEqual(CHINESE_FIELDS);
  });

  it('keeps the Chinese value and warns when English and Chinese values conflict', () => {
    const input = {
      ...CHINESE_FIELDS,
      customer_name: '李四', // English conflicting value
    };
    const result = mapCustomerCandidate(input);
    expect(result.mappedFields['客户姓名']).toBe('张三'); // Chinese wins
    const conflict = result.warnings.find((w) => w.code === 'CANDIDATE_FIELD_CONFLICT');
    expect(conflict).toBeDefined();
    expect(conflict?.field).toBe('客户姓名');
  });

  it('drops unknown fields from mappedFields and records UNMAPPED_CANDIDATE_FIELD', () => {
    const input = {
      ...ENGLISH_FIELDS,
      unknown_field: 'should be dropped',
      another_unknown: 42,
    };
    const result = mapCustomerCandidate(input);
    expect(result.mappedFields).toEqual(CHINESE_FIELDS);
    const unmapped = result.warnings.filter((w) => w.code === 'UNMAPPED_CANDIDATE_FIELD');
    expect(unmapped.length).toBe(2);
    expect(unmapped.some((w) => w.field === 'unknown_field')).toBe(true);
    expect(unmapped.some((w) => w.field === 'another_unknown')).toBe(true);
  });

  it('does not mutate nested or top-level input data', () => {
    const input = {
      ...ENGLISH_FIELDS,
      nested: { a: 1, b: { c: 2 } },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    mapCustomerCandidate(input);
    expect(input).toEqual(snapshot);
  });

  it('returns deeply equal results for repeated equal inputs', () => {
    const input = {
      ...ENGLISH_FIELDS,
      extra: 'noise',
    };
    const r1: CandidateMappingResult = mapCustomerCandidate(input);
    const r2: CandidateMappingResult = mapCustomerCandidate(input);
    expect(r1).toEqual(r2);
    // Identity of mappedFields arrays/objects must differ; deep equality must hold.
    expect(r1.mappedFields).not.toBe(r2.mappedFields);
    expect(r1.warnings).not.toBe(r2.warnings);
  });
});
