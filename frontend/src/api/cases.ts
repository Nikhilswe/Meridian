import type {
  PaginatedRequest,
  PaginatedResponse,
  SummariseCaseResponse,
  Ticket,
  TicketFactsInput,
} from "@scaler/shared-types";
import { apiGet, apiPatch, apiPost } from "./client";

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

/** Adds the record-backed facts the summariser asked for (customerId / orderId). */
export function updateCaseFacts(id: string, facts: TicketFactsInput): Promise<Ticket> {
  return apiPatch<Ticket>(`/api/cases/${encodeURIComponent(id)}/facts`, facts);
}

export function submitDraft(id: string, draftMessage: string): Promise<Ticket> {
  return apiPost<Ticket>(`/api/cases/${encodeURIComponent(id)}/draft`, { draftMessage });
}
