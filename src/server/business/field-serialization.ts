// field-serialization.ts
//
// Writer-boundary explicit serialization + validation for Feishu Bitable
// field types.
//
// WHY THIS EXISTS
// ---------------
// Feishu's Create Record API is asymmetrically strict:
//
//   * DateTime  — rejects anything that is not epoch milliseconds with
//                 `1254064 DatetimeFieldConvFail`. A raw string such as
//                 "8月15日" produced by OCR therefore surfaced as an opaque
//                 FEISHU_COMMIT_FAILED.
//   * Link      — ACCEPTS a display name and then *silently drops it*
//                 (readback shows `record_ids: null`). No error is raised, so
//                 a bad relation is invisible without post-write verification.
//   * MultiSelect — ACCEPTS an unknown option and *auto-creates* it, silently
//                 mutating the table schema.
//
// Passing values through and "letting Feishu reject them" is therefore unsafe:
// two of the three cases are not rejected at all. Every value is normalised
// and validated here, before the API call, and anything that cannot be
// represented fails closed with a precise diagnostic.
//
// The module never strips an offending field and retries — silent field
// removal would turn a data defect into a phantom success.

import { FieldTypeMismatchError } from '../domain/errors.js';

export type WriteTargetTable = 'customer' | 'project' | 'model';

/**
 * Feishu record ids are `rec` + an opaque token. The guard exists to reject
 * *display names* (e.g. a customer's name coming straight out of OCR), which
 * Feishu accepts and then silently stores as an empty relation.
 *
 * It deliberately does NOT try to be a base62 checker: the exact alphabet is
 * not contractual, and internal fixtures/back-office exports legitimately use
 * `-` / `_` separators. Anything without the `rec` prefix is still rejected,
 * which is the failure mode actually observed against the live Base.
 */
const RECORD_ID_PATTERN = /^rec[A-Za-z0-9_-]+$/;

/** Describe a value's runtime type without ever echoing the value itself. */
export function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? 'empty array' : `array<${describeType(value[0])}>`;
  }
  if (value instanceof Date) return 'Date';
  return typeof value;
}

/**
 * Strict, timezone-stable date normalisation to epoch milliseconds (UTC
 * midnight of the calendar day).
 *
 * `Date.parse` is deliberately NOT used as a fallback: it silently accepts
 * US-style "8/10" as August 10 *2001*, which would write a plausible-looking
 * but wrong date into a business table.
 *
 * Accepted inputs:
 *   - number                      → treated as epoch ms (validated range)
 *   - Date                        → getTime()
 *   - "YYYY-MM-DD" / "YYYY-M-D"
 *   - "YYYY/MM/DD" / "YYYY/M/D"
 *   - "YYYY年M月D日"
 *   - "YYYY.M.D"
 *   - "M月D日"       → resolved against `referenceDate`'s year
 *   - full ISO 8601 datetime with an explicit timezone or 'Z'
 *
 * Returns `null` when the input is absent (caller omits the field).
 * Throws FieldTypeMismatchError when the input is present but not a date.
 */
export function toFeishuDateTime(
  fieldName: string,
  value: unknown,
  options: { targetTable?: WriteTargetTable; referenceDate?: Date } = {},
): number | null {
  const targetTable = options.targetTable ?? 'project';
  const reject = (): never => {
    throw new FieldTypeMismatchError(
      fieldName,
      'epoch milliseconds (number) or a resolvable date string',
      describeType(value),
      targetTable,
    );
  };

  if (value === undefined || value === null) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject();
    return value;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) reject();
    return ms;
  }

  if (typeof value !== 'string') reject();

  const text = (value as string).trim();
  if (text.length === 0) return null;

  // All-digit strings are epoch values (seconds or milliseconds).
  if (/^\d{10}$/.test(text)) return Number(text) * 1000;
  if (/^\d{13}$/.test(text)) return Number(text);

  // Full ISO 8601 with explicit timezone — unambiguous, safe to delegate.
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) reject();
    return ms;
  }

  const yearMonthDay =
    text.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
  if (yearMonthDay) {
    return buildUtcDate(
      Number(yearMonthDay[1]),
      Number(yearMonthDay[2]),
      Number(yearMonthDay[3]),
      reject,
    );
  }

  // Year-less Chinese form "8月15日". Booking screenshots routinely omit the
  // year; resolving against the reference year is documented behaviour.
  const monthDay = text.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (monthDay) {
    const reference = options.referenceDate ?? new Date();
    return buildUtcDate(
      reference.getUTCFullYear(),
      Number(monthDay[1]),
      Number(monthDay[2]),
      reject,
    );
  }

  // Anything else (relative expressions like "下周六", free text, partial
  // dates) is NOT guessed. It fails closed so the operator can correct it.
  return reject();
}

