import { describe, it, expect } from 'vitest';
import {
  redactPhone,
  redactContent,
  redactObject,
  sanitizeWarningText,
} from '../../../src/server/security/redaction.js';

describe('redactPhone', () => {
  it('masks an 11-digit Chinese mobile number', () => {
    expect(redactPhone('13800138000')).toBe('138****8000');
  });

  it('masks a number with +86 prefix', () => {
    expect(redactPhone('+8613800138000')).toBe('138****8000');
  });

  it('leaves non-phone strings unchanged', () => {
    expect(redactPhone('张三')).toBe('张三');
  });
});

describe('redactContent', () => {
  it('redacts phones and truncates long content', () => {
    const long = `客户说电话是13800138000，${'x'.repeat(220)}`;
    const result = redactContent(long);
    expect(result).not.toContain('13800138000');
    expect(result).toContain('138****8000');
    expect(result.endsWith('... [truncated]')).toBe(true);
  });
});

describe('redactObject (recursive)', () => {
  it('does not mutate the input object', () => {
    const input = {
      contact: '13800138000',
      nested: { phone: '13900139000' },
    };
    redactObject(input);
    // Input is unchanged.
    expect(input.contact).toBe('13800138000');
    expect(input.nested.phone).toBe('13900139000');
  });

  it('redacts top-level sensitive string keys', () => {
    const result = redactObject({ contact: '13800138000', name: '张三' });
    expect(result.contact).toBe('138****8000');
    expect(result.name).toBe('张三');
  });

  it('redacts nested phone numbers under sensitive keys at any depth', () => {
    const input = {
      candidate: {
        fields: {
          联系方式: '13800138000',
          客户姓名: '张三',
        },
        evidence: {
          contact: '电话13900139000',
        },
      },
    };
    const result = redactObject(input) as Record<string, unknown>;
    const candidate = result.candidate as Record<string, unknown>;
    const fields = candidate.fields as Record<string, unknown>;
    const evidence = candidate.evidence as Record<string, unknown>;
    expect(fields['联系方式']).toBe('138****8000');
    expect(fields['客户姓名']).toBe('张三');
    // Non-sensitive key with embedded phone is still masked at response boundary.
    expect(evidence['contact']).toBe('电话139****9000');
  });

  it('redacts phone numbers inside arrays of objects', () => {
    const input = {
      duplicate_candidates: [
        { 联系方式: '13800138000' },
        { phone: '13700137000' },
      ],
    };
    const result = redactObject(input) as Record<string, unknown>;
    const arr = result.duplicate_candidates as Array<Record<string, unknown>>;
    expect(arr[0]['联系方式']).toBe('138****8000');
    expect(arr[1].phone).toBe('137****7000');
  });

  it('redacts raw-text keys with redactContent (truncation + phone)', () => {
    const longRaw = `电话13800138000${'y'.repeat(220)}`;
    const input = { 原始文本: longRaw, content: longRaw };
    const result = redactObject(input);
    expect(result['原始文本']).not.toContain('13800138000');
    expect(result['原始文本']).toContain('138****8000');
    expect((result['原始文本'] as string).endsWith('... [truncated]')).toBe(true);
    expect(result.content).not.toContain('13800138000');
  });

  it('returns non-object values unchanged through deep traversal', () => {
    const input = { count: 42, flag: true, nil: null };
    const result = redactObject(input);
    expect(result.count).toBe(42);
    expect(result.flag).toBe(true);
    expect(result.nil).toBeNull();
  });
});

describe('sanitizeWarningText', () => {
  it('redacts phone numbers embedded in warning text', () => {
    expect(sanitizeWarningText('phone_13800138000_field')).toBe('phone_138****8000_field');
  });

  it('redacts absolute Unix paths', () => {
    expect(sanitizeWarningText('/etc/passwd')).toBe('<PATH>');
    expect(sanitizeWarningText('field /usr/local/bin node')).toBe('field <PATH> node');
  });

  it('redacts absolute Windows paths', () => {
    expect(sanitizeWarningText('C:\\Users\\admin\\secret')).toBe('<PATH>');
  });

  it('leaves normal field names intact', () => {
    expect(sanitizeWarningText('unknown_field')).toBe('unknown_field');
    expect(sanitizeWarningText('style_preferences')).toBe('style_preferences');
  });

  it('leaves normal messages intact (except embedded PII/paths)', () => {
    expect(sanitizeWarningText('未识别的 Candidate 字段: unknown_field')).toBe(
      '未识别的 Candidate 字段: unknown_field'
    );
  });
});
