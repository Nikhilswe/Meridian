import "reflect-metadata";
import type { Request } from "express";
import { Policy } from "@scaler/shared-types";
import {
  mapOrderRow,
  mapPolicyRow,
  mapTicketRow,
  mapUserRow,
  mapUserWithCredentialsRow,
} from "../../src/repositories/postgres/rowMappers";
import { decodeCursor, encodeCursor } from "../../src/repositories/postgres/cursorUtil";
import { SYSTEM_PROMPT, buildUserPrompt } from "../../src/llm/promptBuilder";
import { findRelevantPolicies } from "../../src/services/naiveRetrieval";
import { parsePagination } from "../../src/middleware/pagination";
import { requireRouteParam } from "../../src/routes/routeUtils";
import { InMemoryEventBus } from "../../src/events/InMemoryEventBus";
import { TestStubProvider } from "../../src/llm/TestStubProvider";
import { EnvSecretsProvider } from "../../src/secrets/EnvSecretsProvider";
import { ConfigResolver } from "../../src/config/ConfigResolver";
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../src/domain/errors";

// ---------------------------------------------------------------- rowMappers

describe("rowMappers", () => {
  const created = new Date("2026-09-10T10:00:00.000Z");

  it("maps a minimal ticket row, turning Date columns into ISO strings and omitting nulls", () => {
    const ticket = mapTicketRow({
      ticketId: "t1",
      creatorId: "c1",
      ticketStatus: "OPEN",
      ticketCreationDate: created,
      ticketOverview: "hello",
      version: 1,
      updatedAt: created,
      assigneeId: null,
      ticketResolvedDate: null,
      attachedDocuments: null,
      caseSummary: null,
      draftMessage: null,
      customerId: null,
      orderId: null,
      suppliedContext: null,
    });
    expect(ticket).toEqual({
      ticketId: "t1",
      creatorId: "c1",
      ticketStatus: "OPEN",
      ticketCreationDate: created.toISOString(),
      ticketOverview: "hello",
      version: 1,
      updatedAt: created.toISOString(),
    });
    expect("assigneeId" in ticket).toBe(false);
  });

  it("maps every optional ticket column when present (string dates pass through untouched)", () => {
    const ticket = mapTicketRow({
      ticketId: "t2",
      creatorId: "c1",
      ticketStatus: "RESOLVED",
      ticketCreationDate: "2026-09-10T10:00:00.000Z",
      ticketOverview: "x",
      version: 3,
      updatedAt: "2026-09-11T10:00:00.000Z",
      assigneeId: "a1",
      ticketResolvedDate: created,
      attachedDocuments: [{ docType: "PDF", fileName: "a.pdf", key: "k" }],
      caseSummary: "",
      draftMessage: "draft",
      customerId: "cust-1",
      orderId: "order-1",
      suppliedContext: { facts: { ticketStatus: "ASSIGNED", otherOrders: [] } },
    });
    expect(ticket.assigneeId).toBe("a1");
    expect(ticket.ticketResolvedDate).toBe(created.toISOString());
    expect(ticket.attachedDocuments).toHaveLength(1);
    // Empty string is a real (persisted) value, not "absent".
    expect(ticket.caseSummary).toBe("");
    expect(ticket.draftMessage).toBe("draft");
    expect(ticket.customerId).toBe("cust-1");
    expect(ticket.orderId).toBe("order-1");
    expect(ticket.suppliedContext?.facts.ticketStatus).toBe("ASSIGNED");
  });

  it("maps policy, order (with and without deliveredDate) and user rows", () => {
    expect(
      mapPolicyRow({ policyId: "p", category: "c", title: "t", body: "b", version: 2, effectiveDate: created }),
    ).toEqual({ policyId: "p", category: "c", title: "t", body: "b", version: 2, effectiveDate: created.toISOString() });

    const base = { orderId: "o", customerId: "cu", itemSummary: "i", orderDate: created, amount: "12.50", currency: "USD", status: "SHIPPED" };
    const shipped = mapOrderRow({ ...base, deliveredDate: null });
    expect(shipped.amount).toBe(12.5);
    expect("deliveredDate" in shipped).toBe(false);
    const delivered = mapOrderRow({ ...base, status: "DELIVERED", deliveredDate: created });
    expect(delivered.deliveredDate).toBe(created.toISOString());

    const row = { userId: "u", displayName: "D", email: "e@x", role: "ADMIN", passwordHash: "h" };
    expect(mapUserRow(row)).toEqual({ userId: "u", displayName: "D", email: "e@x", role: "ADMIN" });
    expect(mapUserWithCredentialsRow(row).passwordHash).toBe("h");
  });
});

// ---------------------------------------------------------------- cursorUtil

