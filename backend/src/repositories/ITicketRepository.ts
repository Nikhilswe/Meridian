import { CreateTicketInput, SuppliedContext, Ticket, TicketStatus } from "@scaler/shared-types";

export interface TicketListPage {
  items: Ticket[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface UpdateTicketFields {
  assigneeId?: string;
  ticketStatus?: TicketStatus;
  caseSummary?: string;
  draftMessage?: string;
  ticketResolvedDate?: string;
  customerId?: string;
  orderId?: string;
  suppliedContext?: SuppliedContext;
}

/**
 * Interface-segregated: only the methods ticket-related consumers actually
 * need, not a generic CRUD blob. Postgres and any future in-memory/test
 * implementation both conform to this.
 */
export interface ITicketRepository {
  create(input: CreateTicketInput): Promise<Ticket>;
  getById(ticketId: string): Promise<Ticket | undefined>;
  listPaginatedForAssignee(assigneeId: string, cursor: string | undefined, limit: number): Promise<TicketListPage>;
  listPaginatedAll(cursor: string | undefined, limit: number): Promise<TicketListPage>;
  listPaginatedForCreator(creatorId: string, cursor: string | undefined, limit: number): Promise<TicketListPage>;
  /**
   * Optimistic-concurrency update: `expectedVersion` must match the row's
   * current `version` or the update is rejected (caller should re-fetch and
   * retry, or surface a conflict). On success the row's version is bumped.
   */
  updateStatusAndFields(ticketId: string, expectedVersion: number, fields: UpdateTicketFields): Promise<Ticket>;
  countDistinctCreators(): Promise<number>;
}
