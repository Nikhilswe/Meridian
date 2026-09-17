import "reflect-metadata";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../../src/llm/AnthropicProvider";
import { OpenAIProvider } from "../../src/llm/OpenAIProvider";
import { OllamaProvider } from "../../src/llm/OllamaProvider";
import { ISecretsProvider } from "../../src/secrets/ISecretsProvider";
import { LLMGenerateInput } from "../../src/llm/ILLMProvider";

/**
 * The Anthropic SDK is replaced wholesale: `messages.create` is a jest.fn we
 * can steer per test, and `APIError` is a real class so the provider's
 * `instanceof` branch is exercised. Nothing here ever reaches the network.
 */
jest.mock("@anthropic-ai/sdk", () => {
  const create = jest.fn();
  class APIError extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly error: unknown = undefined,
    ) {
      super(message);
    }
  }
  class MockAnthropic {
    public static APIError = APIError;
    public static __create = create;
    public messages = { create };
    constructor(public readonly opts: { apiKey: string }) {}
  }
  return { __esModule: true, default: MockAnthropic };
});

const mockedAnthropic = Anthropic as unknown as { __create: jest.Mock; APIError: new (status: number, message: string) => Error };

const INPUT: LLMGenerateInput = {
  ticketOverview: "The parcel never arrived",
  facts: { ticketStatus: "ASSIGNED", customerId: "cust-1", otherOrders: [] },
  relatedPolicies: [],
};

function secrets(values: Record<string, string | undefined>): ISecretsProvider {
  return { get: async (name: string) => values[name] };
}

const GOOD_JSON = JSON.stringify({ summary: "S", draftMessage: "D" });

describe("AnthropicProvider (official SDK)", () => {
  const envModel = process.env.ANTHROPIC_MODEL;
  beforeEach(() => {
    mockedAnthropic.__create.mockReset();
    delete process.env.ANTHROPIC_MODEL;
  });
  afterAll(() => {
    if (envModel !== undefined) process.env.ANTHROPIC_MODEL = envModel;
  });

  it("refuses to run without the key (never falls back to an unauthenticated call)", async () => {
    await expect(new AnthropicProvider(secrets({})).generate(INPUT)).rejects.toThrow("ANTHROPIC_API_KEY is not configured");
    expect(mockedAnthropic.__create).not.toHaveBeenCalled();
  });

  it("sends the shared system prompt + grounded user prompt and parses the JSON text block", async () => {
    mockedAnthropic.__create.mockResolvedValueOnce({ content: [{ type: "text", text: GOOD_JSON }] });
    const out = await new AnthropicProvider(secrets({ ANTHROPIC_API_KEY: "k" })).generate(INPUT);

    expect(out).toEqual({ summary: "S", draftMessage: "D" });
    const req = mockedAnthropic.__create.mock.calls[0]![0];
    expect(req.model).toBe("claude-opus-5");
    expect(req.max_tokens).toBe(1024);
    expect(req.system).toMatch(/Respond with ONLY a single valid JSON object/);
    expect(req.messages[0].content).toContain("SUPPLIED FACTS");
    expect(req.messages[0].content).toContain("The parcel never arrived");
  });

  it("honours ANTHROPIC_MODEL and strips a markdown fence the model wasn't supposed to add", async () => {
    process.env.ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
    mockedAnthropic.__create.mockResolvedValueOnce({ content: [{ type: "text", text: "```json\n" + GOOD_JSON + "\n```" }] });
    const out = await new AnthropicProvider(secrets({ ANTHROPIC_API_KEY: "k" })).generate(INPUT);
    expect(out.summary).toBe("S");
    expect(mockedAnthropic.__create.mock.calls[0]![0].model).toBe("claude-haiku-4-5-20251001");
  });

  it("rejects a response with no text block, and JSON missing either field", async () => {
    const provider = new AnthropicProvider(secrets({ ANTHROPIC_API_KEY: "k" }));
    mockedAnthropic.__create.mockResolvedValueOnce({ content: [{ type: "tool_use" }] });
    await expect(provider.generate(INPUT)).rejects.toThrow("did not contain a text content block");
    mockedAnthropic.__create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ summary: "only" }) }] });
    await expect(provider.generate(INPUT)).rejects.toThrow("missing summary/draftMessage");
  });

  it("maps an SDK APIError to the exact log line the CloudWatch metric filter matches, without the key", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedAnthropic.__create.mockRejectedValueOnce(new mockedAnthropic.APIError(400, "credit balance is too low"));

    await expect(new AnthropicProvider(secrets({ ANTHROPIC_API_KEY: "sk-secret" })).generate(INPUT)).rejects.toThrow(
      "Anthropic API request failed with status 400",
    );
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("Anthropic API request failed with status 400");
    expect(logged).not.toContain("sk-secret");
    errorSpy.mockRestore();
  });

  it("re-throws non-API errors (e.g. network failures) untouched", async () => {
    mockedAnthropic.__create.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(new AnthropicProvider(secrets({ ANTHROPIC_API_KEY: "k" })).generate(INPUT)).rejects.toThrow("ECONNRESET");
  });
});

