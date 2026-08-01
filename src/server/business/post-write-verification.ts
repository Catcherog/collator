/**
 * Compare the fields that the writer intended to persist with the fields read
 * back from Feishu. The error is deliberately generic so a mismatched value
 * (which may contain PII) is never copied into logs or API responses.
 */
export class PostWriteVerificationError extends Error {
  readonly code = 'POST_WRITE_VERIFY_FAILED';

  constructor(
    readonly recordId: string,
    readonly created: boolean
  ) {
    super('Post-write verification failed');
    this.name = 'PostWriteVerificationError';
  }
}

export function assertExpectedFields(
  actualFields: Record<string, unknown>,
  expectedFields: Record<string, unknown>
): void {
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (expected === undefined || expected === null) continue;
    if (!valuesEqual(normalizeValue(actualFields[field]), normalizeValue(expected))) {
      throw new Error('Post-write verification failed: key fields do not match');
    }
  }
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    // Feishu link fields may read back as [{ record_id, text }] even when
    // the write payload used a plain record_id array. Verify the structural
    // relation ID, never the display label.
    if (typeof object.record_id === 'string') {
      return object.record_id;
    }
    if (typeof object.text === 'string' && Object.keys(object).every((key) => key === 'text')) {
      return object.text;
    }
    return Object.fromEntries(
      Object.entries(object)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeValue(item)])
    );
  }
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
