/**
 * Event bus seam. Offline: InMemoryEventBus, a simple in-process pub/sub.
 * AWS mode: a DynamoDB Stream on the tickets table plays the exact role of
 * this bus's `publish` (every write is automatically "published" as a stream
 * record) and a Lambda subscribed to that stream plays the exact role of
 * this bus's dispatch to a `subscribe`d handler. Because of that, handler
 * functions (see services/AssignmentService.ts) are written as pure
 * functions of (event, injected repositories) so they can be lifted into a
 * Lambda handler unchanged -- only the "how do I get invoked" wiring differs.
 */
export interface IEventBus {
  publish<E extends { type: string }>(event: E): Promise<void>;
  subscribe<E extends { type: string }>(eventType: E["type"], handler: (event: E) => Promise<void>): void;
}
