# Full end-to-end verification -- 2026-09-18

Run on a developer laptop (macOS, Node v26.0.0) against a **real** local
Postgres and a **real** running `node backend/dist/server.js`, with
**Ollama (`gemma3:4b`)** as the configured provider. This is the run that
accompanies the "sign-up + CI + coverage + runbook" pull request.

## What changed since the 2026-09-17 report
- Self-service sign-up (`POST /api/auth/signup`, `/signup` page).
- Ticket rows on the Tickets page are now links to the case detail page
  (they were never clickable); the detail page is read-only for a viewer
  who is not the assignee.
- `assignment.agentPoolSize: 0` = every agent rotates (local default), so a
  freshly signed-up agent receives tickets. Previously a new sign-up could
  silently evict an existing agent from the "first N by display name" pool.
- `AnthropicProvider` moved from raw `fetch` to the official
  `@anthropic-ai/sdk`; the 500 seen in the browser was the account having
  no credit (`400: credit balance is too low`), now surfaced in the log.
- 90% coverage gates on both workspaces, ESLint (zero warnings) for both,
  `tsc --noEmit` typecheck, GitHub Actions CI, `docs/RUNBOOK.md`.

## 1. `npm run check` (what CI runs) -- clean
| Step | Result |
|---|---|
| `lint` backend (`eslint src tests --max-warnings 0`) | 0 problems |
| `lint` frontend (`eslint src --max-warnings 0`) | 0 problems |
| `typecheck` (shared-types build, `tsc --noEmit` backend + frontend) | 0 errors |
| backend `test:coverage` (16 suites, unit + integration) | **195 passed**; 97.65% statements / 93.2% branches / 99.31% functions / 97.5% lines |
| frontend `test:coverage` (6 files) | **47 passed**; 99.6% statements / 94.17% branches / 95.12% functions / 99.6% lines |

Thresholds (90/90/90/90) are enforced by `backend/jest.config.js` and
`frontend/vite.config.ts`; both runs cleared them.

## 2. `npm run build` -- clean (shared-types -> backend -> frontend)

## 3. Smoke test against the live server + live Postgres
```
SMOKE_BASE_URL=http://localhost:4000 npm run smoke --workspace=backend
```
**9/9 scenarios passed**, including the new "create tickets until
round-robin reaches the smoke agent" scenario, which is what caught the
pool-eviction bug above: the database contained an extra agent created
through the new sign-up form, and the smoke agent had dropped out of the
3-wide pool.

## 4. `npm run check:llm` -- Ollama, real call
`Provider (from config, APP_ENV=local): ollama` -> `OK in 11396ms`. The draft
correctly did **not** claim the issue was resolved (record status ASSIGNED).

## 5. Browser walk-through (Chromium, http://localhost:5173)
1. `/signup` -> created "Class Demo Agent" -> landed on Tickets, signed in.
2. Created a ticket (`cust-1001` / `order-1001`) -> **Assigned** on creation.
3. Clicked the ticket row -> case detail, "Back to tickets".
4. Summarise & Generate Draft via Ollama -> **DRAFTED**, 4/4 checks passed,
   evidence panels populated, "Generated ... via ollama".

## 6. `cfn-lint infra/cfn/main.template.yaml` -- no findings
