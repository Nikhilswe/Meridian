import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { Ticket } from "@meridian/shared-types";
import { App } from "../App";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import { setAuthToken, setUnauthorizedHandler } from "../api/client";

/**
 * Test-only HTTP layer: `fetch` is replaced with a tiny router keyed by
 * "<METHOD> <path>" so page tests exercise the real api/*.ts modules and
 * client.ts end to end, while never leaving the process.
 */
export type Route = {
  status?: number;
  body?: unknown;
  /** Called with the parsed JSON request body (if any) -- return overrides the static body. */
  handler?: (req: { body: unknown; url: URL; headers: Headers }) => unknown;
};

export type RouteTable = Record<string, Route>;

export interface FetchSpy {
  calls: { method: string; url: URL; headers: Headers; body: unknown }[];
}

export function mockFetch(routes: RouteTable): FetchSpy {
  const spy: FetchSpy = { calls: [] };
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    spy.calls.push({ method, url, headers, body });

    const key = `${method} ${url.pathname}`;
    const route = routes[key];
    if (!route) {
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: `no test route for ${key}` } }), { status: 404 });
    }
    const status = route.status ?? 200;
    const payload = route.handler ? route.handler({ body, url, headers }) : route.body;
    if (status === 204) return new Response(null, { status });
    return new Response(payload === undefined ? "" : JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return spy;
}

export const AGENT = { userId: "agent-1", displayName: "Asha Kapoor", role: "SUPPORT_AGENT" };
export const LOGIN_OK = { token: "jwt-token", user: AGENT };

export function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticketId: "t-1",
    creatorId: "agent-1",
    ticketStatus: "ASSIGNED",
    ticketCreationDate: "2026-09-18T00:00:00.000Z",
    ticketOverview: "Headphones arrived cracked",
    version: 1,
    updatedAt: "2026-09-18T00:00:00.000Z",
    assigneeId: "agent-1",
    ...overrides,
  };
}

export function page(items: Ticket[], extra: { nextCursor?: string; hasMore?: boolean } = {}) {
  return { items, nextCursor: extra.nextCursor, hasMore: extra.hasMore ?? false };
}

/** Full app under real providers, starting at `path`. */
export function renderApp(path: string): RenderResult {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

export function renderWithProviders(ui: ReactElement, path = "/"): RenderResult {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <AuthProvider>{ui}</AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** Reset the api client's module-level state between tests. */
export function resetClient(): void {
  setAuthToken(null);
  setUnauthorizedHandler(null);
}
