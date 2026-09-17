# Prompt for ChatGPT: visual redesign of the Meridian UI

Copy everything in the code block below into ChatGPT (a model with image
generation / canvas / code-interpreter access will get the most out of it,
e.g. GPT-4o or later). It describes the exact screens and component
structure already built in `frontend/src/`, so the output should slot in
without needing to redo the app's logic -- only its visuals.

```
You are a senior product designer + frontend engineer. Redesign the visual
design (not the logic or data flow) of an internal enterprise support tool
called "Meridian". Keep every screen, form field, button, and state described
below -- I need a restyle, not a redesign of functionality.

APP OVERVIEW
Meridian is a support-ticket + AI case-summariser tool used by support agents
and reviewers. It is React + TypeScript. There are two main tabs behind a
login screen, plus a persistent dark/light mode toggle in the top nav.

SCREEN 1 -- Login
- Centered card: email field, password field, "Log in" button, error banner
  on failed auth.

SCREEN 2 -- Tickets tab
- A "create ticket" form at the top: a large multi-line "ticket overview"
  textarea (this is literally what a support rep types after hearing a
  customer's complaint on a call or reading their email -- treat this as
  the emotional/human center of the screen), an optional repeatable
  "attached document" row (file name + a type selector: Image or PDF), and
  a submit button.
- Below it, a paginated table/list of tickets: ticket ID, a colored status
  badge (OPEN, ASSIGNED, IN_REVIEW, DRAFT_PENDING_REVIEW, RESOLVED, CLOSED --
  give each its own distinct, accessible color), creator, created date,
  assignee (or "unassigned"), with Prev/Next pagination controls.

SCREEN 3 -- Case Summariser tab
- A paginated list of "cases" (tickets) assigned to the current user, same
  status-badge treatment, clickable rows.
- Clicking a row opens a detail view: the ticket overview at the top, then
  either:
  (a) a single prominent "Summarise & Generate Draft" button (this is the
      moment the AI does work -- it should feel a little bit magical/alive
      while loading, since a real LLM call can take a few seconds), or
  (b) once summarised: a read-only "case summary" panel and an EDITABLE
      draft-reply textarea pre-filled with the AI's draft, plus a "Submit"
      button. After submit, the case flips to a resolved, read-only state.

DESIGN DIRECTION
- Overall feel: calm, trustworthy, premium enterprise SaaS (think Linear,
  Vercel dashboard, Arc browser's settings) -- NOT playful/consumer, NOT
  generic Bootstrap-blue admin-panel. Support agents live in this tool for
  hours; it should feel fast, quiet, and un-fatiguing, with generous
  whitespace and a restrained color palette (one confident primary accent
  color + neutrals + the status-badge colors above).
- Both a light mode and a dark mode, using CSS custom properties so the
  whole app can flip instantly (a toggle already exists in the nav) --
  dark mode should not just invert colors; design it as its own deliberate
  palette (true near-black surfaces, not navy-tinted grays that look muddy).
- Typography: one clean sans-serif variable font (e.g. something in the
  Inter / Geist / General Sans family), tight but legible type scale, use
  weight and size for hierarchy rather than heavy borders/boxes everywhere.
- Add SUBTLE 3D elements, used sparingly and only where they earn their
  place -- this is an enterprise tool, so 3D must never feel gimmicky:
  1. A soft, slowly-drifting abstract 3D shape (e.g. a low-poly or
     glass-morphism blob/torus rendered with CSS 3D transforms, an inline
     SVG with layered gradients simulating depth, or a lightweight WebGL/
     Three.js/Spline embed if available) as ambient background decoration
     on the Login screen and behind the empty/loading states -- never
     behind dense data tables where it would hurt readability.
  2. A genuine 3D micro-interaction on the "Summarise & Generate Draft"
     button while it's loading: think a subtly rotating/pulsing 3D icon
     (a stylized neural-node/spark glyph) rather than a generic spinner --
     this is the one moment in the app where a little delight is earned,
     because it's the AI visibly "thinking."
  3. Status badges and the theme toggle can have gentle depth via
     multi-layer soft shadows / light-source-consistent highlights (a subtle
     3D "pressed button" feel), not full 3D geometry.
  4. Everything else (tables, forms, nav) stays flat, fast, and information-
     dense -- 3D is a rare accent, not a design language for the whole app.
- Motion: fast, purposeful micro-transitions (150-250ms ease-out) on
  hover/focus/status changes; respect prefers-reduced-motion by disabling
  the ambient 3D drift and micro-interactions for users who request it.
- Accessibility: WCAG AA contrast in both themes (check the status-badge
  colors especially), visible focus rings, and don't rely on color alone
  to convey ticket status (use the text label too, which the app already
  shows).

DELIVERABLE
Give me:
1. A design rationale paragraph (palette, type, the 3D moments chosen and why).
2. CSS custom properties for both themes (`:root[data-theme="light"]` /
   `[data-theme="dark"]`) covering background/surface/text/border/primary/
   the six status colors.
3. Concrete component-level styling guidance (or actual CSS/JSX) for: the nav
   bar + theme toggle, the login card + its ambient 3D background, the
   ticket-create form, the paginated list/table, the status badges, the case
   detail view, and the "Summarise & Generate Draft" button's loading state
   with its 3D micro-interaction.
Assume Tailwind CSS utility classes are available if that's the fastest way
to express it, but CSS custom properties must still be the source of truth
for theme colors (the app already toggles a `data-theme` attribute on
`<html>`, not a Tailwind dark: class).
```

## Why this prompt is shaped this way
- It names the exact screens/components the frontend already has (see
  `frontend/src/pages/*.tsx`) so ChatGPT restyles what exists instead of
  inventing new flows that would need to be re-wired back into the app.
- It scopes the "3D" ask to three specific, purposeful moments (login
  ambience, the AI-thinking button state, badge/toggle depth) instead of a
  vague "add 3D everywhere," because an enterprise ticketing tool that's
  3D-heavy on its data tables would actually hurt usability -- the prompt
  says this explicitly so ChatGPT doesn't over-apply it.
- It pins dark/light mode to the same `data-theme` attribute mechanism the
  frontend's `ThemeContext.tsx` already sets, so the output drops in without
  a rewire.
- It asks for a rationale + tokens + component guidance (not just a mockup
  image) so the output is directly usable as CSS/JSX in `frontend/src/styles/theme.css`
  and the relevant page/component files.
