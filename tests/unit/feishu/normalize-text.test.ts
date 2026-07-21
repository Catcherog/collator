// normalize-text.test.ts
// Unit tests for the shared Feishu text field normaliser.
//
// Covers the TASK-003-GATE-D-TEXT-NORMALIZATION test matrix:
//   - Normal: string, {text}, [{text}] single, [{text}] multi, ID fields
//   - Boundary: empty string, empty array, newline JSON, Unicode, segments,
//     whitespace, long snapshot
//   - Exception: invalid JSON, {text: number}, unknown node, null, cleanup
//     failure, dual failure
//   - Regression: string passthrough, {text} compatibility, idempotency,
//     state machine, Gate A/C-Core (covered by other test files)

import { describe, it, expect } from 'vitest';
import {
  normalizeFeishuText,
  normalizeFeishuJson,
  NormalizeTextError,
  type NormalizeContext,
} from '../../../src/server/feishu/normalize-text.js';

const requiredCtx: NormalizeContext = {
  repository: 'FeishuTaskRepository',
  fieldName: '任务快照 JSON',
  recordId: 'recTest123',
  required: true,
};

const optionalCtx: NormalizeContext = {
  ...requiredCtx,
  required: false,
};

const ingestionIdCtx: NormalizeContext = {
  repository: 'FeishuTaskRepository',
  fieldName: '摄入 ID',
  recordId: 'recTest456',
  required: true,
};

describe('normalizeFeishuText — supported shapes (AC-02)', () => {
  it('returns string as-is', () => {
    expect(normalizeFeishuText('hello', requiredCtx)).toBe('hello');
  });

  it('extracts text from {text: string} single object', () => {
    expect(normalizeFeishuText({ text: 'abc' }, requiredCtx)).toBe('abc');
  });

  it('extracts text from single-element array [{text: "abc"}]', () => {
    expect(normalizeFeishuText([{ text: 'abc' }], requiredCtx)).toBe('abc');
  });

  it('concatenates multi-element array [{text:"a"},{text:"b"}] in order', () => {
    expect(
      normalizeFeishuText([{ text: 'a' }, { text: 'b' }], requiredCtx)
    ).toBe('ab');
  });

  it('concatenates multi-element array with more elements in order', () => {
    expect(
      normalizeFeishuText(
        [{ text: 'foo' }, { text: 'bar' }, { text: 'baz' }],
        requiredCtx
      )
    ).toBe('foobarbaz');
  });

  it('preserves order when array elements are out of lexical order', () => {
    expect(
      normalizeFeishuText(
        [{ text: 'second' }, { text: 'first' }],
        requiredCtx
      )
    ).toBe('secondfirst');
  });

  it('handles ingestion ID returned as array structure', () => {
    expect(
      normalizeFeishuText([{ text: 'ing_abc123' }], ingestionIdCtx)
    ).toBe('ing_abc123');
  });

  it('handles idempotency key returned as array structure', () => {
    const ctx: NormalizeContext = {
      ...ingestionIdCtx,
      fieldName: '幂等键',
    };
    expect(
      normalizeFeishuText([{ text: 'idem_key_xyz' }], ctx)
    ).toBe('idem_key_xyz');
  });

  it('handles source record ID returned as array structure', () => {
    const ctx: NormalizeContext = {
      ...ingestionIdCtx,
      fieldName: '来源记录 ID',
    };
    expect(
      normalizeFeishuText([{ text: 'recSource789' }], ctx)
    ).toBe('recSource789');
  });
});

describe('normalizeFeishuText — required vs optional (AC-03, AC-04)', () => {
  it('throws on null for required field', () => {
    expect(() => normalizeFeishuText(null, requiredCtx)).toThrow(
      NormalizeTextError
    );
    expect(() => normalizeFeishuText(null, requiredCtx)).toThrow(/null/);
  });

  it('throws on undefined for required field', () => {
    expect(() => normalizeFeishuText(undefined, requiredCtx)).toThrow(
      NormalizeTextError
    );
    expect(() => normalizeFeishuText(undefined, requiredCtx)).toThrow(
      /undefined/
    );
  });

  it('throws on empty array for required field', () => {
    expect(() => normalizeFeishuText([], requiredCtx)).toThrow(
      NormalizeTextError
    );
    expect(() => normalizeFeishuText([], requiredCtx)).toThrow(/empty array/);
  });

  it('returns undefined for null when optional', () => {
    expect(normalizeFeishuText(null, optionalCtx)).toBeUndefined();
  });

  it('returns undefined for undefined when optional', () => {
    expect(normalizeFeishuText(undefined, optionalCtx)).toBeUndefined();
  });

  it('returns undefined for empty array when optional', () => {
    expect(normalizeFeishuText([], optionalCtx)).toBeUndefined();
  });
});

