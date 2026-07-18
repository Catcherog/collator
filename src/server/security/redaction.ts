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
 * Recursively redact a value at any nesting level without mutating input.
 *
 * - Plain objects and arrays are traversed element-wise (returning fresh
 *   copies so the stored task is never mutated).
 * - String values under a sensitive key are redacted with `redactPhone` (or
 *   `redactContent` for raw-text keys).
 * - All other string values pass through `redactPhone` so a phone number
 *   embedded under a non-sensitive key (e.g. `evidence.budget`) is still
 *   masked at the response boundary.
 */
function redactValueDeep(value: unknown, sensitiveKeys: string[]): unknown {
  if (typeof value === 'string') {
    return redactPhone(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValueDeep(v, sensitiveKeys));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const lower = key.toLowerCase();
      const v = source[key];
      if (typeof v === 'string' && isSensitiveKey(lower, sensitiveKeys)) {
        result[key] =
          lower.includes('content') || lower.includes('原始文本')
            ? redactContent(v)
            : redactPhone(v);
      } else {
        result[key] = redactValueDeep(v, sensitiveKeys);
      }
    }
    return result;
  }
  return value;
}

export function redactObject(
  obj: Record<string, unknown>,
  sensitiveKeys: string[] = ['phone', '联系方式', 'mobile', 'wechat', '微信', 'content', '原始文本']
): Record<string, unknown> {
  return redactValueDeep(obj, sensitiveKeys) as Record<string, unknown>;
}
