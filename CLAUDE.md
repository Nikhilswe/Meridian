# Scaler -- project memory for Claude

Read this before doing any work in this repo. It exists so you don't need a
prompt re-explaining the architecture every session -- follow it by default.
Directory-specific detail lives in `backend/CLAUDE.md`, `frontend/CLAUDE.md`,
and `infra/CLAUDE.md`; this file is the map plus the rules that apply
everywhere. `README.md` is the human-facing overview -- this file is the
agent-facing one; keep them consistent when either changes.

## What this is
A support-ticketing + AI case-summariser platform. Support reps create
tickets from customer complaints (UI -> API -> DB); a ticket is
auto-assigned round-robin to a support agent; the assigned agent opens the
case-summariser screen, generates an AI summary + draft reply, edits it, and
submits it, which resolves the ticket. Built offline-first (Docker Compose +
Postgres) with an AWS deployment scaffold (DynamoDB/Lambda/API
Gateway/Cognito/S3, via CloudFormation/SAM) that is written but **not
deployed** -- there are no AWS credentials available by default, so don't
assume `aws`/`sam` calls will succeed unless the user has just given you
credentials in this session.

## Layout
```
frontend/               React + TypeScript (Vite) SPA -- see frontend/CLAUDE.md
backend/                Express + TypeScript API -- see backend/CLAUDE.md
packages/shared-types/  Types shared by frontend, backend, and infra/lambda
infra/                  CloudFormation/SAM + Lambda handlers -- see infra/CLAUDE.md
docs/                   aws-cost-notes.md, chatgpt-ui-prompt.md
docker-compose.yml      Offline stack: Postgres (+ optional Ollama profile)
```

## Commands (run from repo root unless noted)
- Install once (npm workspaces): `npm install`
- Build everything, in dependency order: `npm run build` -- this builds
  `packages/shared-types` first, then `backend`, then `frontend`. If you add
  a new workspace package, preserve this ordering in the root `package.json`
  build script; backend/frontend both import shared-types' compiled `dist/`.
- Dev servers: `npm run dev:backend`, `npm run dev:frontend` (separate terminals)
- Offline stack via Docker: `cp .env.example .env` then `docker compose up --build`
  (Postgres + backend container; the backend's entrypoint runs migrate ->
  seed -> server automatically on first boot)
- Backend tests: `npm run test --workspace=backend` (jest unit, no DB),
  `npm run test:integration --workspace=backend` (jest integration, in-memory
  adapters, no DB needed), `npm run smoke --workspace=backend` (real HTTP
  against a running server -- needs a real DB and a running `node
  dist/server.js`/`docker compose up`)
- Frontend tests: `npm run test --workspace=frontend` (vitest)
- Everything CI checks, in one go: `npm run check` (lint with zero warnings,
  `tsc --noEmit`, then unit + integration + frontend tests under **90%
  line/branch/function/statement coverage gates** -- `backend/jest.config.js`
  and `frontend/vite.config.ts`). New code must keep those gates green;
  don't lower a threshold to land a change.
- Is the AI wired up? `npm run check:llm` (one real call via the DI container)
- Human-facing how-to for all of the above: `docs/RUNBOOK.md`
- DB only, without Docker: `npm run migrate --workspace=backend` then
  `npm run seed --workspace=backend`, against whatever `DATABASE_URL` is in
  your environment/`.env`

## Non-negotiable conventions
These are why the codebase looks the way it does. Preserve them when
extending; don't quietly reintroduce the pattern they were written to avoid.

1. **Dependency injection via `tsyringe`, never inline `new X()` for a
   repository/service/provider.** Everything is constructor-injected and
   resolved through `backend/src/di/container.ts`. Adding a class means
   registering it there, not instantiating it where it's used.
2. **Builder pattern for ticket creation.** All ticket-creation validation
   lives in `backend/src/domain/TicketBuilder.ts` -- one place, not
   duplicated in routes or services.
3. **Config via `ConfigResolver`, never literal magic numbers/strings for
   tunables** (rate limits, pagination size, LLM provider choice, agent pool
   size). Lookup order, first match wins:
   `env.namespace.key` -> `env.*.key` -> `*.namespace.key` -> `*.*.key`.
   Backing files: `backend/src/config/data/{local,beta,prod,wildcard}.json`.
4. **Secrets are a separate concern from config, and are never hardcoded or
   logged.** Everything goes through `ISecretsProvider` --
   `EnvSecretsProvider` (local, reads `process.env`) or
   `AwsSecretsManagerProvider` (AWS mode). A new external API key means a
   new named secret through this interface, never a config JSON value and
   never a raw `process.env.FOO` read inside business logic.
