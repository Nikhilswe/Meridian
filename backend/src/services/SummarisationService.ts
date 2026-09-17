import { inject, injectable } from "tsyringe";
import { AuthenticatedPrincipal, SummariseCaseResponse } from "@scaler/shared-types";
import { ITicketRepository } from "../repositories/ITicketRepository";
import { IPolicyRepository } from "../repositories/IPolicyRepository";
import { IOrderRepository } from "../repositories/IOrderRepository";
import { ILLMProvider } from "../llm/ILLMProvider";
import { LLMProviderFactory } from "../llm/LLMProviderFactory";
import { canTransition } from "../domain/TicketEntity";
import { ForbiddenError, InvalidStateTransitionError, NotFoundError } from "../domain/errors";
import { findRelevantPolicies } from "./naiveRetrieval";

const MAX_RELATED_POLICIES = 3;
const MAX_RELATED_ORDERS = 5;

/**
 * Named, testable test-bypass check (the "pre-context parameter" requested):
 * if the ticket's overview mentions the whole word "test" (case-insensitive),
 * the summarisation flow must never call a real LLM. Kept as its own
 * function -- not an inline regex buried in summariseCase -- so it's easy to
 * unit test and easy to see the bypass rule doesn't quietly change.
 */
export function shouldBypassWithTestStub(ticketOverview: string): boolean {
  return /\btest\b/i.test(ticketOverview);
}

export interface SummariseCaseContext {
  /** Explicit test-mode override, e.g. from a request body/query flag. */
  testMode?: boolean;
}

function isPrivilegedRole(role: AuthenticatedPrincipal["role"]): boolean {
  return role === "ADMIN" || role === "REVIEWER";
}

@injectable()
export class SummarisationService {
  constructor(
    @inject("ITicketRepository") private readonly ticketRepo: ITicketRepository,
    @inject("IPolicyRepository") private readonly policyRepo: IPolicyRepository,
    @inject("IOrderRepository") private readonly orderRepo: IOrderRepository,
    @inject("ILLMProvider") private readonly llmProvider: ILLMProvider,
    private readonly llmProviderFactory: LLMProviderFactory,
  ) {}

  public async summariseCase(
    ticketId: string,
    requestingUser: AuthenticatedPrincipal,
    context: SummariseCaseContext = {},
  ): Promise<SummariseCaseResponse> {
    const ticket = await this.ticketRepo.getById(ticketId);
    if (!ticket) {
      throw new NotFoundError(`Ticket ${ticketId} not found`);
    }

    if (!isPrivilegedRole(requestingUser.role) && ticket.assigneeId !== requestingUser.userId) {
      throw new ForbiddenError("Only the assigned agent may summarise this case");
    }

    const providerName = this.llmProviderFactory.getProviderName();
    const testModeTriggered = context.testMode === true || shouldBypassWithTestStub(ticket.ticketOverview);

    let summary: string;
    let draftMessage: string;

    if (testModeTriggered) {
      // Deterministic, clearly-marked test values -- no real LLM is called,
      // so demos/tests never burn API calls by accident.
      summary = "test";
      draftMessage = "test";
    } else {
      const allPolicies = await this.policyRepo.listAll();
      const relatedPolicies = findRelevantPolicies(ticket.ticketOverview, allPolicies, MAX_RELATED_POLICIES);
      const relatedOrders = (await this.orderRepo.listByCustomerId(ticket.creatorId)).slice(0, MAX_RELATED_ORDERS);

      const result = await this.llmProvider.generate({
        ticketOverview: ticket.ticketOverview,
        relatedPolicies,
        relatedOrders,
      });
      summary = result.summary;
      draftMessage = result.draftMessage;
    }

    // Normal lifecycle is ASSIGNED -> IN_REVIEW -> DRAFT_PENDING_REVIEW. If the
    // agent is summarising straight from ASSIGNED (hasn't "opened" the case
    // through a separate step), advance through IN_REVIEW first so we never
    // skip a step in TicketEntity's state machine.
    let working = ticket;
    if (working.ticketStatus === "ASSIGNED") {
      working = await this.ticketRepo.updateStatusAndFields(working.ticketId, working.version, {
        ticketStatus: "IN_REVIEW",
      });
    }

    if (!canTransition(working.ticketStatus, "DRAFT_PENDING_REVIEW")) {
      throw new InvalidStateTransitionError(
        `Cannot move ticket ${ticketId} from ${working.ticketStatus} to DRAFT_PENDING_REVIEW`,
      );
    }

    await this.ticketRepo.updateStatusAndFields(working.ticketId, working.version, {
      caseSummary: summary,
      draftMessage,
      ticketStatus: "DRAFT_PENDING_REVIEW",
    });

    return {
      ticketId,
      caseSummary: summary,
      draftMessage,
      usedProvider: providerName,
      testModeTriggered,
    };
  }
}
