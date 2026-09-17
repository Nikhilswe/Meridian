import rateLimit from "express-rate-limit";
import { Request } from "express";
import { ConfigResolver } from "../config/ConfigResolver";

export type RateLimitNamespaceKey = "ticketCreate" | "summarise";

/**
 * Builds an express-rate-limit middleware configured entirely from
 * ConfigResolver (rateLimit.<prefix>Max / rateLimit.<prefix>WindowMs) --
 * never hardcoded literals at the call site. Keyed by the authenticated
 * principal's userId when available, else falls back to the request IP.
 */
export function buildRateLimiter(configResolver: ConfigResolver, namespaceKeyPrefix: RateLimitNamespaceKey) {
  const max = configResolver.get<number>("rateLimit", `${namespaceKeyPrefix}Max`);
  const windowMs = configResolver.get<number>("rateLimit", `${namespaceKeyPrefix}WindowMs`);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.principal?.userId ?? req.ip ?? "unknown",
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: `Rate limit exceeded: max ${max} requests per ${windowMs}ms`,
        },
      });
    },
  });
}
