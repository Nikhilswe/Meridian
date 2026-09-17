# frontend/ -- Claude project memory

Read `../CLAUDE.md` first (repo-wide rules, incl. "no localStorage/
sessionStorage"). This file is frontend-specific detail only.

## Directory map
```
src/api/           client.ts (typed fetch wrapper, setAuthToken/getAuthToken, ApiError,
                   onUnauthorized hook), auth.ts, tickets.ts, cases.ts
src/context/       AuthContext (in-memory token/user), ThemeContext (in-memory, sets
                   document.documentElement.dataset.theme)
src/components/    StatusBadge, Pagination, LoadingSpinner, ErrorBanner, ThemeToggle,
                   ProtectedRoute, NavBar -- small, reusable, SRP
src/pages/         LoginPage, TicketsPage, CaseSummariserPage, CaseDetailPage
src/styles/theme.css   CSS custom properties for [data-theme="light"|"dark"] -- the ONLY
                   place theme colors are defined; components consume the variables,
                   they don't hardcode colors
```

## Conventions specific to this workspace
1. **Auth token and theme are React state, never `localStorage`/
   `sessionStorage`** -- this was a deliberate constraint (per this
   project's in-conversation-preview environment at the time it was built),
   not an oversight. If a later requirement needs persistence across page
   reloads, that's a real product decision to surface to the user, not
   something to quietly add back with browser storage.
2. **Theme switching is via a `data-theme` attribute on `<html>`**, set by
   `ThemeContext`, consumed by CSS custom properties in
   `src/styles/theme.css`. Don't introduce a second theming mechanism
   (e.g. Tailwind's `dark:` class strategy) without updating both.
3. **Types come from `@meridian/shared-types` as `import type {...}`** (type-only
   imports), matching `packages/shared-types/src/*.ts` exactly. If the
   backend adds a field/endpoint, check whether a shared type needs
   updating there FIRST (see repo-root CLAUDE.md) rather than
   hand-declaring a shadow type here.
4. **Pagination is a cursor-stack** (Prev pops, Next pushes `nextCursor`),
   shared by `TicketsPage` and `CaseSummariserPage` via the generic
   `Pagination` component -- don't reimplement per-page.
5. **Visual design here is an intentionally plain, functional baseline.**
   `docs/chatgpt-ui-prompt.md` (repo root) has a ready-to-paste prompt for
   the dark/light + tasteful-3D restyle. If asked to improve the look,
   generate from that prompt (or point the user to it) rather than
   freelancing a different visual direction, so the result still matches
   the screens/components that actually exist.

## Commands
```bash
npm run dev --workspace=frontend      # Vite dev server
npm run build --workspace=frontend    # tsc -b && vite build
npm run test --workspace=frontend     # vitest
```
`VITE_API_BASE_URL` (default `http://localhost:4000`) must point at a
running backend -- see `../backend/CLAUDE.md` for how to bring one up.

## Known gaps specific to frontend/
- No real `<input type="file">` upload UI -- attachment rows are
  metadata-only (fileName + docType), with a placeholder `key`. Wiring a
  real upload means adding a file input, uploading to a new backend
  multipart endpoint (see `backend/CLAUDE.md`'s file-upload gap), and using
  the real returned `key` instead of the placeholder.
- No `/api/auth/me` endpoint, so a page reload always drops back to the
  login screen (auth state is memory-only, matching rule 1 above) -- this
  is expected, not a bug, unless the product requirement changes.
