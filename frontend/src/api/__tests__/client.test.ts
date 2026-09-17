import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPatch, apiPost, getAuthToken, setAuthToken, setUnauthorizedHandler } from "../client";
import { login, signup } from "../auth";
import { createTicket, getTicket, listTickets } from "../tickets";
import { getCase, listCases, submitDraft, summariseCase, updateCaseFacts } from "../cases";
import { mockFetch, resetClient } from "../../test/harness";

describe("api/client", () => {
  beforeEach(() => resetClient());
  afterEach(() => vi.unstubAllGlobals());

  it("builds URLs against the API base, drops undefined query params and only sends Authorization when a token is set", async () => {
    const spy = mockFetch({ "GET /api/tickets": { body: { ok: true } } });
    await apiGet("/api/tickets", { cursor: undefined, limit: 10 });
    expect(spy.calls[0]!.url.toString()).toBe("http://localhost:4000/api/tickets?limit=10");
    expect(spy.calls[0]!.headers.has("Authorization")).toBe(false);

    setAuthToken("abc");
    expect(getAuthToken()).toBe("abc");
    await apiGet("/api/tickets");
    expect(spy.calls[1]!.headers.get("Authorization")).toBe("Bearer abc");
  });

  it("POST/PATCH send JSON bodies with the content-type header, and no body when none is given", async () => {
    const spy = mockFetch({ "POST /api/x": { body: { id: 1 } }, "PATCH /api/x": { body: { id: 2 } } });
    await expect(apiPost("/api/x", { a: 1 })).resolves.toEqual({ id: 1 });
    await expect(apiPatch("/api/x", { b: 2 })).resolves.toEqual({ id: 2 });
    await apiPost("/api/x");
    expect(spy.calls[0]!.body).toEqual({ a: 1 });
    expect(spy.calls[0]!.headers.get("Content-Type")).toBe("application/json");
    expect(spy.calls[1]!.method).toBe("PATCH");
    expect(spy.calls[2]!.body).toBeUndefined();
  });

  it("throws ApiError carrying status + server body, or the fallback message when the body is not an error envelope", async () => {
    mockFetch({
      "GET /api/bad": { status: 409, body: { error: { code: "CONFLICT", message: "already exists" } } },
      "GET /api/plain": { status: 500, body: "not json at all" },
    });
    const err = await apiGet("/api/bad").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("already exists");
    expect((err as ApiError).body?.error.code).toBe("CONFLICT");

    const plain = (await apiGet("/api/plain").catch((e: unknown) => e)) as ApiError;
    expect(plain.message).toBe("Request failed with status 500");
    expect(plain.body).toBeUndefined();
  });

  it("treats a non-envelope JSON error body as undefined body", async () => {
    mockFetch({ "GET /api/weird": { status: 400, body: { nope: true } } });
    const err = (await apiGet("/api/weird").catch((e: unknown) => e)) as ApiError;
    expect(err.body).toBeUndefined();
  });

  it("fires the unauthorized handler on 401 (then still throws) and resolves undefined on 204", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockFetch({ "GET /api/secret": { status: 401, body: { error: { code: "UNAUTHORIZED", message: "expired" } } }, "POST /api/empty": { status: 204 } });
    await expect(apiGet("/api/secret")).rejects.toThrow("expired");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(apiPost("/api/empty")).resolves.toBeUndefined();
  });

  it("typed endpoint wrappers hit the right paths with the right methods and encoded ids", async () => {
    const spy = mockFetch({
      "POST /api/auth/login": { body: { token: "t", user: {} } },
      "POST /api/auth/signup": { body: { token: "t", user: {} } },
      "POST /api/tickets": { body: {} },
      "GET /api/tickets": { body: { items: [], hasMore: false } },
      "GET /api/tickets/a%2Fb": { body: {} },
      "GET /api/cases": { body: { items: [], hasMore: false } },
      "GET /api/cases/c1": { body: {} },
      "POST /api/cases/c1/summarise": { body: {} },
      "PATCH /api/cases/c1/facts": { body: {} },
      "POST /api/cases/c1/draft": { body: {} },
    });
    await login({ email: "e", password: "p" });
    await signup({ email: "e", password: "p", displayName: "d" });
    await createTicket({ creatorId: "c", ticketOverview: "o" });
    await listTickets({ cursor: "cur", limit: 5 });
    await getTicket("a/b");
    await listCases();
    await getCase("c1");
    await summariseCase("c1");
    await updateCaseFacts("c1", { customerId: "x" });
    await submitDraft("c1", "hello");

    const keys = spy.calls.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`);
    expect(keys).toEqual([
      "POST /api/auth/login",
      "POST /api/auth/signup",
      "POST /api/tickets",
      "GET /api/tickets?cursor=cur&limit=5",
      "GET /api/tickets/a%2Fb",
      "GET /api/cases",
      "GET /api/cases/c1",
      "POST /api/cases/c1/summarise",
      "PATCH /api/cases/c1/facts",
      "POST /api/cases/c1/draft",
    ]);
    expect(spy.calls[9]!.body).toEqual({ draftMessage: "hello" });
  });
});
