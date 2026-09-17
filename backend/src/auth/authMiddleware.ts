import { NextFunction, Request, Response } from "express";
import { IAuthProvider } from "./IAuthProvider";

/**
 * Reads `Authorization: Bearer <token>`, verifies it through the injected
 * IAuthProvider, and attaches `req.principal`. Never talks to a concrete
 * auth implementation directly -- 401 on any missing/invalid token.
 */
export function buildAuthMiddleware(authProvider: IAuthProvider) {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing bearer token" } });
      return;
    }

    const token = header.slice("Bearer ".length).trim();
    try {
      req.principal = await authProvider.verify(token);
      next();
    } catch {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
    }
  };
}
