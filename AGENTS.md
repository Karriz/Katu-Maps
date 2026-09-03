# Katu Maps Agent Guide

## Scope and structure

- The browser application lives in `apps/map-app` and is a React, TypeScript,
  and Vite application.
- MapLibre owns the map, camera, sources, and style. Three.js custom layers
  render procedural trees and transit vehicles. Keep React UI independent of
  map-source parsing.
- Use the existing ownership boundaries: `MapView.tsx` coordinates runtime map
  state; `GlobalMapStyle.ts` owns hosted source and style definitions; transit
  provider selection belongs in `src/map/transit/`.
- Do not modify `data/`, local tile tooling, or generated visual artifacts
  unless the task explicitly concerns them. Production uses hosted map data;
  a clean build must not require local MBTiles or a tile server.

## Product constraints

- Preserve visible MapLibre attribution and provider attribution.
- When a change affects responsive layout, consider desktop, landscape, and
  phone states. Avoid overlapping controls, respect safe-area insets, and keep
  panel triggers reachable.
- Preserve keyboard navigation, focus restoration, semantic labels, and Escape
  behavior for controls, menus, dialogs, and panels.
- Keep provider failures recoverable. Do not expose credentials in source or
  logs; `VITE_DIGITRANSIT_SUBSCRIPTION_KEY` is a local development variable.
- Custom rendering layers must respect existing object/performance budgets.
  Rendering should be reproducible under deterministic test fixtures;
  elapsed-time animation is allowed in production.

## Working conventions

- Make focused changes in the owning module. Do not refactor unrelated map,
  rendering, or provider code while fixing a local issue.
- Reuse the existing CSS, component, and test patterns before adding a new
  abstraction or dependency.
- Verify changes in proportion to their risk. Add or update tests only when a
  stable behavior contract changes and the test provides meaningful regression
  coverage. Small, isolated visual or animation changes do not automatically
  require new tests.
- Never revert user changes or generated output you did not create.

## Available verification commands

These commands are available when relevant; they are not required for every
change. Prefer the narrowest useful check. Do not run the full suite or visual
tests unless the request, risk, or scope justifies them. Report unrelated
failures without investigating them unless asked.

Run commands from `apps/map-app`:

```sh
npm test
npm run build
npm run test:visual
npm run test:visual:scenario -- <scenario-name>
```

- For visual test setup, install Chromium once with
  `npx playwright install --with-deps chromium`.
- Visual tests use deterministic fixtures and SwiftShader. They are appropriate
  for layout, workflow, and WebGL-readiness checks, not physical-GPU
  performance claims.

--- OPERATIONAL GUIDELINES ---
- Handle todos sequentially: start one, complete it immediately, move on.
- For browser work: use read_page over screenshots; navigate strategically with history/URL.
- For terminal: prefer sync mode for one-shot commands; avoid unnecessary sleeps/polling.
- For edits: read file first, make minimal focused changes, never show diffs to user.