describe("cursorUtil", () => {
  it("round-trips a cursor through an opaque base64url string", () => {
    const cursor = { ticketCreationDate: "2026-09-10T10:00:00.000Z", ticketId: "abc" };
    const encoded = encodeCursor(cursor);
    expect(encoded).not.toContain("{");
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it("rejects garbage, valid-JSON-but-wrong-shape, and empty cursors with one stable error", () => {
    expect(() => decodeCursor("not-base64-json")).toThrow("Invalid pagination cursor");
    const wrongShape = Buffer.from(JSON.stringify({ ticketId: 42 })).toString("base64url");
    expect(() => decodeCursor(wrongShape)).toThrow("Invalid pagination cursor");
    expect(() => decodeCursor("")).toThrow("Invalid pagination cursor");
  });
});

// ------------------------------------------------------------- promptBuilder

describe("promptBuilder", () => {
  const policy: Policy = { policyId: "p1", category: "Returns", title: "Damaged items", body: "Replace within 30 days.", version: 3, effectiveDate: "2026-01-01" };

  it("separates the customer's words from SUPPLIED FACTS and lists policies with versions", () => {
    const prompt = buildUserPrompt({
      ticketOverview: "It arrived broken",
      facts: {
        ticketStatus: "ASSIGNED",
        customerId: "cust-1",
        order: { orderId: "o1", customerId: "cust-1", itemSummary: "Lamp", orderDate: "2026-09-01T00:00:00Z", amount: 10, currency: "USD", status: "DELIVERED", deliveredDate: "2026-09-05T00:00:00Z" },
        otherOrders: [
          { orderId: "o2", customerId: "cust-1", itemSummary: "Bulb", orderDate: "2026-08-01T00:00:00Z", amount: 2, currency: "USD", status: "SHIPPED" },
        ],
      },
      relatedPolicies: [policy],
    });
    expect(prompt).toContain("customer's own words");
    expect(prompt).toContain("SUPPLIED FACTS");
    expect(prompt).toContain("- Issue record status: ASSIGNED");
    expect(prompt).toContain("- Customer ID: cust-1");
    expect(prompt).toContain("Order o1: Lamp (DELIVERED, 10 USD, placed 2026-09-01, delivered 2026-09-05)");
    expect(prompt).toContain("Other orders on file for this customer:");
    expect(prompt).toContain("    - Order o2: Bulb (SHIPPED, 2 USD, placed 2026-08-01)");
    expect(prompt).toContain("- [Returns] Damaged items (v3): Replace within 30 days.");
  });

  it("spells out every absent fact instead of leaving a blank the model could fill in", () => {
    const prompt = buildUserPrompt({
      ticketOverview: "x",
      facts: { ticketStatus: "OPEN", otherOrders: [] },
      relatedPolicies: [],
    });
    expect(prompt).toContain("- Customer ID: (not identified)");
    expect(prompt).toContain("- Referenced order: (none)");
    expect(prompt).toContain("- Other orders on file for this customer: (none)");
    expect(prompt).toContain("(no matching policies found)");
  });

  it("system prompt forbids resolution claims and refund promises", () => {
    expect(SYSTEM_PROMPT).toMatch(/never state or imply that the issue is resolved/);
    expect(SYSTEM_PROMPT).toMatch(/Do not promise a refund/);
  });
});

// ------------------------------------------------------------ naiveRetrieval

describe("naiveRetrieval.findRelevantPolicies", () => {
  const policies: Policy[] = [
    { policyId: "a", category: "Returns", title: "Damaged item on arrival", body: "", version: 1, effectiveDate: "" },
    { policyId: "b", category: "Shipping", title: "Late delivery", body: "", version: 1, effectiveDate: "" },
    { policyId: "c", category: "Security", title: "Suspicious login", body: "", version: 1, effectiveDate: "" },
    { policyId: "d", category: "Returns", title: "Damaged item, late delivery", body: "", version: 1, effectiveDate: "" },
  ];

  it("ranks by word overlap against category+title, drops zero-score policies, and caps results", () => {
    const hits = findRelevantPolicies("My item was damaged and the delivery was late", policies, 2);
    expect(hits.map((p) => p.policyId)).toEqual(["d", "a"]);
  });

  it("ignores short tokens and punctuation and returns [] when nothing overlaps", () => {
    expect(findRelevantPolicies("hi, ok!! a b", policies)).toEqual([]);
  });

  it("defaults to at most 3 results", () => {
    const hits = findRelevantPolicies("damaged item late delivery returns shipping security login", policies);
    expect(hits).toHaveLength(3);
  });
});

// ---------------------------------------------------------------- pagination

describe("parsePagination", () => {
  const config = { get: jest.fn() } as unknown as ConfigResolver;
  beforeEach(() => {
    (config.get as jest.Mock).mockImplementation((_ns: string, key: string) => (key === "defaultLimit" ? 20 : 100));
  });
  const req = (query: Record<string, unknown>) => ({ query }) as unknown as Request;

  it("uses the configured default when no limit is given", () => {
    expect(parsePagination(req({}), config)).toEqual({ cursor: undefined, limit: 20 });
  });

  it("caps limit at maxLimit and passes a cursor through", () => {
    expect(parsePagination(req({ limit: "500", cursor: "abc" }), config)).toEqual({ cursor: "abc", limit: 100 });
    expect(parsePagination(req({ limit: "7" }), config).limit).toBe(7);
  });

  it("rejects non-integer, zero, negative limits and empty/non-string cursors", () => {
    for (const bad of ["abc", "0", "-3", "2.5"]) {
      expect(() => parsePagination(req({ limit: bad }), config)).toThrow(ValidationError);
    }
    expect(() => parsePagination(req({ cursor: "" }), config)).toThrow(ValidationError);
    expect(() => parsePagination(req({ cursor: ["a", "b"] }), config)).toThrow(ValidationError);
  });
});

// ----------------------------------------------------------------- routeUtils

describe("requireRouteParam", () => {
  it("returns the value when present and throws a ValidationError naming the param when not", () => {
    expect(requireRouteParam("abc", "id")).toBe("abc");
    expect(() => requireRouteParam(undefined, "id")).toThrow('Missing required route parameter "id"');
    expect(() => requireRouteParam("", "id")).toThrow(ValidationError);
  });
});

// ----------------------------------------------------------- InMemoryEventBus

describe("InMemoryEventBus", () => {
  it("dispatches to every subscriber of a type, in order, and ignores other types", async () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    bus.subscribe<{ type: "A"; n: number }>("A", async (e) => {
      seen.push(`first:${e.n}`);
    });
    bus.subscribe<{ type: "A"; n: number }>("A", async (e) => {
      seen.push(`second:${e.n}`);
    });
    bus.subscribe<{ type: "B" }>("B", async () => {
      seen.push("B");
    });
    await bus.publish({ type: "A", n: 1 });
    await bus.publish({ type: "C" });
    expect(seen).toEqual(["first:1", "second:1"]);
  });

  it("logs and swallows a throwing handler so the publisher and later handlers still run", async () => {
    const bus = new InMemoryEventBus();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const after = jest.fn(async () => undefined);
    bus.subscribe<{ type: "X" }>("X", async () => {
      throw new Error("boom");
    });
    bus.subscribe<{ type: "X" }>("X", after);
    await expect(bus.publish({ type: "X" })).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('handler for "X" threw'), "boom");
    errorSpy.mockRestore();
  });
});

