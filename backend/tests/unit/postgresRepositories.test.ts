import "reflect-metadata";
import type { Pool } from "pg";
import { PostgresTicketRepository } from "../../src/repositories/postgres/PostgresTicketRepository";
import { PostgresPolicyRepository } from "../../src/repositories/postgres/PostgresPolicyRepository";
import { PostgresOrderRepository } from "../../src/repositories/postgres/PostgresOrderRepository";
import { PostgresUserRepository } from "../../src/repositories/postgres/PostgresUserRepository";
import { PostgresAssignmentCursorRepository } from "../../src/repositories/postgres/PostgresAssignmentCursorRepository";
import { decodeCursor, encodeCursor } from "../../src/repositories/postgres/cursorUtil";
import { NotFoundError } from "../../src/domain/errors";
import { createPool } from "../../src/db/pool";

/**
 * These tests pin the SQL each repository emits (parameterised placeholders,
 * cursor predicate, optimistic-concurrency WHERE) against a stubbed pg.Pool.
 * They deliberately do NOT talk to Postgres -- the smoke test does that.
 */

function fakePool(): { pool: Pool; query: jest.Mock } {
  const query = jest.fn();
  return { pool: { query } as unknown as Pool, query };
}

const NOW = new Date("2026-09-18T00:00:00.000Z");

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    ticketId: "t1",
    creatorId: "c1",
    assigneeId: null,
    ticketStatus: "OPEN",
    ticketCreationDate: NOW,
    ticketResolvedDate: null,
    ticketOverview: "o",
    attachedDocuments: [],
    caseSummary: null,
    draftMessage: null,
    customerId: null,
    orderId: null,
    suppliedContext: null,
    version: 1,
    updatedAt: NOW,
    ...overrides,
  };
}

// --------------------------------------------------- PostgresTicketRepository

