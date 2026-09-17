import { Order, Policy } from "./policy";

/**
 * Ticket domain contract shared by frontend, backend, and Lambda code.
 * Mirrors the DynamoDB item shape 1:1 in AWS mode, and the Postgres row shape
 * (via a thin mapper) in offline mode -- this type is the single source of truth
 * so both storage backends must conform to it, not the other way around.
 */

export type TicketStatus =
  | "OPEN" // just created, not yet assigned
  | "ASSIGNED" // round-robin assigned to a support agent
  | "IN_REVIEW" // agent opened the case-summariser for it
  | "DRAFT_PENDING_REVIEW" // draft generated, awaiting agent submission
  | "RESOLVED" // draft submitted, resolvedDate set
  | "CLOSED";

export type DocumentType = "IMG" | "PDF";

export interface AttachedDocument {
  /** S3 key pattern: <date>/<ticketId>/<creatorId>/<docType>-<filename> */
  key: string;
  docType: DocumentType;
  fileName: string;
  uploadedAt: string; // ISO-8601
  sizeBytes?: number;
}

export interface Ticket {
  ticketId: string;
  creatorId: string;
  assigneeId?: string;
  /**
   * The customer the complaint is about (an identifier from the order
   * system). Distinct from creatorId, which is the support rep who logged
   * the ticket. Optional at creation; the summariser's deterministic gate
   * refuses to draft until it is present.
   */
  customerId?: string;
  /** Optional order the complaint refers to; must belong to customerId to be supplied to the model. */
  orderId?: string;
  ticketStatus: TicketStatus;
  ticketCreationDate: string; // ISO-8601
  ticketResolvedDate?: string; // ISO-8601, optional -- only present once resolved
  ticketOverview: string;
  attachedDocuments?: AttachedDocument[];
  /** Populated by the summarisation flow. */
  caseSummary?: string;
  draftMessage?: string;
  /**
   * Exactly what the model was given (facts + policy versions) and which
   * deterministic checks ran, recorded at generation time so the reviewer
   * sees the same evidence after a reload and yesterday's draft can be
   * reconstructed.
   */
  suppliedContext?: SuppliedContext;
  /** Optimistic concurrency / audit */
  version: number;
  updatedAt: string;
}

export interface CreateTicketInput {
  creatorId: string;
  ticketOverview: string;
  customerId?: string;
  orderId?: string;
  attachedDocuments?: Omit<AttachedDocument, "uploadedAt">[];
}

/** Facts the assigned agent can add to a ticket after creation (e.g. when the summariser asks for them). */
export interface TicketFactsInput {
  customerId?: string;
  orderId?: string;
}

/** The record-backed facts supplied to the model, as opposed to the customer's wording. */
export interface SuppliedFacts {
  ticketStatus: TicketStatus;
  customerId?: string;
  /** The referenced order -- only present if it exists AND belongs to customerId. */
  order?: Order;
  /** The customer's other orders on file, supplied as context. */
  otherOrders: Order[];
}

/** A named, deterministic check that ran around the model call. */
export interface SummariseCheck {
  id: string;
  description: string;
  passed: boolean;
  detail?: string;
}

export interface SuppliedContext {
  facts: SuppliedFacts;
  /** The exact policy records (incl. version) the model saw. */
  policies: Policy[];
  checks: SummariseCheck[];
  usedProvider: LLMProviderName;
  testModeTriggered: boolean;
  generatedAt: string; // ISO-8601
}

export type LLMProviderName = "openai" | "anthropic" | "ollama" | "test-stub";

export interface SubmitDraftInput {
  ticketId: string;
  draftMessage: string;
  submittedBy: string;
}
