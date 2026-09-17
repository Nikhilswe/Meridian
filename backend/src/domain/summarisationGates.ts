import { Order, SuppliedFacts, SummariseCheck, Ticket } from "@scaler/shared-types";

/**
 * Deterministic checks that surround the model call in SummarisationService.
 * "Deterministic before probabilistic": anything ordinary code can decide
 * with certainty is decided here, never delegated to the model's
 * instructions. Every function is pure so it can be unit-tested without a
 * repository or a provider.
 *
 * Check ids are stable identifiers that are returned to the reviewer and
 * persisted in Ticket.suppliedContext -- treat them as part of the API.
 */

export const CHECK_CUSTOMER_IDENTIFIED = "CUSTOMER_IDENTIFIED";
export const CHECK_ORDER_BELONGS_TO_CUSTOMER = "ORDER_BELONGS_TO_CUSTOMER";
export const CHECK_DELIVERY_DATE_PRESENT = "DELIVERY_DATE_PRESENT";
export const CHECK_NO_RESOLUTION_CLAIM = "NO_RESOLUTION_CLAIM_WHILE_OPEN";

export interface GateResult {
  /** Checks that ran, passed or failed, in order. */
  checks: SummariseCheck[];
  /** Human-readable, agent-facing list of what is missing. Empty means "proceed". */
  missingInformation: string[];
}

/**
 * Pre-model gate. Given the ticket and the order lookup result (already
 * scoped to the ticket's customer by the caller), decide whether we have the
 * facts a draft would need. If anything is missing we STOP -- the system
 * asks for the fact rather than letting the model infer it.
 *
 * `referencedOrder` is the order the ticket points at, or undefined if the
 * ticket has no orderId, the order doesn't exist, or it belongs to a
 * different customer (the caller must never pass another customer's order).
 */
export function runPreModelGate(ticket: Pick<Ticket, "customerId" | "orderId">, referencedOrder: Order | undefined): GateResult {
  const checks: SummariseCheck[] = [];
  const missing: string[] = [];

  const customerId = ticket.customerId?.trim();
  if (customerId) {
    checks.push({
      id: CHECK_CUSTOMER_IDENTIFIED,
      description: "The ticket identifies which customer the complaint is about",
      passed: true,
      detail: `customerId=${customerId}`,
    });
  } else {
    checks.push({
      id: CHECK_CUSTOMER_IDENTIFIED,
      description: "The ticket identifies which customer the complaint is about",
      passed: false,
      detail: "No customerId on the ticket, so no order or account facts can be retrieved",
    });
    missing.push("Customer ID -- which customer is this complaint about?");
  }

  if (ticket.orderId) {
    if (referencedOrder) {
      checks.push({
        id: CHECK_ORDER_BELONGS_TO_CUSTOMER,
        description: "The referenced order exists and belongs to this customer",
        passed: true,
        detail: `order ${referencedOrder.orderId} is on file for customer ${referencedOrder.customerId}`,
      });

      const needsDeliveryDate = referencedOrder.status === "DELIVERED";
      if (needsDeliveryDate && !referencedOrder.deliveredDate) {
        checks.push({
          id: CHECK_DELIVERY_DATE_PRESENT,
          description: "A delivered order has its delivery date on record (needed for any delivery-window policy)",
          passed: false,
          detail: `order ${referencedOrder.orderId} is DELIVERED but has no deliveredDate`,
        });
        missing.push(
          `Delivery date for order ${referencedOrder.orderId} -- required before any delivery-window policy can be applied`,
        );
      } else if (needsDeliveryDate) {
        checks.push({
          id: CHECK_DELIVERY_DATE_PRESENT,
          description: "A delivered order has its delivery date on record (needed for any delivery-window policy)",
          passed: true,
          detail: `deliveredDate=${referencedOrder.deliveredDate}`,
        });
      }
    } else {
      checks.push({
        id: CHECK_ORDER_BELONGS_TO_CUSTOMER,
        description: "The referenced order exists and belongs to this customer",
        passed: false,
        detail: customerId
          ? `order ${ticket.orderId} is not on file for customer ${customerId}`
          : `order ${ticket.orderId} cannot be verified without a customerId`,
      });
      missing.push(`Order ${ticket.orderId} could not be matched to this customer -- confirm the order number`);
    }
  }

  return { checks, missingInformation: missing };
}

/**
 * Phrases that assert the customer's problem is already fixed. Deliberately
 * conservative: a false positive costs one regeneration, a false negative
 * is the Meridian incident. This is a floor, not an evaluation strategy.
 */
/** "once/when it is resolved" is a future condition, not a claim -- exclude those. */
const NOT_CONDITIONAL = String.raw`(?<!\b(?:once|when|until|after|if|before|unless|should)\s(?:\w+\s){0,3})`;
const RESOLVED_WORDS = String.raw`(?:resolved|fixed|closed|sorted(?:\s+out)?|taken\s+care\s+of)`;

const RESOLUTION_CLAIM_PATTERNS: RegExp[] = [
  new RegExp(NOT_CONDITIONAL + String.raw`\b(?:has|have|had)\s+(?:now\s+|already\s+)?been\s+(?:fully\s+)?` + RESOLVED_WORDS + String.raw`\b`, "i"),
  new RegExp(NOT_CONDITIONAL + String.raw`\b(?:is|was|are|were)\s+(?:now\s+|already\s+)?(?:fully\s+)?` + RESOLVED_WORDS + String.raw`\b`, "i"),
  /\b(?:we|i)\s+(?:have|'ve)\s+(?:now\s+)?(?:resolved|fixed|closed)\s+(?:your|the|this)\b/i,
  /\bconsider\s+(?:this|the|your)\s+(?:issue|matter|case|complaint|ticket)\s+(?:resolved|closed)\b/i,
  new RegExp(NOT_CONDITIONAL + String.raw`\b(?:issue|matter|case|complaint|ticket|problem)\s+(?:is|has\s+been)\s+(?:now\s+)?(?:resolved|closed|fixed)\b`, "i"),
  /\bmarked\s+(?:as\s+)?(?:resolved|closed)\b/i,
];

export function containsResolutionClaim(text: string): boolean {
  return RESOLUTION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Post-model check (P3): the draft must not tell the customer the issue is
 * resolved while the authoritative record says it is not. Compares against
 * the record, never against the customer's wording or the model's fluency.
 */
export function runPostModelChecks(facts: Pick<SuppliedFacts, "ticketStatus">, draftMessage: string): SummariseCheck[] {
  const recordSaysResolved = facts.ticketStatus === "RESOLVED" || facts.ticketStatus === "CLOSED";
  const claims = containsResolutionClaim(draftMessage);
  const passed = recordSaysResolved || !claims;
  return [
    {
      id: CHECK_NO_RESOLUTION_CLAIM,
      description: "The draft does not tell the customer the issue is resolved while the record says it is open",
      passed,
      detail: passed
        ? `record status is ${facts.ticketStatus}; no resolution claim found`
        : `record status is ${facts.ticketStatus} but the draft asserts the issue is resolved`,
    },
  ];
}