describe("PostgresTicketRepository", () => {
  it("create() inserts with a generated uuid, JSON-encoded attachments and NULL for absent optional ids", async () => {
    const { pool, query } = fakePool();
    query.mockResolvedValueOnce({ rows: [ticketRow()] });
    const repo = new PostgresTicketRepository(pool);

    const ticket = await repo.create({ creatorId: "c1", ticketOverview: "o" });

    expect(ticket.ticketId).toBe("t1");
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO tickets/);
    expect(params[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(params[1]).toBe("c1");
    expect(params[3]).toBe("o");
    expect(params[4]).toBe("[]");
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
  });

  it("create() passes customerId/orderId/attachments through when supplied", async () => {
    const { pool, query } = fakePool();
    query.mockResolvedValueOnce({ rows: [ticketRow({ customerId: "cust-1", orderId: "o1" })] });
    const repo = new PostgresTicketRepository(pool);
    const doc = { docType: "PDF" as const, fileName: "a.pdf", key: "k" };

    const ticket = await repo.create({ creatorId: "c1", ticketOverview: "o", customerId: "cust-1", orderId: "o1", attachedDocuments: [doc] });

    expect(ticket.customerId).toBe("cust-1");
    const params = query.mock.calls[0]![1] as unknown[];
    expect(params[4]).toBe(JSON.stringify([doc]));
    expect(params[5]).toBe("cust-1");
    expect(params[6]).toBe("o1");
  });

  it("getById() maps the row or returns undefined", async () => {
    const { pool, query } = fakePool();
    const repo = new PostgresTicketRepository(pool);
    query.mockResolvedValueOnce({ rows: [ticketRow()] });
    await expect(repo.getById("t1")).resolves.toMatchObject({ ticketId: "t1" });
    query.mockResolvedValueOnce({ rows: [] });
    await expect(repo.getById("nope")).resolves.toBeUndefined();
    expect(query.mock.calls[1]![1]).toEqual(["nope"]);
  });

  describe("keyset pagination", () => {
    it("listPaginatedAll() with no cursor emits no WHERE, asks for limit+1 rows and reports hasMore=false when under the limit", async () => {
      const { pool, query } = fakePool();
      query.mockResolvedValueOnce({ rows: [ticketRow({ ticketId: "a" }), ticketRow({ ticketId: "b" })] });
      const repo = new PostgresTicketRepository(pool);

      const page = await repo.listPaginatedAll(undefined, 5);

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toMatch(/WHERE/);
      expect(sql).toMatch(/ORDER BY "ticketCreationDate" DESC, "ticketId" DESC/);
      expect(params).toEqual([6]);
      expect(page.items.map((t) => t.ticketId)).toEqual(["a", "b"]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeUndefined();
    });

    it("trims the extra row, sets hasMore and encodes the LAST returned row as nextCursor", async () => {
      const { pool, query } = fakePool();
      const later = new Date("2026-09-18T01:00:00.000Z");
      query.mockResolvedValueOnce({
        rows: [
          ticketRow({ ticketId: "c", ticketCreationDate: later }),
          ticketRow({ ticketId: "b", ticketCreationDate: NOW }),
          ticketRow({ ticketId: "a" }),
        ],
      });
      const repo = new PostgresTicketRepository(pool);

      const page = await repo.listPaginatedAll(undefined, 2);

      expect(page.items.map((t) => t.ticketId)).toEqual(["c", "b"]);
      expect(page.hasMore).toBe(true);
      expect(decodeCursor(page.nextCursor!)).toEqual({ ticketCreationDate: NOW.toISOString(), ticketId: "b" });
    });

    it("listPaginatedForAssignee() combines the assignee filter with the cursor predicate using correctly numbered placeholders", async () => {
      const { pool, query } = fakePool();
      query.mockResolvedValueOnce({ rows: [] });
      const repo = new PostgresTicketRepository(pool);
      const cursor = encodeCursor({ ticketCreationDate: NOW.toISOString(), ticketId: "b" });

      await repo.listPaginatedForAssignee("agent-1", cursor, 3);

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/WHERE "assigneeId" = \$1 AND \("ticketCreationDate", "ticketId"\) < \(\$2::timestamptz, \$3\)/);
      expect(sql).toMatch(/LIMIT \$4/);
      expect(params).toEqual(["agent-1", NOW.toISOString(), "b", 4]);
    });

    it("listPaginatedForCreator() filters on creatorId", async () => {
      const { pool, query } = fakePool();
      query.mockResolvedValueOnce({ rows: [] });
      await new PostgresTicketRepository(pool).listPaginatedForCreator("c1", undefined, 1);
      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/WHERE "creatorId" = \$1/);
      expect(params).toEqual(["c1", 2]);
    });

    it("rejects an invalid cursor before touching the database", async () => {
      const { pool, query } = fakePool();
      await expect(new PostgresTicketRepository(pool).listPaginatedAll("garbage", 1)).rejects.toThrow("Invalid pagination cursor");
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe("updateStatusAndFields() -- optimistic concurrency", () => {
    it("builds SET clauses only for the fields supplied and guards on the expected version", async () => {
      const { pool, query } = fakePool();
      query.mockResolvedValueOnce({ rows: [ticketRow({ version: 2, ticketStatus: "ASSIGNED", assigneeId: "a1" })] });
      const repo = new PostgresTicketRepository(pool);

      const updated = await repo.updateStatusAndFields("t1", 1, { assigneeId: "a1", ticketStatus: "ASSIGNED" });

      expect(updated.version).toBe(2);
      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/"version" = "version" \+ 1/);
      expect(sql).toMatch(/"assigneeId" = \$2/);
      expect(sql).toMatch(/"ticketStatus" = \$3/);
      expect(sql).not.toMatch(/caseSummary|draftMessage|ticketResolvedDate|customerId|orderId|suppliedContext/);
      expect(sql).toMatch(/WHERE "ticketId" = \$4 AND "version" = \$5/);
      expect(params.slice(1)).toEqual(["a1", "ASSIGNED", "t1", 1]);
    });

    it("serialises every other field, JSON-encoding suppliedContext as jsonb", async () => {
      const { pool, query } = fakePool();
      query.mockResolvedValueOnce({ rows: [ticketRow({ version: 2 })] });
      const repo = new PostgresTicketRepository(pool);
      const suppliedContext = {
        facts: { ticketStatus: "ASSIGNED" as const, otherOrders: [] },
        policies: [],
        checks: [],
        usedProvider: "test-stub" as const,
        testModeTriggered: true,
        generatedAt: NOW.toISOString(),
      };

      await repo.updateStatusAndFields("t1", 1, {
        caseSummary: "s",
        draftMessage: "d",
        ticketResolvedDate: NOW.toISOString(),
        customerId: "cust-1",
        orderId: "o1",
        suppliedContext,
      });

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/"suppliedContext" = \$7::jsonb/);
      expect(params[6]).toBe(JSON.stringify(suppliedContext));
      expect(params.slice(1, 6)).toEqual(["s", "d", NOW.toISOString(), "cust-1", "o1"]);
    });

    it("throws NotFoundError when no row matched and the ticket does not exist at all", async () => {
      const { pool, query } = fakePool();
      query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
      await expect(new PostgresTicketRepository(pool).updateStatusAndFields("ghost", 1, { caseSummary: "x" })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws a concurrency-conflict error naming both versions when the row exists at a newer version", async () => {
      const { pool, query } = fakePool();
      query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [ticketRow({ version: 4 })] });
      await expect(new PostgresTicketRepository(pool).updateStatusAndFields("t1", 1, { caseSummary: "x" })).rejects.toThrow(
        "Optimistic concurrency conflict updating ticket t1: expected version 1, current version 4",
      );
    });
  });

  it("countDistinctCreators() coerces the COUNT result and tolerates an empty result set", async () => {
    const { pool, query } = fakePool();
    const repo = new PostgresTicketRepository(pool);
    query.mockResolvedValueOnce({ rows: [{ count: "3" }] });
    await expect(repo.countDistinctCreators()).resolves.toBe(3);
    query.mockResolvedValueOnce({ rows: [] });
    await expect(repo.countDistinctCreators()).resolves.toBe(0);
  });
});

// ------------------------------------------------------ small repositories

describe("PostgresPolicyRepository", () => {
  const row = { policyId: "p", category: "Returns", title: "t", body: "b", version: 1, effectiveDate: NOW };

  it("listAll() orders by category then title; listByCategory() filters with a parameter", async () => {
    const { pool, query } = fakePool();
    const repo = new PostgresPolicyRepository(pool);
    query.mockResolvedValueOnce({ rows: [row] });
    const all = await repo.listAll();
    expect(all[0]!.effectiveDate).toBe(NOW.toISOString());
    expect(query.mock.calls[0]![0]).toMatch(/ORDER BY "category", "title"/);

    query.mockResolvedValueOnce({ rows: [] });
    await expect(repo.listByCategory("Returns")).resolves.toEqual([]);
    expect(query.mock.calls[1]![1]).toEqual(["Returns"]);
  });
});

describe("PostgresOrderRepository", () => {
  const row = { orderId: "o", customerId: "cu", itemSummary: "i", orderDate: NOW, amount: "5", currency: "USD", status: "SHIPPED", deliveredDate: null };

  it("listByCustomerId() is newest-first and getById() returns undefined for a miss", async () => {
    const { pool, query } = fakePool();
    const repo = new PostgresOrderRepository(pool);
    query.mockResolvedValueOnce({ rows: [row] });
    const orders = await repo.listByCustomerId("cu");
    expect(orders[0]!.amount).toBe(5);
    expect(query.mock.calls[0]![0]).toMatch(/ORDER BY "orderDate" DESC/);
    expect(query.mock.calls[0]![1]).toEqual(["cu"]);

    query.mockResolvedValueOnce({ rows: [row] });
    await expect(repo.getById("o")).resolves.toMatchObject({ orderId: "o" });
    query.mockResolvedValueOnce({ rows: [] });
    await expect(repo.getById("x")).resolves.toBeUndefined();
  });
});

describe("PostgresUserRepository", () => {
  const row = { userId: "u", displayName: "D", email: "d@x", role: "SUPPORT_AGENT", passwordHash: "h" };

  it("getById()/getByEmailWithCredentials() map rows and return undefined on a miss", async () => {
    const { pool, query } = fakePool();
    const repo = new PostgresUserRepository(pool);
    query.mockResolvedValueOnce({ rows: [row] });
    await expect(repo.getById("u")).resolves.toEqual({ userId: "u", displayName: "D", email: "d@x", role: "SUPPORT_AGENT" });
    query.mockResolvedValueOnce({ rows: [] });
    await expect(repo.getById("x")).resolves.toBeUndefined();
    query.mockResolvedValueOnce({ rows: [row] });
    await expect(repo.getByEmailWithCredentials("d@x")).resolves.toMatchObject({ passwordHash: "h" });
    query.mockResolvedValueOnce({ rows: [] });
    await expect(repo.getByEmailWithCredentials("nobody")).resolves.toBeUndefined();
  });

  it("listByRole() filters by role; create() inserts the seed script's column list and never returns the hash", async () => {
    const { pool, query } = fakePool();
    const repo = new PostgresUserRepository(pool);
    query.mockResolvedValueOnce({ rows: [row] });
    await expect(repo.listByRole("SUPPORT_AGENT")).resolves.toHaveLength(1);
    expect(query.mock.calls[0]![1]).toEqual(["SUPPORT_AGENT"]);

    query.mockResolvedValueOnce({ rows: [row] });
    const created = await repo.create({ userId: "u", email: "d@x", displayName: "D", role: "SUPPORT_AGENT", passwordHash: "h" });
    expect(created).not.toHaveProperty("passwordHash");
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO users \("userId", "displayName", "email", "role", "passwordHash"\)/);
    expect(params).toEqual(["u", "D", "d@x", "SUPPORT_AGENT", "h"]);
  });
});

