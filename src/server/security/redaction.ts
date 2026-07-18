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

function isSensitiveKey(lower: string, sensitiveKeys: string[]): boolean {
  return sensitiveKeys.some((sk) => lower.includes(sk.toLowerCase()));
}

/**
 * Redaction mode propagated through recursion.
 *
 * - `default`: apply key-based sensitive handling (phone for `phone`/
 *   `mobile`, contact for `wechat`/`微信`/`联系方式`/`contact`, content
 *   for `content`/`原始文本`).
 * - `contact`: every nested string beneath a contact/wechat key must use
 *   `redactContactValue` so WeChat IDs inside arrays or nested objects
 *   are masked instead of falling back to `redactPhone` (TASK-002
 *   P0-01B).
 * - `content`: every nested string beneath a raw-text key uses
 *   `redactContent`.
 */
type RedactionMode = 'default' | 'contact' | 'content';

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
 * Recursively redact a value at any nesting level without mutating input.
 *
 * - Plain objects and arrays are traversed element-wise (returning fresh
 *   copies so the stored task is never mutated).
 * - Once a contact/wechat (or raw-text) key is encountered, the
 *   corresponding redaction mode is propagated to ALL descendants so
 *   arrays and nested objects beneath that key receive the same
 *   contact/content redaction instead of falling back to `redactPhone`
 *   (TASK-002 P0-01B).
 * - String values under a raw-text key (`content` / `原始文本`) are
 *   redacted with `redactContent`.
 * - String values under a WeChat/contact key (`wechat` / `微信` /
 *   `联系方式` / `contact`) are redacted with `redactContactValue`,
 *   which masks both phone numbers and non-phone WeChat IDs.
 * - String values under other sensitive keys (e.g. `phone` / `mobile`)
 *   are redacted with `redactPhone`.
 * - All other string values pass through `redactPhone` so a phone number
 *   embedded under a non-sensitive key (e.g. `evidence.budget`) is still
 *   masked at the response boundary.
 * - Pipeline evidence objects that carry a `field` sibling (e.g. entries
 *   inside `corrections[]`) propagate the field-indicated mode to their
 *   `original` and `corrected` values so contact PII copied into Pipeline
 *   evidence is masked at the response boundary (TASK-002 P0-01).
 */
function redactValueDeep(
  value: unknown,
  sensitiveKeys: string[],
  mode: RedactionMode = 'default'
): unknown {
  if (typeof value === 'string') {
    if (mode === 'contact') {
      return redactContactValue(value);
    }
    if (mode === 'content') {
      return redactContent(value);
    }
    return redactPhone(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValueDeep(v, sensitiveKeys, mode));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    // If this object is a Pipeline evidence entry with a `field` sibling
    // (e.g. an element of `corrections[]`), derive a mode from that field
    // name and apply it to `original`/`corrected` values. This masks
    // contact PII that the Pipeline copied into correction evidence.
    const fieldSibling = source['field'];
    let fieldMode: RedactionMode = 'default';
    if (typeof fieldSibling === 'string') {
      const fieldLower = fieldSibling.toLowerCase();
      if (isContactKey(fieldLower)) {
        fieldMode = 'contact';
      } else if (isContentKey(fieldLower)) {
        fieldMode = 'content';
      }
    }

    for (const key of Object.keys(source)) {
      const lower = key.toLowerCase();
      const v = source[key];
      const contactKey = isContactKey(lower);
      const contentKey = isContentKey(lower);

      // `original`/`corrected` inside a Pipeline evidence entry inherit
      // the mode indicated by the sibling `field` property. Without this,
      // a WeChat ID copied into `corrections[].original` would leak
      // through the GET response (TASK-002 P0-01 residual).
      if (
        fieldMode !== 'default' &&
        (lower === 'original' || lower === 'corrected')
      ) {
        result[key] = redactValueDeep(v, sensitiveKeys, fieldMode);
        continue;
      }

      if (typeof v === 'string' && isSensitiveKey(lower, sensitiveKeys)) {
        // Direct string value under a sensitive key. Mode is determined
        // by the key itself (the direct-value branch does not inherit
        // parent mode, matching pre-fix behavior for top-level sensitive
        // strings).
        if (contentKey) {
          result[key] = redactContent(v);
        } else if (contactKey) {
          result[key] = redactContactValue(v);
        } else {
          result[key] = redactPhone(v);
        }
      } else {
        // Non-string value (array/object) or non-sensitive key. Propagate
        // the appropriate mode so descendants of a contact/content key
        // keep using contact/content redaction at any depth.
        let childMode: RedactionMode = mode;
        if (contactKey) {
          childMode = 'contact';
        } else if (contentKey) {
          childMode = 'content';
        }
        result[key] = redactValueDeep(v, sensitiveKeys, childMode);
      }
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
