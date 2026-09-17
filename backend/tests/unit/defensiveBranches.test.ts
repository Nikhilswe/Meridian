import "reflect-metadata";
import express from "express";
import request from "supertest";
import * as path from "path";
import { canTransition } from "../../src/domain/TicketEntity";
import { TicketBuilder, validateOptionalIdentifier } from "../../src/domain/TicketBuilder";
import { ValidationError } from "../../src/domain/errors";
import { buildRateLimiter } from "../../src/middleware/rateLimiter";
import { ConfigResolver } from "../../src/config/ConfigResolver";

/**
 * Small, explicit tests for the guard branches the happy-path suites never
 * reach: unknown statuses, malformed attachment metadata, identifier length
 * limits, and the rate limiter's key fallbacks.
 */

describe("TicketEntity.canTransition -- unknown statuses", () => {
  it("returns false (never throws) for a status outside the lifecycle in either position", () => {
    expect(canTransition("BOGUS" as never, "ASSIGNED")).toBe(false);
    expect(canTransition("OPEN", "BOGUS" as never)).toBe(false);
  });
});

describe("TicketBuilder -- attachment and identifier edge cases", () => {
  it("reports a missing fileName and an unsupported docType per attachment", () => {
    expect(() =>
      new TicketBuilder()
        .forCreator("rep")
        .withOverview("ok")
        .withAttachedDocument({ key: "k", fileName: "  ", docType: "DOCX" as never })
        .build(),
    ).toThrow(
      expect.objectContaining({
        details: expect.arrayContaining(["attachedDocuments[0].fileName is required", "attachedDocuments[0].docType must be IMG or PDF"]),
      }),
    );
  });

  it("validateOptionalIdentifier: undefined/blank -> undefined, too long -> error, bad chars -> error, good -> trimmed", () => {
    const errors: string[] = [];
    expect(validateOptionalIdentifier("customerId", undefined, errors)).toBeUndefined();
    expect(validateOptionalIdentifier("customerId", "   ", errors)).toBeUndefined();
    expect(errors).toEqual([]);

    validateOptionalIdentifier("customerId", "x".repeat(65), errors);
    expect(errors).toEqual(["customerId must be at most 64 characters"]);

    validateOptionalIdentifier("orderId", "-leading-dash", errors);
    expect(errors[1]).toMatch(/orderId may only contain/);

    expect(validateOptionalIdentifier("orderId", "  order-1 ", errors)).toBe("order-1");
    expect(errors).toHaveLength(2);
  });

  it("surfaces identifier problems through build() as a ValidationError", () => {
    expect(() => new TicketBuilder().forCreator("rep").withOverview("ok").forCustomer("bad id!").build()).toThrow(ValidationError);
  });
});

describe("rateLimiter key generation", () => {
  const config = new ConfigResolver(path.join(__dirname, "..", "integration", "fixtures", "config-strict"), "local");

  it("keys by principal when authenticated, else by IP, so one noisy user cannot exhaust everyone's budget", async () => {
    const limiter = buildRateLimiter(config, "ticketCreate");
    const max = config.get<number>("rateLimit", "ticketCreateMax");
    const app = express();
    app.use((req, _res, next) => {
      if (req.headers["x-user"]) req.principal = { userId: String(req.headers["x-user"]), role: "SUPPORT_AGENT" };
      next();
    });
    app.get("/", limiter, (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < max; i += 1) {
      expect((await request(app).get("/").set("x-user", "alice")).status).toBe(200);
    }
    // alice is now capped...
    const capped = await request(app).get("/").set("x-user", "alice");
    expect(capped.status).toBe(429);
    expect(capped.body.error.code).toBe("RATE_LIMITED");
    // ...but bob (separate principal key) and an anonymous caller (IP key) are not.
    expect((await request(app).get("/").set("x-user", "bob")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(200);
  });
});
