import "reflect-metadata";
import { Express } from "express";
import request from "supertest";
import { createApp } from "../../src/app";
import { setupTestContainer, STRICT_CONFIG_FIXTURE_DIR, TEST_USERS } from "./setupTestContainer";
import { InMemoryTicketRepository } from "./fakes/InMemoryTicketRepository";

const AGENT_1 = TEST_USERS[0]!;
const AGENT_2 = TEST_USERS[1]!;

async function loginAs(app: Express, email: string, password: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

describe("Scaler backend integration (full HTTP stack, in-memory adapters)", () => {
  let app: Express;
  let ticketRepo: InMemoryTicketRepository;
  let agent1Token: string;

  beforeAll(async () => {
    const setup = await setupTestContainer();
    ticketRepo = setup.ticketRepo;
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
      .send({ creatorId: "customer-e", ticketOverview: "This is a test ticket for the summariser" });
    expect(created.status).toBe(201);

    const assignee = created.body.assigneeId as string;
    const assigneeUser = TEST_USERS.find((u) => u.userId === assignee)!;
    const assigneeToken = await loginAs(app, assigneeUser.email, assigneeUser.plaintextPassword);

    const summarised = await request(app)
      .post(`/api/cases/${created.body.ticketId}/summarise`)
      .set("Authorization", `Bearer ${assigneeToken}`)
      .send({});

    expect(summarised.status).toBe(200);
    expect(summarised.body.testModeTriggered).toBe(true);
    expect(summarised.body.caseSummary).toBe("test");
    expect(summarised.body.draftMessage).toBe("test");
  });

  it("summarises, edits and submits a draft, resolving the ticket", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${agent1Token}`)
      .send({ creatorId: "customer-f", ticketOverview: "Customer wants a refund for a damaged item" });
    expect(created.status).toBe(201);

    const assignee = created.body.assigneeId as string;
    const assigneeUser = TEST_USERS.find((u) => u.userId === assignee)!;
    const assigneeToken = await loginAs(app, assigneeUser.email, assigneeUser.plaintextPassword);

    const summarised = await request(app)
      .post(`/api/cases/${created.body.ticketId}/summarise`)
      .set("Authorization", `Bearer ${assigneeToken}`)
      .send({});
    expect(summarised.status).toBe(200);

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
