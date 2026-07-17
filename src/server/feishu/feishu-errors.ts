import { redactPhone } from '../security/redaction.js';

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

  constructor(code: number, rawMessage: string) {
    const safe = redactPhone(rawMessage ?? '');
    super(`[feishu code=${code}] ${safe}`);
    this.name = 'FeishuApiError';
    this.code = code;
  }
}
