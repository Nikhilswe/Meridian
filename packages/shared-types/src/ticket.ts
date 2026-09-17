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
  ticketStatus: TicketStatus;
  ticketCreationDate: string; // ISO-8601
  ticketResolvedDate?: string; // ISO-8601, optional -- only present once resolved
  ticketOverview: string;
  attachedDocuments?: AttachedDocument[];
  /** Populated by the summarisation flow. */
  caseSummary?: string;
  draftMessage?: string;
  /** Optimistic concurrency / audit */
  version: number;
  updatedAt: string;
}

export interface CreateTicketInput {
  creatorId: string;
  ticketOverview: string;
  attachedDocuments?: Omit<AttachedDocument, "uploadedAt">[];
}

export interface SubmitDraftInput {
  ticketId: string;
  draftMessage: string;
  submittedBy: string;
}