describe('normalizeFeishuText — invalid shapes (AC-03)', () => {
  it('throws on [{}] (array with empty object)', () => {
    expect(() => normalizeFeishuText([{}], requiredCtx)).toThrow(
      NormalizeTextError
    );
    expect(() => normalizeFeishuText([{}], requiredCtx)).toThrow(/no 'text'/);
  });

  it('throws on {text: 123} (text is not string)', () => {
    expect(() => normalizeFeishuText({ text: 123 }, requiredCtx)).toThrow(
      NormalizeTextError
    );
    expect(() => normalizeFeishuText({ text: 123 }, requiredCtx)).toThrow(
      /'text' of type number/
    );
  });

  it('throws on {text: true} (text is boolean)', () => {
    expect(() => normalizeFeishuText({ text: true }, requiredCtx)).toThrow(
      /'text' of type boolean/
    );
  });

  it('throws on {text: null} (text is null)', () => {
    expect(() => normalizeFeishuText({ text: null }, requiredCtx)).toThrow(
      /'text' of type object/
    );
  });

  it('throws on plain unknown object {foo: "bar"}', () => {
    expect(() => normalizeFeishuText({ foo: 'bar' }, requiredCtx)).toThrow(
      NormalizeTextError
    );
    expect(() => normalizeFeishuText({ foo: 'bar' }, requiredCtx)).toThrow(
      /no 'text' property/
    );
  });

  it('throws on mixed valid and invalid array elements', () => {
    expect(() =>
      normalizeFeishuText([{ text: 'a' }, { foo: 'bar' }], requiredCtx)
    ).toThrow(NormalizeTextError);
    expect(() =>
      normalizeFeishuText([{ text: 'a' }, { foo: 'bar' }], requiredCtx)
    ).toThrow(/array index 1/);
  });

  it('does NOT silently coerce {text: 123} to "123" via String()', () => {
    // If String(value) were used, {text: 123} would become "123".
    // Verify the error does NOT contain "123" as a coerced value.
    try {
      normalizeFeishuText({ text: 123 }, requiredCtx);
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toMatch(/\b123\b/);
      expect(msg).toMatch(/'text' of type number/);
    }
  });

  it('throws on number primitive', () => {
    expect(() => normalizeFeishuText(42, requiredCtx)).toThrow(
      /unsupported value type number/
    );
  });

  it('throws on boolean primitive', () => {
    expect(() => normalizeFeishuText(true, requiredCtx)).toThrow(
      /unsupported value type boolean/
    );
  });
});

describe('normalizeFeishuText — error diagnostics (AC-03)', () => {
  it('includes repository name in error', () => {
    try {
      normalizeFeishuText(null, requiredCtx);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('FeishuTaskRepository');
    }
  });

  it('includes field name in error', () => {
    try {
      normalizeFeishuText(null, requiredCtx);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('任务快照 JSON');
    }
  });

  it('includes record id in error when provided', () => {
    try {
      normalizeFeishuText(null, requiredCtx);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('recTest123');
    }
  });

  it('handles missing recordId gracefully (new record)', () => {
    const ctx: NormalizeContext = {
      repository: 'FeishuTaskRepository',
      fieldName: '摄入 ID',
      required: true,
    };
    try {
      normalizeFeishuText(null, ctx);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('new record');
      expect((e as Error).message).not.toContain('record undefined');
    }
  });

  it('does NOT include raw value content in error (PII safety)', () => {
    // Even if value contains secret-like strings, error should not echo them.
    const secretObj = { text: 'app_secret=abc123token=xyz' };
    try {
      normalizeFeishuText({ foo: 'bar', ...secretObj }, requiredCtx);
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('abc123token');
      expect(msg).not.toContain('xyz');
      expect(msg).not.toContain('app_secret');
    }
  });

  it('does NOT include raw text content when rejecting {text: number}', () => {
    // The number 12345 could be a phone fragment; ensure it is not echoed.
    try {
      normalizeFeishuText({ text: 1234567 }, requiredCtx);
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('1234567');
      expect(msg).toMatch(/'text' of type number/);
    }
  });
});

