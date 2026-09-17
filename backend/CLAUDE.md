# backend/ -- Claude project memory

Read `../CLAUDE.md` first (repo-wide rules -- DI, builder pattern, config
resolver, secrets, LLM bypass, pagination, `requireRouteParam`). This file
is backend-specific detail only.

## Directory map
```
src/config/          ConfigResolver + config/data/{local,beta,prod,wildcard}.json
src/secrets/         ISecretsProvider, EnvSecretsProvider, AwsSecretsManagerProvider
src/domain/          TicketBuilder, TicketEntity (state machine + visibility rule), errors.ts,
                     summarisationGates.ts (pure pre/post-model checks -- see root CLAUDE.md rule 11)
src/repositories/    Interfaces (ITicketRepository etc.) + postgres/ + storage/ implementations
src/events/          IEventBus, InMemoryEventBus, events.ts -- offline stand-in for a DynamoDB Stream
src/services/        AssignmentService, TicketService, SummarisationService, naiveRetrieval.ts
src/llm/             ILLMProvider, AnthropicProvider, OpenAIProvider, OllamaProvider,
                     TestStubProvider, LLMProviderFactory
src/auth/            IAuthProvider, LocalJwtAuthProvider, CognitoAuthProviderStub, authMiddleware
src/middleware/      rateLimiter, errorHandler, pagination
src/routes/          ticket.routes.ts, case.routes.ts, auth.routes.ts, routeUtils.ts
src/di/container.ts  tsyringe wiring -- the ONE place concrete implementations are chosen
src/db/              pool.ts, migrations/*.sql, migrate.ts, seed.ts
src/app.ts           createApp(): Express -- no .listen(), so tests can import it directly
src/server.ts        entrypoint: reflect-metadata -> configureContainer() -> createApp().listen()
tests/unit/          jest, mocked repositories, no DB
tests/integration/   supertest + tsyringe container wired to in-memory fakes (tests/integration/fakes/),
                     no DB needed
tests/smoke/         real HTTP against a running server -- see "Full local verification" below
scripts/check-llm.ts one real provider call through the DI container (`npm run check:llm`)
jest.config.js       coverage scope + the 90% thresholds `npm run test:coverage` enforces
```

## Full local verification (what "done" means for backend changes)
This exact sequence is what actually proves the offline flow works, not
just "the tests should pass" -- run it after any change to
tickets/assignment/summarisation/auth:
```bash
npm run build --workspace=backend
npm run lint --workspace=backend             # zero warnings allowed
npm run test:coverage --workspace=backend    # unit + integration, fails under 90% lines/branches

# then the real thing, against a live server + live DB:
cp .env.example .env                 # from repo root, once
npm run migrate --workspace=backend   # idempotent -- safe to re-run
npm run seed --workspace=backend      # re-seeds demo users incl. smoke-test@meridian.local
node backend/dist/server.js &         # or `docker compose up` if Docker Hub is reachable
SMOKE_BASE_URL=http://localhost:4000 npm run smoke --workspace=backend
```
See `docs/test-report-*.md` at the repo root for the last recorded full run
and its exact output -- add a new dated report there each time you redo this
verification for a nontrivial change, rather than only trusting "tests
passed" in isolation. This step has caught real bugs unit/integration tests
alone missed (a stale-object bug in `TicketService.createTicket`, a
rate-limiter test-isolation issue) -- don't skip it.

## Test fixture layout (why there are two config fixture dirs)
`tests/integration/fixtures/config/` is the default fixture most
integration tests share via one `app` instance across many requests --
its `rateLimit.*Max` values are intentionally generous (25) so ordinary
test traffic never trips the limiter by accident.
`tests/integration/fixtures/config-strict/` exists ONLY for the dedicated
rate-limit test, which needs an exact, small max (3) to assert the 429
boundary precisely, using its OWN isolated app/limiter instance. If you add
a new integration test that creates several tickets/summarises several
cases against the shared `app`, make sure the default fixture's limits
still comfortably cover it -- don't lower them "for realism," and don't add
a third fixture without a comment explaining why the existing two don't fit.

## DI container specifics
`src/di/container.ts`'s `configureContainer()` is called once from
`server.ts` (production) or replicated per-test by
`tests/integration/setupTestContainer.ts` (which swaps every repository for
an in-memory fake, but resolves `LLMProviderFactory` for real so the actual
config-driven provider-selection logic is exercised, not bypassed). If you
add a new injectable class:
1. Give it a narrow interface if anything besides itself will ever mock it.
2. Register the interface token (`"IFoo"`) in `container.ts`, not the
   concrete class, unless nothing will ever need to swap it.
3. Add a matching fake + registration in `setupTestContainer.ts` if
   anything in `tests/integration/` will touch it.

## Summarisation flow (SummarisationService.summariseCase)
Fixed order, don't reorder: authorise (assignee/privileged) -> retrieve
scoped to `ticket.customerId` -> `runPreModelGate` (NEEDS_INFO stops here,
no provider call) -> generate (stub or provider) -> `runPostModelChecks`
(DRAFT_REJECTED: returned for transparency, not persisted) -> persist draft
+ `suppliedContext` (facts, policy versions, checks, provider, timestamp).
Re-running from DRAFT_PENDING_REVIEW is "regenerate": same flow, status
unchanged, draft/context replaced. `PATCH /api/cases/:id/facts` lets the
assignee add customerId/orderId so NEEDS_INFO is actionable.

## Auth: sign-up
`POST /api/auth/signup` -> `IAuthProvider.signup()`. Local mode creates a
SUPPORT_AGENT (bcrypt cost 10, same as seed.ts) and returns a token exactly
like login; duplicate email is a 409 `ConflictError`, never a 401. The route
ignores any `role` in the body on purpose (privilege escalation); promotion
is an admin action. AWS mode refuses -- user creation belongs to Cognito.

## Assignment pool
`assignment.agentPoolSize` caps rotation to the first N agents by
displayName; `0` means everyone. `local.json` is `0` so a freshly signed-up
agent gets tickets immediately. Keep the integration fixture at `2` -- the
round-robin tests depend on it.

## LLM providers
Default is Anthropic (`llm.provider: "anthropic"` in
`config/data/local.json` and `prod.json`; `beta.json` uses `ollama` as a
worked example of the config override mechanism). All four providers
(`AnthropicProvider`, `OpenAIProvider`, `OllamaProvider`, `TestStubProvider`)
implement the same `ILLMProvider.generate()` shape and are resolved by
`LLMProviderFactory` purely from config -- see the repo-root CLAUDE.md rule
about not adding an `LLM_PROVIDER` env var shortcut. Never call
`fetch`/an SDK directly from `SummarisationService` -- always through the
injected `ILLMProvider`.

## Known gaps specific to backend/
- No file-upload endpoint yet; `IAttachmentStorage` (local-fs + S3
  implementations) exists but nothing calls `.put()`. Wiring this up means
  a multipart route on `ticket.routes.ts` that builds the
  `date/ticketId/creatorId/doctype-filename` key and calls the injected
  storage, then attaches the resulting `AttachedDocument` to the ticket via
  `TicketBuilder`.
- DynamoDB implementations of the repository interfaces don't exist yet --
  see the repo-root CLAUDE.md and `infra/CLAUDE.md`.
