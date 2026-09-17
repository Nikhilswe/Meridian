"use strict";
/**
 * DynamoDB-Stream-triggered Lambda: the AWS-mode counterpart of
 * backend/src/services/AssignmentService.ts's InMemoryEventBus subscriber.
 * Same round-robin logic, same "atomic increment on a cursor row" trick --
 * here the cursor lives in the AssignmentCursorTable and the atomic
 * increment is a DynamoDB UpdateItem with ADD, which is safe under
 * concurrent invocations the same way the offline UPDATE...RETURNING is.
 *
 * This file is intentionally plain JS (no build step) for a small, auditable
 * demo Lambda. For a real production port, the recommended path is to run
 * backend/src/services/AssignmentService.ts's handler function itself inside
 * this Lambda (bundled with esbuild) so the two code paths can never drift --
 * this stub exists to keep the infra scaffold runnable/reviewable without
 * requiring a bundler in this pass.
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TICKETS_TABLE = process.env.TICKETS_TABLE;
const AGENT_POOL = (process.env.AGENT_POOL_IDS || "agent-1,agent-2,agent-3").split(",");
const CURSOR_ID = "default";

async function nextAgentId() {
  const result = await ddb.send(
    new UpdateCommand({
      TableName: process.env.ASSIGNMENT_CURSOR_TABLE || "AssignmentCursorTable",
      Key: { cursorId: CURSOR_ID },
      UpdateExpression: "SET lastIndex = if_not_exists(lastIndex, :zero) + :one",
      ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  const idx = (result.Attributes?.lastIndex ?? 1) % AGENT_POOL.length;
  return AGENT_POOL[idx];
}

exports.handler = async (event) => {
  for (const record of event.Records || []) {
    if (record.eventName !== "INSERT") continue;

    const newImage = record.dynamodb?.NewImage;
    if (!newImage) continue;

    const ticketId = newImage.ticketId?.S;
    const currentStatus = newImage.ticketStatus?.S;
    if (!ticketId || currentStatus !== "OPEN") continue;

    const assigneeId = await nextAgentId();

    await ddb.send(
      new UpdateCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
        UpdateExpression: "SET assigneeId = :a, ticketStatus = :s, updatedAt = :u",
        ConditionExpression: "ticketStatus = :openStatus", // avoid double-assigning on retries
        ExpressionAttributeValues: {
          ":a": assigneeId,
          ":s": "ASSIGNED",
          ":u": new Date().toISOString(),
          ":openStatus": "OPEN",
        },
      }),
    ).catch((err) => {
      if (err.name !== "ConditionalCheckFailedException") throw err;
      // Already assigned by a previous/duplicate delivery -- safe to ignore.
    });
  }
};
