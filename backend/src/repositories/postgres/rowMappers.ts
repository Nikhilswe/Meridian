import { AttachedDocument, Order, Policy, Ticket, TicketStatus, User, UserRole } from "@scaler/shared-types";
import { UserWithCredentials } from "../IUserRepository";

/**
 * All migrations use quoted camelCase column names (e.g. "ticketId") so rows
 * map 1:1 onto the shared-types shapes without a separate snake_case<->camel
 * translation layer. `pg` returns quoted-identifier columns verbatim.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function mapTicketRow(row: any): Ticket {
  const ticket: Ticket = {
    ticketId: row.ticketId,
    creatorId: row.creatorId,
    ticketStatus: row.ticketStatus as TicketStatus,
    ticketCreationDate: toIso(row.ticketCreationDate),
    ticketOverview: row.ticketOverview,
    version: row.version,
    updatedAt: toIso(row.updatedAt),
  };
  if (row.assigneeId) ticket.assigneeId = row.assigneeId;
  if (row.ticketResolvedDate) ticket.ticketResolvedDate = toIso(row.ticketResolvedDate);
  if (row.attachedDocuments) ticket.attachedDocuments = row.attachedDocuments as AttachedDocument[];
  if (row.caseSummary !== null && row.caseSummary !== undefined) ticket.caseSummary = row.caseSummary;
  if (row.draftMessage !== null && row.draftMessage !== undefined) ticket.draftMessage = row.draftMessage;
  return ticket;
}

export function mapPolicyRow(row: any): Policy {
  return {
    policyId: row.policyId,
    category: row.category,
    title: row.title,
    body: row.body,
    version: row.version,
    effectiveDate: toIso(row.effectiveDate),
  };
}

export function mapOrderRow(row: any): Order {
  return {
    orderId: row.orderId,
    customerId: row.customerId,
    itemSummary: row.itemSummary,
    orderDate: toIso(row.orderDate),
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
  };
}

export function mapUserRow(row: any): User {
  return {
    userId: row.userId,
    displayName: row.displayName,
    email: row.email,
    role: row.role as UserRole,
  };
}

export function mapUserWithCredentialsRow(row: any): UserWithCredentials {
  return {
    ...mapUserRow(row),
    passwordHash: row.passwordHash,
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}
