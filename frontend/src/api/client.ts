import type { ApiErrorBody } from "@scaler/shared-types";

/**
 * Small typed fetch wrapper shared by every src/api/*.ts module.
 *
 * The JWT is kept in memory only (see src/context/AuthContext.tsx) and is
 * pushed into this module via `setAuthToken` whenever it changes, so every
 * request can attach `Authorization: Bearer <token>` without callers having
 * to thread the token through every function call.
 */

const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** Called whenever a request comes back 401 Unauthorized. Set by AuthProvider. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, body: ApiErrorBody | undefined, fallbackMessage: string) {
    super(body?.error?.message ?? fallbackMessage);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export type QueryParams = Record<string, string | number | undefined>;

function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(path.replace(/^\//, ""), API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody | undefined> {
  try {
    const data = (await response.json()) as unknown;
    if (data && typeof data === "object" && "error" in data) {
      return data as ApiErrorBody;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    onUnauthorized?.();
  }

  if (!response.ok) {
    const body = await parseErrorBody(response);
    throw new ApiError(response.status, body, `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function authHeaders(): HeadersInit {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

export async function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  const response = await fetch(buildUrl(path, params), {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
  return handleResponse<T>(response);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiSend<T>("POST", path, body);
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiSend<T>("PATCH", path, body);
}

async function apiSend<T>(method: "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}
