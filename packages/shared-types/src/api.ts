import { LLMProviderName, SuppliedFacts, SummariseCheck } from "./ticket";
import { Policy } from "./policy";
import { UserRole } from "./user";

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

/**
 * DRAFTED         -- a draft was generated and passed every check.
 * NEEDS_INFO      -- a required fact is missing; NO model call was made.
 * DRAFT_REJECTED  -- the model answered but a deterministic check failed;
 *                    the draft was NOT saved. The agent may regenerate.
 */
export type SummariseOutcome = "DRAFTED" | "NEEDS_INFO" | "DRAFT_REJECTED";

export interface SummariseCaseResponse {
  ticketId: string;
  outcome: SummariseOutcome;
  /** Present only when outcome is DRAFTED. */
  caseSummary?: string;
  draftMessage?: string;
  /** Human-readable list of what the agent must supply; non-empty only for NEEDS_INFO. */
  missingInformation: string[];
  checks: SummariseCheck[];
  suppliedFacts?: SuppliedFacts;
  suppliedPolicies: Policy[];
  usedProvider: LLMProviderName;
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

export interface SignupRequest {
  email: string;
  password: string;
  displayName: string;
  /** Defaults to SUPPORT_AGENT server-side; only an existing ADMIN flow should ever pass another role. */
  role?: UserRole;
}
