# Scaler -- support ticketing + AI case-summariser

A support-ticket platform: a UI for creating tickets from customer
complaints, automatic round-robin assignment to support agents, and an
AI-assisted "case summariser" screen where agents generate a case summary +
draft customer reply (Claude/OpenAI/Ollama/deterministic test-stub, chosen
by config), edit it, and resolve the ticket.

Built offline-first (Docker Compose + Postgres + a local SQL DB, no AWS
account required to run it) with an AWS deployment scaffold (DynamoDB,
Lambda, API Gateway, Cognito, S3, CloudFormation/SAM) ready for when you
have credentials. See `docs/aws-cost-notes.md` for why the AWS side fits
comfortably under a $60 / 6-month demo budget.

## Layout
```
frontend/            React + TypeScript (Vite) SPA
backend/              Express + TypeScript API (SOLID, DI via tsyringe, builder pattern, etc.)
packages/shared-types/  Types shared by frontend, backend, and the Lambda scaffold
infra/                CloudFormation/SAM template + Lambda handler stubs (code-only, not deployed)
docs/                 Cost notes + the ChatGPT UI-design prompt
docker-compose.yml    Offline stack: Postgres (+ optional Ollama)
```

## Quickstart (offline)
```bash
cp .env.example .env               # then fill in ANTHROPIC_API_KEY if you want real summaries
docker compose up --build          # Postgres + backend (auto-migrates + seeds on first boot)
npm install                        # once, at the repo root (npm workspaces)
npm run dev:frontend                # in another terminal
```
Open the frontend (Vite prints the URL, typically http://localhost:5173) and
log in with one of the seeded demo users (printed to the backend's logs on
first seed, or see `backend/src/db/seed.ts`) -- there's a dedicated
`smoke-test@scaler.local` account for automated runs.

Tickets whose overview contains the word "test" always skip the real LLM
call and return a deterministic `{summary: "test", draftMessage: "test"}` --
useful for demos/CI so you never burn real API spend by accident.

## Tests
```bash
npm run build --workspace=backend
npm run test --workspace=backend            # jest unit tests
npm run test:integration --workspace=backend # jest integration tests (in-memory adapters, no DB needed)
npm run smoke --workspace=backend            # real HTTP smoke test against a running server
npm run test --workspace=frontend            # vitest
```
All of the above were run in this environment against a real local Postgres
+ a real running server (not just "should work") -- see the session's build
log for full pass output: 40 backend unit tests, 12 backend integration
tests, 8/8 smoke-test scenarios, and 7 frontend tests, all passing.

## What's real vs. scaffolded
- **Offline flow (tickets + case summariser + auth + rate limiting + config +
  round-robin assignment + Postgres persistence): fully working**, verified
  end-to-end in this environment.
- **AWS (CloudFormation/SAM template, Cognito, DynamoDB, S3, 3 Lambdas):
  written and reviewed but not deployed** (no AWS credentials in this
  environment) and the DynamoDB-backed repository implementations behind
  `ITicketRepository`/etc. are not yet written (Postgres was this pass's
  priority) -- see `infra/README.md` "Known gaps" for the precise list and
  how to close it.
- **Visual design is an intentionally plain, functional baseline.**
  `docs/chatgpt-ui-prompt.md` has a ready-to-paste prompt for generating the
  polished dark/light-mode + tasteful-3D redesign described in the original
  ask.

## Architecture notes
- **Builder pattern**: `backend/src/domain/TicketBuilder.ts` is the only
  place ticket-creation validation lives.
- **Dependency injection**: `backend/src/di/container.ts` (tsyringe) resolves
  every repository/provider/service at runtime; nothing does `new
  PostgresTicketRepository()` inline. The LLM provider (Claude/OpenAI/Ollama/
  test-stub) and the auth provider (local JWT vs. a Cognito-stub) are each
  swapped purely through this container + config, never a code change.
  Attach the same pattern before you write a DynamoDB repository for AWS
  mode -- it's the intended extension point.
- **Config**: `backend/src/config/ConfigResolver.ts` implements the
  `env.namespace.key` -> `env.*.key` -> `*.namespace.key` -> `*.*.key`
  wildcard fallback exactly as requested, backed by
  `backend/src/config/data/{local,beta,prod,wildcard}.json`.
- **Secrets**: never hardcoded/logged; `ISecretsProvider` has an
  env-var-backed local implementation and an AWS Secrets Manager
  implementation behind the same interface.
- **Event-driven assignment**: `IEventBus`/`InMemoryEventBus` play the role
  of a DynamoDB Stream locally; `AssignmentService`'s handler is written so
  it could run inside a real Lambda unchanged once a Dynamo repository
  exists.
- **Pagination**: cursor-based, `pagination.defaultLimit`/`maxLimit` come
  from the same config resolver, not literals.
