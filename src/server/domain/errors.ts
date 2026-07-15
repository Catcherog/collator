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
