import { v4 as uuidv4 } from "uuid";
import { CreateTicketInput, Ticket } from "@meridian/shared-types";
import { ITicketRepository, TicketListPage, UpdateTicketFields } from "../../../src/repositories/ITicketRepository";
import { decodeCursor, encodeCursor } from "../../../src/repositories/postgres/cursorUtil";

/**
 * In-memory stand-in for PostgresTicketRepository, used by integration
 * tests so the full HTTP -> route -> service -> repository-interface stack
 * is exercised without a live Postgres database. Mirrors the same
 * cursor-based pagination semantics (ordered by creationDate desc, id desc).
 */
export class InMemoryTicketRepository implements ITicketRepository {
  private readonly tickets = new Map<string, Ticket>();

  public async create(input: CreateTicketInput): Promise<Ticket> {
    const now = new Date();
    // Stagger creation timestamps slightly so cursor ordering is stable even
    // when many tickets are created within the same millisecond in a test.
    const offsetMs = this.tickets.size;
    const ticket: Ticket = {
      ticketId: uuidv4(),
      creatorId: input.creatorId,
      ticketStatus: "OPEN",
      ticketCreationDate: new Date(now.getTime() + offsetMs).toISOString(),
      ticketOverview: input.ticketOverview,
      attachedDocuments: input.attachedDocuments?.map((doc) => ({ ...doc, uploadedAt: now.toISOString() })),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.orderId ? { orderId: input.orderId } : {}),
      version: 1,
      updatedAt: now.toISOString(),
    };
    this.tickets.set(ticket.ticketId, ticket);
    return { ...ticket };
  }

  public async getById(ticketId: string): Promise<Ticket | undefined> {
    const ticket = this.tickets.get(ticketId);
    return ticket ? { ...ticket } : undefined;
  }

  public async listPaginatedForAssignee(
    assigneeId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<TicketListPage> {
    return this.listPaginated((t) => t.assigneeId === assigneeId, cursor, limit);
  }

  public async listPaginatedForCreator(
    creatorId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<TicketListPage> {
    return this.listPaginated((t) => t.creatorId === creatorId, cursor, limit);
  }

  public async listPaginatedAll(cursor: string | undefined, limit: number): Promise<TicketListPage> {
    return this.listPaginated(() => true, cursor, limit);
  }

  private listPaginated(
    predicate: (t: Ticket) => boolean,
    cursor: string | undefined,
    limit: number,
  ): TicketListPage {
    const all = Array.from(this.tickets.values())
      .filter(predicate)
      .sort((a, b) => {
        if (a.ticketCreationDate !== b.ticketCreationDate) {
          return a.ticketCreationDate < b.ticketCreationDate ? 1 : -1;
        }
        return a.ticketId < b.ticketId ? 1 : -1;
      });

    let startIndex = 0;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      startIndex = all.findIndex(
        (t) => t.ticketCreationDate === decoded.ticketCreationDate && t.ticketId === decoded.ticketId,
      );
      startIndex = startIndex === -1 ? 0 : startIndex + 1;
    }

    const window = all.slice(startIndex, startIndex + limit + 1);
    const hasMore = window.length > limit;
    const pageItems = hasMore ? window.slice(0, limit) : window;

    let nextCursor: string | undefined;
    const last = pageItems[pageItems.length - 1];
    if (hasMore && last) {
      nextCursor = encodeCursor({ ticketCreationDate: last.ticketCreationDate, ticketId: last.ticketId });
    }

    return { items: pageItems.map((t) => ({ ...t })), nextCursor, hasMore };
  }

  public async updateStatusAndFields(
    ticketId: string,
    expectedVersion: number,
    fields: UpdateTicketFields,
  ): Promise<Ticket> {
    const existing = this.tickets.get(ticketId);
    if (!existing) {
      throw new Error(`Ticket ${ticketId} not found`);
    }
    if (existing.version !== expectedVersion) {
      throw new Error(
        `Optimistic concurrency conflict updating ticket ${ticketId}: expected version ${expectedVersion}, current version ${existing.version}`,
      );
    }
    const updated: Ticket = {
      ...existing,
      ...fields,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.tickets.set(ticketId, updated);
    return { ...updated };
  }

  public async countDistinctCreators(): Promise<number> {
    return new Set(Array.from(this.tickets.values()).map((t) => t.creatorId)).size;
  }

  /** Test-only helper to inspect/reset state between scenarios. */
  public clear(): void {
    this.tickets.clear();
  }
}
