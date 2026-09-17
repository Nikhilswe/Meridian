/**
 * Domain events published on the event bus. In AWS mode, a DynamoDB Stream
 * on the tickets table triggers a Lambda instead of an in-process publish --
 * see events/IEventBus.ts for how that maps.
 */
export interface TicketCreatedEvent {
  type: "TicketCreated";
  ticketId: string;
  creatorId: string;
  occurredAt: string;
}

export const EVENT_TYPE_TICKET_CREATED = "TicketCreated" as const;
