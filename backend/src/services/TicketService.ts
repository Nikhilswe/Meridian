import { inject, injectable } from "tsyringe";
import { AuthenticatedPrincipal, CreateTicketInput, PaginatedResponse, SubmitDraftInput, Ticket } from "@scaler/shared-types";
import { ITicketRepository } from "../repositories/ITicketRepository";
import { IEventBus } from "../events/IEventBus";
import { EVENT_TYPE_TICKET_CREATED, TicketCreatedEvent } from "../events/events";
import { TicketBuilder } from "../domain/TicketBuilder";
import { canTransition, isVisibleToUser } from "../domain/TicketEntity";
import { ForbiddenError, InvalidStateTransitionError, NotFoundError } from "../domain/errors";

export interface PaginationParams {
  cursor?: string;
  limit: number;
}

function isPrivilegedRole(role: AuthenticatedPrincipal["role"]): boolean {
  return role === "ADMIN" || role === "REVIEWER";
}

/**
 * Orchestrates ticket creation, listing (with the visibility rule) and draft
 * submission. Receives its dependencies through constructor injection --
 * never instantiates a repository or the event bus itself.
 */
@injectable()
export class TicketService {
  constructor(
    @inject("ITicketRepository") private readonly ticketRepo: ITicketRepository,
    @inject("IEventBus") private readonly eventBus: IEventBus,
  ) {}

  public async createTicket(input: CreateTicketInput): Promise<Ticket> {
    let builder = new TicketBuilder().forCreator(input.creatorId).withOverview(input.ticketOverview);
    for (const doc of input.attachedDocuments ?? []) {
      builder = builder.withAttachedDocument(doc);
    }
    const validated = builder.build();

    const ticket = await this.ticketRepo.create(validated);

    const event: TicketCreatedEvent = {
      type: EVENT_TYPE_TICKET_CREATED,
      ticketId: ticket.ticketId,
      creatorId: ticket.creatorId,
      occurredAt: new Date().toISOString(),
    };
    await this.eventBus.publish(event);

    // The offline event bus dispatches subscribers (AssignmentService)
    // synchronously within publish(), so by now the ticket may already have
    // been round-robin assigned. Re-fetch so the caller sees the final
    // state rather than a stale pre-assignment snapshot. In AWS mode the
    // equivalent Lambda dispatch is asynchronous relative to this request,
    // so this re-fetch is purely a "best-effort freshness" nicety there.
    const latest = await this.ticketRepo.getById(ticket.ticketId);
    return latest ?? ticket;
  }

  public async listTickets(
    requestingUser: AuthenticatedPrincipal,
    pagination: PaginationParams,
  ): Promise<PaginatedResponse<Ticket>> {
    const page = await this.ticketRepo.listPaginatedAll(pagination.cursor, pagination.limit);

    if (isPrivilegedRole(requestingUser.role)) {
      return { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore };
    }

    const totalDistinctCreators = await this.ticketRepo.countDistinctCreators();
    const items = page.items.filter((ticket) =>
      isVisibleToUser(ticket, requestingUser.userId, totalDistinctCreators),
    );
    return { items, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }

  /**
   * The case-summariser screen's "my queue" view: tickets currently
   * assigned to the requesting agent. Privileged roles may pass any
   * `assigneeId` (e.g. a reviewer looking at a specific agent's queue);
   * everyone else may only look at their own.
   */
  public async listCasesForAssignee(
    assigneeId: string,
    requestingUser: AuthenticatedPrincipal,
    pagination: PaginationParams,
  ): Promise<PaginatedResponse<Ticket>> {
    if (!isPrivilegedRole(requestingUser.role) && assigneeId !== requestingUser.userId) {
      throw new ForbiddenError("You may only view your own case queue");
    }
    const page = await this.ticketRepo.listPaginatedForAssignee(assigneeId, pagination.cursor, pagination.limit);
    return { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }

  public async getTicketById(ticketId: string, requestingUser: AuthenticatedPrincipal): Promise<Ticket> {
    const ticket = await this.ticketRepo.getById(ticketId);
    if (!ticket) {
      throw new NotFoundError(`Ticket ${ticketId} not found`);
    }

    if (isPrivilegedRole(requestingUser.role)) {
      return ticket;
    }

    const totalDistinctCreators = await this.ticketRepo.countDistinctCreators();
    if (!isVisibleToUser(ticket, requestingUser.userId, totalDistinctCreators)) {
      throw new ForbiddenError(`You do not have access to ticket ${ticketId}`);
    }
    return ticket;
  }

  public async submitDraft(input: SubmitDraftInput): Promise<Ticket> {
    const ticket = await this.ticketRepo.getById(input.ticketId);
    if (!ticket) {
      throw new NotFoundError(`Ticket ${input.ticketId} not found`);
    }

    if (ticket.assigneeId !== input.submittedBy) {
      throw new ForbiddenError("Only the assigned agent may submit a draft for this ticket");
    }

    if (!canTransition(ticket.ticketStatus, "RESOLVED")) {
      throw new InvalidStateTransitionError(
        `Cannot move ticket ${input.ticketId} from ${ticket.ticketStatus} to RESOLVED`,
      );
    }

    return this.ticketRepo.updateStatusAndFields(ticket.ticketId, ticket.version, {
      draftMessage: input.draftMessage,
      ticketStatus: "RESOLVED",
      ticketResolvedDate: new Date().toISOString(),
    });
  }
}