// ----------------------------------------------------------- TestStubProvider

describe("TestStubProvider", () => {
  it("returns a deterministic, clearly-marked summary/draft without any network call", async () => {
    const out = await new TestStubProvider().generate({
      ticketOverview: "a".repeat(200),
      facts: { ticketStatus: "OPEN", otherOrders: [] },
      relatedPolicies: [],
    });
    expect(out.summary.startsWith("[test-stub summary] ")).toBe(true);
    expect(out.summary.length).toBe("[test-stub summary] ".length + 120);
    expect(out.draftMessage).toMatch(/^\[test-stub draft\]/);
  });
});

// ---------------------------------------------------------- EnvSecretsProvider

describe("EnvSecretsProvider", () => {
  it("reads process.env and treats an empty string as unset", async () => {
    const provider = new EnvSecretsProvider();
    process.env.UNIT_TEST_SECRET = "value";
    process.env.UNIT_TEST_EMPTY = "";
    delete process.env.UNIT_TEST_MISSING;
    await expect(provider.get("UNIT_TEST_SECRET")).resolves.toBe("value");
    await expect(provider.get("UNIT_TEST_EMPTY")).resolves.toBeUndefined();
    await expect(provider.get("UNIT_TEST_MISSING")).resolves.toBeUndefined();
    delete process.env.UNIT_TEST_SECRET;
    delete process.env.UNIT_TEST_EMPTY;
  });
});

// -------------------------------------------------------------------- errors

describe("domain errors", () => {
  it("each carries a stable machine-readable code and a distinct name", () => {
    const cases: [Error, string, string][] = [
      [new ValidationError("v", { field: "x" }), "VALIDATION_ERROR", "ValidationError"],
      [new NotFoundError("n"), "NOT_FOUND", "NotFoundError"],
      [new ForbiddenError("f"), "FORBIDDEN", "ForbiddenError"],
      [new UnauthorizedError("u"), "UNAUTHORIZED", "UnauthorizedError"],
      [new InvalidStateTransitionError("i"), "INVALID_STATE_TRANSITION", "InvalidStateTransitionError"],
      [new ConflictError("c"), "CONFLICT", "ConflictError"],
    ];
    for (const [err, code, name] of cases) {
      expect((err as unknown as { code: string }).code).toBe(code);
      expect(err.name).toBe(name);
      expect(err).toBeInstanceOf(Error);
    }
    expect(new ValidationError("v", { field: "x" }).details).toEqual({ field: "x" });
  });
});
