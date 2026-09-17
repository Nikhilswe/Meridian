import { NextFunction, Request, Response } from "express";
import { ApiErrorBody } from "@scaler/shared-types";
import {
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../domain/errors";

/**
 * Central express error-handling middleware. Maps domain errors to HTTP
 * status codes and a consistent ApiErrorBody shape. Server errors (anything
 * unrecognised) are logged to console.error -- NEVER log secrets here; only
 * the error message/stack of the thrown Error, which application code is
 * responsible for keeping secret-free.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const body: ApiErrorBody = { error: { code: "INTERNAL_ERROR", message: "Internal server error" } };

  if (err instanceof ValidationError) {
    res.status(400).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof UnauthorizedError) {
    res.status(401).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof InvalidStateTransitionError) {
    res.status(409).json({ error: { code: err.code, message: err.message } });
    return;
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  console.error("Unhandled error:", message);
  res.status(500).json(body);
}
