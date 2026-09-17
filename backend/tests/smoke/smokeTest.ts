/**
 * Standalone smoke test: real HTTP calls against a RUNNING server (start it
 * separately, e.g. `npm run dev` or `docker compose up`). Run via
 * `npm run smoke`. Prints a PASS/FAIL line per scenario and exits non-zero
 * if anything failed, so it's usable as a CI gate against a live
 * deployment.
 *
 * Logs in as the dedicated smoke-test user seeded by src/db/seed.ts
 * (smoke-test@scaler.local). Its password comes from SMOKE_TEST_PASSWORD
 * (same env var seed.ts reads), defaulting to the same demo value so a
 * fresh `npm run seed` + `npm run smoke` pair just works.
 */

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:4000";
const SMOKE_EMAIL = "smoke-test@scaler.local";
const SMOKE_PASSWORD = process.env.SMOKE_TEST_PASSWORD || "SmokeTest!123";

interface ScenarioResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: ScenarioResult[] = [];

async function runScenario(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`PASS - ${name}`);
  } catch (err) {
    results.push({ name, passed: false, error: (err as Error).message });
    console.log(`FAIL - ${name}: ${(err as Error).message}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function api(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let body: unknown = undefined;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
}

async function main(): Promise<void> {
  let token = "";
  let createdTicketIds: string[] = [];
  let testModeTicketId = "";
  let caseToResolveId = "";

  await runScenario("login as smoke-test user", async () => {
    const { status, body } = await api("/api/auth/login", {
      method: "POST",
      body: { email: SMOKE_EMAIL, password: SMOKE_PASSWORD },
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.token, "expected a token in the login response");
    token = body.token;
  });

  await runScenario("create several tickets, including one with the word 'test'", async () => {
    const overviews = [
      "Customer says their order never arrived",
      "This is a test ticket to exercise the bypass path",
      "Customer wants to know about the refund policy",
    ];
    for (const overview of overviews) {
      const { status, body } = await api("/api/tickets", {
        method: "POST",
        token,
        body: { creatorId: "smoke-customer", ticketOverview: overview },
      });
      assert(status === 201, `expected 201 creating ticket, got ${status}: ${JSON.stringify(body)}`);
      createdTicketIds.push(body.ticketId);
      if (overview.toLowerCase().includes("test")) {
        testModeTicketId = body.ticketId;
      }
    }
    assert(createdTicketIds.length === 3, "expected 3 tickets to be created");
    assert(testModeTicketId, "expected one created ticket to contain the word 'test'");
  });

  await runScenario("list tickets with pagination across pages", async () => {
    const firstPage = await api("/api/tickets?limit=2", { token });
    assert(firstPage.status === 200, `expected 200, got ${firstPage.status}`);
    assert(firstPage.body.items.length <= 2, "expected at most 2 items on the first page");

    if (firstPage.body.hasMore) {
      const secondPage = await api(`/api/tickets?limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`, {
        token,
      });
      assert(secondPage.status === 200, `expected 200 on second page, got ${secondPage.status}`);
      const firstIds = new Set(firstPage.body.items.map((t: { ticketId: string }) => t.ticketId));
      for (const item of secondPage.body.items) {
        assert(!firstIds.has(item.ticketId), "second page must not repeat items from the first page");
      }
    }
  });

  await runScenario("list assigned cases", async () => {
    const { status, body } = await api("/api/cases", { token });
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(body.items), "expected items[] in the cases response");
    const mine = body.items.find((t: { ticketId: string }) => createdTicketIds.includes(t.ticketId));
    if (mine) {
      caseToResolveId = mine.ticketId;
    }
  });

  await runScenario("summarise a case (test-stub / bypass path)", async () => {
    const ticketId = testModeTicketId || caseToResolveId || createdTicketIds[0];
    assert(ticketId, "need at least one ticket to summarise");
    const { status, body } = await api(`/api/cases/${ticketId}/summarise`, { method: "POST", token, body: {} });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    if (ticketId === testModeTicketId) {
      assert(body.testModeTriggered === true, "expected testModeTriggered=true for the 'test' overview ticket");
      assert(body.caseSummary === "test" && body.draftMessage === "test", "expected deterministic test values");
    }
    caseToResolveId = ticketId;
  });

  await runScenario("edit and submit the draft, resolving the ticket", async () => {
    assert(caseToResolveId, "need a summarised case to submit a draft for");
    const editedDraft = "Edited by smoke test: thanks for your patience, this has been resolved.";
    const { status, body } = await api(`/api/cases/${caseToResolveId}/draft`, {
      method: "POST",
      token,
      body: { draftMessage: editedDraft },
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ticketStatus === "RESOLVED", `expected RESOLVED, got ${body.ticketStatus}`);
    assert(body.draftMessage === editedDraft, "expected the edited draft message to be persisted");
    assert(!!body.ticketResolvedDate, "expected ticketResolvedDate to be set");
  });

  await runScenario("verify the final ticket status via GET", async () => {
    const { status, body } = await api(`/api/tickets/${caseToResolveId}`, { token });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.ticketStatus === "RESOLVED", `expected RESOLVED, got ${body.ticketStatus}`);
  });

  await runScenario("exceed the ticket-create rate limit and confirm a 429", async () => {
    let sawRateLimited = false;
    for (let i = 0; i < 25; i += 1) {
      const { status } = await api("/api/tickets", {
        method: "POST",
        token,
        body: { creatorId: "smoke-customer", ticketOverview: `Rate limit probe ${i}` },
      });
      if (status === 429) {
        sawRateLimited = true;
        break;
      }
    }
    assert(sawRateLimited, "expected to eventually receive a 429 after exceeding the configured rate limit");
  });

  const failed = results.filter((r) => !r.passed);
  console.log("\n=== Smoke test summary ===");
  for (const r of results) {
    console.log(`${r.passed ? "PASS" : "FAIL"} - ${r.name}${r.error ? `: ${r.error}` : ""}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke test crashed:", (err as Error).message);
  process.exit(1);
});
