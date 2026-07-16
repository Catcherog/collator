import { describe, it, expect, beforeEach } from 'vitest';
import {
  adaptValidateField,
  adaptValidateRecord,
  adaptValidateRequiredFields,
  adaptValidateLogicConsistency,
  adaptValidateStateTransition,
  adaptMakeIssue,
  adaptIsEmpty,
} from '../../../../src/server/cleaning/adapters/rules-adapter.js';
import { clearLegacyExportCache } from '../../../../src/server/cleaning/legacy-module-loader.js';

describe('rules-adapter', () => {
  beforeEach(() => {
    clearLegacyExportCache();
  });

  it('adaptValidateField 校验手机号字段', () => {
    const fieldSchema = {
      fieldName: '联系方式',
      type: 'text(phone)',
      required: true,
      enumValues: [],
    };
    const result = adaptValidateField(fieldSchema, '13800138000');
    expect(result.valid).toBe(true);
  });

  it('adaptValidateField 非法枚举返回 ENUM_MISMATCH', () => {
    const fieldSchema = {
      fieldName: '来源渠道',
      type: 'select',
      required: false,
      enumValues: ['小红书', '抖音'],
    };
    const result = adaptValidateField(fieldSchema, '不存在');
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('ENUM_MISMATCH');
  });

  it('adaptValidateRecord 返回完整结果', () => {
    const data = {
      客户姓名: '张三',
      联系方式: '13800138000',
    };
    const result = adaptValidateRecord('customer', data);
    expect(['passed', 'warning', 'failed']).toContain(result.status);
    expect(typeof result.score).toBe('number');
  });

  it('adaptValidateRequiredFields 检测必填缺失', () => {
    const data = {};
    const result = adaptValidateRequiredFields('customer', data);
    expect(result.valid).toBe(false);
    expect(result.missingFields.length).toBeGreaterThan(0);
  });

  it('adaptValidateLogicConsistency 检测日期冲突', () => {
    const data = {
      咨询时间: '2026-06-10',
      拍摄日期: '2026-06-05',
    };
    const result = adaptValidateLogicConsistency(data, 'customer');
    expect(result.errors.some(e => e.code === 'DATE_CONFLICT')).toBe(true);
  });

  it('adaptValidateStateTransition 校验状态机', () => {
    const result = adaptValidateStateTransition('projectStatus', null, '待立项');
    expect(result.valid).toBe(true);

    const bad = adaptValidateStateTransition('projectStatus', '待立项', '已归档');
    expect(bad.valid).toBe(false);
  });

  it('adaptMakeIssue 构造 issue', () => {
    const issue = adaptMakeIssue('f', 'CODE', 'msg', 'error', 'suggestion');
    expect(issue.field).toBe('f');
    expect(issue.code).toBe('CODE');
  });

  it('adaptIsEmpty 判断空值', () => {
    expect(adaptIsEmpty('')).toBe(true);
    expect(adaptIsEmpty(null)).toBe(true);
    expect(adaptIsEmpty('x')).toBe(false);
  });
});
