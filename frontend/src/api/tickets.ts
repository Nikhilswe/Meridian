import type {
  CreateTicketInput,
  PaginatedRequest,
  PaginatedResponse,
  Ticket,
} from "@scaler/shared-types";
import { apiGet, apiPost } from "./client";

export function createTicket(input: CreateTicketInput): Promise<Ticket> {
  return apiPost<Ticket>("/api/tickets", input);
}

export function listTickets(params?: PaginatedRequest): Promise<PaginatedResponse<Ticket>> {
  return apiGet<PaginatedResponse<Ticket>>("/api/tickets", {
    cursor: params?.cursor,
    limit: params?.limit,
  });
}

export function getTicket(id: string): Promise<Ticket> {
  return apiGet<Ticket>(`/api/tickets/${encodeURIComponent(id)}`);
}
