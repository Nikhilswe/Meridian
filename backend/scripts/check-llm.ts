import "reflect-metadata";
import * as path from "path";
import * as dotenv from "dotenv";
import { configureContainer } from "../src/di/container";
import { ILLMProvider } from "../src/llm/ILLMProvider";
import { LLMProviderFactory } from "../src/llm/LLMProviderFactory";

/**
 * "Is my LLM wired up?" -- a one-shot check that resolves the provider the
 * SAME way the server does (config-driven, through the DI container, key
 * via ISecretsProvider) and asks it to summarise a fixed sample case.
 *
 *   npm run check:llm --workspace=backend
 *
 * It never prints a secret: only the provider name, the model's answer and,
 * on failure, the same sanitised error the server would log. Which provider
 * runs is decided by `llm.provider` in backend/src/config/data/<APP_ENV>.json
 * (see the runbook: docs/RUNBOOK.md -> "Choosing the AI provider").
 */
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

async function main(): Promise<number> {
  const container = configureContainer();
  const factory = container.resolve(LLMProviderFactory);
  const provider = container.resolve<ILLMProvider>("ILLMProvider");
  console.log(`Provider (from config, APP_ENV=${process.env.APP_ENV ?? "local"}): ${factory.getProviderName()}`);

  const started = Date.now();
  try {
    const result = await provider.generate({
      ticketOverview: "Customer says their wireless headphones arrived with a cracked left earcup and wants a replacement.",
      facts: {
        ticketStatus: "ASSIGNED",
        customerId: "cust-1001",
        order: {
          orderId: "order-1001",
          customerId: "cust-1001",
          itemSummary: "Wireless headphones",
          orderDate: "2026-09-10T00:00:00.000Z",
          amount: 89.99,
          currency: "USD",
          status: "DELIVERED",
          deliveredDate: "2026-09-14T00:00:00.000Z",
        },
        otherOrders: [],
      },
      relatedPolicies: [],
    });
    console.log(`OK in ${Date.now() - started}ms`);
    console.log(`\nSummary:\n  ${result.summary}`);
    console.log(`\nDraft:\n  ${result.draftMessage}`);
    return 0;
  } catch (err) {
    console.error(`FAILED after ${Date.now() - started}ms: ${(err as Error).message}`);
    console.error("See docs/RUNBOOK.md -> Troubleshooting for the usual causes (no key / no credits / Ollama not running).");
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
