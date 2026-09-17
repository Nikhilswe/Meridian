import type {
  PaginatedRequest,
  PaginatedResponse,
  SummariseCaseResponse,
  Ticket,
} from "@scaler/shared-types";
import { apiGet, apiPost } from "./client";

export function listCases(params?: PaginatedRequest): Promise<PaginatedResponse<Ticket>> {
  return apiGet<PaginatedResponse<Ticket>>("/api/cases", {
    cursor: params?.cursor,
    limit: params?.limit,
  });
}

export function getCase(id: string): Promise<Ticket> {
  return apiGet<Ticket>(`/api/cases/${encodeURIComponent(id)}`);
}

export function summariseCase(id: string): Promise<SummariseCaseResponse> {
  return apiPost<SummariseCaseResponse>(`/api/cases/${encodeURIComponent(id)}/summarise`);
}

export function submitDraft(id: string, draftMessage: string): Promise<Ticket> {
  return apiPost<Ticket>(`/api/cases/${encodeURIComponent(id)}/draft`, { draftMessage });
}
