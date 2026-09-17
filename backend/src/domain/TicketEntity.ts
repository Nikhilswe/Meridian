import { Ticket, TicketStatus } from "@scaler/shared-types";

/**
 * Pure, dependency-free domain rules about a Ticket's lifecycle. Kept free of
 * any repository/DB/HTTP concern so it's trivially unit-testable and reusable
 * from both TicketService and (if ever needed) a Lambda handler.
 */

const ORDER: TicketStatus[] = ["OPEN", "ASSIGNED", "IN_REVIEW", "DRAFT_PENDING_REVIEW", "RESOLVED", "CLOSED"];

/**
 * Ticket status only ever moves forward one step at a time along the fixed
 * lifecycle OPEN -> ASSIGNED -> IN_REVIEW -> DRAFT_PENDING_REVIEW -> RESOLVED
 * -> CLOSED. No skipping ahead, no moving backwards, no staying put via this
 * check (callers that don't need a transition simply don't call it).
 */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  const fromIndex = ORDER.indexOf(from);
  const toIndex = ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) {
    return false;
  }
  return toIndex === fromIndex + 1;
}

/**
 * Visibility rule: an unassigned ticket is normally hidden from everyone
 * except admins/reviewers (it hasn't been triaged to an agent yet). The one
 * exception is a demo/bootstrap edge case: if there is currently only a
 * single distinct creator across all tickets in the system, that creator may
 * see their own unassigned ticket (there's nobody else's data to leak, and
 * it avoids a confusing "your ticket vanished" UX for a brand new tenant).
 */
export function isVisibleToUser(
  ticket: Pick<Ticket, "creatorId" | "assigneeId">,
  userId: string,
  totalDistinctCreators: number,
): boolean {
  if (ticket.assigneeId) {
    return ticket.assigneeId === userId || ticket.creatorId === userId;
  }

  if (ticket.creatorId === userId && totalDistinctCreators <= 1) {
    return true;
  }

  return false;
}