describe('normalizeFeishuText — boundary (Test Matrix Boundary)', () => {
  it('returns empty string as-is (empty but present)', () => {
    expect(normalizeFeishuText('', requiredCtx)).toBe('');
  });

  it('returns empty string from {text: ""}', () => {
    expect(normalizeFeishuText({ text: '' }, requiredCtx)).toBe('');
  });

  it('returns empty string from [{text: ""}]', () => {
    expect(normalizeFeishuText([{ text: '' }], requiredCtx)).toBe('');
  });

  it('concatenates multiple segments including empty ones', () => {
    expect(
      normalizeFeishuText(
        [{ text: 'a' }, { text: '' }, { text: 'b' }],
        requiredCtx
      )
    ).toBe('ab');
  });

  it('preserves whitespace within text', () => {
    expect(
      normalizeFeishuText([{ text: '  hello  world  ' }], requiredCtx)
    ).toBe('  hello  world  ');
  });

  it('preserves Unicode and CJK characters', () => {
    expect(
      normalizeFeishuText([{ text: '客户姓名：张三' }], requiredCtx)
    ).toBe('客户姓名：张三');
  });

  it('preserves escape sequences in text', () => {
    expect(
      normalizeFeishuText([{ text: 'line1\\nline2\\ttab' }], requiredCtx)
    ).toBe('line1\\nline2\\ttab');
  });

  it('handles very long text in single segment', () => {
    const long = 'x'.repeat(10000);
    expect(normalizeFeishuText(long, requiredCtx)).toBe(long);
  });

  it('handles very long text split across segments', () => {
    const seg1 = 'a'.repeat(5000);
    const seg2 = 'b'.repeat(5000);
    expect(
      normalizeFeishuText([{ text: seg1 }, { text: seg2 }], requiredCtx)
    ).toBe(seg1 + seg2);
  });
});

describe('normalizeFeishuJson — supported shapes (AC-04)', () => {
  it('parses JSON from string', () => {
    expect(normalizeFeishuJson('{"foo":"bar"}', requiredCtx)).toEqual({
      foo: 'bar',
    });
  });

  it('parses JSON from {text: string}', () => {
    expect(
      normalizeFeishuJson({ text: '{"foo":"bar"}' }, requiredCtx)
    ).toEqual({ foo: 'bar' });
  });

  it('parses JSON from single-element array [{text: string}]', () => {
    expect(
      normalizeFeishuJson([{ text: '{"foo":"bar"}' }], requiredCtx)
    ).toEqual({ foo: 'bar' });
  });

  it('parses JSON from multi-element array (concatenated)', () => {
    expect(
      normalizeFeishuJson(
        [{ text: '{"foo":' }, { text: '"bar"}' }],
        requiredCtx
      )
    ).toEqual({ foo: 'bar' });
  });

  it('parses JSON spanning many segments', () => {
    const json = '{"a":1,"b":[2,3],"c":{"d":"e"}}';
    const parts = [
      json.slice(0, 5),
      json.slice(5, 10),
      json.slice(10, 15),
      json.slice(15),
    ];
    expect(
      normalizeFeishuJson(
        parts.map((p) => ({ text: p })),
        requiredCtx
      )
    ).toEqual({ a: 1, b: [2, 3], c: { d: 'e' } });
  });
});

describe('normalizeFeishuJson — boundary (Test Matrix Boundary)', () => {
  it('handles JSON with leading/trailing whitespace', () => {
    expect(
      normalizeFeishuJson('  {"foo":"bar"}  ', requiredCtx)
    ).toEqual({ foo: 'bar' });
  });

  it('handles JSON with newlines (pretty-printed)', () => {
    expect(
      normalizeFeishuJson('{\n  "foo": "bar"\n}', requiredCtx)
    ).toEqual({ foo: 'bar' });
  });

  it('preserves Unicode characters in JSON values', () => {
    expect(
      normalizeFeishuJson('{"name":"客户姓名"}', requiredCtx)
    ).toEqual({ name: '客户姓名' });
  });

  it('preserves escaped characters in JSON', () => {
    expect(
      normalizeFeishuJson('{"text":"hello\\nworld"}', requiredCtx)
    ).toEqual({ text: 'hello\nworld' });
  });

  it('preserves Unicode escape sequences in JSON', () => {
    expect(
      normalizeFeishuJson('{"emoji":"\\uD83D\\uDE00"}', requiredCtx)
    ).toEqual({ emoji: '\uD83D\uDE00' });
  });

  it('handles very long JSON snapshot', () => {
    const longValue = 'x'.repeat(10000);
    const obj = { data: longValue };
    expect(
      normalizeFeishuJson(JSON.stringify(obj), requiredCtx)
    ).toEqual(obj);
  });

  it('handles empty JSON object', () => {
    expect(normalizeFeishuJson('{}', requiredCtx)).toEqual({});
  });

  it('handles empty JSON array', () => {
    expect(normalizeFeishuJson('[]', requiredCtx)).toEqual([]);
  });

  it('handles JSON number', () => {
    expect(normalizeFeishuJson('42', requiredCtx)).toBe(42);
  });

  it('handles JSON null value', () => {
    expect(normalizeFeishuJson('null', requiredCtx)).toBeNull();
  });
});

