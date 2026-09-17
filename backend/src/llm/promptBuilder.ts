import { LLMGenerateInput } from "./ILLMProvider";

/**
 * Shared prompt-building logic for the real LLM providers (OpenAI, Ollama).
 * Kept in one place (SRP) so both providers send the model the same
 * instructions and the same grounding context.
 */

export const SYSTEM_PROMPT =
  "You are a support-ticket case summariser for Scaler. Given a customer's ticket " +
  "overview and a short list of relevant company policies and the customer's recent " +
  "orders, produce two things: (1) a concise internal case summary for the support " +
  "agent, and (2) a courteous, professional draft reply to the customer. Ground your " +
  "answer ONLY in the policies and orders given to you -- do not invent policy details " +
  "or order information that isn't present in the provided context. Respond as strict " +
  'JSON: {"summary": "...", "draftMessage": "..."} with no extra commentary.';

export function buildUserPrompt(input: LLMGenerateInput): string {
  const policiesText =
    input.relatedPolicies.length > 0
      ? input.relatedPolicies.map((p) => `- [${p.category}] ${p.title}: ${p.body}`).join("\n")
      : "(no matching policies found)";

  const ordersText =
    input.relatedOrders.length > 0
      ? input.relatedOrders
          .map((o) => `- Order ${o.orderId}: ${o.itemSummary} (${o.status}, ${o.amount} ${o.currency})`)
          .join("\n")
      : "(no orders on file for this customer)";

  return [
    "Customer ticket overview:",
    input.ticketOverview,
    "",
    "Relevant policies:",
    policiesText,
    "",
    "Customer's recent orders:",
    ordersText,
  ].join("\n");
}
