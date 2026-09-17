import "reflect-metadata";
import { shouldBypassWithTestStub, SummarisationService } from "../../src/services/SummarisationService";
import { ITicketRepository, UpdateTicketFields } from "../../src/repositories/ITicketRepository";
import { IPolicyRepository } from "../../src/repositories/IPolicyRepository";
import { IOrderRepository } from "../../src/repositories/IOrderRepository";
import { ILLMProvider, LLMGenerateInput } from "../../src/llm/ILLMProvider";
import { LLMProviderFactory } from "../../src/llm/LLMProviderFactory";
import { ConfigResolver } from "../../src/config/ConfigResolver";
import { InvalidStateTransitionError } from "../../src/domain/errors";
import { Order, Ticket } from "@scaler/shared-types";

describe("shouldBypassWithTestStub", () => {
  it("matches the whole word 'test' case-insensitively", () => {
    expect(shouldBypassWithTestStub("This is a Test ticket")).toBe(true);
    expect(shouldBypassWithTestStub("please TEST this flow")).toBe(true);
  });

  it("does not match substrings like 'testing' being part of another word boundary-less string", () => {
    expect(shouldBypassWithTestStub("we are testing the widget")).toBe(false);
  });

  it("returns false for an overview with no mention of test", () => {
    expect(shouldBypassWithTestStub("Customer wants a refund for a damaged item")).toBe(false);
  });
});

const AGENT = { userId: "agent-1", role: "SUPPORT_AGENT" as const };

const ORDERS: Order[] = [
  {
    orderId: "order-1",
    customerId: "cust-1",
    itemSummary: "Jacket",
    orderDate: "2026-09-10T00:00:00.000Z",
    amount: 80,
    currency: "USD",
    status: "DELIVERED",
    deliveredDate: "2026-09-16T00:00:00.000Z",
  },
  {
    orderId: "order-2",
    customerId: "cust-1",
    itemSummary: "Scarf",
    orderDate: "2026-09-01T00:00:00.000Z",
    amount: 20,
    currency: "USD",
    status: "SHIPPED",
  },
  {
    orderId: "order-other",
    customerId: "cust-OTHER",
    itemSummary: "Someone else's laptop",
    orderDate: "2026-09-01T00:00:00.000Z",
    amount: 1500,
    currency: "USD",
    status: "DELIVERED",
    deliveredDate: "2026-09-02T00:00:00.000Z",
  },
];

function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticketId: "ticket-1",
    creatorId: "agent-1", // the support rep -- NOT the customer
    assigneeId: "agent-1",
    ticketStatus: "ASSIGNED",
    ticketCreationDate: new Date().toISOString(),
    ticketOverview: "Customer wants a refund",
    customerId: "cust-1",
    version: 1,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

interface Harness {
  service: SummarisationService;
  generate: jest.Mock<Promise<{ summary: string; draftMessage: string }>, [LLMGenerateInput]>;
  updates: UpdateTicketFields[];
  orderRepo: IOrderRepository;
}

function buildService(ticket: Ticket, draftText = "We have referred your case for review."): Harness {
  const updates: UpdateTicketFields[] = [];
  let current = ticket;

  const ticketRepo: ITicketRepository = {
    create: jest.fn(),
    getById: jest.fn().mockImplementation(async () => current),
    listPaginatedForAssignee: jest.fn(),
    listPaginatedAll: jest.fn(),
    listPaginatedForCreator: jest.fn(),
    updateStatusAndFields: jest.fn().mockImplementation(async (_id, _version, fields: UpdateTicketFields) => {
      updates.push(fields);
      current = { ...current, ...fields, version: current.version + 1 };
      return current;
    }),
    countDistinctCreators: jest.fn(),
  };

  const policyRepo: IPolicyRepository = {
    listAll: jest.fn().mockResolvedValue([]),
    listByCategory: jest.fn(),
  };
  const orderRepo: IOrderRepository = {
    listByCustomerId: jest.fn().mockImplementation(async (id: string) => ORDERS.filter((o) => o.customerId === id)),
    getById: jest.fn().mockImplementation(async (id: string) => ORDERS.find((o) => o.orderId === id)),
  };
  const generate = jest.fn().mockResolvedValue({ summary: "REAL SUMMARY", draftMessage: draftText });
  const llmProvider: ILLMProvider = { generate };
  const factory = new LLMProviderFactory(new ConfigResolver(undefined, "local"));

  const service = new SummarisationService(ticketRepo, policyRepo, orderRepo, llmProvider, factory);
  return { service, generate, updates, orderRepo };
}