describe('normalizeFeishuJson — error handling (AC-04)', () => {
  it('throws on invalid JSON (distinguishes from text structure error)', () => {
    try {
      normalizeFeishuJson('not valid json', requiredCtx);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NormalizeTextError);
      expect((e as Error).message).toMatch(/JSON parse failed/i);
    }
  });

  it('throws on broken JSON from array structure', () => {
    expect(() =>
      normalizeFeishuJson([{ text: '{broken' }], requiredCtx)
    ).toThrow(/JSON parse failed/i);
  });

  it('does NOT silently swallow JSON parse errors', () => {
    // Even when text can be extracted, invalid JSON must throw.
    expect(() => normalizeFeishuJson('definitely not json', requiredCtx)).toThrow();
  });

  it('does NOT alter JSON content (no re-serialisation)', () => {
    const original = '{"name":"测试","value":123,"nested":{"arr":[1,2,3]}}';
    const result = normalizeFeishuJson(original, requiredCtx);
    expect(result).toEqual({
      name: '测试',
      value: 123,
      nested: { arr: [1, 2, 3] },
    });
  });

  it('distinguishes text structure error from JSON parse error', () => {
    // Text structure error: {text: 123} cannot be normalised to string.
    try {
      normalizeFeishuJson({ text: 123 }, requiredCtx);
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      // Should NOT say "JSON parse failed" — this is a text structure error.
      expect(msg).not.toMatch(/JSON parse failed/i);
      expect(msg).toMatch(/'text' of type number/);
    }
  });

  it('returns undefined for null when optional', () => {
    expect(normalizeFeishuJson(null, optionalCtx)).toBeUndefined();
  });

  it('returns undefined for empty array when optional', () => {
    expect(normalizeFeishuJson([], optionalCtx)).toBeUndefined();
  });

  it('throws on empty string for required JSON field (invalid JSON)', () => {
    // Empty string is a valid text value but invalid JSON.
    expect(() => normalizeFeishuJson('', requiredCtx)).toThrow(
      /JSON parse failed/i
    );
  });

  it('preserves JSON object key order', () => {
    const json = '{"z":1,"a":2,"m":3}';
    const result = normalizeFeishuJson(json, requiredCtx) as Record<
      string,
      number
    >;
    expect(Object.keys(result)).toEqual(['z', 'a', 'm']);
  });
});

describe('normalizeFeishuText — regression (Test Matrix Regression)', () => {
  it('original string return mode continues to work', () => {
    // Existing callers that pass strings should see no behaviour change.
    expect(normalizeFeishuText('simple string', requiredCtx)).toBe(
      'simple string'
    );
    expect(normalizeFeishuText('', requiredCtx)).toBe('');
  });

  it('Review Repository {text} compatibility is preserved', () => {
    // FeishuReviewRepository previously accepted {text: string} single
    // objects. This must continue to work.
    expect(normalizeFeishuText({ text: 'review-text' }, requiredCtx)).toBe(
      'review-text'
    );
  });

  it('WriteLog Repository {text} compatibility is preserved', () => {
    // FeishuWriteLogRepository previously accepted {text: string} single
    // objects. This must continue to work.
    expect(normalizeFeishuText({ text: 'writelog-text' }, requiredCtx)).toBe(
      'writelog-text'
    );
  });

  it('does not trim the result (preserves idempotency-key semantics)', () => {
    // Trimming would change idempotency-key comparison semantics.
    // The normaliser must NOT trim.
    expect(normalizeFeishuText('  key_with_spaces  ', requiredCtx)).toBe(
      '  key_with_spaces  '
    );
    expect(normalizeFeishuText({ text: '  key_with_spaces  ' }, requiredCtx)).toBe(
      '  key_with_spaces  '
    );
  });

  it('does not trim array-concatenated result', () => {
    expect(
      normalizeFeishuText(
        [{ text: '  a  ' }, { text: '  b  ' }],
        requiredCtx
      )
    ).toBe('  a    b  ');
  });
});
