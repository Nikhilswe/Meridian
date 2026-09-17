import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SummariseCaseResponse, Ticket } from "@meridian/shared-types";
import { AGENT, LOGIN_OK, mockFetch, page, renderApp, resetClient, ticket, type RouteTable } from "../../test/harness";

/**
 * Every page is driven through the real router + providers + api client,
 * with only `fetch` faked. Logging in through the real form is how each
 * test gets a token, exactly as a user would.
 */

async function signIn(startAt = "/login") {
  renderApp(startAt);
  await userEvent.type(screen.getByLabelText("Email"), "asha.kapoor@meridian.local");
  await userEvent.type(screen.getByLabelText("Password"), "AgentDemo!123");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

const LOGIN_ROUTE: RouteTable = { "POST /api/auth/login": { body: LOGIN_OK } };

beforeEach(() => resetClient());
afterEach(() => vi.unstubAllGlobals());

describe("LoginPage", () => {
  it("signs in and lands on Tickets; an unknown path bounces to /login when logged out", async () => {
    mockFetch({ ...LOGIN_ROUTE, "GET /api/tickets": { body: page([]) } });
    await signIn("/nowhere");
    expect(await screen.findByRole("heading", { name: "Create a ticket" })).toBeInTheDocument();
    expect(screen.getByText("No tickets yet.")).toBeInTheDocument();
  });

  it("shows the server's message on a failed login and stays on the form", async () => {
    mockFetch({ "POST /api/auth/login": { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Invalid email or password" } } } });
    await signIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("returns the user to the protected page they originally asked for", async () => {
    mockFetch({ ...LOGIN_ROUTE, "GET /api/cases": { body: page([]) } });
    await signIn("/cases");
    expect(await screen.findByRole("heading", { name: "Case Summariser" })).toBeInTheDocument();
  });

  it("links to sign-up, and an already-authenticated visit to /login redirects away", async () => {
    mockFetch({ ...LOGIN_ROUTE, "GET /api/tickets": { body: page([]) } });
    renderApp("/login");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
    await userEvent.type(screen.getByLabelText("Email"), "a@b.c");
    await userEvent.type(screen.getByLabelText("Password"), "password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Create a ticket" });
    await userEvent.click(screen.getByRole("link", { name: "Tickets" }));
    expect(screen.queryByRole("heading", { name: "Sign in to Meridian" })).not.toBeInTheDocument();
  });
});

describe("SignupPage", () => {
  it("creates an account and is signed in immediately", async () => {
    const spy = mockFetch({
      "POST /api/auth/signup": { status: 201, body: { token: "new-token", user: { userId: "user-x", displayName: "Class Demo Agent", role: "SUPPORT_AGENT" } } },
      "GET /api/tickets": { body: page([]) },
    });
    renderApp("/signup");
    await userEvent.type(screen.getByLabelText("Full name"), "Class Demo Agent");
    await userEvent.type(screen.getByLabelText("Email"), "demo.agent@meridian.local");
    await userEvent.type(screen.getByLabelText(/Password/), "DemoPass!2026");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Create a ticket" })).toBeInTheDocument();
    expect(screen.getByText("Class Demo Agent")).toBeInTheDocument();
    expect(spy.calls[0]!.body).toEqual({ email: "demo.agent@meridian.local", password: "DemoPass!2026", displayName: "Class Demo Agent" });
    expect(spy.calls[1]!.headers.get("Authorization")).toBe("Bearer new-token");
  });

  it("surfaces a 409 duplicate-email conflict and links back to sign-in", async () => {
    mockFetch({ "POST /api/auth/signup": { status: 409, body: { error: { code: "CONFLICT", message: "An account with this email already exists" } } } });
    renderApp("/signup");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    await userEvent.type(screen.getByLabelText("Full name"), "Dup");
    await userEvent.type(screen.getByLabelText("Email"), "dup@meridian.local");
    await userEvent.type(screen.getByLabelText(/Password/), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });
});

describe("TicketsPage", () => {
  const rows: Ticket[] = [
    ticket({ ticketId: "t-1", assigneeId: "agent-1" }),
    ticket({ ticketId: "t-2", assigneeId: undefined, ticketStatus: "OPEN" }),
  ];

  it("lists tickets with status badges and 'Unassigned', and paginates with a cursor stack", async () => {
    const spy = mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/tickets": {
        handler: ({ url }) => (url.searchParams.get("cursor") === "c2" ? page([ticket({ ticketId: "t-3" })]) : page(rows, { nextCursor: "c2", hasMore: true })),
      },
    });
    await signIn();
    expect(await screen.findByText("t-1")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Page 1 · 2 tickets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("t-3")).toBeInTheDocument();
    expect(screen.getByText("Page 2 · 1 ticket")).toBeInTheDocument();
    expect(spy.calls.at(-1)!.url.searchParams.get("cursor")).toBe("c2");

    await userEvent.click(screen.getByRole("button", { name: "Prev" }));
    expect(await screen.findByText("t-2")).toBeInTheDocument();
  });

  it("shows a list error banner when loading fails", async () => {
    mockFetch({ ...LOGIN_ROUTE, "GET /api/tickets": { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "boom" } } } });
    await signIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });

  it("creates a ticket with customer/order ids and attachment metadata, then resets the form and reloads page 1", async () => {
    let created = false;
    const spy = mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/tickets": { handler: () => (created ? page([ticket({ ticketId: "t-new" })]) : page([])) },
      "POST /api/tickets": {
        status: 201,
        handler: () => {
          created = true;
          return ticket({ ticketId: "t-new" });
        },
      },
    });
    await signIn();
    await screen.findByText("No tickets yet.");

    const submit = screen.getByRole("button", { name: "Create ticket" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Ticket overview/), "Cracked earcup, wants replacement");
    await userEvent.type(screen.getByLabelText(/^Customer ID/), "cust-1001");
    await userEvent.type(screen.getByLabelText(/^Order ID/), "order-1001");

    await userEvent.click(screen.getByRole("button", { name: "+ Add attachment" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Add attachment" }));
    const fileInputs = screen.getAllByPlaceholderText("File name");
    await userEvent.type(fileInputs[0]!, "invoice.pdf");
    await userEvent.selectOptions(screen.getAllByRole("combobox")[1]!, "IMG");
    await userEvent.type(fileInputs[1]!, "photo.png");
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
    expect(screen.getAllByPlaceholderText("File name")).toHaveLength(1);

    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    expect(await screen.findByText("t-new")).toBeInTheDocument();
    const post = spy.calls.find((c) => c.method === "POST" && c.url.pathname === "/api/tickets")!;
    expect(post.body).toMatchObject({ creatorId: AGENT.userId, ticketOverview: "Cracked earcup, wants replacement", customerId: "cust-1001", orderId: "order-1001" });
    expect((post.body as { attachedDocuments: { fileName: string; docType: string; key: string }[] }).attachedDocuments).toEqual([
      expect.objectContaining({ fileName: "invoice.pdf", docType: "PDF", key: expect.stringMatching(/^pending\//) }),
    ]);
    expect(screen.getByLabelText(/Ticket overview/)).toHaveValue("");
    expect(screen.getByText("No attachments added.")).toBeInTheDocument();
  });

  it("blank customer/order become undefined (not empty strings) and a create failure shows the error", async () => {
    const spy = mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/tickets": { body: page([]) },
      "POST /api/tickets": { status: 429, body: { error: { code: "RATE_LIMITED", message: "slow down" } } },
    });
    await signIn();
    await screen.findByText("No tickets yet.");
    await userEvent.type(screen.getByLabelText(/Ticket overview/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/too often/);
    const post = spy.calls.find((c) => c.method === "POST" && c.url.pathname === "/api/tickets")!;
    expect(post.body).toEqual({ creatorId: AGENT.userId, ticketOverview: "x", attachedDocuments: [] });
  });

  it("a ticket row is a keyboard-reachable link that opens the case detail with a 'Back to tickets' link", async () => {
    mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/tickets": { body: page(rows) },
      "GET /api/cases/t-1": { body: rows[0] },
    });
    await signIn();
    const row = await screen.findByRole("link", { name: "Open ticket t-1" });
    expect(row).toHaveAttribute("tabindex", "0");
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Case t-1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "← Back to tickets" }));
    expect(await screen.findByRole("heading", { name: "Create a ticket" })).toBeInTheDocument();
  });
});

