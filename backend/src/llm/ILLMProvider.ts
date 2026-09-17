import { Policy, SuppliedFacts } from "@meridian/shared-types";

export interface LLMGenerateInput {
  ticketOverview: string;
  /** Record-backed facts (issue status, customer, order) -- the source of truth the draft must follow. */
  facts: SuppliedFacts;
  relatedPolicies: Policy[];
}

export interface LLMGenerateOutput {
  summary: string;
  draftMessage: string;
}

/**
 * Single seam for "call an LLM to summarise a case and draft a reply".
 * Concrete choice of Anthropic / OpenAI / Ollama / deterministic test-stub is
 * resolved by LLMProviderFactory from config, never hardcoded at a call site.
 */
export interface ILLMProvider {
  generate(input: LLMGenerateInput): Promise<LLMGenerateOutput>;
}
