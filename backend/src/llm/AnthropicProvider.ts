import { inject, injectable } from "tsyringe";
import Anthropic from "@anthropic-ai/sdk";
import { ISecretsProvider } from "../secrets/ISecretsProvider";
import { ILLMProvider, LLMGenerateInput, LLMGenerateOutput } from "./ILLMProvider";
import { SYSTEM_PROMPT, buildUserPrompt } from "./promptBuilder";

/**
 * Claude-backed provider using the official Anthropic SDK. Mirrors OpenAIProvider's
 * shape exactly so LLMProviderFactory can swap between them purely via the
 * `llm.provider` config value -- no call site cares which one is active.
 *
 * The API key is resolved through ISecretsProvider at call time (never
 * hardcoded, never logged -- see EnvSecretsProvider's comment). The model
 * name is a plain non-secret tunable read from ANTHROPIC_MODEL with a
 * sensible small/cheap default suitable for this demo's budget.
 */
@injectable()
export class AnthropicProvider implements ILLMProvider {
  constructor(@inject("ISecretsProvider") private readonly secrets: ISecretsProvider) {}

  public async generate(input: LLMGenerateInput): Promise<LLMGenerateOutput> {
    const apiKey = await this.secrets.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured -- cannot call AnthropicProvider");
    }
    const model = process.env.ANTHROPIC_MODEL || "claude-opus-5";

    const client = new Anthropic({ apiKey });
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: `${SYSTEM_PROMPT}\n\nRespond with ONLY a single valid JSON object of the shape {"summary": string, "draftMessage": string} and nothing else -- no markdown fences, no commentary.`,
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      });
      return this.processResponse(response);
    } catch (error: unknown) {
      if (error instanceof Anthropic.APIError) {
        // Status + the API's own error body only. The SDK never puts the
        // x-api-key in `message`/`error`, so this stays secret-free -- and
        // the exact string below is what the SummariseProviderFailures
        // CloudWatch metric filter matches on (infra/cfn/main.template.yaml).
        console.error(`Anthropic API request failed with status ${error.status}: ${error.message}`);
        throw new Error(`Anthropic API request failed with status ${error.status}`);
      }
      throw error;
    }
  }

  private async processResponse(response: Anthropic.Message): Promise<LLMGenerateOutput> {

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Anthropic API response did not contain a text content block");
    }

    const jsonText = extractJsonObject(textBlock.text);
    const parsed = JSON.parse(jsonText) as { summary?: string; draftMessage?: string };
    if (!parsed.summary || !parsed.draftMessage) {
      throw new Error("Anthropic API response JSON missing summary/draftMessage");
    }
    return { summary: parsed.summary, draftMessage: parsed.draftMessage };
  }
}

/**
 * Claude is instructed to return raw JSON, but this defensively strips any
 * accidental markdown code-fence wrapping before JSON.parse rather than
 * trusting the model's output format blindly.
 */
function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenceMatch?.[1] ?? trimmed;
}
