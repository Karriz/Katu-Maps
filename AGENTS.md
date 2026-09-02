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
- Treat desktop, landscape, and phone layouts as separate responsive states.
  Layout changes must avoid overlapping controls, respect safe-area insets,
  and keep panel triggers reachable.
- Preserve keyboard navigation, focus restoration, semantic labels, and Escape
  behavior for controls, menus, dialogs, and panels.
- Keep provider failures recoverable. Do not expose credentials in source or
  logs; `VITE_DIGITRANSIT_SUBSCRIPTION_KEY` is a local development variable.
- Custom rendering layers must remain deterministic and respect existing
  object/performance budgets.

## Working conventions

- Make focused changes in the owning module. Do not refactor unrelated map,
  rendering, or provider code while fixing a local issue.
- Reuse the existing CSS, component, and test patterns before adding a new
  abstraction or dependency.
- Update tests whenever a user-visible workflow, responsive geometry, keyboard
  interaction, provider contract, or rendering boundary changes.
- Never revert user changes or generated output you did not create.

## Commands

Run commands from `apps/map-app`:

```sh
npm test
npm run build
npm run test:visual
npm run test:visual:scenario -- <scenario-name>
```

- Prefer the narrowest relevant unit test or named visual scenario first.
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

--- TEST STRATEGY ---
- Prefer narrowest relevant unit or visual test first.
- Use deterministic fixtures and SwiftShader for visual tests.
- Do not expose credentials in source or logs.

