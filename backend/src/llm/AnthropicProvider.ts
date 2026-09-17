import { inject, injectable } from "tsyringe";
import { ISecretsProvider } from "../secrets/ISecretsProvider";
import { ILLMProvider, LLMGenerateInput, LLMGenerateOutput } from "./ILLMProvider";
import { SYSTEM_PROMPT, buildUserPrompt } from "./promptBuilder";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * Claude-backed provider (Anthropic Messages API). Mirrors OpenAIProvider's
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
    const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Never log this header / the apiKey value.
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: `${SYSTEM_PROMPT}\n\nRespond with ONLY a single valid JSON object of the shape {"summary": string, "draftMessage": string} and nothing else -- no markdown fences, no commentary.`,
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      }),
    });

    if (!response.ok) {
      // Safe to include status text; never include request headers/body here.
      throw new Error(`Anthropic API request failed with status ${response.status}`);
    }

    const body = (await response.json()) as {
      content?: { type?: string; text?: string }[];
    };
    const textBlock = body.content?.find((block) => block.type === "text");
    const content = textBlock?.text;
    if (!content) {
      throw new Error("Anthropic API response did not contain a text content block");
    }

    const jsonText = extractJsonObject(content);
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
