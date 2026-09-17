export interface PaginatedRequest {
  /** Opaque cursor returned by the previous page; omit for page 1. */
  cursor?: string;
  limit?: number; // default + max enforced server-side
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface SummariseCaseResponse {
  ticketId: string;
  caseSummary: string;
  draftMessage: string;
  usedProvider: "openai" | "anthropic" | "ollama" | "test-stub";
  testModeTriggered: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: { userId: string; displayName: string; role: string };
}
