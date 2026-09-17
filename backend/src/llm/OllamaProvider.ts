import { injectable } from "tsyringe";
import { ILLMProvider, LLMGenerateInput, LLMGenerateOutput } from "./ILLMProvider";
import { SYSTEM_PROMPT, buildUserPrompt } from "./promptBuilder";

/**
 * Local Ollama-backed provider (no API key needed -- it's a local runtime,
 * started via `docker compose --profile ollama up`). Base URL and model come
 * from plain env vars since they're not secrets.
 */
@injectable()
export class OllamaProvider implements ILLMProvider {
  public async generate(input: LLMGenerateInput): Promise<LLMGenerateOutput> {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const model = process.env.OLLAMA_MODEL || "llama3.1:8b";

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        system: SYSTEM_PROMPT,
        prompt: `${buildUserPrompt(input)}\n\nRespond as strict JSON: {"summary": "...", "draftMessage": "..."}`,
        stream: false,
        format: "json",
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with status ${response.status}`);
    }

    const body = (await response.json()) as { response?: string };
    if (!body.response) {
      throw new Error("Ollama response did not contain a `response` field");
    }

    const parsed = JSON.parse(body.response) as { summary?: string; draftMessage?: string };
    if (!parsed.summary || !parsed.draftMessage) {
      throw new Error("Ollama response JSON missing summary/draftMessage");
    }
    return { summary: parsed.summary, draftMessage: parsed.draftMessage };
  }
}