describe("SummarisationService test-bypass short-circuit", () => {
  it("short-circuits and never calls the LLM provider when overview contains 'test'", async () => {
    const { service, generate } = buildService(buildTicket({ ticketOverview: "This is a test ticket" }));
    const result = await service.summariseCase("ticket-1", AGENT);
    expect(result.outcome).toBe("DRAFTED");
    expect(result.testModeTriggered).toBe(true);
    expect(result.caseSummary).toBe("test");
    expect(result.draftMessage).toBe("test");
    expect(generate).not.toHaveBeenCalled();
  });

  it("short-circuits when an explicit testMode context flag is passed, regardless of overview text", async () => {
    const { service, generate } = buildService(buildTicket());
    const result = await service.summariseCase("ticket-1", AGENT, { testMode: true });
    expect(result.testModeTriggered).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it("calls the real LLM provider when there is no test bypass", async () => {
    const { service, generate } = buildService(buildTicket());
    const result = await service.summariseCase("ticket-1", AGENT);
    expect(result.outcome).toBe("DRAFTED");
    expect(result.testModeTriggered).toBe(false);
    expect(result.caseSummary).toBe("REAL SUMMARY");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("SummarisationService deterministic gate (before the model)", () => {
  it("returns NEEDS_INFO and NEVER invokes the model when the customer is missing", async () => {
    const { service, generate, updates } = buildService(buildTicket({ customerId: undefined }));
    generate.mockImplementation(async () => {
      throw new Error("model must not be called when the gate fails");
    });

    const result = await service.summariseCase("ticket-1", AGENT);

    expect(result.outcome).toBe("NEEDS_INFO");
    expect(result.missingInformation[0]).toMatch(/Customer ID/);
    expect(result.caseSummary).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
    expect(updates).toEqual([]); // nothing persisted, status unchanged
  });

  it("gate also applies in test mode -- the stub is not a way around it", async () => {
    const { service, updates } = buildService(buildTicket({ customerId: undefined, ticketOverview: "a test ticket" }));
    const result = await service.summariseCase("ticket-1", AGENT);
    expect(result.outcome).toBe("NEEDS_INFO");
    expect(result.testModeTriggered).toBe(true);
    expect(updates).toEqual([]);
  });

  it("C2: delivered order without a delivery date -> NEEDS_INFO, no model call", async () => {
    const ticket = buildTicket({ orderId: "order-1" });
    const { service, generate, orderRepo } = buildService(ticket);
    (orderRepo.getById as jest.Mock).mockResolvedValue({ ...ORDERS[0], deliveredDate: undefined });
    (orderRepo.listByCustomerId as jest.Mock).mockResolvedValue([{ ...ORDERS[0], deliveredDate: undefined }]);

    const result = await service.summariseCase("ticket-1", AGENT);

    expect(result.outcome).toBe("NEEDS_INFO");
    expect(result.missingInformation[0]).toMatch(/Delivery date for order order-1/);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("SummarisationService access at retrieval", () => {
  it("retrieves orders by the ticket's customerId, never by creatorId", async () => {
    const { service, orderRepo, generate } = buildService(buildTicket());
    await service.summariseCase("ticket-1", AGENT);
    expect(orderRepo.listByCustomerId).toHaveBeenCalledWith("cust-1");
    expect(orderRepo.listByCustomerId).not.toHaveBeenCalledWith("agent-1");
    const input = generate.mock.calls[0]?.[0];
    expect(input?.facts.customerId).toBe("cust-1");
    expect(input?.facts.otherOrders.map((o) => o.orderId).sort()).toEqual(["order-1", "order-2"]);
  });

  it("a referenced order belonging to another customer never enters the model context", async () => {
    const { service, generate } = buildService(buildTicket({ orderId: "order-other" }));
    const result = await service.summariseCase("ticket-1", AGENT);

    expect(result.outcome).toBe("NEEDS_INFO");
    expect(result.missingInformation[0]).toMatch(/order-other could not be matched/);
    expect(result.suppliedFacts?.order).toBeUndefined();
    expect(JSON.stringify(result.suppliedFacts)).not.toContain("laptop");
    expect(generate).not.toHaveBeenCalled();
  });

  it("supplies the referenced order as the primary fact and the rest as context", async () => {
    const { service, generate } = buildService(buildTicket({ orderId: "order-1" }));
    await service.summariseCase("ticket-1", AGENT);
    const input = generate.mock.calls[0]?.[0];
    expect(input?.facts.order?.orderId).toBe("order-1");
    expect(input?.facts.otherOrders.map((o) => o.orderId)).toEqual(["order-2"]);
    expect(input?.facts.ticketStatus).toBe("ASSIGNED");
  });
});

describe("SummarisationService post-model check (source of truth)", () => {
  it("C3: rejects and does not persist a draft that claims resolution while the record is open", async () => {
    const { service, updates } = buildService(buildTicket(), "Good news: your issue has been resolved.");
    const result = await service.summariseCase("ticket-1", AGENT);

    expect(result.outcome).toBe("DRAFT_REJECTED");
    expect(result.draftMessage).toContain("resolved"); // returned for transparency
    expect(result.checks.find((c) => c.id === "NO_RESOLUTION_CLAIM_WHILE_OPEN")?.passed).toBe(false);
    expect(updates).toEqual([]); // NOT saved, status unchanged
  });

  it("persists the draft together with the supplied context when every check passes", async () => {
    const { service, updates } = buildService(buildTicket({ orderId: "order-1" }));
    const result = await service.summariseCase("ticket-1", AGENT);

    expect(result.outcome).toBe("DRAFTED");
    expect(result.checks.every((c) => c.passed)).toBe(true);
    const persisted = updates.find((u) => u.suppliedContext);
    expect(persisted?.ticketStatus).toBe("DRAFT_PENDING_REVIEW");
    expect(persisted?.suppliedContext?.facts.order?.orderId).toBe("order-1");
    expect(persisted?.suppliedContext?.checks.length).toBeGreaterThan(0);
    expect(persisted?.suppliedContext?.generatedAt).toBeTruthy();
  });
});

describe("SummarisationService regenerate", () => {
  it("regenerates from DRAFT_PENDING_REVIEW, replacing the draft without changing status", async () => {
    const ticket = buildTicket({ ticketStatus: "DRAFT_PENDING_REVIEW", caseSummary: "old", draftMessage: "old draft" });
    const { service, updates, generate } = buildService(ticket, "Second attempt: referred for review.");
    const result = await service.summariseCase("ticket-1", AGENT);

    expect(result.outcome).toBe("DRAFTED");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.ticketStatus).toBeUndefined();
    expect(updates[0]?.draftMessage).toBe("Second attempt: referred for review.");
  });

  it("refuses to generate for a RESOLVED case", async () => {
    const { service, generate } = buildService(buildTicket({ ticketStatus: "RESOLVED" }));
    await expect(service.summariseCase("ticket-1", AGENT)).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect(generate).not.toHaveBeenCalled();
  });
});