5. **The LLM provider is pluggable and selected ONLY via config, not an env
   var.** `backend/src/llm/ILLMProvider.ts` + `LLMProviderFactory.ts` choose
   between Anthropic (default), OpenAI, Ollama, or a deterministic
   `test-stub` based purely on the active config layer's `llm.provider`
   value. There is intentionally no `LLM_PROVIDER` env var read anywhere --
   don't add one as a shortcut; it would create a second source of truth.
6. **The "test" keyword bypass must never be removed or weakened.** If a
   ticket's overview matches `/\btest\b/i`,
   `SummarisationService.shouldBypassWithTestStub()` short-circuits and
   returns `{summary:"test", draftMessage:"test"}` without calling any real
   LLM. This is what keeps demos/CI from burning real API spend by accident,
   and the smoke test relies on it.
7. **Pagination is cursor-based** (`nextCursor`/`hasMore`), sized from
   `pagination.defaultLimit`/`maxLimit` in config -- don't switch to
   offset/page-number pagination.
8. **Repository interfaces are the extension seam for AWS.**
   `ITicketRepository`, `IPolicyRepository`, `IOrderRepository`,
   `IUserRepository`, `IAssignmentCursorRepository`, `IAttachmentStorage`
   currently have Postgres (+ local-fs) implementations only. Add DynamoDB
   support by writing new implementations of these SAME interfaces and
   switching the DI registration on an execution-environment flag -- never
   by changing the interfaces to fit DynamoDB's shape, and never by
   hand-duplicating service logic again the way the `infra/lambda/*.js`
   stubs currently do (that's a documented stopgap, not the target design --
   see `infra/CLAUDE.md`).
9. **`req.params.<name>` types as `string | undefined`** under this repo's
   `noUncheckedIndexedAccess`. Use `requireRouteParam()` from
   `backend/src/routes/routeUtils.ts`, never a bare `req.params.id` or a
   non-null assertion.
10. **No `localStorage`/`sessionStorage` in the frontend.** Auth token and
    theme are plain React context/state (see `frontend/CLAUDE.md`).
11. **Deterministic before probabilistic in summarisation.** Anything code
    can decide with certainty is decided in
    `backend/src/domain/summarisationGates.ts`, never in the prompt: a
    missing customer/order/delivery date returns `NEEDS_INFO` **before** any
    provider (stub or real) is called, and a draft that claims resolution
    while the record is open is `DRAFT_REJECTED` and never persisted. Order
    retrieval is scoped by `ticket.customerId` (never `creatorId`, which is
    the rep) and a referenced order only enters the model context if it
    belongs to that customer. The gate runs in test mode too -- the `test`
    bypass (rule 6) only decides *which provider answers*, not whether the
    gate applies. Don't add a prompt instruction as a substitute for a
    check here.

## Before you say a task is done
Run, from repo root: `npm run build` and `npm run check` (lint, typecheck,
and every test suite with the coverage gates). For anything touching ticket creation, assignment, or
summarisation, also run the smoke test against a real running server + real
Postgres (see `backend/CLAUDE.md` for the exact sequence) -- in this
project's own build, that step is what caught a stale-object bug in
`TicketService.createTicket` and a rate-limiter test-isolation bug that the
unit/integration suites alone missed. Don't consider a change to those areas
verified until the smoke test has actually run against a live server, not
just "should pass."

## Known gaps -- do these next, without waiting to be asked, if the task touches them
1. DynamoDB-backed repository implementations (see `infra/CLAUDE.md` /
   `infra/README.md`) -- required before `infra/lambda/api` can actually
   run against AWS resources.
2. A real file-upload endpoint (attachments are metadata-only right now;
   `IAttachmentStorage` implementations exist but nothing calls them yet).
3. A CI/CD pipeline for `infra/cfn` deploys.
4. Visual redesign: `docs/chatgpt-ui-prompt.md` has a ready-to-paste prompt
   for the dark/light + tasteful-3D restyle. If asked to improve the UI's
   look, use that prompt's output as the basis rather than freelancing a
   different visual direction, so all screens stay consistent.

## Environment reality-check
- No AWS credentials are available by default. If a task requires
  `aws`/`sam` CLI calls against a real account, confirm credentials exist in
  this session before assuming they'll work; otherwise treat `infra/` work
  as code-only (write it, don't try to deploy it).
- `.env` is git-ignored and must never be committed; `.env.example` is the
  template. Real API keys (Anthropic/OpenAI) go in the gitignored `.env`
  locally, or AWS Secrets Manager in the cloud -- never in a config JSON
  file, never in a CFN template, never in a commit.
