import { redactPhone } from '../security/redaction.js';

/**
 * Structured, already-redacted diagnostic detail for a failed Feishu call.
 *
 * This is the payload that satisfies the "do not swallow the Feishu error"
 * requirement: the caller-visible error code stays coarse
 * (`FEISHU_COMMIT_FAILED`), but operators can still see *why* it failed.
 *
 * Invariants:
 *  - never carries app_secret, tenant_access_token or Authorization headers
 *  - never carries raw field *values* (only field names / types)
 *  - phone numbers inside `feishu_message` are masked
 */
export interface FeishuErrorDetail {
  /** Numeric OpenAPI error code, or a synthetic negative for transport faults. */
  feishu_code: number;
  /** Redacted `msg` from the OpenAPI envelope. */
  feishu_message: string;
  /** Feishu `log_id` / `X-Tt-Logid`. The only reliable support handle. */
  request_id: string | null;
  /** HTTP status of the failing response, when one was received. */
  http_status: number | null;
  /** Field-level violations reported by Feishu, when present. */
  field_violations?: unknown;
}

/**
 * Error thrown by FeishuClient when an OpenAPI call fails.
 *
 * `code` is the numeric OpenAPI error code returned by Feishu (e.g. 1254045,
 * 99991663). For non-API failures (network errors, malformed responses) it is
 * set to a synthetic negative number.
 *
 * The error message is always redacted: phone numbers are masked and the
 * app_secret is never included.
 */
export class FeishuApiError extends Error {
  public readonly code: number;
  /** Feishu `log_id` (a.k.a. request id). Null for transport-level faults. */
  public readonly requestId: string | null;
  public readonly httpStatus: number | null;
  public readonly fieldViolations?: unknown;

  constructor(
    code: number,
    rawMessage: string,
    options: {
      requestId?: string | null;
      httpStatus?: number | null;
      fieldViolations?: unknown;
    } = {},
  ) {
    const safe = redactPhone(rawMessage ?? '');
    super(`[feishu code=${code}] ${safe}`);
    this.name = 'FeishuApiError';
    this.code = code;
    this.requestId = options.requestId ?? null;
    this.httpStatus = options.httpStatus ?? null;
    this.fieldViolations = options.fieldViolations;
  }

  /** Redacted message without the `[feishu code=N] ` prefix. */
  get safeMessage(): string {
    return this.message.replace(/^\[feishu code=-?\d+\]\s*/, '');
  }

  toDetail(): FeishuErrorDetail {
    return {
      feishu_code: this.code,
      feishu_message: this.safeMessage,
      request_id: this.requestId,
      http_status: this.httpStatus,
      ...(this.fieldViolations ? { field_violations: this.fieldViolations } : {}),
    };
  }
}