describe("OpenAIProvider (fetch)", () => {
  const fetchMock = jest.fn();
  const envModel = process.env.OPENAI_MODEL;
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.OPENAI_MODEL;
  });
  afterAll(() => {
    if (envModel !== undefined) process.env.OPENAI_MODEL = envModel;
  });

  it("refuses without a key", async () => {
    await expect(new OpenAIProvider(secrets({})).generate(INPUT)).rejects.toThrow("OPENAI_API_KEY is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a chat-completions request with json_object mode and a bearer header, and parses the reply", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: GOOD_JSON } }] }) });
    const out = await new OpenAIProvider(secrets({ OPENAI_API_KEY: "ok" })).generate(INPUT);
    expect(out).toEqual({ summary: "S", draftMessage: "D" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ok");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("system");
  });

  it("honours OPENAI_MODEL and surfaces status / empty / malformed responses as errors", async () => {
    process.env.OPENAI_MODEL = "gpt-4.1";
    const provider = new OpenAIProvider(secrets({ OPENAI_API_KEY: "ok" }));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(provider.generate(INPUT)).rejects.toThrow("OpenAI API request failed with status 429");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).model).toBe("gpt-4.1");

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [] }) });
    await expect(provider.generate(INPUT)).rejects.toThrow("did not contain a message body");

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ draftMessage: "x" }) } }] }) });
    await expect(provider.generate(INPUT)).rejects.toThrow("missing summary/draftMessage");
  });
});

describe("OllamaProvider (local runtime, no key)", () => {
  const fetchMock = jest.fn();
  const envUrl = process.env.OLLAMA_BASE_URL;
  const envModel = process.env.OLLAMA_MODEL;
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
  });
  afterAll(() => {
    if (envUrl !== undefined) process.env.OLLAMA_BASE_URL = envUrl;
    if (envModel !== undefined) process.env.OLLAMA_MODEL = envModel;
  });

  it("calls /api/generate on localhost:11434 with format=json and the default model", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ response: GOOD_JSON }) });
    const out = await new OllamaProvider().generate(INPUT);
    expect(out).toEqual({ summary: "S", draftMessage: "D" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/generate");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("llama3.1:8b");
    expect(body.format).toBe("json");
    expect(body.stream).toBe(false);
    expect(body.prompt).toContain("SUPPLIED FACTS");
  });

  it("honours OLLAMA_BASE_URL / OLLAMA_MODEL (what the class runbook sets for gemma3:4b)", async () => {
    process.env.OLLAMA_BASE_URL = "http://ollama:11434";
    process.env.OLLAMA_MODEL = "gemma3:4b";
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ response: GOOD_JSON }) });
    await new OllamaProvider().generate(INPUT);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://ollama:11434/api/generate");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).model).toBe("gemma3:4b");
  });

  it("surfaces HTTP failures, an empty response field and incomplete JSON as errors", async () => {
    const provider = new OllamaProvider();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(provider.generate(INPUT)).rejects.toThrow("Ollama request failed with status 404");
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await expect(provider.generate(INPUT)).rejects.toThrow("did not contain a `response` field");
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ response: JSON.stringify({ summary: "s" }) }) });
    await expect(provider.generate(INPUT)).rejects.toThrow("missing summary/draftMessage");
  });
});
