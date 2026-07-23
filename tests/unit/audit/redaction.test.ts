// WORKSTREAM-D (Task D6): redactDetails 单元测试 — AC-D04 PII 最小化。
//
// 验证：敏感 key 整值丢弃、手机号掩码、嵌套递归、不改入参、undefined 透传。

import { describe, it, expect } from 'vitest';
import { redactDetails } from '../../../src/audit/redaction.js';

describe('redactDetails (AC-D04)', () => {
  it('strips secret-like keys to [REDACTED]', () => {
    const out = redactDetails({
      app_secret: 'shhh-123',
      apiToken: 'tok_abc',
      password: 'p@ss',
      appSecret: 'shhh-456',
    });
    expect(out).toEqual({
      app_secret: '[REDACTED]',
      apiToken: '[REDACTED]',
      password: '[REDACTED]',
      appSecret: '[REDACTED]',
    });
  });

  it('strips image / base64 keys (never persists full image)', () => {
    const out = redactDetails({
      image: 'data:image/png;base64,iVBORw0KGgo=',
      image_base64: 'iVBORw0KGgo=',
      base64: 'AAAABBBB',
      ocr_version: 'tess-1.0',
    });
    expect(out).toEqual({
      image: '[REDACTED]',
      image_base64: '[REDACTED]',
      base64: '[REDACTED]',
      ocr_version: 'tess-1.0',
    });
  });

  it('masks phone numbers embedded in any string value', () => {
    const out = redactDetails({
      contact: '13800138000',
      phone: '电话: 13912345678',
      note: '客户电话 13800138000 已联系',
      table_id: 'tblCustomer',
    });
    expect(out?.contact).toBe('138****8000');
    expect(out?.phone).toBe('电话: 139****5678');
    expect(out?.note).toBe('客户电话 138****8000 已联系');
    expect(out?.table_id).toBe('tblCustomer');
  });

  it('recurses into nested objects and arrays', () => {
    const out = redactDetails({
      nested: {
        app_secret: 'nested-secret',
        contact: '13800138000',
        ok: 'keep',
      },
      list: [{ token: 'tok_x', value: '13800138000' }],
    });
    expect(out).toEqual({
      nested: {
        app_secret: '[REDACTED]',
        contact: '138****8000',
        ok: 'keep',
      },
      list: [{ token: '[REDACTED]', value: '138****8000' }],
    });
  });

  it('does not mutate the input object', () => {
    const input = {
      app_secret: 'shhh',
      phone: '13800138000',
      nested: { token: 'tok' },
    };
    const snapshot = JSON.stringify(input);
    redactDetails(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    // 入参原值未被替换
    expect(input.app_secret).toBe('shhh');
    expect(input.phone).toBe('13800138000');
  });

  it('returns undefined for undefined input', () => {
    expect(redactDetails(undefined)).toBeUndefined();
  });

  it('preserves non-sensitive primitives (number/boolean/null)', () => {
    const out = redactDetails({
      count: 3,
      ok: true,
      empty: null,
      ratio: 0.85,
    });
    expect(out).toEqual({ count: 3, ok: true, empty: null, ratio: 0.85 });
  });

  it('matches key patterns case-insensitively', () => {
    const out = redactDetails({
      AppSecret: 'x',
      TOKEN: 'y',
      ImageBase64: 'z',
    });
    expect(out).toEqual({
      AppSecret: '[REDACTED]',
      TOKEN: '[REDACTED]',
      ImageBase64: '[REDACTED]',
    });
  });
});
