# Full end-to-end verification -- 2026-09-17

Run in the cloud build sandbox (not Docker Compose, since this sandbox has
no network access to pull Docker Hub images -- see "Environment notes"
below). Every layer was exercised against a **real** local Postgres 16
instance and a **real** running Node server, not mocks-only.

- Node v22.22.2, npm 10.9.7, PostgreSQL 16.13
- `DATABASE_URL=postgresql://meridian:meridian_local_pw@localhost:5432/meridian`
- `APP_ENV=local` (so `llm.provider` resolves to `anthropic` per
  `backend/src/config/data/local.json` -- no real Anthropic call is made
  anywhere in this run because every summarise call below used a ticket
  overview containing "test", which trips the bypass before any provider
  is invoked)

## 1. Full workspace build
```
npm run build
```
`packages/shared-types` -> `backend` -> `frontend`, in that order. **Clean,
zero errors.**

## 2. Backend unit tests
```
npm run test --workspace=backend
```
**6 suites / 40 tests, all passed.** Covers `TicketBuilder`, `TicketEntity`
(state machine + visibility rule), `ConfigResolver` (wildcard precedence),
`SummarisationService` (test-bypass logic), `LLMProviderFactory`, rate
limiter config wiring.

## 3. Backend integration tests
```
npm run test:integration --workspace=backend
```
**1 suite / 12 tests, all passed.** Full HTTP -> route -> service ->
repository-interface stack via supertest, with in-memory repository fakes
(no DB needed for this layer): login, ticket creation + round-robin
assignment across 2 seeded agents, validation rejection, missing-auth
rejection, cursor pagination, the single-creator visibility edge case,
summarise via the test-bypass, edit+submit a draft through to RESOLVED,
listing a case queue, and an isolated 429 rate-limit check.

## 4. Frontend tests
```
npm run test --workspace=frontend
```
**3 files / 7 tests, all passed** (StatusBadge, Pagination, LoginPage smoke render).

## 5. Real end-to-end run (the part that actually proves the offline flow works)
```
cp .env.example .env
npm run migrate --workspace=backend    # against real Postgres
npm run seed --workspace=backend       # seeds 4 demo users + smoke-test user + policies/orders
node backend/dist/server.js &          # real server, real DB, port 4000
SMOKE_BASE_URL=http://localhost:4000 npm run smoke --workspace=backend
```
Migrations ran idempotently (re-run safely skips already-applied files).
Seed re-ran cleanly. Server came up and answered `POST /api/auth/login`
with `200`. Smoke test result:

```
PASS - login as smoke-test user
PASS - create several tickets, including one with the word 'test'
PASS - list tickets with pagination across pages
PASS - list assigned cases
PASS - summarise a case (test-stub / bypass path)
PASS - edit and submit the draft, resolving the ticket
PASS - verify the final ticket status via GET
PASS - exceed the ticket-create rate limit and confirm a 429

8/8 scenarios passed.
```

## Bugs this process has caught historically (for context, not re-fixed today)
- `TicketService.createTicket` originally returned a stale pre-assignment
  `Ticket` object (fixed in the initial build pass).
- Several `noUncheckedIndexedAccess` strict-mode gaps across
  `AssignmentService`, both ticket repositories, and route files (fixed).
- A rate-limiter integration test was incidentally failing because earlier
  tests in the same describe block shared one in-memory limiter counter and
  exhausted it before the later tests ran -- fixed by giving the dedicated
  rate-limit test its own strict fixture (`tests/integration/fixtures/config-strict/`)
  and raising the shared fixture's limits well above what the rest of the
  suite issues.

## Environment notes / what this run does NOT prove
- **Docker Compose itself was not exercised end-to-end in this sandbox**:
  `docker compose up` failed here only because this sandbox blocks pulling
  images from Docker Hub (`registry-1.docker.io: 403 Forbidden`) -- a
  sandbox network restriction, not a bug in `docker-compose.yml`. Every
  service that compose would run (Postgres + the same backend build) was
  verified directly instead. Run `docker compose up --build` on your own
  machine, which has normal internet access, to confirm the containerized
  path too -- nothing about this run should be read as "Docker doesn't
  work," only "Docker Hub wasn't reachable from this sandbox."
- **No real LLM provider call (Anthropic/OpenAI/Ollama) was exercised** --
  every summarise call in this run used the "test" keyword bypass by
  design, so a live network call to Anthropic was never made or verified
  in this pass. If you want that path checked too, add `ANTHROPIC_API_KEY`
  to `.env`, create a ticket whose overview does NOT contain "test", and
  run the summarise flow manually or via a small ad-hoc script.
- **AWS/`infra/` was not deployed or tested** -- no AWS credentials in this
  sandbox; see `infra/README.md` "Known gaps."
