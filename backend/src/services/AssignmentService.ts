import { inject, injectable } from "tsyringe";
import { ConfigResolver } from "../config/ConfigResolver";
import { ITicketRepository } from "../repositories/ITicketRepository";
import { IUserRepository } from "../repositories/IUserRepository";
import { IAssignmentCursorRepository } from "../repositories/IAssignmentCursorRepository";
import { IEventBus } from "../events/IEventBus";
import { EVENT_TYPE_TICKET_CREATED, TicketCreatedEvent } from "../events/events";

/**
 * Simulates a DynamoDB-stream-triggered Lambda: subscribes to TicketCreated
 * on the (injected) event bus and round-robin assigns the new ticket to a
 * support agent. `handleTicketCreated` is written as a pure-ish function of
 * (event, injected repositories) -- no framework/HTTP concerns -- so in AWS
 * mode the *exact same method body* could be the Lambda handler subscribed
 * to the tickets table's DynamoDB Stream; only the "what triggers this call"
 * wiring (event bus subscribe vs Lambda event source mapping) would differ.
 */
@injectable()
export class AssignmentService {
  constructor(
    @inject("IEventBus") eventBus: IEventBus,
    @inject("ITicketRepository") private readonly ticketRepo: ITicketRepository,
    @inject("IUserRepository") private readonly userRepo: IUserRepository,
    @inject("IAssignmentCursorRepository") private readonly cursorRepo: IAssignmentCursorRepository,
    private readonly config: ConfigResolver,
  ) {
    eventBus.subscribe<TicketCreatedEvent>(EVENT_TYPE_TICKET_CREATED, (event) => this.handleTicketCreated(event));
  }

  public async handleTicketCreated(event: TicketCreatedEvent): Promise<void> {
    const agents = await this.userRepo.listByRole("SUPPORT_AGENT");
    if (agents.length === 0) {
      console.error(`AssignmentService: no SUPPORT_AGENT users found; cannot assign ticket ${event.ticketId}`);
      return;
    }

    // assignment.agentPoolSize caps how many agents are in rotation; 0 (or
    // unset) means every SUPPORT_AGENT rotates. The cap is taken from the
    // head of the displayName-ordered list, so with a cap a newly signed-up
    // agent only receives work if they sort inside it -- which is why the
    // local config uses 0: every sign-up in a class demo should get tickets.
    const configuredPoolSize = this.config.get<number>("assignment", "agentPoolSize", 0);
    const poolSize = configuredPoolSize > 0 ? Math.min(configuredPoolSize, agents.length) : agents.length;
    const pool = agents.slice(0, poolSize);

    const nextIndex = await this.cursorRepo.incrementAndGet();
    const agent = pool[nextIndex % pool.length];
    if (!agent) {
      // Unreachable given poolSize >= 1 above, but keeps this safe under
      // strict/noUncheckedIndexedAccess without a non-null assertion.
      console.error(`AssignmentService: could not pick an agent for ticket ${event.ticketId}`);
      return;
    }

    const ticket = await this.ticketRepo.getById(event.ticketId);
    if (!ticket) {
      console.error(`AssignmentService: ticket ${event.ticketId} not found when attempting assignment`);
      return;
    }
    if (ticket.ticketStatus !== "OPEN") {
      // Already assigned (or moved further) -- avoid double-assignment on
      // any accidental redelivery of the event.
      return;
    }

    await this.ticketRepo.updateStatusAndFields(ticket.ticketId, ticket.version, {
      assigneeId: agent.userId,
      ticketStatus: "ASSIGNED",
    });
  }
}
