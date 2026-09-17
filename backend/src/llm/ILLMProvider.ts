import { Order, Policy } from "@scaler/shared-types";

export interface LLMGenerateInput {
  ticketOverview: string;
  relatedPolicies: Policy[];
  relatedOrders: Order[];
}

export interface LLMGenerateOutput {
  summary: string;
  draftMessage: string;
}

/**
 * Single seam for "call an LLM to summarise a case and draft a reply".
 * Concrete choice of OpenAI / Ollama / deterministic test-stub is resolved
 * by LLMProviderFactory from config, never hardcoded at a call site.
 */
export interface ILLMProvider {
  generate(input: LLMGenerateInput): Promise<LLMGenerateOutput>;
}
