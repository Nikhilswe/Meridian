import { inject, injectable } from "tsyringe";
import {
  AuthenticatedPrincipal,
  Order,
  SuppliedContext,
  SuppliedFacts,
  SummariseCaseResponse,
  SummariseCheck,
  Ticket,
} from "@meridian/shared-types";
import { ITicketRepository } from "../repositories/ITicketRepository";
import { IPolicyRepository } from "../repositories/IPolicyRepository";
import { IOrderRepository } from "../repositories/IOrderRepository";
import { ILLMProvider } from "../llm/ILLMProvider";
import { LLMProviderFactory } from "../llm/LLMProviderFactory";
import { canTransition } from "../domain/TicketEntity";
import { ForbiddenError, InvalidStateTransitionError, NotFoundError } from "../domain/errors";
import { runPostModelChecks, runPreModelGate } from "../domain/summarisationGates";
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

/**
 * Orchestrates one summarise/draft attempt in a fixed order:
 *
 *   1. authorise      -- only the assignee (or a privileged role) may ask
 *   2. retrieve       -- scoped to the ticket's customer, never the creator
 *   3. pre-model gate -- deterministic; missing facts => NEEDS_INFO, no model call
 *   4. generate       -- the only probabilistic step (stub or real provider)
 *   5. post-model     -- deterministic; a failed check => DRAFT_REJECTED, nothing saved
 *   6. persist        -- draft + the exact context it was based on
 *
 * Regeneration is the same flow run again while the ticket is still in
 * DRAFT_PENDING_REVIEW; the previous draft/context are replaced.
 */
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

    // 1. Authorise BEFORE any customer data is retrieved.
    if (!isPrivilegedRole(requestingUser.role) && ticket.assigneeId !== requestingUser.userId) {
      throw new ForbiddenError("Only the assigned agent may summarise this case");
    }
    this.assertCanDraft(ticket);

    const providerName = this.llmProviderFactory.getProviderName();
    const testModeTriggered = context.testMode === true || shouldBypassWithTestStub(ticket.ticketOverview);

    // 2. Retrieve, scoped to the customer on the record.
    const { facts, referencedOrder } = await this.assembleFacts(ticket);

    // 3. Deterministic gate. Runs in test mode too -- it is not an LLM call.
    const gate = runPreModelGate(ticket, referencedOrder);
    if (gate.missingInformation.length > 0) {
      return {
        ticketId,
        outcome: "NEEDS_INFO",
        missingInformation: gate.missingInformation,
        checks: gate.checks,
        suppliedFacts: facts,
        suppliedPolicies: [],
        usedProvider: providerName,
        testModeTriggered,
      };
    }

    // 4. Generate.
    const allPolicies = await this.policyRepo.listAll();
    const policies = findRelevantPolicies(ticket.ticketOverview, allPolicies, MAX_RELATED_POLICIES);

    let summary: string;
    let draftMessage: string;
    if (testModeTriggered) {
      // Deterministic, clearly-marked test values -- no real LLM is called,
      // so demos/tests never burn API calls by accident.
      summary = "test";
      draftMessage = "test";
    } else {
      const result = await this.llmProvider.generate({
        ticketOverview: ticket.ticketOverview,
        facts,
        relatedPolicies: policies,
      });
      summary = result.summary;
      draftMessage = result.draftMessage;
    }

    // 5. Post-model checks against the record.
    const postChecks = runPostModelChecks(facts, draftMessage);
    const checks: SummariseCheck[] = [...gate.checks, ...postChecks];
    if (postChecks.some((c) => !c.passed)) {
      // The offending draft is returned for transparency but NOT persisted.
      return {
        ticketId,
        outcome: "DRAFT_REJECTED",
        caseSummary: summary,
        draftMessage,
        missingInformation: [],
        checks,
        suppliedFacts: facts,
        suppliedPolicies: policies,
        usedProvider: providerName,
        testModeTriggered,
      };
    }

    // 6. Persist the draft together with exactly what it was based on.
    const suppliedContext: SuppliedContext = {
      facts,
      policies,
      checks,
      usedProvider: providerName,
      testModeTriggered,
      generatedAt: new Date().toISOString(),
    };
    await this.persistDraft(ticket, summary, draftMessage, suppliedContext);

    return {
      ticketId,
      outcome: "DRAFTED",
      caseSummary: summary,
      draftMessage,
      missingInformation: [],
      checks,
      suppliedFacts: facts,
      suppliedPolicies: policies,
      usedProvider: providerName,
      testModeTriggered,
    };
  }

  /**
   * A draft can be generated from ASSIGNED / IN_REVIEW (first time) or
   * regenerated from DRAFT_PENDING_REVIEW. Once the case is RESOLVED or
   * CLOSED the record is final and the model must not touch it.
   */
  private assertCanDraft(ticket: Ticket): void {
    const status = ticket.ticketStatus;
    const canDraft =
      status === "DRAFT_PENDING_REVIEW" ||
      status === "IN_REVIEW" ||
      (status === "ASSIGNED" && canTransition("ASSIGNED", "IN_REVIEW"));
    if (!canDraft) {
      throw new InvalidStateTransitionError(`Cannot generate a draft for ticket ${ticket.ticketId} in status ${status}`);
    }
  }

  /**
   * Access is enforced at retrieval: orders are looked up by the CUSTOMER on
   * the ticket (never by creatorId, which is the support rep), and a
   * referenced order only enters the context if it belongs to that
   * customer. Anything that fails these rules never reaches the model.
   */
  private async assembleFacts(ticket: Ticket): Promise<{ facts: SuppliedFacts; referencedOrder: Order | undefined }> {
    const customerId = ticket.customerId?.trim() || undefined;
    const customerOrders: Order[] = customerId ? await this.orderRepo.listByCustomerId(customerId) : [];

    let referencedOrder: Order | undefined;
    if (ticket.orderId && customerId) {
      const candidate = await this.orderRepo.getById(ticket.orderId);
      if (candidate && candidate.customerId === customerId) {
        referencedOrder = candidate;
      }
    }

    const otherOrders = customerOrders
      .filter((o) => o.orderId !== referencedOrder?.orderId)
      .slice(0, MAX_RELATED_ORDERS);

    const facts: SuppliedFacts = {
      ticketStatus: ticket.ticketStatus,
      otherOrders,
    };
    if (customerId) facts.customerId = customerId;
    if (referencedOrder) facts.order = referencedOrder;
    return { facts, referencedOrder };
  }

  private async persistDraft(
    ticket: Ticket,
    summary: string,
    draftMessage: string,
    suppliedContext: SuppliedContext,
  ): Promise<void> {
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

    if (working.ticketStatus === "DRAFT_PENDING_REVIEW") {
      // Regeneration: stay in DRAFT_PENDING_REVIEW, replace draft + context.
      await this.ticketRepo.updateStatusAndFields(working.ticketId, working.version, {
        caseSummary: summary,
        draftMessage,
        suppliedContext,
      });
      return;
    }

    if (!canTransition(working.ticketStatus, "DRAFT_PENDING_REVIEW")) {
      throw new InvalidStateTransitionError(
        `Cannot move ticket ${ticket.ticketId} from ${working.ticketStatus} to DRAFT_PENDING_REVIEW`,
      );
    }
    await this.ticketRepo.updateStatusAndFields(working.ticketId, working.version, {
      caseSummary: summary,
      draftMessage,
      suppliedContext,
      ticketStatus: "DRAFT_PENDING_REVIEW",
    });
  }
}
