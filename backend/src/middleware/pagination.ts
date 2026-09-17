import { Request } from "express";
import { ConfigResolver } from "../config/ConfigResolver";
import { ValidationError } from "../domain/errors";

export interface ParsedPagination {
  cursor?: string;
  limit: number;
}

/**
 * Parses/validates `cursor`/`limit` query params against
 * ConfigResolver's pagination.defaultLimit/maxLimit -- keeps every list
 * route consistent instead of each route re-implementing this.
 */
export function parsePagination(req: Request, configResolver: ConfigResolver): ParsedPagination {
  const defaultLimit = configResolver.get<number>("pagination", "defaultLimit");
  const maxLimit = configResolver.get<number>("pagination", "maxLimit");

  const rawLimit = req.query.limit;
  let limit = defaultLimit;
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ValidationError("`limit` must be a positive integer");
    }
    limit = Math.min(parsed, maxLimit);
  }

  const rawCursor = req.query.cursor;
  let cursor: string | undefined;
  if (rawCursor !== undefined) {
    if (typeof rawCursor !== "string" || rawCursor.length === 0) {
      throw new ValidationError("`cursor` must be a non-empty string");
    }
    cursor = rawCursor;
  }

  return { cursor, limit };
}
