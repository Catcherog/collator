import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadCustomerSchema,
  clearCustomerSchemaCache,
  getFieldSchema,
  getRequiredFields,
  getEnumFields,
} from '../../../../src/server/cleaning/adapters/schema-adapter.js';

describe('schema-adapter', () => {
  beforeEach(() => {
    clearCustomerSchemaCache();
  });

  it('loadCustomerSchema 加载 customer schema', () => {
    const schema = loadCustomerSchema();
    expect(schema.tableName).toBe('客户全生命周期管理表');
    expect(schema.fields.length).toBeGreaterThan(0);
  });

  it('缓存生效：重复调用返回同一对象', () => {
    const first = loadCustomerSchema();
    const second = loadCustomerSchema();
    expect(first).toBe(second);
  });

  it('getFieldSchema 返回字段定义', () => {
    const field = getFieldSchema('customer', '客户姓名');
    expect(field).toBeDefined();
    expect(field?.type).toBe('text');
    expect(field?.required).toBe(true);
  });

  it('getRequiredFields 返回必填字段', () => {
    const fields = getRequiredFields('customer');
    expect(fields.some(f => f.fieldName === '客户姓名')).toBe(true);
  });

  it('getEnumFields 返回枚举字段', () => {
    const fields = getEnumFields('customer');
    expect(fields.some(f => f.fieldName === '预算区间')).toBe(true);
  });

  it('非 customer schemaKey 返回空', () => {
    expect(getFieldSchema('project', '客户姓名')).toBeUndefined();
    expect(getRequiredFields('project')).toHaveLength(0);
  });
});