describe("PostgresAssignmentCursorRepository", () => {
  it("incrementAndGet() is a single atomic UPDATE ... RETURNING; reset() zeroes the row", async () => {
    const { pool, query } = fakePool();
    const repo = new PostgresAssignmentCursorRepository(pool);
    query.mockResolvedValueOnce({ rows: [{ lastIndex: "7" }] });
    await expect(repo.incrementAndGet()).resolves.toBe(7);
    expect(query.mock.calls[0]![0]).toMatch(/UPDATE assignment_cursor SET "lastIndex" = "lastIndex" \+ 1 WHERE id = 1 RETURNING/);

    query.mockResolvedValueOnce({ rows: [] });
    await repo.reset();
    expect(query.mock.calls[1]![0]).toMatch(/SET "lastIndex" = 0/);
  });

  it("fails loudly when the singleton row is missing (seed did not run)", async () => {
    const { pool, query } = fakePool();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(new PostgresAssignmentCursorRepository(pool).incrementAndGet()).rejects.toThrow(/did seed\.ts run/);
  });
});

// ------------------------------------------------------------------- pool.ts

describe("createPool", () => {
  const original = process.env.DATABASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("refuses to start without DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => createPool()).toThrow("DATABASE_URL is not set");
  });

  it("builds a Pool from DATABASE_URL without connecting", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:1/db";
    const pool = createPool();
    expect(pool).toBeDefined();
    await pool.end();
  });
});
