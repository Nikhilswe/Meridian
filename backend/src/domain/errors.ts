/**
 * Domain-level errors. These are mapped to HTTP status codes exclusively in
 * src/middleware/errorHandler.ts -- domain/service code never touches
 * express Response objects directly (SRP: domain logic vs HTTP transport).
 */

export class ValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";

  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  public readonly code = "NOT_FOUND";

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  public readonly code = "FORBIDDEN";

  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends Error {
  public readonly code = "UNAUTHORIZED";

  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class InvalidStateTransitionError extends Error {
  public readonly code = "INVALID_STATE_TRANSITION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidStateTransitionError";
  }
}
