import "reflect-metadata";
import { container } from "tsyringe";
import * as path from "path";
import { LLMProviderFactory } from "../../src/llm/LLMProviderFactory";
import { ConfigResolver } from "../../src/config/ConfigResolver";
import { OpenAIProvider } from "../../src/llm/OpenAIProvider";
import { OllamaProvider } from "../../src/llm/OllamaProvider";
import { TestStubProvider } from "../../src/llm/TestStubProvider";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "llm-provider-factory");

describe("LLMProviderFactory", () => {
  beforeEach(() => {
    container.clearInstances();
    // OpenAIProvider needs an ISecretsProvider dependency to be resolvable.
    container.register("ISecretsProvider", { useValue: { get: async () => undefined } });
  });

  it("resolves TestStubProvider when llm.provider is 'test-stub' (local env)", () => {
    const config = new ConfigResolver(FIXTURE_DIR, "local");
    const factory = new LLMProviderFactory(config);
    expect(factory.getProviderName()).toBe("test-stub");
    expect(factory.create(container)).toBeInstanceOf(TestStubProvider);
  });

  it("resolves OllamaProvider when llm.provider is 'ollama' (beta env)", () => {
    const config = new ConfigResolver(FIXTURE_DIR, "beta");
    const factory = new LLMProviderFactory(config);
    expect(factory.getProviderName()).toBe("ollama");
    expect(factory.create(container)).toBeInstanceOf(OllamaProvider);
  });

  it("resolves OpenAIProvider when llm.provider is 'openai' (prod env)", () => {
    const config = new ConfigResolver(FIXTURE_DIR, "prod");
    const factory = new LLMProviderFactory(config);
    expect(factory.getProviderName()).toBe("openai");
    expect(factory.create(container)).toBeInstanceOf(OpenAIProvider);
  });

  it("falls back through to the wildcard tier's TestStubProvider for an env with no override", () => {
    const config = new ConfigResolver(FIXTURE_DIR, "staging");
    const factory = new LLMProviderFactory(config);
    expect(factory.getProviderName()).toBe("test-stub");
    expect(factory.create(container)).toBeInstanceOf(TestStubProvider);
  });
});
