import "reflect-metadata";
import { container, DependencyContainer } from "tsyringe";
import { Pool } from "pg";
import { createPool } from "../db/pool";
import { ConfigResolver } from "../config/ConfigResolver";
import { ISecretsProvider } from "../secrets/ISecretsProvider";
import { EnvSecretsProvider } from "../secrets/EnvSecretsProvider";
import { AwsSecretsManagerProvider } from "../secrets/AwsSecretsManagerProvider";
import { IEventBus } from "../events/IEventBus";
import { InMemoryEventBus } from "../events/InMemoryEventBus";
import { ITicketRepository } from "../repositories/ITicketRepository";
import { PostgresTicketRepository } from "../repositories/postgres/PostgresTicketRepository";
import { IPolicyRepository } from "../repositories/IPolicyRepository";
import { PostgresPolicyRepository } from "../repositories/postgres/PostgresPolicyRepository";
import { IOrderRepository } from "../repositories/IOrderRepository";
import { PostgresOrderRepository } from "../repositories/postgres/PostgresOrderRepository";
import { IUserRepository } from "../repositories/IUserRepository";
import { PostgresUserRepository } from "../repositories/postgres/PostgresUserRepository";
import { IAssignmentCursorRepository } from "../repositories/IAssignmentCursorRepository";
import { PostgresAssignmentCursorRepository } from "../repositories/postgres/PostgresAssignmentCursorRepository";
import { IAttachmentStorage } from "../repositories/IAttachmentStorage";
import { LocalFsAttachmentStorage } from "../repositories/storage/LocalFsAttachmentStorage";
import { S3AttachmentStorage } from "../repositories/storage/S3AttachmentStorage";
import { ILLMProvider } from "../llm/ILLMProvider";
import { LLMProviderFactory } from "../llm/LLMProviderFactory";
import { IAuthProvider } from "../auth/IAuthProvider";
import { LocalJwtAuthProvider } from "../auth/LocalJwtAuthProvider";
import { CognitoAuthProviderStub } from "../auth/CognitoAuthProviderStub";
import { TicketService } from "../services/TicketService";
import { SummarisationService } from "../services/SummarisationService";
import { AssignmentService } from "../services/AssignmentService";

/**
 * Everything below is a *runtime* decision (env vars / ConfigResolver), not
 * a compile-time `new X()` scattered through services. Repositories,
 * providers and services all receive their dependencies through
 * constructor injection; this file is the ONLY place concrete classes are
 * bound to their interface tokens.
 */
export function configureContainer(): DependencyContainer {
  const configResolver = new ConfigResolver();
  container.registerInstance(ConfigResolver, configResolver);

  const authMode = (process.env.AUTH_MODE || "local").toLowerCase();
  const secretsMode = (process.env.SECRETS_PROVIDER || "env").toLowerCase();
  const docsStorageMode = (process.env.DOCS_STORAGE_MODE || "local-fs").toLowerCase();

  // --- Database ---
  const pool: Pool = createPool();
  container.register<Pool>("Pool", { useValue: pool });

  // --- Secrets ---
  if (secretsMode === "aws") {
    container.registerSingleton<ISecretsProvider>("ISecretsProvider", AwsSecretsManagerProvider);
  } else {
    container.registerSingleton<ISecretsProvider>("ISecretsProvider", EnvSecretsProvider);
  }

  // --- Event bus ---
  container.registerSingleton<IEventBus>("IEventBus", InMemoryEventBus);

  // --- Repositories ---
  container.registerSingleton<ITicketRepository>("ITicketRepository", PostgresTicketRepository);
  container.registerSingleton<IPolicyRepository>("IPolicyRepository", PostgresPolicyRepository);
  container.registerSingleton<IOrderRepository>("IOrderRepository", PostgresOrderRepository);
  container.registerSingleton<IUserRepository>("IUserRepository", PostgresUserRepository);
  container.registerSingleton<IAssignmentCursorRepository>(
    "IAssignmentCursorRepository",
    PostgresAssignmentCursorRepository,
  );

  // --- Attachment storage ---
  if (docsStorageMode === "s3") {
    container.registerSingleton<IAttachmentStorage>("IAttachmentStorage", S3AttachmentStorage);
  } else {
    container.registerSingleton<IAttachmentStorage>("IAttachmentStorage", LocalFsAttachmentStorage);
  }

  // --- LLM provider: resolved via the factory's OUTPUT, not a class binding,
  // since the concrete choice depends on runtime config (llm.provider). ---
  const llmProviderFactory = container.resolve(LLMProviderFactory);
  const llmProvider: ILLMProvider = llmProviderFactory.create(container);
  container.register<ILLMProvider>("ILLMProvider", { useValue: llmProvider });

  // --- Auth provider ---
  if (authMode === "cognito") {
    container.registerSingleton<IAuthProvider>("IAuthProvider", CognitoAuthProviderStub);
  } else {
    container.registerSingleton<IAuthProvider>("IAuthProvider", LocalJwtAuthProvider);
  }

  // --- Services ---
  container.registerSingleton(TicketService);
  container.registerSingleton(SummarisationService);
  container.registerSingleton(AssignmentService);

  // AssignmentService subscribes to the event bus from its constructor;
  // resolve it once, eagerly, so that subscription actually happens before
  // any TicketCreated event can be published.
  container.resolve(AssignmentService);

  return container;
}

export { container };
