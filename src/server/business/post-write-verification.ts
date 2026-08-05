/**
 * Compare the fields that the writer intended to persist with the fields read
 * back from Feishu. The error is deliberately generic so a mismatched value
 * (which may contain PII) is never copied into logs or API responses.
 */
export interface PostWriteVerificationErrorOptions {
  verificationStage?: string;
  table?: string;
  fieldName?: string;
  reason?: string;
}

export class PostWriteVerificationError extends Error {
  readonly code = 'POST_WRITE_VERIFY_FAILED';
  readonly verificationStage?: string;
  readonly table?: string;
  readonly fieldName?: string;
  readonly reason?: string;

  constructor(
    readonly recordId: string,
    readonly created: boolean,
    options?: PostWriteVerificationErrorOptions
  ) {
    super('Post-write verification failed');
    this.name = 'PostWriteVerificationError';
    this.verificationStage = options?.verificationStage;
    this.table = options?.table;
    this.fieldName = options?.fieldName;
    this.reason = options?.reason;
  }
}

export function assertExpectedFields(
  actualFields: Record<string, unknown>,
  expectedFields: Record<string, unknown>
): void {
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (expected === undefined || expected === null) continue;
    if (!valuesEqual(normalizeValue(actualFields[field]), normalizeValue(expected))) {
      throw new PostWriteVerificationError('unknown', false, {
        verificationStage: 'field_comparison',
        fieldName: field,
        reason: 'normalized_values_do_not_match',
      });
    }
  }
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeValue(item));
    // Feishu link fields may wrap linked record IDs as {record_ids: string[]}
    // or as {id, text, table_id, type}. Flatten relation shapes so each
    // linked ID becomes a comparable string; other arrays retain their shape.
    // Sort for order-independent comparison.
    if (value.some(isLinkValue)) {
      return normalized
        .flat()
        .sort((left, right) => String(left).localeCompare(String(right)));
    }
    return normalized.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    // Feishu link fields may read back as [{ record_id, text }] even when
    // the write payload used a plain record_id array. Verify the structural
    // relation ID, never the display label.
    if (typeof object.record_id === 'string') {
      return object.record_id;
    }
    if (
      Array.isArray(object.record_ids) &&
      object.record_ids.every((recordId) => typeof recordId === 'string')
    ) {
      return object.record_ids;
    }
    // Feishu relation fields also read back as [{ id, text, table_id, type }].
    // Require structural features beyond a bare `id` to avoid false-positive
    // matches on ordinary business objects that happen to contain an `id`.
    if (
      typeof object.id === 'string' &&
      (typeof object.text === 'string' ||
        typeof object.table_id === 'string' ||
        object.type === 'url')
    ) {
      return object.id;
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

function isLinkValue(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return (
    typeof object.record_id === 'string' ||
    Array.isArray(object.record_ids) ||
    isFeishuRelationObject(object)
  );
}

function isFeishuRelationObject(object: Record<string, unknown>): boolean {
  return (
    typeof object.id === 'string' &&
    (typeof object.text === 'string' ||
      typeof object.table_id === 'string' ||
      object.type === 'url')
  );
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
