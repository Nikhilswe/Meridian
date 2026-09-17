import { DependencyContainer, injectable } from "tsyringe";
import { ConfigResolver } from "../config/ConfigResolver";
import { AnthropicProvider } from "./AnthropicProvider";
import { ILLMProvider } from "./ILLMProvider";
import { OllamaProvider } from "./OllamaProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { TestStubProvider } from "./TestStubProvider";

export type LLMProviderName = "openai" | "anthropic" | "ollama" | "test-stub";

/**
 * Resolves the concrete ILLMProvider implementation at DI-container-setup
 * time, based on ConfigResolver's `llm.provider` value -- never a hardcoded
 * `new OpenAIProvider()` sprinkled through the codebase. src/di/container.ts
 * calls `create()` once and registers its *result* under the "ILLMProvider"
 * token as a value provider, so every consumer (SummarisationService) just
 * injects "ILLMProvider" and never knows which concrete class backs it.
 */
@injectable()
export class LLMProviderFactory {
  constructor(private readonly config: ConfigResolver) {}

  public getProviderName(): LLMProviderName {
    return this.config.get<LLMProviderName>("llm", "provider", "test-stub");
  }

  public create(container: DependencyContainer): ILLMProvider {
    switch (this.getProviderName()) {
      case "openai":
        return container.resolve(OpenAIProvider);
      case "anthropic":
        return container.resolve(AnthropicProvider);
      case "ollama":
        return container.resolve(OllamaProvider);
      case "test-stub":
        return container.resolve(TestStubProvider);
      default:
        return container.resolve(TestStubProvider);
    }
  }
}
