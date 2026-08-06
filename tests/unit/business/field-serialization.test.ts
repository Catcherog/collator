import { describe, expect, it } from 'vitest';
import {
  describeType,
  toFeishuDateTime,
  toFeishuMultiSelect,
  toFeishuRelation,
  toFeishuSingleSelect,
  toFeishuText,
} from '../../../src/server/business/field-serialization.js';
import { FieldTypeMismatchError } from '../../../src/server/domain/errors.js';

/**
 * Regression suite for the writer-boundary serialization layer.
 *
 * Context: the Project table returned an opaque FEISHU_COMMIT_FAILED because a
 * raw OCR date string reached the 拍摄档期 DateTime column, which answers
 * `1254064 DatetimeFieldConvFail` for anything that is not epoch milliseconds.
 * Two neighbouring column types fail *silently* instead (Link drops unknown
 * values, MultiSelect auto-creates unknown options), so the writer must reject
 * bad shapes itself rather than relying on the API to complain.
 */

const REFERENCE = new Date(Date.UTC(2026, 7, 1)); // 2026-08-01
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe('field-serialization', () => {
  describe('toFeishuDateTime — the FEISHU_COMMIT_FAILED root cause', () => {
    it('resolves the year-less Chinese form that OCR produces ("8月15日")', () => {
      // This exact value used to be forwarded verbatim and rejected by Feishu.
      expect(toFeishuDateTime('拍摄档期', '8月15日', { referenceDate: REFERENCE })).toBe(
        utc(2026, 8, 15),
      );
    });

    it.each([
      ['2026-08-15', utc(2026, 8, 15)],
      ['2026-8-15', utc(2026, 8, 15)],
      ['2026/8/15', utc(2026, 8, 15)],
      ['2026.8.15', utc(2026, 8, 15)],
      ['2026年8月15日', utc(2026, 8, 15)],
      ['  2026-08-15  ', utc(2026, 8, 15)],
    ])('normalises %s to UTC midnight epoch ms', (input, expected) => {
      expect(toFeishuDateTime('拍摄档期', input)).toBe(expected);
    });

    it('passes epoch milliseconds through unchanged', () => {
      const ms = utc(2026, 8, 15);
      expect(toFeishuDateTime('拍摄档期', ms)).toBe(ms);
    });

    it('widens 10-digit epoch seconds to milliseconds', () => {
      expect(toFeishuDateTime('拍摄档期', '1786060800')).toBe(1786060800 * 1000);
    });

    it('accepts a full ISO 8601 timestamp with an explicit timezone', () => {
      expect(toFeishuDateTime('拍摄档期', '2026-08-15T00:00:00Z')).toBe(utc(2026, 8, 15));
    });

    it('treats absent values as "omit the field", not as an error', () => {
      expect(toFeishuDateTime('拍摄档期', undefined)).toBeNull();
      expect(toFeishuDateTime('拍摄档期', null)).toBeNull();
      expect(toFeishuDateTime('拍摄档期', '   ')).toBeNull();
    });

    it('refuses to guess ambiguous US-style dates instead of silently writing 2001', () => {
      // Date.parse('8/10') yields 2001-08-10. Writing a plausible-but-wrong
      // business date is worse than failing, so there is no parse fallback.
      expect(() => toFeishuDateTime('拍摄档期', '8/10')).toThrow(FieldTypeMismatchError);
    });

    it.each(['下周六', '待定', '八月十五', '2026-08', 'next Friday'])(
      'fails closed on unresolvable input %s',
      (input) => {
        expect(() => toFeishuDateTime('拍摄档期', input)).toThrow(FieldTypeMismatchError);
      },
    );

    it('rejects calendar overflow rather than rolling 2月30日 into March', () => {
      expect(() => toFeishuDateTime('拍摄档期', '2026年2月30日')).toThrow(FieldTypeMismatchError);
      expect(() => toFeishuDateTime('拍摄档期', '2026-13-01')).toThrow(FieldTypeMismatchError);
    });

    it('rejects non-date value shapes', () => {
      expect(() => toFeishuDateTime('拍摄档期', { when: 'soon' })).toThrow(FieldTypeMismatchError);
      expect(() => toFeishuDateTime('拍摄档期', ['2026-08-15'])).toThrow(FieldTypeMismatchError);
      expect(() => toFeishuDateTime('拍摄档期', Number.NaN)).toThrow(FieldTypeMismatchError);
    });

    it('is timezone-stable: the same calendar day maps to the same instant', () => {
      // Uses Date.UTC rather than the local-time constructor, so a CI box in
      // UTC+8 and a laptop in UTC-5 agree on 拍摄档期.
      expect(toFeishuDateTime('拍摄档期', '2026-08-15')).toBe(
        toFeishuDateTime('拍摄档期', '2026年8月15日'),
      );
    });
  });

  describe('toFeishuRelation — Link columns fail silently on the wire', () => {
    it('wraps a single record id into an array', () => {
      expect(toFeishuRelation('关联客户 ID', 'recuNazHZU')).toEqual(['recuNazHZU']);
    });

    it('accepts record ids that carry - or _ separators', () => {
      expect(toFeishuRelation('关联客户 ID', 'rec_customer_abc')).toEqual(['rec_customer_abc']);
    });

    it('passes an array of record ids through unchanged', () => {
      expect(toFeishuRelation('关联客户 ID', ['recA1', 'recB2'])).toEqual(['recA1', 'recB2']);
    });

    it('rejects a display name, which Feishu would accept and silently drop', () => {
      expect(() => toFeishuRelation('关联客户 ID', '李女士')).toThrow(FieldTypeMismatchError);
    });

    it('rejects a nested record object instead of unwrapping it by guesswork', () => {
      expect(() => toFeishuRelation('关联客户 ID', [{ record_id: 'recA1' }])).toThrow(
        FieldTypeMismatchError,
      );
    });

    it('treats absent values as "omit the field"', () => {
      expect(toFeishuRelation('关联客户 ID', undefined)).toBeNull();
      expect(toFeishuRelation('关联客户 ID', [])).toBeNull();
    });
  });

  describe('toFeishuMultiSelect — unknown options mutate the schema', () => {
    const STYLES = ['日系清新', '韩系唯美', '复古胶片'] as const;

    it('accepts configured options', () => {
      expect(toFeishuMultiSelect('风格定位', ['复古胶片'], { allowedOptions: STYLES })).toEqual([
        '复古胶片',
      ]);
    });

    it('wraps a single option into an array', () => {
      expect(toFeishuMultiSelect('风格定位', '日系清新', { allowedOptions: STYLES })).toEqual([
        '日系清新',
      ]);
    });

    it('fails closed on an unknown option rather than letting Feishu auto-create it', () => {
      expect(() =>
        toFeishuMultiSelect('风格定位', ['复古旗袍'], { allowedOptions: STYLES }),
      ).toThrow(FieldTypeMismatchError);
    });

    it('rejects a partially valid list — no silent partial write', () => {
      expect(() =>
        toFeishuMultiSelect('风格定位', ['复古胶片', 'OCR噪声'], { allowedOptions: STYLES }),
      ).toThrow(FieldTypeMismatchError);
    });

    it('rejects non-string entries', () => {
      expect(() => toFeishuMultiSelect('风格定位', [42], { allowedOptions: STYLES })).toThrow(
        FieldTypeMismatchError,
      );
    });
  });

  describe('toFeishuSingleSelect', () => {
    it('accepts a configured option', () => {
      expect(toFeishuSingleSelect('项目类型', '客片', { allowedOptions: ['客片', '创作'] })).toBe(
        '客片',
      );
    });

    it('fails closed on an unknown option', () => {
      expect(() =>
        toFeishuSingleSelect('项目类型', '商拍', { allowedOptions: ['客片', '创作'] }),
      ).toThrow(FieldTypeMismatchError);
    });
  });

  describe('toFeishuText', () => {
    it('trims and preserves text', () => {
      expect(toFeishuText('备注', '  客户备注  ')).toBe('客户备注');
    });

    it('coerces numbers and booleans', () => {
      expect(toFeishuText('备注', 42)).toBe('42');
      expect(toFeishuText('备注', true)).toBe('true');
    });

    it('rejects objects instead of writing "[object Object]"', () => {
      expect(() => toFeishuText('备注', { a: 1 })).toThrow(FieldTypeMismatchError);
    });

    it('maps blank strings to null so the field is omitted', () => {
      expect(toFeishuText('备注', '   ')).toBeNull();
    });
  });

  describe('redaction invariant', () => {
    it('never echoes the offending value in the error message or detail', () => {
      const secretish = '13800138000';
      let caught: FieldTypeMismatchError | undefined;
      try {
        toFeishuDateTime('拍摄档期', secretish);
      } catch (e) {
        caught = e as FieldTypeMismatchError;
      }

      expect(caught).toBeInstanceOf(FieldTypeMismatchError);
      expect(caught!.message).not.toContain(secretish);
      expect(JSON.stringify(caught!.toDetail('ing_1', ['拍摄档期']))).not.toContain(secretish);
      // The diagnostic still identifies the field and the shape mismatch.
      expect(caught!.message).toContain('拍摄档期');
      expect(caught!.toDetail('ing_1', ['拍摄档期'])).toMatchObject({
        internal_error_code: 'FIELD_TYPE_MISMATCH',
        offending_field: '拍摄档期',
        target_table: 'project',
      });
    });

    it('reports a relation display-name failure without leaking the name', () => {
      const name = '李女士';
      try {
        toFeishuRelation('关联客户 ID', name);
        throw new Error('expected a FieldTypeMismatchError');
      } catch (e) {
        expect(e).toBeInstanceOf(FieldTypeMismatchError);
        expect((e as Error).message).not.toContain(name);
      }
    });
  });

  describe('describeType', () => {
    it.each([
      [null, 'null'],
      [[], 'empty array'],
      [['a'], 'array<string>'],
      [new Date(), 'Date'],
      [1, 'number'],
      [{}, 'object'],
    ])('describes %s without echoing it', (value, expected) => {
      expect(describeType(value)).toBe(expected);
    });
  });
});
