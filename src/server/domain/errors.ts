export class CollatorError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = 'CollatorError';
  }
}

export class BadRequestError extends CollatorError {
  constructor(message: string) {
    super('BAD_REQUEST', message, 400);
  }
}

export class UnauthorizedError extends CollatorError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends CollatorError {
  constructor(message: string = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends CollatorError {
  constructor(message: string = 'Not found') {
    super('NOT_FOUND', message, 404);
  }
}

export class ConflictError extends CollatorError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

/**
 * Raised when a Feishu customer-record commit fails (network error, API
 * rejection, malformed response). The detailed cause is persisted only
 * inside the sanitised write-log entry; the HTTP response exposes only
 * the code `FEISHU_COMMIT_FAILED` and a generic message so no PII
 * (phone numbers, customer chat text, app_secret) leaks to the client.
 *
 * TASK-003 spec: 飞书提交失败返回 HTTP 502 和 FEISHU_COMMIT_FAILED；
 * 详细信息只进入脱敏审计。
 */
export class FeishuCommitFailedError extends CollatorError {
  constructor(message: string = 'Feishu commit failed') {
    super('FEISHU_COMMIT_FAILED', message, 502);
  }
}
