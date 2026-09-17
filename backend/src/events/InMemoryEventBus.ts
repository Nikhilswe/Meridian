import { injectable } from "tsyringe";
import { IEventBus } from "./IEventBus";

type Handler = (event: unknown) => Promise<void>;

/**
 * Offline in-process pub/sub, registered as a DI singleton (see
 * src/di/container.ts) so every publisher/subscriber shares the same bus
 * instance. Handlers run sequentially and a failing handler is logged but
 * never crashes the publisher -- mirrors how a Lambda's own failure doesn't
 * take down whatever wrote the DynamoDB record that triggered it.
 */
@injectable()
export class InMemoryEventBus implements IEventBus {
  private readonly handlers = new Map<string, Handler[]>();

  public async publish<E extends { type: string }>(event: E): Promise<void> {
    const subscribers = this.handlers.get(event.type) ?? [];
    for (const handler of subscribers) {
      try {
        await handler(event);
      } catch (err) {
        console.error(`InMemoryEventBus: handler for "${event.type}" threw:`, (err as Error).message);
      }
    }
  }

  public subscribe<E extends { type: string }>(eventType: E["type"], handler: (event: E) => Promise<void>): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler as Handler);
    this.handlers.set(eventType, existing);
  }
}
