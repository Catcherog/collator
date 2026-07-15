export function redactPhone(value: string): string {
  if (typeof value !== 'string') return value;
  // Match 11-digit Chinese mobile numbers
  return value.replace(/(\+?86)?1[3-9]\d{9}/g, (match) => {
    const digits = match.replace(/\D/g, '');
    const last4 = digits.slice(-4);
    return `${digits.slice(0, 3)}****${last4}`;
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

export function redactObject(
  obj: Record<string, unknown>,
  sensitiveKeys: string[] = ['phone', '联系方式', 'mobile', 'wechat', '微信', 'content', '原始文本']
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    const value = obj[key];
    if (
      sensitiveKeys.some((sk) => lower.includes(sk.toLowerCase())) &&
      typeof value === 'string'
    ) {
      result[key] = lower.includes('content') || lower.includes('原始文本')
        ? redactContent(value)
        : redactPhone(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
