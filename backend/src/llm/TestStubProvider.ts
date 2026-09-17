import { injectable } from "tsyringe";
import { ILLMProvider, LLMGenerateInput, LLMGenerateOutput } from "./ILLMProvider";

/**
 * Deterministic, no-network provider for CI/offline demos without API keys.
 * Distinct from the SummarisationService test-bypass path (which is
 * triggered by the word "test" in the ticket overview) -- this is simply
 * the "llm.provider" config choice of "test-stub", usable for any ticket.
 */
@injectable()
export class TestStubProvider implements ILLMProvider {
  public async generate(input: LLMGenerateInput): Promise<LLMGenerateOutput> {
    return {
      summary: `[test-stub summary] ${input.ticketOverview.slice(0, 120)}`,
      draftMessage: "[test-stub draft] Thank you for reaching out -- we're looking into this for you.",
    };
  }
}
