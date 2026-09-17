import "reflect-metadata";
import type { Request, Response } from "express";
import { Ticket, User } from "@meridian/shared-types";
import { TicketService } from "../../src/services/TicketService";
import { AssignmentService } from "../../src/services/AssignmentService";
import { ITicketRepository } from "../../src/repositories/ITicketRepository";
import { IUserRepository } from "../../src/repositories/IUserRepository";
import { IAssignmentCursorRepository } from "../../src/repositories/IAssignmentCursorRepository";
import { InMemoryEventBus } from "../../src/events/InMemoryEventBus";
import { IEventBus } from "../../src/events/IEventBus";
import { ConfigResolver } from "../../src/config/ConfigResolver";
import { errorHandler } from "../../src/middleware/errorHandler";
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../src/domain/errors";

const AGENT = { userId: "agent-1", role: "SUPPORT_AGENT" as const };
const OTHER_AGENT = { userId: "agent-2", role: "SUPPORT_AGENT" as const };
const REVIEWER = { userId: "rev-1", role: "REVIEWER" as const };

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticketId: "t1",
    creatorId: "rep-1",
    ticketStatus: "OPEN",
    ticketCreationDate: "2026-09-18T00:00:00.000Z",
    ticketOverview: "Parcel damaged",
    version: 1,
    updatedAt: "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

function ticketRepo(initial: Ticket[] = []) {
  const store = new Map(initial.map((t) => [t.ticketId, t]));
  const repo = {
    create: jest.fn(async (input: Parameters<ITicketRepository["create"]>[0]) => {
      const t = ticket({ ticketId: `t${store.size + 1}`, creatorId: input.creatorId, ticketOverview: input.ticketOverview, customerId: input.customerId, orderId: input.orderId });
      store.set(t.ticketId, t);
      return t;
    }),
    getById: jest.fn(async (id: string) => store.get(id)),
    listPaginatedAll: jest.fn(async (_cursor?: string, _limit?: number) => ({ items: [...store.values()], hasMore: false })),
    listPaginatedForAssignee: jest.fn(async (assigneeId: string) => ({ items: [...store.values()].filter((t) => t.assigneeId === assigneeId), hasMore: false, nextCursor: "c" })),
    listPaginatedForCreator: jest.fn(async () => ({ items: [] as Ticket[], hasMore: false })),
    updateStatusAndFields: jest.fn(async (id: string, version: number, fields: Parameters<ITicketRepository["updateStatusAndFields"]>[2]) => {
      const cur = store.get(id)!;
      if (cur.version !== version) throw new Error("conflict");
      const next: Ticket = { ...cur, ...fields, version: cur.version + 1 } as Ticket;
      store.set(id, next);
      return next;
    }),
    countDistinctCreators: jest.fn(async () => new Set([...store.values()].map((t) => t.creatorId)).size),
  };
  return repo as typeof repo & ITicketRepository;
}

