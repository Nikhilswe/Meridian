import { AttachedDocument, CreateTicketInput } from "@scaler/shared-types";
import { ValidationError } from "./errors";

const MAX_OVERVIEW_LENGTH = 5000;

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

  public forCreator(creatorId: string): this {
    this.creatorId = creatorId;
    return this;
  }

  public withOverview(text: string): this {
    this.ticketOverview = text;
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
    return input;
  }
}
