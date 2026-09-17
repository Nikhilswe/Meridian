import "reflect-metadata";
import * as bcrypt from "bcryptjs";
import * as path from "path";
import { container } from "tsyringe";
import { Policy, Order, UserRole } from "@scaler/shared-types";
import { ConfigResolver } from "../../src/config/ConfigResolver";
import { ISecretsProvider } from "../../src/secrets/ISecretsProvider";
import { IEventBus } from "../../src/events/IEventBus";
import { InMemoryEventBus } from "../../src/events/InMemoryEventBus";
import { ITicketRepository } from "../../src/repositories/ITicketRepository";
import { IPolicyRepository } from "../../src/repositories/IPolicyRepository";
import { IOrderRepository } from "../../src/repositories/IOrderRepository";
import { IUserRepository, UserWithCredentials } from "../../src/repositories/IUserRepository";
import { IAssignmentCursorRepository } from "../../src/repositories/IAssignmentCursorRepository";
import { ILLMProvider } from "../../src/llm/ILLMProvider";
import { LLMProviderFactory } from "../../src/llm/LLMProviderFactory";
import { IAuthProvider } from "../../src/auth/IAuthProvider";
import { LocalJwtAuthProvider } from "../../src/auth/LocalJwtAuthProvider";
import { TicketService } from "../../src/services/TicketService";
import { SummarisationService } from "../../src/services/SummarisationService";
import { AssignmentService } from "../../src/services/AssignmentService";
import { InMemoryTicketRepository } from "./fakes/InMemoryTicketRepository";
import { InMemoryUserRepository } from "./fakes/InMemoryUserRepository";
import { InMemoryPolicyRepository } from "./fakes/InMemoryPolicyRepository";
import { InMemoryOrderRepository } from "./fakes/InMemoryOrderRepository";
import { InMemoryAssignmentCursorRepository } from "./fakes/InMemoryAssignmentCursorRepository";

export const CONFIG_FIXTURE_DIR = path.join(__dirname, "fixtures", "config");
/**
 * A second fixture with the exact rateLimit.ticketCreateMax/summariseMax=3
 * the dedicated rate-limiter test asserts against. The main fixture's
 * limits were raised well above the handful of ticket-create/summarise
 * calls the rest of this suite issues against one shared `app`/token, so
 * that suite is no longer *incidentally* rate-limited by unrelated test
 * traffic sharing the same in-memory limiter store.
 */
export const STRICT_CONFIG_FIXTURE_DIR = path.join(__dirname, "fixtures", "config-strict");

export interface TestUserFixture {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  plaintextPassword: string;
}

export const TEST_USERS: TestUserFixture[] = [
  { userId: "agent-1", email: "agent1@test.local", displayName: "Agent One", role: "SUPPORT_AGENT", plaintextPassword: "AgentOne!123" },
  { userId: "agent-2", email: "agent2@test.local", displayName: "Agent Two", role: "SUPPORT_AGENT", plaintextPassword: "AgentTwo!123" },
  { userId: "reviewer-1", email: "reviewer1@test.local", displayName: "Reviewer One", role: "REVIEWER", plaintextPassword: "ReviewerOne!123" },
];

export const TEST_POLICIES: Policy[] = [
  {
    policyId: "policy-refunds-1",
    category: "refunds",
    title: "Standard refund window",
    body: "Refunds are available within 30 days of delivery.",
    version: 1,
    effectiveDate: new Date().toISOString(),
  },
];

export const TEST_ORDERS: Order[] = [
  {
    orderId: "order-1",
    customerId: "cust-1",
    itemSummary: "Widget",
    orderDate: new Date().toISOString(),
    amount: 42,
    currency: "USD",
    status: "DELIVERED",
    deliveredDate: new Date().toISOString(),
  },
  {
    // Delivered but the date is unknown -> the summariser's gate must ask for it (C2).
    orderId: "order-nodate",
    customerId: "cust-1",
    itemSummary: "Gadget",
    orderDate: new Date().toISOString(),
    amount: 15,
    currency: "USD",
    status: "DELIVERED",
  },
];

/**
 * Wires the SAME tsyringe `container` singleton that src/app.ts resolves
 * from, but binds every repository/provider token to an in-memory fake
 * instead of a Postgres-backed / real-network implementation. This lets
 * integration tests exercise the full HTTP -> route -> service ->
 * repository-interface stack without a live database or LLM API.
 */
export async function setupTestContainer(
  configDir: string = CONFIG_FIXTURE_DIR,
): Promise<{ ticketRepo: InMemoryTicketRepository; userRepo: InMemoryUserRepository }> {
  container.clearInstances();

  process.env.APP_ENV = "local";
  process.env.JWT_SECRET = "integration-test-jwt-secret";
  process.env.JWT_EXPIRY = "1h";

  const configResolver = new ConfigResolver(configDir, "local");
  container.registerInstance(ConfigResolver, configResolver);

  container.register<ISecretsProvider>("ISecretsProvider", {
    useValue: {
      get: async (name: string) => process.env[name],
    },
  });

  container.registerSingleton<IEventBus>("IEventBus", InMemoryEventBus);

  const ticketRepo = new InMemoryTicketRepository();
  container.register<ITicketRepository>("ITicketRepository", { useValue: ticketRepo });

  const userRepo = new InMemoryUserRepository();
  const hashedUsers: UserWithCredentials[] = await Promise.all(
    TEST_USERS.map(async (u) => ({
      userId: u.userId,
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      passwordHash: await bcrypt.hash(u.plaintextPassword, 4),
    })),
  );
  userRepo.seed(hashedUsers);
  container.register<IUserRepository>("IUserRepository", { useValue: userRepo });

  container.register<IPolicyRepository>("IPolicyRepository", { useValue: new InMemoryPolicyRepository(TEST_POLICIES) });
  container.register<IOrderRepository>("IOrderRepository", { useValue: new InMemoryOrderRepository(TEST_ORDERS) });
  container.register<IAssignmentCursorRepository>("IAssignmentCursorRepository", {
    useValue: new InMemoryAssignmentCursorRepository(),
  });

  const llmProviderFactory = container.resolve(LLMProviderFactory);
  const llmProvider: ILLMProvider = llmProviderFactory.create(container);
  container.register<ILLMProvider>("ILLMProvider", { useValue: llmProvider });

  container.registerSingleton<IAuthProvider>("IAuthProvider", LocalJwtAuthProvider);

  container.registerSingleton(TicketService);
  container.registerSingleton(SummarisationService);
  container.registerSingleton(AssignmentService);
  container.resolve(AssignmentService); // eagerly subscribe to the event bus

  return { ticketRepo, userRepo };
}
