import "reflect-metadata";
import { Express } from "express";
import request from "supertest";
import { createApp } from "../../src/app";
import { setupTestContainer, STRICT_CONFIG_FIXTURE_DIR, TEST_USERS } from "./setupTestContainer";
import { InMemoryTicketRepository } from "./fakes/InMemoryTicketRepository";
import { InMemoryUserRepository } from "./fakes/InMemoryUserRepository";

const AGENT_1 = TEST_USERS[0]!;
const AGENT_2 = TEST_USERS[1]!;

async function loginAs(app: Express, email: string, password: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

describe("Meridian backend integration (full HTTP stack, in-memory adapters)", () => {
  let app: Express;
  let ticketRepo: InMemoryTicketRepository;
  let userRepo: InMemoryUserRepository;
  let agent1Token: string;

  beforeAll(async () => {
    const setup = await setupTestContainer();
    ticketRepo = setup.ticketRepo;
    userRepo = setup.userRepo;
    app = createApp();
    agent1Token = await loginAs(app, AGENT_1.email, AGENT_1.plaintextPassword);
  });

  it("rejects login with the wrong password", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: AGENT_1.email, password: "wrong-password" });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("logs in successfully and returns a token + user", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: AGENT_1.email, password: AGENT_1.plaintextPassword });
    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
    expect(response.body.user.userId).toBe(AGENT_1.userId);
  });

  describe("self-service sign-up", () => {
    const newcomer = { email: "newcomer@meridian.local", password: "NewcomerPass!1", displayName: "New Comer" };

    it("creates a SUPPORT_AGENT, returns 201 + a token that works immediately, and the account can log in normally", async () => {
      const response = await request(app).post("/api/auth/signup").send(newcomer);
      expect(response.status).toBe(201);
      expect(response.body.user).toMatchObject({ displayName: "New Comer", role: "SUPPORT_AGENT" });

      const me = await request(app).get("/api/tickets").set("Authorization", `Bearer ${response.body.token}`);
      expect(me.status).toBe(200);

      const login = await request(app).post("/api/auth/login").send({ email: newcomer.email, password: newcomer.password });
      expect(login.status).toBe(200);
      expect(login.body.user.userId).toBe(response.body.user.userId);
    });

    it("rejects a duplicate email with 409 CONFLICT, not 401", async () => {
      const response = await request(app).post("/api/auth/signup").send({ ...newcomer, displayName: "Again" });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("CONFLICT");
    });

    it("validates the body: short password, bad email, blank name", async () => {
      for (const bad of [
        { ...newcomer, email: "x@y.z", password: "short" },
        { ...newcomer, email: "not-an-email" },
        { ...newcomer, email: "y@z.w", displayName: "   " },
      ]) {
        const response = await request(app).post("/api/auth/signup").send(bad);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("ignores any role the caller tries to claim -- everyone signs up as SUPPORT_AGENT", async () => {
      const response = await request(app).post("/api/auth/signup").send({ email: "wannabe@meridian.local", password: "Password!123", displayName: "W", role: "ADMIN" });
      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe("SUPPORT_AGENT");
    });

    it("a signed-up agent is a real SUPPORT_AGENT the assignment pool can draw from (bounded by assignment.agentPoolSize)", async () => {
      const agents = await userRepo.listByRole("SUPPORT_AGENT");
      expect(agents.map((a) => a.email)).toEqual(expect.arrayContaining([newcomer.email, "wannabe@meridian.local"]));
      // The fixture pins agentPoolSize=2 so the round-robin tests above stay
      // deterministic; the pool is agents[0..1] by userId order, so seeded
      // "agent-*" ids stay in the pool and "user-<uuid>" newcomers wait for
      // ops to raise the tunable. This is the config knob, not a code change.
      const created = await request(app)
        .post("/api/tickets")
        .set("Authorization", `Bearer ${agent1Token}`)
        .send({ creatorId: "customer-pool", ticketOverview: "pool probe" });
      expect(created.status).toBe(201);
      expect([AGENT_1.userId, AGENT_2.userId]).toContain(created.body.assigneeId);
    });
  });

  it("creates a ticket, which is round-robin auto-assigned to a seeded agent", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-a", ticketOverview: "My package arrived damaged" });

    expect(response.status).toBe(201);
    expect(response.body.ticketStatus).toBe("ASSIGNED");
    expect([AGENT_1.userId, AGENT_2.userId]).toContain(response.body.assigneeId);
  });

  it("round-robins two tickets to two different seeded agents", async () => {
    const first = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-b", ticketOverview: "Question about my order status" });
    const second = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-c", ticketOverview: "Need a shipping update please" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.assigneeId).not.toBe(second.body.assigneeId);
  });

  it("rejects ticket creation with a missing overview", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-d" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects any ticket route call without a bearer token", async () => {
    const response = await request(app).get("/api/tickets");
    expect(response.status).toBe(401);
  });

  it("lists tickets with cursor-based pagination (fixture defaultLimit=2)", async () => {
    const firstPage = await request(app).get("/api/tickets").set("Authorization", `Bearer ${agent1Token}`);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items.length).toBeLessThanOrEqual(2);

    if (firstPage.body.hasMore) {
      const secondPage = await request(app)
        .get("/api/tickets")
        .query({ cursor: firstPage.body.nextCursor })
        .set("Authorization", `Bearer ${agent1Token}`);
      expect(secondPage.status).toBe(200);

      const firstPageIds = new Set(firstPage.body.items.map((t: { ticketId: string }) => t.ticketId));
      for (const item of secondPage.body.items) {
        expect(firstPageIds.has(item.ticketId)).toBe(false);
      }
    }
  });

  it("demonstrates the single-creator visibility edge case", async () => {
    // Bypass HTTP ticket creation (which always triggers synchronous
    // round-robin auto-assignment) to construct an unassigned ticket
    // directly, so we can exercise the "sole creator may see their own
    // unassigned ticket" rule in isolation. agent-1 plays the role of the
    // ticket's creator here.
    ticketRepo.clear();
    const soleTicket = await ticketRepo.create({
      creatorId: AGENT_1.userId,
      ticketOverview: "Only ticket so far, still unassigned",
    });
    expect(soleTicket.ticketStatus).toBe("OPEN");

    const visibleAsSoleCreator = await request(app)
      .get(`/api/tickets/${soleTicket.ticketId}`)
      .set("Authorization", `Bearer ${agent1Token}`);
    // agent-1 IS the ticket's creator, and is currently the only distinct
    // creator system-wide, so the exception applies: visible despite being
    // unassigned.
    expect(visibleAsSoleCreator.status).toBe(200);

    // Now add a second ticket from a different creator -- the visibility
    // exception no longer applies, so the original unassigned ticket
    // becomes hidden even from its own creator (until it's assigned).
    await ticketRepo.create({ creatorId: "another-customer", ticketOverview: "A second, different customer" });

    const nowHidden = await request(app)
      .get(`/api/tickets/${soleTicket.ticketId}`)
      .set("Authorization", `Bearer ${agent1Token}`);
    expect(nowHidden.status).toBe(403);

    ticketRepo.clear();
  });

  it("summarises a case via the test-stub bypass (overview contains 'test')", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-e", customerId: "cust-1", ticketOverview: "This is a test ticket for the summariser" });
    expect(created.status).toBe(201);

    const assignee = created.body.assigneeId as string;
    const assigneeUser = TEST_USERS.find((u) => u.userId === assignee)!;
    const assigneeToken = await loginAs(app, assigneeUser.email, assigneeUser.plaintextPassword);

    const summarised = await request(app)
      .post(`/api/cases/${created.body.ticketId}/summarise`)
      .set("Authorization", `Bearer ${assigneeToken}`)
      .send({});

    expect(summarised.status).toBe(200);
    expect(summarised.body.outcome).toBe("DRAFTED");
    expect(summarised.body.testModeTriggered).toBe(true);
    expect(summarised.body.caseSummary).toBe("test");
    expect(summarised.body.draftMessage).toBe("test");
  });

  it("returns NEEDS_INFO (no draft) when the ticket has no customer, then drafts after the agent adds one", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-h", ticketOverview: "Refund please -- test" });
    expect(created.status).toBe(201);
    expect(created.body.customerId).toBeUndefined();

    const assignee = created.body.assigneeId as string;
    const assigneeUser = TEST_USERS.find((u) => u.userId === assignee)!;
    const assigneeToken = await loginAs(app, assigneeUser.email, assigneeUser.plaintextPassword);

    const first = await request(app)
      .post(`/api/cases/${created.body.ticketId}/summarise`)
      .set("Authorization", `Bearer ${assigneeToken}`)
      .send({});
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("NEEDS_INFO");
    expect(first.body.missingInformation[0]).toMatch(/Customer ID/);
    expect(first.body.caseSummary).toBeUndefined();

    // Status must not have moved -- nothing was generated.
    const unchanged = await request(app)
      .get(`/api/cases/${created.body.ticketId}`)
      .set("Authorization", `Bearer ${assigneeToken}`);
    expect(unchanged.body.ticketStatus).toBe("ASSIGNED");

    // The agent supplies the missing fact and retries.
    const patched = await request(app)
      .patch(`/api/cases/${created.body.ticketId}/facts`)
      .set("Authorization", `Bearer ${assigneeToken}`)
      .send({ customerId: "cust-1", orderId: "order-1" });
    expect(patched.status).toBe(200);
    expect(patched.body.customerId).toBe("cust-1");
    expect(patched.body.orderId).toBe("order-1");

    const second = await request(app)
      .post(`/api/cases/${created.body.ticketId}/summarise`)
      .set("Authorization", `Bearer ${assigneeToken}`)
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe("DRAFTED");
    expect(second.body.suppliedFacts.customerId).toBe("cust-1");
    expect(second.body.suppliedFacts.order.orderId).toBe("order-1");
    expect(second.body.checks.every((c: { passed: boolean }) => c.passed)).toBe(true);

    // The supplied context is persisted on the ticket for the reviewer.
    const after = await request(app)
      .get(`/api/cases/${created.body.ticketId}`)
      .set("Authorization", `Bearer ${assigneeToken}`);
    expect(after.body.ticketStatus).toBe("DRAFT_PENDING_REVIEW");
    expect(after.body.suppliedContext.facts.order.orderId).toBe("order-1");
    expect(after.body.suppliedContext.checks.length).toBeGreaterThan(0);

    // Regenerate: allowed while still in DRAFT_PENDING_REVIEW, status unchanged.
    const again = await request(app)
      .post(`/api/cases/${created.body.ticketId}/summarise`)
      .set("Authorization", `Bearer ${assigneeToken}`)
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe("DRAFTED");
    const afterAgain = await request(app)
      .get(`/api/cases/${created.body.ticketId}`)
      .set("Authorization", `Bearer ${assigneeToken}`);
    expect(afterAgain.body.ticketStatus).toBe("DRAFT_PENDING_REVIEW");
  });

  it("C2: a delivered order with no delivery date stops at the gate", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-i", customerId: "cust-1", orderId: "order-nodate", ticketOverview: "Damaged gadget -- test" });
    expect(created.status).toBe(201);

    const assignee = created.body.assigneeId as string;
    const assigneeUser = TEST_USERS.find((u) => u.userId === assignee)!;
    const assigneeToken = await loginAs(app, assigneeUser.email, assigneeUser.plaintextPassword);

    const result = await request(app)
      .post(`/api/cases/${created.body.ticketId}/summarise`)
      .set("Authorization", `Bearer ${assigneeToken}`)
      .send({});
    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("NEEDS_INFO");
    expect(result.body.missingInformation[0]).toMatch(/Delivery date for order order-nodate/);
  });

  it("another agent cannot change a ticket's facts", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-j", ticketOverview: "Facts permission probe" });
    expect(created.status).toBe(201);
    const assignee = created.body.assigneeId as string;
    const other = TEST_USERS.find((u) => u.userId !== assignee && u.role === "SUPPORT_AGENT")!;
    const otherToken = await loginAs(app, other.email, other.plaintextPassword);

    const patched = await request(app)
      .patch(`/api/cases/${created.body.ticketId}/facts`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ customerId: "cust-1" });
    expect(patched.status).toBe(403);
  });

  it("summarises, edits and submits a draft, resolving the ticket", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-f", customerId: "cust-1", ticketOverview: "Customer wants a refund for a damaged item" });
    expect(created.status).toBe(201);

    const assignee = created.body.assigneeId as string;
    const assigneeUser = TEST_USERS.find((u) => u.userId === assignee)!;
    const assigneeToken = await loginAs(app, assigneeUser.email, assigneeUser.plaintextPassword);

    const summarised = await request(app)
      .post(`/api/cases/${created.body.ticketId}/summarise`)
      .set("Authorization", `Bearer ${assigneeToken}`)
      .send({});
    expect(summarised.status).toBe(200);
    expect(summarised.body.outcome).toBe("DRAFTED");

    const editedDraft = "Edited draft: we're sorry about the damage, a refund is on its way.";
    const submitted = await request(app)
      .post(`/api/cases/${created.body.ticketId}/draft`)
      .set("Authorization", `Bearer ${assigneeToken}`)
      .send({ draftMessage: editedDraft });

    expect(submitted.status).toBe(200);
    expect(submitted.body.ticketStatus).toBe("RESOLVED");
    expect(submitted.body.draftMessage).toBe(editedDraft);
    expect(submitted.body.ticketResolvedDate).toBeTruthy();
  });

  it("lists the assignee's own case queue via /api/cases", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-g", ticketOverview: "Another support request" });
    expect(created.status).toBe(201);

    const assignee = created.body.assigneeId as string;
    const assigneeUser = TEST_USERS.find((u) => u.userId === assignee)!;
    const assigneeToken = await loginAs(app, assigneeUser.email, assigneeUser.plaintextPassword);

    const cases = await request(app).get("/api/cases").set("Authorization", `Bearer ${assigneeToken}`);
    expect(cases.status).toBe(200);
    expect(cases.body.items.some((t: { ticketId: string }) => t.ticketId === created.body.ticketId)).toBe(true);
  });
});

describe("Rate limiting (isolated app instance for a clean counter)", () => {
  it("returns 429 once the configured ticketCreate max is exceeded within the window", async () => {
    await setupTestContainer(STRICT_CONFIG_FIXTURE_DIR);
    const isolatedApp = createApp();
    const token = await loginAs(isolatedApp, AGENT_1.email, AGENT_1.plaintextPassword);

    // Strict fixture config: rateLimit.ticketCreateMax = 3 within a 5s window.
    const statuses: number[] = [];
    let fourthBody: { error?: { code?: string } } = {};
    for (let i = 0; i < 4; i += 1) {
      const response = await request(isolatedApp)
        .post("/api/tickets")
        .set("Authorization", `Bearer ${token}`)
        .send({ creatorId: `rl-customer-${i}`, ticketOverview: `Rate limit probe ${i}` });
      statuses.push(response.status);
      if (i === 3) {
        fourthBody = response.body;
      }
    }

    expect(statuses.slice(0, 3).every((s) => s === 201)).toBe(true);
    expect(statuses[3]).toBe(429);
    expect(fourthBody.error?.code).toBe("RATE_LIMITED");
  });
});
