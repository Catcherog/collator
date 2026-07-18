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
 * Redact a contact-string value that may carry a phone number or a
 * non-phone WeChat ID. Phone numbers are masked first; if no phone pattern
 * was found the value is treated as a WeChat ID and masked with
 * `redactWechatId`. This ensures both `13800138000` and
 * `wechat_secret_01` are masked under the same contact key.
 */
function redactContactValue(value: string): string {
  const phoneRedacted = redactPhone(value);
  if (phoneRedacted !== value) {
    return phoneRedacted;
  }
  return redactWechatId(value);
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
        if (lower.includes('content') || lower.includes('原始文本')) {
          result[key] = redactContent(v);
        } else if (
          lower.includes('wechat') ||
          lower.includes('微信') ||
          lower.includes('联系方式') ||
          lower.includes('contact')
        ) {
          result[key] = redactContactValue(v);
        } else {
          result[key] = redactPhone(v);
        }
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