describe("TicketService", () => {
  describe("createTicket", () => {
    it("validates through TicketBuilder, persists, publishes TicketCreated, then re-reads so the caller sees any synchronous assignment", async () => {
      const repo = ticketRepo();
      const bus = new InMemoryEventBus();
      const seen: unknown[] = [];
      bus.subscribe<{ type: "TicketCreated"; ticketId: string }>("TicketCreated", async (e) => {
        seen.push(e);
        // Simulate AssignmentService mutating the row inside publish().
        await repo.updateStatusAndFields(e.ticketId, 1, { assigneeId: "agent-1", ticketStatus: "ASSIGNED" });
      });
      const service = new TicketService(repo, bus);

      const created = await service.createTicket({ creatorId: "rep-1", ticketOverview: "Parcel damaged", customerId: "cust-1", attachedDocuments: [{ docType: "PDF", fileName: "a.pdf", key: "k" }] });

      expect(seen).toEqual([expect.objectContaining({ type: "TicketCreated", ticketId: "t1", creatorId: "rep-1" })]);
      expect(created.ticketStatus).toBe("ASSIGNED");
      expect(created.assigneeId).toBe("agent-1");
    });

    it("returns the freshly created ticket when the re-read misses (async assignment in AWS mode)", async () => {
      const repo = ticketRepo();
      repo.getById.mockResolvedValueOnce(undefined);
      const created = await new TicketService(repo, new InMemoryEventBus()).createTicket({ creatorId: "rep-1", ticketOverview: "Parcel damaged" });
      expect(created.ticketId).toBe("t1");
    });

    it("rejects invalid input before touching the repository or the bus", async () => {
      const repo = ticketRepo();
      const bus: IEventBus = { publish: jest.fn(), subscribe: jest.fn() };
      await expect(new TicketService(repo, bus).createTicket({ creatorId: "rep-1", ticketOverview: "   " })).rejects.toBeInstanceOf(ValidationError);
      expect(repo.create).not.toHaveBeenCalled();
      expect(bus.publish).not.toHaveBeenCalled();
    });
  });

  describe("listTickets / visibility", () => {
    const rows = [
      ticket({ ticketId: "mine-assigned", creatorId: "rep-1", assigneeId: "agent-1", ticketStatus: "ASSIGNED" }),
      ticket({ ticketId: "others-assigned", creatorId: "rep-2", assigneeId: "agent-2", ticketStatus: "ASSIGNED" }),
      ticket({ ticketId: "unassigned", creatorId: "rep-1" }),
    ];

    it("privileged roles see everything, unfiltered, without counting creators", async () => {
      const repo = ticketRepo(rows);
      const page = await new TicketService(repo, new InMemoryEventBus()).listTickets(REVIEWER, { limit: 10 });
      expect(page.items).toHaveLength(3);
      expect(repo.countDistinctCreators).not.toHaveBeenCalled();
    });

    it("an agent sees only tickets they created or are assigned; unassigned ones are hidden once there are multiple creators", async () => {
      const repo = ticketRepo(rows);
      const page = await new TicketService(repo, new InMemoryEventBus()).listTickets(AGENT, { limit: 10, cursor: "abc" });
      expect(page.items.map((t) => t.ticketId)).toEqual(["mine-assigned"]);
      expect(repo.listPaginatedAll).toHaveBeenCalledWith("abc", 10);
    });
  });

  describe("listCasesForAssignee", () => {
    it("lets an agent view only their own queue and a reviewer view anyone's", async () => {
      const repo = ticketRepo([ticket({ ticketId: "a", assigneeId: "agent-2" })]);
      const service = new TicketService(repo, new InMemoryEventBus());
      await expect(service.listCasesForAssignee("agent-2", AGENT, { limit: 5 })).rejects.toBeInstanceOf(ForbiddenError);
      const own = await service.listCasesForAssignee("agent-1", AGENT, { limit: 5 });
      expect(own).toEqual({ items: [], hasMore: false, nextCursor: "c" });
      const theirs = await service.listCasesForAssignee("agent-2", REVIEWER, { limit: 5 });
      expect(theirs.items.map((t) => t.ticketId)).toEqual(["a"]);
    });
  });

  describe("getTicketById", () => {
    it("404s on a miss, allows privileged roles, and enforces the visibility rule for agents", async () => {
      const repo = ticketRepo([
        ticket({ ticketId: "a", creatorId: "rep-1", assigneeId: "agent-2", ticketStatus: "ASSIGNED" }),
        ticket({ ticketId: "b", creatorId: "rep-2", assigneeId: "agent-1", ticketStatus: "ASSIGNED" }),
      ]);
      const service = new TicketService(repo, new InMemoryEventBus());
      await expect(service.getTicketById("ghost", AGENT)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.getTicketById("a", REVIEWER)).resolves.toMatchObject({ ticketId: "a" });
      await expect(service.getTicketById("a", AGENT)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.getTicketById("b", AGENT)).resolves.toMatchObject({ ticketId: "b" });
    });
  });

  describe("updateFacts", () => {
    const assigned = () => ticket({ ticketId: "a", assigneeId: "agent-1", ticketStatus: "ASSIGNED" });

    it("only the assignee (or a privileged role) may change facts; final tickets are frozen", async () => {
      const repo = ticketRepo([assigned(), ticket({ ticketId: "done", assigneeId: "agent-1", ticketStatus: "RESOLVED" })]);
      const service = new TicketService(repo, new InMemoryEventBus());
      await expect(service.updateFacts("ghost", AGENT, {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.updateFacts("a", OTHER_AGENT, { customerId: "c" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.updateFacts("done", AGENT, { customerId: "c" })).rejects.toBeInstanceOf(InvalidStateTransitionError);
      await expect(service.updateFacts("a", REVIEWER, { customerId: "cust-9" })).resolves.toMatchObject({ customerId: "cust-9" });
    });

    it("validates identifiers, treats an empty string as 'clear', and is a no-op when nothing is supplied", async () => {
      const repo = ticketRepo([assigned()]);
      const service = new TicketService(repo, new InMemoryEventBus());
      await expect(service.updateFacts("a", AGENT, { customerId: "has spaces!" })).rejects.toBeInstanceOf(ValidationError);

      const untouched = await service.updateFacts("a", AGENT, {});
      expect(untouched.version).toBe(1);
      expect(repo.updateStatusAndFields).not.toHaveBeenCalled();

      const updated = await service.updateFacts("a", AGENT, { customerId: "cust-1", orderId: "" });
      expect(repo.updateStatusAndFields).toHaveBeenCalledWith("a", 1, { customerId: "cust-1", orderId: "" });
      expect(updated.version).toBe(2);
    });
  });

  describe("submitDraft", () => {
    it("resolves the ticket with the edited draft and a resolved timestamp, only from a state that allows it", async () => {
      const repo = ticketRepo([
        ticket({ ticketId: "pending", assigneeId: "agent-1", ticketStatus: "DRAFT_PENDING_REVIEW", draftMessage: "ai draft" }),
        ticket({ ticketId: "open", assigneeId: "agent-1", ticketStatus: "OPEN" }),
      ]);
      const service = new TicketService(repo, new InMemoryEventBus());
      await expect(service.submitDraft({ ticketId: "ghost", submittedBy: "agent-1", draftMessage: "x" })).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.submitDraft({ ticketId: "pending", submittedBy: "agent-2", draftMessage: "x" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.submitDraft({ ticketId: "open", submittedBy: "agent-1", draftMessage: "x" })).rejects.toBeInstanceOf(InvalidStateTransitionError);

      const resolved = await service.submitDraft({ ticketId: "pending", submittedBy: "agent-1", draftMessage: "edited by human" });
      expect(resolved.ticketStatus).toBe("RESOLVED");
      expect(resolved.draftMessage).toBe("edited by human");
      expect(resolved.ticketResolvedDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

describe("AssignmentService (the offline stand-in for the DynamoDB-stream Lambda)", () => {
  const agents: User[] = [
    { userId: "agent-1", displayName: "A", email: "a@x", role: "SUPPORT_AGENT" },
    { userId: "agent-2", displayName: "B", email: "b@x", role: "SUPPORT_AGENT" },
    { userId: "agent-3", displayName: "C", email: "c@x", role: "SUPPORT_AGENT" },
  ];

  function build(opts: { agents?: User[]; poolSize?: number; ticketState?: Ticket[]; cursorStart?: number } = {}) {
    let cursor = opts.cursorStart ?? 0;
    const cursorRepo: IAssignmentCursorRepository = { incrementAndGet: jest.fn(async () => ++cursor), reset: jest.fn() };
    const userRepo = { listByRole: jest.fn(async () => opts.agents ?? agents) } as unknown as IUserRepository;
    const config = { get: jest.fn((_ns: string, _key: string, fallback: number) => opts.poolSize ?? fallback) } as unknown as ConfigResolver;
    const repo = ticketRepo(opts.ticketState ?? [ticket({ ticketId: "t1" })]);
    const bus = new InMemoryEventBus();
    const service = new AssignmentService(bus, repo, userRepo, cursorRepo, config);
    return { service, bus, repo, cursorRepo, config };
  }

  const event = (ticketId = "t1") => ({ type: "TicketCreated" as const, ticketId, creatorId: "rep", occurredAt: "now" });

  it("subscribes itself to TicketCreated on construction and assigns via the event bus", async () => {
    const { bus, repo } = build();
    await bus.publish(event());
    expect(repo.updateStatusAndFields).toHaveBeenCalledWith("t1", 1, { assigneeId: "agent-2", ticketStatus: "ASSIGNED" });
  });

  it("round-robins across the configured pool size, wrapping around", async () => {
    const { service, repo } = build({ poolSize: 2, ticketState: [ticket({ ticketId: "a" }), ticket({ ticketId: "b" }), ticket({ ticketId: "c" })] });
    await service.handleTicketCreated(event("a"));
    await service.handleTicketCreated(event("b"));
    await service.handleTicketCreated(event("c"));
    const assignees = repo.updateStatusAndFields.mock.calls.map((c) => c[2].assigneeId);
    // cursor 1,2,3 mod 2 -> agent-2, agent-1, agent-2 (agent-3 is outside the pool)
    expect(assignees).toEqual(["agent-2", "agent-1", "agent-2"]);
  });

  it("agentPoolSize 0 (local default) rotates across EVERY agent, so a freshly signed-up agent receives work", async () => {
    const { service, repo } = build({ poolSize: 0, ticketState: [ticket({ ticketId: "a" }), ticket({ ticketId: "b" }), ticket({ ticketId: "c" })] });
    await service.handleTicketCreated(event("a"));
    await service.handleTicketCreated(event("b"));
    await service.handleTicketCreated(event("c"));
    expect(repo.updateStatusAndFields.mock.calls.map((c) => c[2].assigneeId)).toEqual(["agent-2", "agent-3", "agent-1"]);
  });

  it("caps the pool at the number of agents that actually exist", async () => {
    const { service, repo } = build({ poolSize: 10, agents: agents.slice(0, 1) });
    await service.handleTicketCreated(event());
    expect(repo.updateStatusAndFields.mock.calls[0]![2].assigneeId).toBe("agent-1");
  });

  it("logs and skips when there are no agents, when the ticket is missing, and never double-assigns a non-OPEN ticket", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const none = build({ agents: [] });
    await none.service.handleTicketCreated(event());
    expect(none.cursorRepo.incrementAndGet).not.toHaveBeenCalled();

    const missing = build();
    await missing.service.handleTicketCreated(event("ghost"));
    expect(missing.repo.updateStatusAndFields).not.toHaveBeenCalled();

    const already = build({ ticketState: [ticket({ ticketId: "t1", ticketStatus: "ASSIGNED", assigneeId: "agent-9" })] });
    await already.service.handleTicketCreated(event());
    expect(already.repo.updateStatusAndFields).not.toHaveBeenCalled();

    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});

describe("errorHandler middleware", () => {
  function run(err: unknown) {
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as unknown as Response;
    errorHandler(err, {} as Request, res, jest.fn());
    return { status: (res.status as jest.Mock).mock.calls[0]![0] as number, body: json.mock.calls[0]![0] };
  }

  it("maps each domain error to its HTTP status and stable code", () => {
    expect(run(new ValidationError("v", ["d"]))).toEqual({ status: 400, body: { error: { code: "VALIDATION_ERROR", message: "v", details: ["d"] } } });
    expect(run(new UnauthorizedError("u")).status).toBe(401);
    expect(run(new ForbiddenError("f")).status).toBe(403);
    expect(run(new NotFoundError("n")).status).toBe(404);
    expect(run(new InvalidStateTransitionError("i")).status).toBe(409);
    expect(run(new ConflictError("c"))).toEqual({ status: 409, body: { error: { code: "CONFLICT", message: "c" } } });
  });

  it("hides unknown errors behind a generic 500 but logs message + stack for the CloudWatch 'Unhandled error:' filter", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(run(new Error("db exploded"))).toEqual({ status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Internal server error" } } });
    expect(errorSpy).toHaveBeenCalledWith("Unhandled error:", "db exploded");
    expect(String(errorSpy.mock.calls[1]![0])).toMatch(/^Error: db exploded/);

    errorSpy.mockClear();
    expect(run("a thrown string").status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith("Unhandled error:", "Unknown error");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
