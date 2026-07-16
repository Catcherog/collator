import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSynonyms,
  loadCleaningRules,
  clearConfigCache,
  getFieldFormatRule,
  getStateMachine,
} from '../../../../src/server/cleaning/adapters/config-adapter.js';

describe('config-adapter', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('loadSynonyms 返回同义词配置', () => {
    const synonyms = loadSynonyms();
    expect(synonyms.styleSynonyms['日系清新']).toContain('小清新');
    expect(synonyms.shootTypeMapping['亲子'].synonyms).toContain('宝宝照');
  });

  it('loadCleaningRules 返回清洗规则', () => {
    const rules = loadCleaningRules();
    expect(rules.fieldFormatRules['phone']).toBeDefined();
    expect(rules.stateMachines['projectStatus']).toBeDefined();
  });

  it('缓存生效：重复调用返回同一对象', () => {
    const first = loadSynonyms();
    const second = loadSynonyms();
    expect(first).toBe(second);
  });

  it('getFieldFormatRule 返回指定规则', () => {
    const rule = getFieldFormatRule('phone');
    expect(rule).toBeDefined();
    expect(rule?.pattern).toBe('^1[3-9]\\d{9}$');
  });

  it('getStateMachine 返回状态机', () => {
    const sm = getStateMachine('projectStatus');
    expect(sm).toBeDefined();
    expect(sm?.initial).toBe('待立项');
  });
});
