export function redactPhone(value: string): string {
  if (typeof value !== 'string') return value;
  // Match 11-digit Chinese mobile numbers (with optional +86 / 86 prefix).
  // The prefix is consumed but not included in the masked output so the
  // result is always the 11-digit number in `XXX****XXXX` form.
  return value.replace(/(\+?86)?(1[3-9]\d{9})/g, (_match, _prefix, number: string) => {
    const last4 = number.slice(-4);
    return `${number.slice(0, 3)}****${last4}`;
  });
}

/**
 * Redact a WeChat ID while preserving its first and last two characters.
 * Middle characters are replaced with `*`. IDs of length 4 or less must
 * never be returned as-is; they are fully masked.
 *
 * Rule source: `docs/PHASE2_DATA_CONTRACTS.md` §5.
 */
export function redactWechatId(value: string): string {
  if (typeof value !== 'string') return value;
  if (value.length === 0) return value;
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }
  const head = value.slice(0, 2);
  const tail = value.slice(-2);
  const middle = '*'.repeat(value.length - 4);
  return `${head}${middle}${tail}`;
}

/**
 * Labels/punctuation that may legitimately accompany a pure phone value
 * (e.g. `电话13800138000`, `联系方式: 13800138000`). These are stripped
 * when deciding whether a phone-bearing contact string is "pure phone" or
 * "mixed/ambiguous". Anything left after this stripping indicates the
 * value carries additional contact tokens (e.g. a WeChat ID) and must be
 * treated as fail-closed per TASK-002 P0-01A.
 */
const CONTACT_LABEL_PATTERN = /电话|手机|联系方式|微信|wechat|联系|contact/gi;
const CONTACT_SEPARATOR_PATTERN = /[\s:：,，、;；\-_()+]/g;

/**
 * Redact a contact-string value that may carry a phone number, a
 * non-phone WeChat ID, or both. Behavior:
 *
 * - No phone pattern → treat as a pure WeChat ID; apply `redactWechatId`
 *   (first/last 2 chars preserved, middle masked).
 * - Phone pattern present AND stripping phones + labels + separators
 *   leaves nothing → pure phone (with optional labels/punctuation); apply
 *   `redactPhone` to preserve the existing `XXX****XXXX` format.
 * - Phone pattern present but residual content remains → mixed/ambiguous;
 *   fail closed by masking the whole value. Returning any unmasked
 *   residual contact token is forbidden (TASK-002 P0-01A).
 */
function redactContactValue(value: string): string {
  if (typeof value !== 'string') return value;
  if (value.length === 0) return value;

  const phonePattern = /(\+?86)?(1[3-9]\d{9})/g;
  const hasPhone = phonePattern.test(value);
  phonePattern.lastIndex = 0;

  if (!hasPhone) {
    return redactWechatId(value);
  }

  // Strip phone patterns, labels, and separators. Any residual non-empty
  // content means the value is mixed/ambiguous and must be fail-closed.
  const residual = value
    .replace(phonePattern, '')
    .replace(CONTACT_LABEL_PATTERN, '')
    .replace(CONTACT_SEPARATOR_PATTERN, '')
    .trim();

  if (residual.length === 0) {
    return redactPhone(value);
  }

  // Mixed/ambiguous contact string → fail closed. Whole-value masking
  // guarantees no residual WeChat ID or other contact token survives.
  return '*'.repeat(value.length);
}

export function redactContent(value: string, maxLength: number = 200): string {
  if (typeof value !== 'string') return value;
  let redacted = redactPhone(value);
  if (redacted.length > maxLength) {
    redacted = redacted.slice(0, maxLength) + '... [truncated]';
  }
  return redacted;
}

/**
 * Matches absolute path-like substrings that could leak local filesystem
 * layout through attacker-controlled warning text. Relative paths without a
 * leading separator are intentionally NOT matched so normal field names
 * (e.g. `style_preferences`, `unknown_field`) are left intact.
 * Examples covered: `/usr/local/...`, `C:\Users\...`, `/etc/passwd`.
 */
