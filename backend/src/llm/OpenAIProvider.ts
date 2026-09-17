import { inject, injectable } from "tsyringe";
import { ISecretsProvider } from "../secrets/ISecretsProvider";
import { ILLMProvider, LLMGenerateInput, LLMGenerateOutput } from "./ILLMProvider";
import { SYSTEM_PROMPT, buildUserPrompt } from "./promptBuilder";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Real OpenAI-backed provider. The API key is resolved through
 * ISecretsProvider at call time -- it is never hardcoded and never logged
 * (see EnvSecretsProvider's comment on this). The model name is a plain
 * (non-secret) tunable, read from OPENAI_MODEL with a sensible default.
 */
@injectable()
export class OpenAIProvider implements ILLMProvider {
  constructor(@inject("ISecretsProvider") private readonly secrets: ISecretsProvider) {}

  public async generate(input: LLMGenerateInput): Promise<LLMGenerateOutput> {
    const apiKey = await this.secrets.get("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured -- cannot call OpenAIProvider");
    }
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Never log this header / the apiKey value.
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      // Safe to include status text; never include request headers/body here.
      throw new Error(`OpenAI API request failed with status ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI API response did not contain a message body");
    }

    const parsed = JSON.parse(content) as { summary?: string; draftMessage?: string };
    if (!parsed.summary || !parsed.draftMessage) {
      throw new Error("OpenAI API response JSON missing summary/draftMessage");
    }
    return { summary: parsed.summary, draftMessage: parsed.draftMessage };
  }
}
