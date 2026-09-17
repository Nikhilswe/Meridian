import { AttachedDocument, CreateTicketInput } from "@scaler/shared-types";
import { ValidationError } from "./errors";

const MAX_OVERVIEW_LENGTH = 5000;
const MAX_IDENTIFIER_LENGTH = 64;
/** Identifiers come from an external order system: keep them to a safe, printable token. */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type BuilderAttachedDocument = Omit<AttachedDocument, "uploadedAt">;

/**
 * Builder pattern for ticket creation. Tickets have a growing set of optional
 * fields (attachments today, more later); the fluent builder keeps that
 * extensibility from turning into a giant constructor or an options-bag that
 * nobody validates consistently. This is the ONLY place ticket-creation
 * validation logic lives -- TicketService calls .build() and trusts it.
 */
export class TicketBuilder {
  private creatorId?: string;
  private ticketOverview?: string;
  private attachedDocuments: BuilderAttachedDocument[] = [];
  private customerId?: string;
  private orderId?: string;

  public forCreator(creatorId: string): this {
    this.creatorId = creatorId;
    return this;
  }

  public withOverview(text: string): this {
    this.ticketOverview = text;
    return this;
  }

  /** Optional at creation; the summariser's deterministic gate asks for it if absent. */
  public forCustomer(customerId: string | undefined): this {
    this.customerId = customerId;
    return this;
  }

  /** Optional; the summariser only supplies it to the model if it belongs to the customer. */
  public aboutOrder(orderId: string | undefined): this {
    this.orderId = orderId;
    return this;
  }

  /** Repeatable -- call once per attachment. */
  public withAttachedDocument(doc: BuilderAttachedDocument): this {
    this.attachedDocuments.push(doc);
    return this;
  }

  public build(): CreateTicketInput {
    const errors: string[] = [];

    const creatorId = (this.creatorId ?? "").trim();
    if (creatorId.length === 0) {
      errors.push("creatorId is required and must be non-empty");
    }

    const ticketOverview = (this.ticketOverview ?? "").trim();
    if (ticketOverview.length === 0) {
      errors.push("ticketOverview is required and must be non-empty");
    } else if (ticketOverview.length > MAX_OVERVIEW_LENGTH) {
      errors.push(`ticketOverview must be at most ${MAX_OVERVIEW_LENGTH} characters`);
    }

    const customerId = validateOptionalIdentifier("customerId", this.customerId, errors);
    const orderId = validateOptionalIdentifier("orderId", this.orderId, errors);

    for (const [index, doc] of this.attachedDocuments.entries()) {
      if (!doc.key || doc.key.trim().length === 0) {
        errors.push(`attachedDocuments[${index}].key is required`);
      }
      if (!doc.fileName || doc.fileName.trim().length === 0) {
        errors.push(`attachedDocuments[${index}].fileName is required`);
      }
      if (doc.docType !== "IMG" && doc.docType !== "PDF") {
        errors.push(`attachedDocuments[${index}].docType must be IMG or PDF`);
      }
    }

    if (errors.length > 0) {
      throw new ValidationError("Invalid ticket input", errors);
    }

    const input: CreateTicketInput = {
      creatorId,
      ticketOverview,
    };
    if (this.attachedDocuments.length > 0) {
      input.attachedDocuments = this.attachedDocuments;
    }
    if (customerId) input.customerId = customerId;
    if (orderId) input.orderId = orderId;
    return input;
  }
}

/**
 * Shared by TicketBuilder (creation) and TicketService.updateFacts (adding
 * facts later) so an identifier is validated identically in both places.
 */
export function validateOptionalIdentifier(
  fieldName: string,
  value: string | undefined,
  errors: string[],
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
    errors.push(`${fieldName} must be at most ${MAX_IDENTIFIER_LENGTH} characters`);
  } else if (!IDENTIFIER_PATTERN.test(trimmed)) {
    errors.push(`${fieldName} may only contain letters, digits, '.', '_' and '-'`);
  }
  return trimmed;
}
