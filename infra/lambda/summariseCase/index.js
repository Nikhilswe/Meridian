"use strict";
/**
 * API-Gateway-triggered Lambda: the AWS-mode counterpart of
 * backend/src/services/SummarisationService.ts. Mirrors the same
 * test-bypass rule (never calls a real LLM when the ticket overview
 * contains the word "test") and the same "fetch a couple of related
 * policies/orders as naive keyword-matched context" approach, then calls
 * Claude (Anthropic Messages API) the same way
 * backend/src/llm/AnthropicProvider.ts does. As with assignTicket, a real
 * production port should bundle the actual TS services with esbuild instead
 * of hand-duplicating this logic -- this file keeps the infra scaffold
 * runnable/reviewable without a bundler in this pass.
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

const TICKETS_TABLE = process.env.TICKETS_TABLE;
const POLICIES_TABLE = process.env.POLICIES_TABLE;
const SECRETS_PREFIX = process.env.SECRETS_PREFIX || "/scaler/beta/";

function shouldBypassWithTestStub(ticketOverview) {
  return /\btest\b/i.test(ticketOverview || "");
}

async function getAnthropicApiKey() {
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: `${SECRETS_PREFIX}ANTHROPIC_API_KEY` }),
  );
  const parsed = JSON.parse(res.SecretString || "{}");
  return parsed.ANTHROPIC_API_KEY;
  // NOTE: never log `res` or the returned key.
}

async function fetchRelatedPolicies(ticketOverview) {
  const scan = await ddb.send(new ScanCommand({ TableName: POLICIES_TABLE, Limit: 25 }));
  const words = (ticketOverview || "").toLowerCase();
  return (scan.Items || [])
    .filter((p) => words.includes(String(p.category || "").toLowerCase()))
    .slice(0, 3);
}

async function callClaude(apiKey, ticketOverview, policies) {
  const systemPrompt =
    "You are a customer support case summariser. Given a ticket description and " +
    "relevant policies, respond with ONLY JSON {\"summary\": string, \"draftMessage\": string}.";
  const userPrompt = `Ticket: ${ticketOverview}\n\nRelevant policies:\n${policies
    .map((p) => `- ${p.title}: ${p.body}`)
    .join("\n")}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API request failed with status ${response.status}`);
  const body = await response.json();
  const text = body.content?.find((b) => b.type === "text")?.text || "{}";
  return JSON.parse(text);
}

exports.handler = async (event) => {
  const ticketId = event.pathParameters?.ticketId;
  if (!ticketId) {
    return { statusCode: 400, body: JSON.stringify({ error: { code: "BAD_REQUEST", message: "ticketId is required" } }) };
  }

  const { Item: ticket } = await ddb.send(new GetCommand({ TableName: TICKETS_TABLE, Key: { ticketId } }));
  if (!ticket) {
    return { statusCode: 404, body: JSON.stringify({ error: { code: "NOT_FOUND", message: "ticket not found" } }) };
  }

  let summary, draftMessage, testModeTriggered;
  if (shouldBypassWithTestStub(ticket.ticketOverview)) {
    summary = "test";
    draftMessage = "test";
    testModeTriggered = true;
  } else {
    const policies = await fetchRelatedPolicies(ticket.ticketOverview);
    const apiKey = await getAnthropicApiKey();
    const result = await callClaude(apiKey, ticket.ticketOverview, policies);
    summary = result.summary;
    draftMessage = result.draftMessage;
    testModeTriggered = false;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: "SET caseSummary = :s, draftMessage = :d, ticketStatus = :st, updatedAt = :u",
      ExpressionAttributeValues: {
        ":s": summary,
        ":d": draftMessage,
        ":st": "DRAFT_PENDING_REVIEW",
        ":u": new Date().toISOString(),
      },
    }),
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ ticketId, caseSummary: summary, draftMessage, usedProvider: "anthropic", testModeTriggered }),
  };
};
