# Scaler backend

REST API for the support-ticketing + case-summariser platform. Express +
TypeScript, constructor-based DI via `tsyringe`, Postgres for persistence
offline (mirrors a DynamoDB-backed AWS deployment 1:1 via `@scaler/shared-types`).

## Setup

From the repo root:

```
cp .env.example .env      # never commit the real .env
docker compose up --build
```

This starts Postgres, the backend (which runs migrations + seed data on
container start, see `entrypoint.sh`), and optionally Ollama (`docker compose
--profile ollama up` if you want `LLM_PROVIDER=ollama` instead of the default
`test-stub`).

For local dev without Docker:

```
npm install            # from the repo root (workspaces)
npm run migrate --workspace=backend
npm run seed --workspace=backend
npm run dev --workspace=backend
```

Seeding prints demo user credentials to the console **once** -- copy them
from there, they are never logged anywhere else.

## Tests

```
npm run test --workspace=backend              # unit tests (no DB, mocked repos)
npm run test:integration --workspace=backend   # full HTTP stack, in-memory adapters (no live DB needed)
```

The integration suite (`tests/integration/`) drives the real Express app
(`src/app.ts`) with `supertest`, but swaps every repository/provider for an
in-memory fake registered into the same `tsyringe` container the app
resolves from (`tests/integration/setupTestContainer.ts`). It's still called
"integration" because it exercises the full HTTP -> route -> service ->
repository-interface stack, just without Postgres. It uses its own tiny
rate-limit windows (`tests/integration/fixtures/config/`) so the 429 test
doesn't need to wait 10 real minutes.

### Smoke test

Against a **running** server (local `npm run dev`, or a deployed instance):

```
SMOKE_BASE_URL=http://localhost:4000 npm run smoke --workspace=backend
```

Logs in as the seeded `smoke-test@scaler.local` user and runs a sequence of
realistic scenarios end to end (create tickets, paginate, list cases,
summarise, edit + submit a draft, confirm resolution, confirm rate
limiting), printing PASS/FAIL per scenario and exiting non-zero on any
failure -- safe to use as a CI gate.

## Config: hierarchical wildcard resolution

`src/config/ConfigResolver.ts` resolves `(namespace, key)` pairs against the
current `APP_ENV` (`local` | `beta` | `prod`) with a 4-tier wildcard
fallback, first match wins:

1. `${env}.${namespace}.${key}`
2. `${env}.*.${key}`
3. `*.${namespace}.${key}`
4. `*.*.${key}`

Backing data lives in `src/config/data/{local,beta,prod,wildcard}.json`
(`wildcard.json` is the `*` env). Concrete examples:

- **`prod.llm.provider`**: `prod.json` sets `llm.provider = "openai"`, so
  tier 1 matches directly -- prod always talks to real OpenAI.
- **`beta.rateLimit.ticketCreateMax`**: `beta.json` has no `rateLimit`
  namespace at all, so tier 1 and tier 2 miss; `wildcard.json` (`*`) has
  `rateLimit.ticketCreateMax = 10`, so tier 3 (`*.rateLimit.ticketCreateMax`)
  matches -- beta inherits the demo default without duplicating it.
- **A hypothetical `beta.*.someSharedFlag`**: if ops wanted to change one
  value for *every* namespace in beta only (not local/prod), they'd add a
  `"*": { "someSharedFlag": true }` block to `beta.json` -- that's tier 2,
  which beats the namespace-specific wildcard.json entry (tier 3) for beta
  specifically, without touching local/prod at all.

Secrets (API keys, JWT signing secret, DB URL) are a **separate** concern
handled by `src/secrets/ISecretsProvider` -- never mixed into these JSON
files, never logged. Never commit `.env`; `.env.example` at the repo root
documents every variable.

## Offline abstraction -> AWS counterpart

| Offline (this repo)                                  | AWS counterpart                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| `InMemoryEventBus` (`src/events`)                      | DynamoDB Stream on the `tickets` table, publishing every write     |
| `AssignmentService.handleTicketCreated` (event handler) | The exact same method body as a Lambda subscribed to that stream   |
| `LocalFsAttachmentStorage` (`src/repositories/storage`) | `S3AttachmentStorage` (same `IAttachmentStorage` interface)         |
| `EnvSecretsProvider` (`.env`, git-ignored)              | `AwsSecretsManagerProvider` (AWS Secrets Manager, same interface)   |
| `LocalJwtAuthProvider` (bcrypt + signed JWT)            | `CognitoAuthProviderStub` (Cognito User Pool JWKS verification)     |
| Postgres repositories (`repositories/postgres`)         | DynamoDB-backed repositories implementing the same interfaces       |

Every row above is swapped in one place only: `src/di/container.ts`, based
on runtime env vars/config (`AUTH_MODE`, `SECRETS_PROVIDER`,
`DOCS_STORAGE_MODE`) -- never a hardcoded `new X()` elsewhere in the
codebase.

## Rate limiting

`src/middleware/rateLimiter.ts` builds an `express-rate-limit` middleware
purely from `ConfigResolver` values (`rateLimit.ticketCreateMax` /
`...WindowMs`, `rateLimit.summariseMax` / `...WindowMs`) -- demo default is
10 requests / 10 minutes per authenticated user (falls back to IP if
unauthenticated). Never a literal `10` or `600000` at the call site.

## Test-mode LLM bypass

If a ticket's `ticketOverview` contains the whole word "test"
(case-insensitive) -- or the summarise request passes an explicit
`testMode: true` flag -- `SummarisationService` short-circuits via the named
`shouldBypassWithTestStub()` function and returns a deterministic
`{ summary: "test", draftMessage: "test" }` **without calling any real LLM
provider**, so demos and CI never burn a real API call by accident.
