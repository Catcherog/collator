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

export class ProductionPilotMutationLockedError extends CollatorError {
  constructor(message: string = 'Production pilot execution has locked task mutations') {
    super('PRODUCTION_PILOT_MUTATION_LOCKED', message, 409);
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
  constructor(message: string = 'Feishu commit failed', readonly resultUnknown = false) {
    super('FEISHU_COMMIT_FAILED', message, 502);
  }
}

export class InternalWriteResultUnknownError extends CollatorError {
  constructor(message: string = 'Internal controlled write result is unknown') {
    super('INTERNAL_WRITE_RESULT_UNKNOWN', message, 503);
  }
}

export class InternalWriteStateTransitionConflictError extends CollatorError {
  constructor() {
    super(
      'INTERNAL_WRITE_STATE_TRANSITION_CONFLICT',
      'Internal controlled write result was not durably applied',
      409,
    );
  }
}

export class InternalWriteDisabledError extends CollatorError {
  constructor() {
    super('INTERNAL_WRITE_DISABLED', 'Internal controlled write lane is disabled', 409);
  }
}

export class InternalWriteAlreadyInProgressError extends CollatorError {
  constructor() {
    super('INTERNAL_WRITE_ALREADY_IN_PROGRESS', 'Internal controlled write is already in progress', 409);
  }
}

export class InternalWriteNeedsReconciliationError extends CollatorError {
  constructor() {
    super('INTERNAL_WRITE_NEEDS_RECONCILIATION', 'Internal controlled write requires reconciliation', 409);
  }
}

export class InternalWritePreviewExpiredError extends CollatorError {
  constructor() {
    super('INTERNAL_WRITE_PREVIEW_EXPIRED', 'Internal controlled write preview has expired', 409);
  }
}

export class InternalWritePlanMismatchError extends CollatorError {
  constructor() {
    super('INTERNAL_WRITE_PLAN_MISMATCH', 'Internal controlled write plan does not match the server preview', 409);
  }
}

export class InternalWriteGateBlockedError extends CollatorError {
  constructor() {
    super('INTERNAL_WRITE_GATE_BLOCKED', 'Internal controlled write gate blocked execution', 409);
  }
}

export class InternalWriteRequiresHumanConfirmationError extends CollatorError {
  constructor() {
    super('INTERNAL_WRITE_REQUIRES_HUMAN_CONFIRMATION', 'Authenticated human confirmation is required', 409);
  }
}

export class InternalWriteOperatorMismatchError extends CollatorError {
  constructor() {
    super('INTERNAL_WRITE_OPERATOR_MISMATCH', 'Authenticated operator does not match the server preview', 403);
  }
}

export class InternalWritePreviewStaleError extends CollatorError {
  constructor() {
    super('INTERNAL_WRITE_PREVIEW_STALE', 'Internal controlled write preview is stale', 409);
  }
}

export class InternalWritePartialError extends CollatorError {
  constructor() {
    super('INTERNAL_WRITE_PARTIAL', 'Internal controlled write completed partially', 502);
  }
}
