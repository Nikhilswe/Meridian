"use strict";
/**
 * Wraps the SAME Express app used offline (backend/src/app.ts) so ticket
 * CRUD + auth business logic is never duplicated between local Docker and
 * AWS. In a real build step, `npm run build` in backend/ followed by an
 * esbuild bundle of this handler (pulling in backend/dist/app.js and
 * swapping the DI container's repositories for Dynamo-backed
 * implementations of the same ITicketRepository/etc. interfaces) produces
 * the deployable artifact for this function's CodeUri.
 *
 * This file is left as a thin, honestly-commented placeholder rather than a
 * fake "it just works" wrapper, because the Dynamo-backed repository
 * implementations were intentionally out of scope for this pass (offline
 * Postgres was the priority) -- see infra/README.md "Known gaps".
 */

let cachedHandler;

async function getHandler() {
  if (cachedHandler) return cachedHandler;
  const serverlessHttp = require("serverless-http");
  // eslint-disable-next-line import/no-unresolved -- resolved at deploy-bundle time
  const { createApp } = require("../../../backend/dist/app");
  cachedHandler = serverlessHttp(createApp());
  return cachedHandler;
}

exports.handler = async (event, context) => {
  const handler = await getHandler();
  return handler(event, context);
};
