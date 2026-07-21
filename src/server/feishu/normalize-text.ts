// normalize-text.ts
// Shared normalisers for Feishu Base text field values.
//
// Feishu Base multi-line text fields (type=1) can be returned by the API in
// three legal shapes depending on the `text_field_as_array` query parameter
// and on whether the field was written as a single segment or as rich text:
//   - string                    (when text_field_as_array=false)
//   - { text: string }          (single-segment rich text)
//   - Array<{ text: string }>   (multi-segment rich text; also the default
//                                when text_field_as_array is not specified)
//
// Repository adapters must defensively handle all three shapes because the
// API default may change and because not all call sites set the parameter
// explicitly. This shared normaliser replaces the per-repository
// `readScalar` / `readOptionalScalar` ad-hoc logic that was inconsistent
// across FeishuTaskRepository, FeishuReviewRepository and
// FeishuWriteLogRepository (TASK-003-GATE-D-TEXT-NORMALIZATION AC-01/AC-05).
//
// Design constraints (per task card):
//   - Never silently coerce null/undefined/empty-array to the string
//     "undefined" or to empty JSON.
//   - Never silently coerce non-text nodes (e.g. { text: 123 }) via
//     String(value); reject them with a diagnostic error.
//   - Error messages must include repository, field name, and record_id
//     (when available) to aid diagnosis.
//   - Error messages must NOT include Secret/Token or full sensitive
//     business data; only structural descriptions are echoed.

/**
 * Context for normalising Feishu text field values.
 */
export interface NormalizeContext {
  /** Repository name for diagnostics, e.g. 'FeishuTaskRepository'. */
  repository: string;
  /** Feishu field name for diagnostics, e.g. '任务快照 JSON'. */
  fieldName: string;
  /** Feishu record_id for diagnostics (optional for new records). */
  recordId?: string;
  /**
   * Whether the field is required. When true, null/undefined/empty-array
   * throw a diagnostic error. When false, they return undefined.
   */
  required: boolean;
}

/**
 * Error class for normalisation failures. Includes full diagnostic context
 * (repository, fieldName, recordId) but never the raw value, so PII and
 * secrets never leak through error messages.
 */
export class NormalizeTextError extends Error {
  constructor(ctx: NormalizeContext, reason: string) {
    const location = ctx.recordId
      ? `record ${ctx.recordId}`
      : 'new record (no record_id)';
    super(
      `${ctx.repository}: field "${ctx.fieldName}" on ${location} — ${reason}`
    );
    this.name = 'NormalizeTextError';
  }
}

/**
 * Normalise a Feishu text field value to a string (or undefined when the
 * value is absent and the field is optional).
 *
 * Supported input shapes:
 *   - string                     -> returned as-is
 *   - { text: string }           -> returns text
 *   - Array<{ text: string }>    -> concatenates all text segments in order
 *   - null / undefined / []      -> throws if required, else returns undefined
 *
 * Unsupported shapes (throw a diagnostic error):
 *   - { text: non-string }       e.g. { text: 123 }
 *   - Array containing non-{text:string} elements
 *   - Plain objects without a `text` property
 *   - Primitives other than string (number, boolean, etc.)
 *
 * The error message includes repository, fieldName, and recordId (when
 * available) but never echoes the raw value (which may contain PII).
 *
 * Note: this function does NOT trim the result. Trimming is the caller's
 * responsibility so that domain-specific semantics (e.g. idempotency-key
 * comparison) are not silently changed.
 */
