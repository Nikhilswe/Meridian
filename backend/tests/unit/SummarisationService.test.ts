import "reflect-metadata";
import { shouldBypassWithTestStub, SummarisationService } from "../../src/services/SummarisationService";
import { ITicketRepository } from "../../src/repositories/ITicketRepository";
import { IPolicyRepository } from "../../src/repositories/IPolicyRepository";
import { IOrderRepository } from "../../src/repositories/IOrderRepository";
import { ILLMProvider } from "../../src/llm/ILLMProvider";
import { LLMProviderFactory } from "../../src/llm/LLMProviderFactory";
import { ConfigResolver } from "../../src/config/ConfigResolver";
import { Ticket } from "@scaler/shared-types";

describe("shouldBypassWithTestStub", () => {
  it("matches the whole word 'test' case-insensitively", () => {
    expect(shouldBypassWithTestStub("This is a Test ticket")).toBe(true);
    expect(shouldBypassWithTestStub("please TEST this flow")).toBe(true);
  });

  it("does not match substrings like 'testing' being part of another word boundary-less string", () => {
    // "\btest\b" DOES match inside "testing" only if "test" is itself a whole
    // token boundary -- "testing" has no boundary after "test", so it should
    // NOT match.
    expect(shouldBypassWithTestStub("we are testing the widget")).toBe(false);
  });

  it("returns false for an overview with no mention of test", () => {
    expect(shouldBypassWithTestStub("Customer wants a refund for a damaged item")).toBe(false);
  });
});

function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticketId: "ticket-1",
    creatorId: "agent-1",
    assigneeId: "agent-1",
    ticketStatus: "ASSIGNED",
    ticketCreationDate: new Date().toISOString(),
    ticketOverview: "Customer wants a refund",
    version: 1,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SummarisationService test-bypass short-circuit", () => {
  function buildService(overview: string, statusUpdates: Ticket[]) {
    const ticket = buildTicket({ ticketOverview: overview });

    const ticketRepo: ITicketRepository = {
      create: jest.fn(),
      getById: jest.fn().mockResolvedValue(ticket),
      listPaginatedForAssignee: jest.fn(),
      listPaginatedAll: jest.fn(),
      listPaginatedForCreator: jest.fn(),
      updateStatusAndFields: jest.fn().mockImplementation(async (_id, _version, fields) => {
        const updated = { ...ticket, ...fields };
        statusUpdates.push(updated);
        return updated;
      }),
      countDistinctCreators: jest.fn(),
    };

    const policyRepo: IPolicyRepository = {
      listAll: jest.fn().mockResolvedValue([]),
      listByCategory: jest.fn(),
    };
    const orderRepo: IOrderRepository = {
      listByCustomerId: jest.fn().mockResolvedValue([]),
    };
    const llmProvider: ILLMProvider = {
      generate: jest.fn().mockResolvedValue({ summary: "REAL SUMMARY", draftMessage: "REAL DRAFT" }),
    };
    const configResolver = new ConfigResolver(undefined, "local");
    const factory = new LLMProviderFactory(configResolver);

    const service = new SummarisationService(ticketRepo, policyRepo, orderRepo, llmProvider, factory);
    return { service, ticketRepo, llmProvider };
  }

  it("short-circuits and never calls the LLM provider when overview contains 'test'", async () => {
    const statusUpdates: Ticket[] = [];
    const { service, llmProvider } = buildService("This is a test ticket", statusUpdates);

    const result = await service.summariseCase("ticket-1", { userId: "agent-1", role: "SUPPORT_AGENT" });

    expect(result.testModeTriggered).toBe(true);
    expect(result.caseSummary).toBe("test");
    expect(result.draftMessage).toBe("test");
    expect(llmProvider.generate).not.toHaveBeenCalled();
  });

  it("short-circuits when an explicit testMode context flag is passed, regardless of overview text", async () => {
    const statusUpdates: Ticket[] = [];
    const { service, llmProvider } = buildService("Customer wants a refund", statusUpdates);

    const result = await service.summariseCase(
      "ticket-1",
      { userId: "agent-1", role: "SUPPORT_AGENT" },
      { testMode: true },
    );

    expect(result.testModeTriggered).toBe(true);
    expect(llmProvider.generate).not.toHaveBeenCalled();
  });

  it("calls the real LLM provider when there is no test bypass", async () => {
    const statusUpdates: Ticket[] = [];
    const { service, llmProvider } = buildService("Customer wants a refund", statusUpdates);

    const result = await service.summariseCase("ticket-1", { userId: "agent-1", role: "SUPPORT_AGENT" });

    expect(result.testModeTriggered).toBe(false);
    expect(result.caseSummary).toBe("REAL SUMMARY");
    expect(llmProvider.generate).toHaveBeenCalledTimes(1);
  });
});
