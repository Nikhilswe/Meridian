# Meridian Frontend

React + TypeScript + Vite single-page app for the Meridian support-ticketing
and case-summariser platform.

## Running locally

From the repository root, install and build the workspace once:

```
npm install
npm run build --workspace=packages/shared-types
```

Then, from the repository root or from `frontend/`:

```
npm run dev --workspace=frontend
# or, from inside frontend/:
npm run dev
```

This starts the Vite dev server (default `http://localhost:5173`).

## Configuration

The app talks to the backend REST API at the URL given by the
`VITE_API_BASE_URL` environment variable (a standard Vite `.env` file, or
your shell environment), falling back to `http://localhost:4000` when unset.
Point it at wherever the `@meridian/backend` Express server is running, e.g.:

```
VITE_API_BASE_URL=http://localhost:4000
```

## Testing

```
npm run test --workspace=frontend
```

Runs the Vitest + React Testing Library suite (component-level smoke and
behavior tests). The backend owns the heavier integration/smoke test suites;
this frontend suite is intentionally minimal.

## Visual design note

This is an intentionally plain, functional baseline: semantic components,
CSS custom properties for theming (see `src/styles/theme.css`), and clean
but unadorned layout/typography. A separate follow-up pass will restyle the
visuals (a more elaborate, "3D" look) using an external design prompt --
the component structure, class names and CSS variable hooks here are kept
deliberately simple and semantic so that restyle can be applied without
touching component logic.