export function normalizeFeishuText(
  value: unknown,
  ctx: NormalizeContext
): string | undefined {
  // Step 1: handle absent values. null/undefined/empty-array are "absent".
  if (value === null || value === undefined) {
    if (ctx.required) {
      throw new NormalizeTextError(
        ctx,
        `required field is ${value === null ? 'null' : 'undefined'}`
      );
    }
    return undefined;
  }

  // Step 2: handle string (the simplest case).
  if (typeof value === 'string') {
    return value;
  }

  // Step 3: handle array. Empty array is treated as absent.
  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (ctx.required) {
        throw new NormalizeTextError(ctx, 'required field is empty array');
      }
      return undefined;
    }
    // Concatenate all {text: string} elements in order. Reject any element
    // that is not a {text: string} object.
    let result = '';
    for (let i = 0; i < value.length; i++) {
      const elem = value[i];
      result += extractTextFromObject(elem, ctx, `array index ${i}`);
    }
    return result;
  }

  // Step 4: handle single object {text: string}.
  if (typeof value === 'object') {
    return extractTextFromObject(value, ctx, 'object');
  }

  // Step 5: reject any other primitive (number, boolean, etc.).
  throw new NormalizeTextError(
    ctx,
    `unsupported value type ${typeof value}`
  );
}

/**
 * Extract the `text` property from an object, ensuring it is a string.
 * Throws a diagnostic error if the object has no `text` property or the
 * property is not a string.
 *
 * The `location` parameter describes where this object was found (e.g.
 * 'object', 'array index 2') for more precise diagnostics.
 *
 * This never calls String(value) on non-string text — doing so would
 * silently coerce {text: 123} to "123", masking schema errors.
 */
function extractTextFromObject(
  obj: unknown,
  ctx: NormalizeContext,
  location: string
): string {
  if (obj === null || typeof obj !== 'object') {
    throw new NormalizeTextError(
      ctx,
      `expected object at ${location} but got ${obj === null ? 'null' : typeof obj}`
    );
  }
  const record = obj as Record<string, unknown>;
  if (!('text' in record)) {
    throw new NormalizeTextError(
      ctx,
      `object at ${location} has no 'text' property (keys: ${Object.keys(record).join(',') || 'none'})`
    );
  }
  const text = record.text;
  if (typeof text !== 'string') {
    throw new NormalizeTextError(
      ctx,
      `object at ${location} has 'text' of type ${typeof text} (expected string)`
    );
  }
  return text;
}

/**
 * Normalise a Feishu text field value and parse it as JSON.
 *
 * This is a two-step process:
 *   1. Normalise the value to a string (using normalizeFeishuText).
 *   2. Parse the string as JSON.
 *
 * Errors are clearly distinguished:
 *   - Text structure errors (cannot normalise) come from normalizeFeishuText
 *     and do NOT mention "JSON parse".
 *   - JSON parse errors mention "JSON parse failed" so callers can tell
 *     them apart from text structure errors.
 *
 * The JSON content is never altered — no re-serialisation, no Unicode
 * normalisation. JSON.parse preserves all characters and structure, and
 * naturally tolerates leading/trailing whitespace.
 *
 * For optional fields (required=false), absent values return undefined.
 * For required fields, absent values or invalid JSON throw.
 *
 * This function does NOT swallow JSON parse errors. A broken JSON payload
 * (e.g. "{broken") will throw even when the text could be extracted, so
 * that schema corruption is not masked by compatibility logic.
 */
export function normalizeFeishuJson<T = unknown>(
  value: unknown,
  ctx: NormalizeContext
): T | undefined {
  // Step 1: normalise to string. For optional fields, absent values
  // return undefined and we propagate that.
  const text = normalizeFeishuText(value, ctx);
  if (text === undefined) {
    return undefined;
  }

  // Step 2: parse as JSON. JSON.parse naturally handles leading/trailing
  // whitespace and preserves all Unicode characters and escape sequences.
  // It does not alter the parsed object's content.
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    // Distinguish JSON parse errors from text structure errors by
    // mentioning "JSON parse failed" in the message. The original parse
    // error message is included for diagnosis but contains no business
    // data (it only mentions position and syntax).
    throw new NormalizeTextError(
      ctx,
      `JSON parse failed: ${(e as Error).message}`
    );
  }
}