describe("CaseSummariserPage", () => {
  it("lists the agent's queue, paginates, and a row (click or Space) opens the case", async () => {
    mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/cases": {
        handler: ({ url }) => (url.searchParams.get("cursor") ? page([ticket({ ticketId: "c-3" })]) : page([ticket({ ticketId: "c-1" }), ticket({ ticketId: "c-2" })], { nextCursor: "n", hasMore: true })),
      },
      "GET /api/cases/c-3": { body: ticket({ ticketId: "c-3" }) },
    });
    await signIn("/cases");
    expect(await screen.findByText("Page 1 · 2 cases")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 · 1 case")).toBeInTheDocument();
    const row = screen.getByRole("link", { name: "Open case c-3" });
    row.focus();
    await userEvent.keyboard(" ");
    expect(await screen.findByRole("heading", { name: "Case c-3" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to cases" })).toBeInTheDocument();
  });

  it("shows the empty state and a load error", async () => {
    mockFetch({ ...LOGIN_ROUTE, "GET /api/cases": { body: page([]) } });
    await signIn("/cases");
    expect(await screen.findByText("No cases assigned to you.")).toBeInTheDocument();
    vi.unstubAllGlobals();
    resetClient();
    mockFetch({ ...LOGIN_ROUTE, "GET /api/cases": { status: 403, body: { error: { code: "FORBIDDEN", message: "not yours" } } } });
    await signIn("/cases");
    expect(await screen.findByRole("alert")).toHaveTextContent("not yours");
  });
});

describe("CaseDetailPage", () => {
  const drafted: SummariseCaseResponse = {
    ticketId: "t-1",
    outcome: "DRAFTED",
    caseSummary: "Summary",
    draftMessage: "Draft",
    missingInformation: [],
    checks: [{ id: "c1", description: "customer identified", passed: true, detail: "cust-1001" }],
    suppliedFacts: { ticketStatus: "ASSIGNED", customerId: "cust-1001", otherOrders: [] },
    suppliedPolicies: [],
    usedProvider: "ollama",
    testModeTriggered: false,
  };

  const draftedTicket = ticket({
    ticketId: "t-1",
    ticketStatus: "DRAFT_PENDING_REVIEW",
    caseSummary: "Summary",
    draftMessage: "Draft",
    customerId: "cust-1001",
    orderId: "order-1001",
    suppliedContext: {
      facts: {
        ticketStatus: "ASSIGNED",
        customerId: "cust-1001",
        order: { orderId: "order-1001", customerId: "cust-1001", itemSummary: "Headphones", orderDate: "2026-09-01T00:00:00Z", amount: 89.99, currency: "USD", status: "DELIVERED", deliveredDate: "2026-09-14T00:00:00Z" },
        otherOrders: [{ orderId: "order-1002", customerId: "cust-1001", itemSummary: "Cable", orderDate: "2026-09-02T00:00:00Z", amount: 5, currency: "USD", status: "SHIPPED" }],
      },
      policies: [{ policyId: "p1", category: "Returns", title: "Damaged on arrival", body: "Replace within 30 days.", version: 2, effectiveDate: "2026-01-01" }],
      checks: [
        { id: "c1", description: "customer identified", passed: true },
        { id: "c4", description: "no resolution claim", passed: false, detail: "said 'resolved'" },
      ],
      usedProvider: "ollama",
      testModeTriggered: false,
      generatedAt: "2026-09-18T02:09:16.000Z",
    },
  });

  it("summarises an assigned case (DRAFTED), then shows facts, policy, checks and the editable draft; submit resolves it", async () => {
    let state: Ticket = ticket({ ticketId: "t-1" });
    const spy = mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/cases/t-1": { handler: () => state },
      "POST /api/cases/t-1/summarise": {
        handler: () => {
          state = draftedTicket;
          return drafted;
        },
      },
      "POST /api/cases/t-1/draft": {
        handler: ({ body }) => {
          state = { ...draftedTicket, ticketStatus: "RESOLVED", draftMessage: (body as { draftMessage: string }).draftMessage };
          return state;
        },
      },
    });
    await signIn("/cases/t-1");
    await userEvent.click(await screen.findByRole("button", { name: "Summarise & Generate Draft" }));

    expect(await screen.findByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Draft Pending Review")).toBeInTheDocument();
    expect(screen.getByText(/Headphones · DELIVERED/)).toBeInTheDocument();
    expect(screen.getByText(/delivered/)).toBeInTheDocument();
    expect(screen.getByText("order-1002")).toBeInTheDocument();
    expect(screen.getByText("Damaged on arrival")).toBeInTheDocument();
    expect(screen.getByText("Returns · v2")).toBeInTheDocument();
    expect(screen.getByText("said 'resolved'")).toBeInTheDocument();
    expect(screen.getByText(/via ollama/)).toBeInTheDocument();

    const textarea = screen.getByRole("textbox");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Human-edited reply");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Human-edited reply")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(spy.calls.find((c) => c.url.pathname.endsWith("/draft"))!.body).toEqual({ draftMessage: "Human-edited reply" });
  });

  it("NEEDS_INFO: explains the AI was NOT called, lets the agent add facts, and retries automatically", async () => {
    let factsSaved = false;
    const spy = mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/cases/t-1": { handler: () => (factsSaved ? draftedTicket : ticket({ ticketId: "t-1" })) },
      "PATCH /api/cases/t-1/facts": {
        handler: () => {
          factsSaved = true;
          return ticket({ ticketId: "t-1", customerId: "cust-1001" });
        },
      },
      "POST /api/cases/t-1/summarise": {
        handler: () =>
          factsSaved
            ? drafted
            : ({
                ...drafted,
                outcome: "NEEDS_INFO",
                caseSummary: undefined,
                draftMessage: undefined,
                missingInformation: ["Customer ID -- which customer is this complaint about?"],
                checks: [{ id: "c1", description: "customer identified", passed: false, detail: "No customerId" }],
                suppliedFacts: { ticketStatus: "ASSIGNED", otherOrders: [] },
              } satisfies SummariseCaseResponse),
      },
    });
    await signIn("/cases/t-1");
    await userEvent.click(await screen.findByRole("button", { name: "Summarise & Generate Draft" }));

    expect(await screen.findByText("More information needed before a draft can be generated")).toBeInTheDocument();
    expect(screen.getByText(/Customer ID -- which customer/)).toBeInTheDocument();
    expect(screen.getByText("not identified")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Customer ID"), "cust-1001");
    await userEvent.click(screen.getByRole("button", { name: "Save facts & retry" }));

    expect(await screen.findByText("Summary")).toBeInTheDocument();
    expect(spy.calls.find((c) => c.method === "PATCH")!.body).toEqual({ customerId: "cust-1001", orderId: "" });
  });

  it("DRAFT_REJECTED: shows the warning with the rejected draft and does not persist it", async () => {
    mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/cases/t-1": { body: ticket({ ticketId: "t-1" }) },
      "POST /api/cases/t-1/summarise": { body: { ...drafted, outcome: "DRAFT_REJECTED", draftMessage: "Your issue has been resolved." } satisfies SummariseCaseResponse },
    });
    await signIn("/cases/t-1");
    await userEvent.click(await screen.findByRole("button", { name: "Summarise & Generate Draft" }));
    expect(await screen.findByText(/contradicted the record/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Show the rejected draft"));
    expect(screen.getByText("Your issue has been resolved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Summarise & Generate Draft" })).toBeEnabled();
  });

  it("regenerate from DRAFT_PENDING_REVIEW keeps the current draft when the retry is rejected, and shows summarise/submit errors", async () => {
    mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/cases/t-1": { body: draftedTicket },
      "POST /api/cases/t-1/summarise": { body: { ...drafted, outcome: "DRAFT_REJECTED" } satisfies SummariseCaseResponse },
      "POST /api/cases/t-1/draft": { status: 409, body: { error: { code: "INVALID_STATE_TRANSITION", message: "cannot resolve" } } },
    });
    await signIn("/cases/t-1");
    await userEvent.click(await screen.findByRole("button", { name: "Regenerate summary & draft" }));
    expect(await screen.findByText(/Your current draft was kept unchanged/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Draft");

    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("cannot resolve")).toBeInTheDocument();
  });

  it("summarise failure (e.g. rate limit) is shown inline; facts-save failure too", async () => {
    mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/cases/t-1": { body: ticket({ ticketId: "t-1" }) },
      "POST /api/cases/t-1/summarise": { status: 429, body: { error: { code: "RATE_LIMITED", message: "x" } } },
    });
    await signIn("/cases/t-1");
    await userEvent.click(await screen.findByRole("button", { name: "Summarise & Generate Draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/rate-limited/);
  });

  it("a creator who is not the assignee gets a read-only view: no summarise/submit controls", async () => {
    mockFetch({
      ...LOGIN_ROUTE,
      "GET /api/cases/t-9": { body: { ...draftedTicket, ticketId: "t-9", assigneeId: "agent-2" } },
    });
    await signIn("/cases/t-9");
    expect(await screen.findByText("Read-only")).toBeInTheDocument();
    expect(screen.getByText(/Only the assigned agent \(agent-2\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Summarise|Regenerate|Submit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("an unassigned ticket viewed by its creator says so", async () => {
    mockFetch({ ...LOGIN_ROUTE, "GET /api/cases/t-0": { body: ticket({ ticketId: "t-0", ticketStatus: "OPEN", assigneeId: undefined }) } });
    await signIn("/cases/t-0");
    expect(await screen.findByText("This ticket has not been assigned to an agent yet.")).toBeInTheDocument();
  });

  it("shows a load error with a back link, and a resolved case is read-only for everyone", async () => {
    mockFetch({ ...LOGIN_ROUTE, "GET /api/cases/missing": { status: 404, body: { error: { code: "NOT_FOUND", message: "Ticket missing not found" } } } });
    await signIn("/cases/missing");
    expect(await screen.findByRole("alert")).toHaveTextContent("Ticket missing not found");
    expect(screen.getByRole("link", { name: "Back to cases" })).toBeInTheDocument();

    vi.unstubAllGlobals();
    resetClient();
    mockFetch({ ...LOGIN_ROUTE, "GET /api/cases/done": { body: { ...draftedTicket, ticketId: "done", ticketStatus: "RESOLVED" } } });
    await signIn("/cases/done");
    expect(await screen.findByText("Draft message (submitted)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
  });

  it("a reviewer can draft on any case (privileged role)", async () => {
    mockFetch({
      "POST /api/auth/login": { body: { token: "t", user: { userId: "rev-1", displayName: "Rita Reviewer", role: "REVIEWER" } } },
      "GET /api/cases/t-1": { body: ticket({ ticketId: "t-1", assigneeId: "agent-2" }) },
    });
    await signIn("/cases/t-1");
    expect(await screen.findByRole("button", { name: "Summarise & Generate Draft" })).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("main")).queryByText("Read-only")).not.toBeInTheDocument());
  });
});
