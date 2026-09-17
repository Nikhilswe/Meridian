# Scaler runbook

How to run, demo, test, and troubleshoot Scaler on your own laptop. Written
for everyone in the class: the first half needs no code at all, the second
half is for anyone changing the code. If you only read one section, read
**"Ten-minute demo"**.

Contents
1. [What Scaler does (one screen)](#1-what-scaler-does-one-screen)
2. [Prerequisites](#2-prerequisites)
3. [Ten-minute demo](#3-ten-minute-demo)
4. [Accounts and roles](#4-accounts-and-roles)
5. [Choosing the AI provider](#5-choosing-the-ai-provider) (Ollama vs Claude vs OpenAI vs no-AI)
6. [How a ticket flows through the system](#6-how-a-ticket-flows-through-the-system)
7. [For developers: checks, tests, coverage, CI](#7-for-developers-checks-tests-coverage-ci)
8. [Where the logs are](#8-where-the-logs-are)
9. [Troubleshooting](#9-troubleshooting)
10. [Production / AWS notes](#10-production--aws-notes)
11. [Glossary](#11-glossary)

---

## 1. What Scaler does (one screen)

Scaler is a support-ticketing tool with an AI **case summariser**.

1. A support rep types a customer complaint into a ticket.
2. The ticket is **automatically assigned** to a support agent (round-robin).
3. The assigned agent opens the case and clicks **Summarise & Generate Draft**.
4. Before any AI runs, deterministic **checks** confirm the record has what
   it needs (which customer, which order, delivery date). If something is
   missing the agent is asked for it -- the AI is not called.
5. The AI (a local Ollama model by default -- free, offline) writes a case
   summary and a draft reply, grounded only in the **supplied facts** from
   the order system, never in the customer's wording.
6. A post-check rejects any draft that claims the issue is resolved while
   the record says it is open.
7. The agent reads the evidence panels, edits the draft, and **Submits**,
   which resolves the ticket. A human always makes the final call.

## 2. Prerequisites

| Need | Why | Install |
|---|---|---|
| Node.js 20+ (22 recommended) and npm | runs the backend, frontend and tests | https://nodejs.org |
| PostgreSQL 14+ | the ticket database | Docker (below) **or** `brew install postgresql@16` |
| Docker Desktop (optional) | one-command Postgres | https://www.docker.com/products/docker-desktop |
| Ollama (optional, recommended) | free local AI, no API key | https://ollama.com/download |

No AWS account, no API key, and no internet (after installs) are needed for
the full demo.

## 3. Ten-minute demo

```bash
# 0. Get the code and install once
git clone <repo-url> scaler && cd scaler
npm install

# 1. Configuration -- copy the template; the defaults work out of the box
cp .env.example .env

# 2. Database -- pick ONE
docker compose up -d postgres                # a) Docker (simplest)
#   or, with a local Postgres:  createdb scaler  and set DATABASE_URL in .env

# 3. Local AI (recommended). Skip this to run without any AI -- see section 5.
ollama pull gemma3:4b                          # ~3 GB, one time
#   Ollama runs as a background service after install; `ollama list` should show gemma3:4b.
#   .env already contains OLLAMA_MODEL=gemma3:4b and OLLAMA_BASE_URL=http://localhost:11434

# 4. Build, create tables, add demo data (idempotent -- safe to re-run)
npm run build
npm run migrate --workspace=backend
npm run seed --workspace=backend

# 5. Run (two terminals)
npm run dev:backend                            # http://localhost:4000
npm run dev:frontend                           # http://localhost:5173
```

Then in the browser at http://localhost:5173:

1. **Sign in** as `asha.kapoor@scaler.local` / `AgentDemo!123` (or click
   **Sign up** to make your own agent account -- it starts receiving tickets
   immediately).
2. On **Tickets**, describe a complaint, e.g. *"Customer says their wireless
   headphones arrived with a cracked left earcup and wants a replacement."*
   Set **Customer ID** `cust-1001` and **Order ID** `order-1001` (seeded
   demo data), click **Create ticket**. It appears in the list already
   **Assigned**.
3. Click the ticket row (or open **Case Summariser**, which lists only the
   cases assigned to *you*). If it was assigned to another agent, sign in as
   that agent (section 4) or just create another ticket -- round-robin will
   reach you.
4. Click **Summarise & Generate Draft**. With Ollama on a laptop CPU this
   takes 10-40 seconds; the orbiting glyph shows it is thinking.
5. Read **Supplied facts**, **Supplied policy** and **Checks** -- this is
   exactly what the model was given. Edit the draft, click **Submit**. The
   ticket is now **Resolved**.

Things worth showing an audience:

* Leave **Customer ID** blank on a new ticket, then summarise: you get
  **"More information needed"** and *the AI was not called*. Add the
  customer ID in the inline form and it retries automatically.
* Use `cust-1002` / `order-1003`: that order is delivered but has no
  delivery date on record, so the gate stops it (Meridian case C2).
* Put the word **test** anywhere in the overview: the AI is skipped and a
  fixed `test` summary/draft comes back instantly. This is how CI and demos
  avoid spending real API credit by accident.
* Reloading the page signs you out. This is deliberate: the app keeps the
  session in memory only (no browser storage). Sign in again.

## 4. Accounts and roles

Seeded by `npm run seed` (see `backend/src/db/seed.ts`):

| Email | Password | Role | Can |
|---|---|---|---|
| `asha.kapoor@scaler.local` | `AgentDemo!123` | SUPPORT_AGENT | create tickets, summarise + submit **their own** cases |
| `marco.silva@scaler.local` | `AgentDemo!123` | SUPPORT_AGENT | same |
| `wen.zhao@scaler.local` | `AgentDemo!123` | SUPPORT_AGENT | same |
| `priya.nair@scaler.local` | `ReviewerDemo!123` | REVIEWER | see every ticket, summarise any case |
| `smoke-test@scaler.local` | `SmokeTest!123` | SUPPORT_AGENT | reserved for the automated smoke test |

**Sign up** (`/signup`) creates a SUPPORT_AGENT. You cannot pick a higher
role at sign-up; promoting someone is an admin action (edit the `role`
column, or in AWS mode the Cognito `custom:role` attribute).

Visibility rule: an agent sees tickets they **created or are assigned**; a
reviewer sees everything. Only the **assignee** (or a reviewer) can generate
or submit a draft -- the case page says "Read-only" otherwise.

## 5. Choosing the AI provider

The provider is chosen by **config, not by an environment variable**:
`backend/src/config/data/local.json` -> `"llm": { "provider": ... }`.
(That is a deliberate rule -- there is no `LLM_PROVIDER` env var, so there
is exactly one source of truth.) Change it, then `npm run build
--workspace=backend` and restart the backend.

| `llm.provider` | Cost | Needs | Notes |
|---|---|---|---|
| `ollama` (default) | free | Ollama running + `OLLAMA_MODEL` pulled | 10-40 s per summary on CPU; fully offline |
| `anthropic` | paid | `ANTHROPIC_API_KEY` in `.env` **with credit on the account** | uses the official `@anthropic-ai/sdk`; `ANTHROPIC_MODEL` optional (default `claude-opus-5`) |
| `openai` | paid | `OPENAI_API_KEY` in `.env` | `OPENAI_MODEL` optional (default `gpt-4o-mini`) |
| `test-stub` | free | nothing | instant canned answer for every ticket; what CI uses |

Check your choice works before a demo:

```bash
npm run check:llm          # resolves the provider exactly like the server and asks it to summarise a sample case
```

Keys live only in the git-ignored `.env` locally, or in AWS Secrets Manager
in the cloud. Never paste one into a config JSON, a commit, or a chat.

Other Ollama models work too (`ollama pull llama3.1:8b`, then set
`OLLAMA_MODEL`). Smaller = faster; `gemma3:4b` is a good laptop default.
Ollama itself: `ollama list` (what is pulled), `ollama ps` (what is
loaded), `ollama serve` (start it by hand if the service is not running).

## 6. How a ticket flows through the system

```
Rep types complaint ──> POST /api/tickets ──> TicketBuilder validates ──> Postgres (status OPEN)
                                                                              │
                                              TicketCreated event ───────────┘
                                                      │
                    AssignmentService (local: in-process bus; AWS: DynamoDB Stream -> Lambda)
                                                      │
                                    round-robin over SUPPORT_AGENTs ──> status ASSIGNED, assigneeId set
                                                      │
Agent clicks Summarise ──> POST /api/cases/:id/summarise
   1. authorise (assignee or reviewer)
   2. retrieve facts scoped to ticket.customerId (never the rep's id)
   3. PRE-MODEL GATE (code, not AI): customer? order belongs to customer? delivery date?
        └─ missing -> outcome NEEDS_INFO, no model call, status unchanged
   4. generate (Ollama / Claude / OpenAI / stub)
   5. POST-MODEL CHECK (code): draft must not claim resolution while record is open
        └─ fails -> outcome DRAFT_REJECTED, nothing saved
   6. persist draft + the exact facts/policies/checks it was based on  -> DRAFT_PENDING_REVIEW
                                                      │
Agent edits + Submits ──> POST /api/cases/:id/draft ──> RESOLVED
```

Round-robin pool: `assignment.agentPoolSize` in the config JSON caps how many
agents are in rotation. **Local uses `0` = every SUPPORT_AGENT**, so anyone
who signs up during a class gets tickets. Production caps it (`prod.json`).

## 7. For developers: checks, tests, coverage, CI

One command runs everything CI runs (except the smoke test and cfn-lint):

```bash
npm run check              # lint (0 warnings) -> typecheck -> tests with coverage gates
```

Individually:

| Command | What |
|---|---|
| `npm run lint` | ESLint, backend + frontend, `--max-warnings 0` |
| `npm run typecheck` | `tsc --noEmit` for every workspace |
| `npm test` | backend unit (jest) + frontend (vitest), no DB |
| `npm run test:integration` | backend HTTP stack with in-memory repositories (supertest), no DB |
| `npm run test:coverage` | the above **with coverage thresholds**: 90% lines / branches / functions / statements, both workspaces. Fails below. |
| `npm run smoke` | real HTTP against a running server + real Postgres (needs `SMOKE_BASE_URL=http://localhost:4000`) |
| `npm run check:llm` | one real call to the configured AI provider |

Current coverage (see CI artifacts for the latest): backend ~97% lines /
~93% branches across 195 tests; frontend ~99% lines / ~94% branches across
47 tests.

**GitHub Actions** (`.github/workflows/ci.yml`) runs on every push to
`main` and every pull request, as five independent jobs so the PR shows
exactly what failed: `lint`, `typecheck`, `test` (coverage gates), `build
+ smoke` (real Postgres service container, `test-stub` provider so no keys
are ever needed in CI), and `infra` (`cfn-lint` on the CloudFormation
template).

Where tests live:

```
backend/tests/unit/          pure logic, repositories against a stubbed pg.Pool, providers against a mocked SDK/fetch
backend/tests/integration/   the Express app end-to-end with in-memory fakes (tests/integration/fakes)
backend/tests/smoke/         the real thing over HTTP
frontend/src/**/__tests__/   React Testing Library; pages are driven through the real router + api client with only fetch faked (src/test/harness.tsx)
```

Repo rules that CI cannot check for you are in `CLAUDE.md` (root,
`backend/`, `frontend/`, `infra/`). Read them before changing structure;
the important ones: DI via tsyringe, config via `ConfigResolver`, secrets
via `ISecretsProvider`, the `test` keyword bypass, cursor pagination, no
browser storage, and **deterministic gates before any model call**.

## 8. Where the logs are

| Where | How to read |
|---|---|
| Backend, `npm run dev:backend` | the terminal you started it in |
| Backend, started with `node backend/dist/server.js > /tmp/backend.log 2>&1 &` | `tail -f /tmp/backend.log` |
| Backend in Docker (`docker compose up`) | `docker compose logs -f backend` |
| Frontend | browser DevTools console; the Vite terminal shows build errors |
| Ollama | `ollama ps`; on macOS `~/.ollama/logs/server.log` |
| AWS | CloudWatch log groups `/aws/lambda/scaler-<env>-{api,summarise-case,assign-ticket}`; alarms + dashboard per `infra/README.md` |

Every unexpected server error is logged as `Unhandled error: <message>`
followed by a stack trace; every AI provider failure as `<Provider> API
request failed with status <n>`. Those exact strings are what the CloudWatch
metric filters and alarms match on, so keep them if you touch that code.
Secrets are never logged.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **Internal server error** on Summarise; log says `credit balance is too low` or `status 401/403` from Anthropic/OpenAI | key has no credit / is invalid | add credit, or switch `llm.provider` to `ollama` / `test-stub` (section 5) |
| Log says `ANTHROPIC_API_KEY is not configured` | `.env` missing the key, or backend started before you added it | add it, **restart the backend** (env is read at start) |
| Summarise hangs then fails; log says `Ollama request failed` or `ECONNREFUSED 11434` | Ollama not running / model not pulled | `ollama serve`, `ollama pull gemma3:4b`, check `OLLAMA_BASE_URL` |
| `listen EADDRINUSE :::4000` | an old backend is still running | `lsof -i :4000` then `kill <pid>` |
| `DATABASE_URL is not set` / `ECONNREFUSED 5432` | Postgres not running or `.env` not loaded | `docker compose up -d postgres`; run npm commands from the repo root so `.env` is found |
| Login works, then immediately signed out again | backend restarted with a different `JWT_SECRET`, or token expired (`JWT_EXPIRY`) | sign in again |
| Signed out after a page reload | by design (in-memory session) | sign in again |
| Ticket rows not clickable / page blank | frontend dev server died | restart `npm run dev:frontend`, hard-refresh |
| "Only the assigned agent may summarise" (403) | you are not the assignee | sign in as the assignee, or as `priya.nair` (reviewer) |
| **Sign up** returns 409 | that email already has an account | sign in instead |
| "More information needed" every time | ticket has no Customer ID (or the order is not that customer's / has no delivery date) | fill the inline form; this is the gate working, not a bug |
| Rate limited (429) while demoing | 10 creates / 10 summarises per 10 min per user (local config) | wait, or restart the backend (limiter is in memory) |
| Smoke test: "none of 6 tickets were assigned to smoke-test-agent" | more than 6 agents in your local DB, or `agentPoolSize` capped | set `assignment.agentPoolSize` to `0`, or use a fresh DB |
| Nothing was assigned; ticket stuck in `OPEN` | no SUPPORT_AGENT users (seed not run) | `npm run seed --workspace=backend` |

## 10. Production / AWS notes

The AWS side (`infra/`) is written and linted but **not deployed** -- there
are no credentials in this repo. When you have an account:

* `infra/README.md` -- deploy steps, the alarm runbook table (what fires,
  first thing to check), IAM posture, known gaps (DynamoDB repositories are
  not implemented yet; the Lambda handlers are stubs).
* `docs/aws-cost-notes.md` -- why the whole thing fits in a small demo
  budget, alarm-by-alarm.
* Secrets: `/scaler/<env>/ANTHROPIC_API_KEY` in Secrets Manager, read
  through the same `ISecretsProvider` interface the local `.env` path uses.
* Sign-up in AWS mode is handled by Cognito, not by the app's `/signup`
  endpoint (which returns 401 there on purpose).
* Ticket assignment in AWS mode is a Lambda on the tickets table's
  **DynamoDB Stream** -- the same `AssignmentService.handleTicketCreated`
  body, triggered by the stream instead of the in-process bus. Failed
  events go to a dead-letter queue with its own alarm.

## 11. Glossary

* **Ticket** -- one customer complaint, created by a rep.
* **Case** -- the same ticket, seen from the assigned agent's queue.
* **Assignee** -- the support agent the ticket was round-robin'd to.
* **Supplied facts** -- record-backed data (customer, order, delivery date,
  status) fetched from the order system and given to the model. These
  "decide what is true", not the customer's words.
* **Gate / check** -- a deterministic rule written in code
  (`backend/src/domain/summarisationGates.ts`). Runs before (gate) and after
  (check) the model. Never replaced by a prompt instruction.
* **NEEDS_INFO / DRAFTED / DRAFT_REJECTED** -- the three possible outcomes of
  a summarise click.
* **Test-stub / `test` keyword** -- two ways to get a canned answer with no
  AI spend: the `test-stub` provider (config-wide) or the word `test` in a
  ticket (per ticket).
* **Ollama** -- a program that runs open models (Gemma, Llama, ...) locally
  on your machine and exposes them on http://localhost:11434. Free, offline.
