import { canTransition, isVisibleToUser } from "../../src/domain/TicketEntity";

describe("TicketEntity.canTransition", () => {
  it("allows each forward single-step transition in the lifecycle", () => {
    expect(canTransition("OPEN", "ASSIGNED")).toBe(true);
    expect(canTransition("ASSIGNED", "IN_REVIEW")).toBe(true);
    expect(canTransition("IN_REVIEW", "DRAFT_PENDING_REVIEW")).toBe(true);
    expect(canTransition("DRAFT_PENDING_REVIEW", "RESOLVED")).toBe(true);
    expect(canTransition("RESOLVED", "CLOSED")).toBe(true);
  });

  it("rejects skipping ahead more than one step", () => {
    expect(canTransition("OPEN", "IN_REVIEW")).toBe(false);
    expect(canTransition("OPEN", "RESOLVED")).toBe(false);
    expect(canTransition("ASSIGNED", "RESOLVED")).toBe(false);
  });

  it("rejects moving backwards", () => {
    expect(canTransition("ASSIGNED", "OPEN")).toBe(false);
    expect(canTransition("RESOLVED", "DRAFT_PENDING_REVIEW")).toBe(false);
    expect(canTransition("CLOSED", "RESOLVED")).toBe(false);
  });

  it("rejects staying in the same state", () => {
    expect(canTransition("OPEN", "OPEN")).toBe(false);
  });
});

describe("TicketEntity.isVisibleToUser", () => {
  it("is visible to its assignee", () => {
    const ticket = { creatorId: "agent-1", assigneeId: "agent-2" };
    expect(isVisibleToUser(ticket, "agent-2", 5)).toBe(true);
  });

  it("is visible to its creator even once assigned to someone else", () => {
    const ticket = { creatorId: "agent-1", assigneeId: "agent-2" };
    expect(isVisibleToUser(ticket, "agent-1", 5)).toBe(true);
  });

  it("is hidden from an unrelated user once assigned", () => {
    const ticket = { creatorId: "agent-1", assigneeId: "agent-2" };
    expect(isVisibleToUser(ticket, "agent-3", 5)).toBe(false);
  });

  it("is visible to its creator when unassigned AND they are the sole distinct creator", () => {
    const ticket = { creatorId: "agent-1", assigneeId: undefined };
    expect(isVisibleToUser(ticket, "agent-1", 1)).toBe(true);
  });

  it("is hidden from its own creator when unassigned but other creators exist", () => {
    const ticket = { creatorId: "agent-1", assigneeId: undefined };
    expect(isVisibleToUser(ticket, "agent-1", 2)).toBe(false);
  });

  it("is hidden from a non-creator when unassigned", () => {
    const ticket = { creatorId: "agent-1", assigneeId: undefined };
    expect(isVisibleToUser(ticket, "agent-2", 1)).toBe(false);
  });
});