const PATH_PATTERN = /(?:[A-Za-z]:[\\/][^\s"'<>]+|\/[^\s"'<>]+)/g;

/**
 * Sanitize a string that may carry attacker-controlled PII or local paths.
 * Used for mapper warning `field` and `message` before persistence so an
 * unknown Candidate key cannot smuggle a phone number or a local path
 * through the warning object.
 */
export function sanitizeWarningText(value: string): string {
  if (typeof value !== 'string') return value;
  let sanitized = redactPhone(value);
  sanitized = sanitized.replace(PATH_PATTERN, '<PATH>');
  return sanitized;
}

/**
 * Redaction mode propagated through recursion.
 *
 * Sensitivity is monotonic — `contact > content > default` — and once a
 * mode is selected it can never be downgraded by a nested key:
 *
 * - `default`: apply key-based sensitive handling (phone for `phone`/
 *   `mobile`, contact for `wechat`/`微信`/`联系方式`/`contact`, content
 *   for `content`/`原始文本`). Structural IDs are preserved only when
 *   the current key is a trusted contract ID field (see
 *   `TRUSTED_STRUCTURAL_ID_KEYS`).
 * - `contact`: every nested string beneath a contact/wechat key must use
 *   `redactContactValue` so WeChat IDs inside arrays or nested objects
 *   are masked instead of falling back to `redactPhone` (TASK-002
 *   P0-01B). Parent contact mode is authoritative for all descendant
 *   strings; nested sensitive child keys (`content`/`phone`/`mobile`/
 *   `原始文本`) must not downgrade it (TASK-002 P0-01C). A nested
 *   contact key beneath a content parent must also upgrade to contact
 *   (TASK-002 P0-01D).
 * - `content`: every nested string beneath a raw-text key uses
 *   `redactContent`. Parent content mode is similarly authoritative for
 *   ordinary descendants, but a nested contact key upgrades the mode to
 *   `contact` (P0-01D).
 */
type RedactionMode = 'default' | 'contact' | 'content';

/**
 * Matches structural identifier values that may be preserved at the
 * response boundary. Default phone-number scanning must not mutate IDs
 * like `ing_2e042890392546c19181507170127599` even though they contain
 * an 11-digit substring matching `1[3-9]\d{9}` (TASK-002 P0-04).
 *
 * Value-shape recognition is necessary but NOT sufficient. Preservation
 * additionally requires the current key to be a trusted contract ID
 * field (see `TRUSTED_STRUCTURAL_ID_KEYS`). Attacker-controlled unknown
 * Candidate/evidence strings must continue through `redactPhone` even
 * when they happen to match this pattern (TASK-002 P0-04B).
 *
 * Covered shapes:
 * - Prefixed opaque IDs: `<alpha>_<alphanumeric>` (e.g. `ing_<hex>`,
 *   `rec_001`, `reviewer_1`).
 * - 32-char hex (UUID without dashes, e.g. ingestion_id body).
 * - 64-char hex (SHA-256 idempotency key).
 * - Canonical UUID with dashes (memory-mode review_record_id).
 *
 * Free-text strings (containing spaces, CJK characters, or multiple
 * underscore-separated tokens) do not match, so embedded phone numbers
 * in non-sensitive free-text fields are still masked at the response
 * boundary.
 */
const STRUCTURAL_ID_PATTERN = /^(?:[a-zA-Z]+_[a-zA-Z0-9]+|[a-f0-9]{32}|[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;

function isStructuralId(value: string): boolean {
  return STRUCTURAL_ID_PATTERN.test(value);
}

/**
 * Trusted response-contract ID field names. Structural-ID preservation
 * at the response boundary applies only when the current key is in this
 * set AND the value matches `STRUCTURAL_ID_PATTERN`. Candidate `fields`
 * and `evidence` are attacker-controlled (`z.record(z.unknown())`), so
 * arbitrary `*_id` keys there must NOT be trusted (TASK-002 P0-04B).
 */
const TRUSTED_STRUCTURAL_ID_KEYS = new Set([
  'ingestion_id',
  'idempotency_key',
  'review_record_id',
  'source_record_id',
  'workflow_run_id',
  'reviewer_id',
  'business_record_id',
]);

function isTrustedStructuralIdKey(lower: string): boolean {
  return TRUSTED_STRUCTURAL_ID_KEYS.has(lower);
}

function isContactKey(lower: string): boolean {
  return (
    lower.includes('wechat') ||
    lower.includes('微信') ||
    lower.includes('联系方式') ||
    lower.includes('contact')
  );
}

function isContentKey(lower: string): boolean {
  return lower.includes('content') || lower.includes('原始文本');
}

/**
 * Centralized redaction-mode resolution. Sensitivity is monotonic:
 * `contact > content > default`. Inherited contact can never be
 * downgraded; inherited content can be upgraded to contact by a nested
 * contact key; otherwise the parent mode is preserved. In default mode
 * a contact/content child key upgrades the mode accordingly (P0-01D).
 */
function resolveRedactionMode(
  parentMode: RedactionMode,
  lowerKey: string
): RedactionMode {
  if (parentMode === 'contact' || isContactKey(lowerKey)) {
    return 'contact';
  }
  if (parentMode === 'content' || isContentKey(lowerKey)) {
    return 'content';
  }
  return 'default';
}

/**
 * Centralized string-value redaction. Contact/content modes always
 * apply their PII policy regardless of trusted-ID context. Only default
 * mode may preserve structural IDs, and only when the caller has
 * established a trusted key context (P0-04 / P0-04B).
 */
function redactStringValue(
  value: string,
  mode: RedactionMode,
  trustedStructuralIdContext: boolean
): string {
  if (mode === 'contact') {
    return redactContactValue(value);
  }
  if (mode === 'content') {
    return redactContent(value);
  }
  if (trustedStructuralIdContext && isStructuralId(value)) {
    return value;
  }
  return redactPhone(value);
}

/**
 * Recursively redact a value at any nesting level without mutating input.
 *
 * - Plain objects and arrays are traversed element-wise (returning fresh
 *   copies so the stored task is never mutated).
 * - Redaction mode is resolved through `resolveRedactionMode()` and is
 *   monotonic: `contact > content > default`. Inherited contact/content
 *   modes are authoritative for descendant strings; a nested contact key
 *   upgrades an inherited content mode to contact (P0-01C / P0-01D).
 * - Structural-ID preservation requires both a trusted contract ID key
 *   (`TRUSTED_STRUCTURAL_ID_KEYS`) and a matching value shape
 *   (`STRUCTURAL_ID_PATTERN`). Trusted context propagates through
 *   arrays but NOT through arbitrary nested object keys, since each
 *   object key starts a fresh key-context evaluation (P0-04 / P0-04B).
 * - Pipeline evidence objects that carry a `field` sibling (e.g. entries
 *   inside `corrections[]`) propagate the field-indicated mode to their
 *   `original` and `corrected` values so contact PII copied into Pipeline
 *   evidence is masked at the response boundary (TASK-002 P0-01).
 */
function redactValueDeep(
  value: unknown,
  sensitiveKeys: string[],
  mode: RedactionMode = 'default',
  trustedStructuralIdContext: boolean = false
): unknown {
  if (typeof value === 'string') {
    return redactStringValue(value, mode, trustedStructuralIdContext);
  }
  if (Array.isArray(value)) {
    // Arrays propagate both the inherited mode and the trusted-ID context
    // to every element. Object elements start their own key-based context
    // inside the object branch below.
    return value.map((v) =>
      redactValueDeep(v, sensitiveKeys, mode, trustedStructuralIdContext)
    );
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    // If this object is a Pipeline evidence entry with a `field` sibling
    // (e.g. an element of `corrections[]`), derive a mode from that field
    // name using the same monotonic resolver and apply it to
    // `original`/`corrected` values. This masks contact PII that the
    // Pipeline copied into correction evidence.
    const fieldSibling = source['field'];
    const fieldMode =
      typeof fieldSibling === 'string'
        ? resolveRedactionMode(mode, fieldSibling.toLowerCase())
        : mode;

    for (const key of Object.keys(source)) {
      const lower = key.toLowerCase();
      const v = source[key];

      // `original`/`corrected` inside a Pipeline evidence entry inherit
      // the mode indicated by the sibling `field` property. Without this,
      // a WeChat ID copied into `corrections[].original` would leak
      // through the GET response (TASK-002 P0-01 residual). Pipeline
      // evidence is never a trusted ID context.
      if (
        typeof fieldSibling === 'string' &&
        (lower === 'original' || lower === 'corrected')
      ) {
        result[key] = redactValueDeep(v, sensitiveKeys, fieldMode, false);
        continue;
      }

      // Single centralized decision: resolve the child mode (monotonic)
      // and compute a fresh trusted-ID context that applies ONLY when
      // this child key itself is a trusted contract ID field and the
      // resolved mode is default. Trusted context does NOT propagate
      // through arbitrary nested object keys.
      const valueMode = resolveRedactionMode(mode, lower);
      const childTrustedIdContext =
        valueMode === 'default' && isTrustedStructuralIdKey(lower);

      result[key] = redactValueDeep(
        v,
        sensitiveKeys,
        valueMode,
        childTrustedIdContext
      );
    }
    return result;
  }
  return value;
}

export function redactObject(
  obj: Record<string, unknown>,
  sensitiveKeys: string[] = [
    'phone',
    '联系方式',
    'contact',
    'mobile',
    'wechat',
    '微信',
    'content',
    '原始文本',
  ]
): Record<string, unknown> {
  return redactValueDeep(obj, sensitiveKeys) as Record<string, unknown>;
}