function buildUtcDate(
  year: number,
  month: number,
  day: number,
  reject: () => never,
): number {
  if (month < 1 || month > 12 || day < 1 || day > 31) reject();
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  // Guards against overflow such as 2 月 30 日 rolling into March.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    reject();
  }
  return ms;
}

/**
 * Normalise a Link / DuplexLink value to an array of Feishu record ids.
 *
 * Display names are rejected rather than passed through: Feishu accepts them
 * and silently stores an empty relation, which would otherwise only be caught
 * (if at all) by post-write verification.
 */
export function toFeishuRelation(
  fieldName: string,
  value: unknown,
  options: { targetTable?: WriteTargetTable } = {},
): string[] | null {
  const targetTable = options.targetTable ?? 'project';
  if (value === undefined || value === null) return null;

  const candidates = Array.isArray(value) ? value : [value];
  if (candidates.length === 0) return null;

  const ids: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !RECORD_ID_PATTERN.test(candidate)) {
      throw new FieldTypeMismatchError(
        fieldName,
        'array of Feishu record ids (rec...)',
        typeof candidate === 'string' ? 'string (not a record id)' : describeType(candidate),
        targetTable,
      );
    }
    ids.push(candidate);
  }
  return ids;
}

/**
 * Normalise a MultiSelect value to a string array.
 *
 * When `allowedOptions` is supplied, unknown options fail closed instead of
 * being auto-created by Feishu — auto-creation silently mutates the table
 * schema and pollutes the option list with OCR noise.
 */
export function toFeishuMultiSelect(
  fieldName: string,
  value: unknown,
  options: { targetTable?: WriteTargetTable; allowedOptions?: readonly string[] } = {},
): string[] | null {
  const targetTable = options.targetTable ?? 'project';
  if (value === undefined || value === null) return null;

  const raw = Array.isArray(value) ? value : [value];
  const items: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      throw new FieldTypeMismatchError(
        fieldName,
        'array of option names (string[])',
        describeType(entry),
        targetTable,
      );
    }
    const trimmed = entry.trim();
    if (trimmed.length > 0) items.push(trimmed);
  }
  if (items.length === 0) return null;

  if (options.allowedOptions && options.allowedOptions.length > 0) {
    const allowed = new Set(options.allowedOptions);
    const unknown = items.filter((item) => !allowed.has(item));
    if (unknown.length > 0) {
      throw new FieldTypeMismatchError(
        fieldName,
        `one of the configured options [${options.allowedOptions.join(' | ')}]`,
        `string (unrecognised option, count=${unknown.length})`,
        targetTable,
      );
    }
  }
  return items;
}

/**
 * Normalise a SingleSelect value, validating against the allowed option list
 * when one is configured.
 */
export function toFeishuSingleSelect(
  fieldName: string,
  value: unknown,
  options: { targetTable?: WriteTargetTable; allowedOptions?: readonly string[] } = {},
): string | null {
  const targetTable = options.targetTable ?? 'project';
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new FieldTypeMismatchError(
      fieldName,
      'option name (string)',
      describeType(value),
      targetTable,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (options.allowedOptions && options.allowedOptions.length > 0) {
    if (!options.allowedOptions.includes(trimmed)) {
      throw new FieldTypeMismatchError(
        fieldName,
        `one of the configured options [${options.allowedOptions.join(' | ')}]`,
        'string (unrecognised option)',
        targetTable,
      );
    }
  }
  return trimmed;
}

/**
 * Normalise a Text value. Objects/arrays are rejected instead of being
 * stringified into `[object Object]`.
 */
export function toFeishuText(
  fieldName: string,
  value: unknown,
  options: { targetTable?: WriteTargetTable } = {},
): string | null {
  const targetTable = options.targetTable ?? 'project';
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new FieldTypeMismatchError(
    fieldName,
    'text (string)',
    describeType(value),
    targetTable,
  );
}
