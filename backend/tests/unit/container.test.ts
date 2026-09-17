import "reflect-metadata";
import { container as globalContainer } from "tsyringe";
import { configureContainer } from "../../src/di/container";
import { EnvSecretsProvider } from "../../src/secrets/EnvSecretsProvider";
import { AwsSecretsManagerProvider } from "../../src/secrets/AwsSecretsManagerProvider";
import { LocalJwtAuthProvider } from "../../src/auth/LocalJwtAuthProvider";
import { CognitoAuthProviderStub } from "../../src/auth/CognitoAuthProviderStub";
import { LocalFsAttachmentStorage } from "../../src/repositories/storage/LocalFsAttachmentStorage";
import { S3AttachmentStorage } from "../../src/repositories/storage/S3AttachmentStorage";
import { InMemoryEventBus } from "../../src/events/InMemoryEventBus";
import { AssignmentService } from "../../src/services/AssignmentService";
import { SummarisationService } from "../../src/services/SummarisationService";
import { TicketService } from "../../src/services/TicketService";
import { ILLMProvider } from "../../src/llm/ILLMProvider";
import { LLMProviderFactory } from "../../src/llm/LLMProviderFactory";

// `aws-jwt-verify` validates the pool id format at create() time; the
// container test only cares about WHICH class was bound, not that AWS is
// reachable, so stub it.
jest.mock("aws-jwt-verify", () => ({ CognitoJwtVerifier: { create: () => ({ verify: jest.fn() }) } }));

/**
 * The container is the ONE place concrete classes are chosen (root CLAUDE.md
 * rule 1). These tests pin the env-flag -> implementation mapping so a
 * refactor can't silently swap, say, EnvSecretsProvider in for AWS mode.
 */
describe("configureContainer", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    globalContainer.reset();
    process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:1/db"; // never connected to
    process.env.APP_ENV = "local";
    delete process.env.AUTH_MODE;
    delete process.env.SECRETS_PROVIDER;
    delete process.env.DOCS_STORAGE_MODE;
  });

  afterAll(async () => {
    process.env = saved;
    globalContainer.reset();
  });

  it("offline defaults: env secrets, local JWT auth, local-fs attachments, in-memory bus, and every service resolvable", () => {
    const c = configureContainer();
    expect(c.resolve("ISecretsProvider")).toBeInstanceOf(EnvSecretsProvider);
    expect(c.resolve("IAuthProvider")).toBeInstanceOf(LocalJwtAuthProvider);
    expect(c.resolve("IAttachmentStorage")).toBeInstanceOf(LocalFsAttachmentStorage);
    expect(c.resolve("IEventBus")).toBeInstanceOf(InMemoryEventBus);
    // Bus and AssignmentService are singletons: the same instance every time.
    expect(c.resolve("IEventBus")).toBe(c.resolve("IEventBus"));
    expect(c.resolve(AssignmentService)).toBe(c.resolve(AssignmentService));
    expect(c.resolve(TicketService)).toBeInstanceOf(TicketService);
    expect(c.resolve(SummarisationService)).toBeInstanceOf(SummarisationService);
  });

  it("the LLM provider is bound from config, not from any env var, and matches the factory's own answer", () => {
    process.env.LLM_PROVIDER = "openai"; // must be ignored -- there is no such switch
    const c = configureContainer();
    const factory = c.resolve(LLMProviderFactory);
    const bound = c.resolve<ILLMProvider>("ILLMProvider");
    expect(bound.constructor).toBe(factory.create(c).constructor);
    expect(bound.constructor.name).not.toBe("OpenAIProvider");
    delete process.env.LLM_PROVIDER;
  });

  it("AWS mode flags swap in the AWS adapters through the SAME interface tokens", () => {
    process.env.AUTH_MODE = "cognito";
    process.env.SECRETS_PROVIDER = "aws";
    process.env.DOCS_STORAGE_MODE = "s3";
    const c = configureContainer();
    expect(c.resolve("ISecretsProvider")).toBeInstanceOf(AwsSecretsManagerProvider);
    expect(c.resolve("IAuthProvider")).toBeInstanceOf(CognitoAuthProviderStub);
    expect(c.resolve("IAttachmentStorage")).toBeInstanceOf(S3AttachmentStorage);
  });

  it("flags are case-insensitive and unknown values fall back to the offline implementations", () => {
    process.env.AUTH_MODE = "COGNITO";
    process.env.SECRETS_PROVIDER = "nonsense";
    process.env.DOCS_STORAGE_MODE = "S3";
    const c = configureContainer();
    expect(c.resolve("IAuthProvider")).toBeInstanceOf(CognitoAuthProviderStub);
    expect(c.resolve("ISecretsProvider")).toBeInstanceOf(EnvSecretsProvider);
    expect(c.resolve("IAttachmentStorage")).toBeInstanceOf(S3AttachmentStorage);
  });

  it("refuses to configure without a database URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => configureContainer()).toThrow("DATABASE_URL is not set");
  });
});
