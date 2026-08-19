# The Draft Room

A local fantasy football analyst terminal for the 2026 season: compare 2025
production, 2026 market data, team context, and injury signals while building a
draft board. Runs entirely on your machine.

## Requirements

- Node.js 22+ (tested on 24)
- pnpm 10 (`corepack enable pnpm` — the version is pinned in `package.json`)

## Run it

```bash
pnpm install && pnpm start
```

Then open http://localhost:8080. That builds everything and serves the
dashboard and the API from one process on one port. Stop it with Ctrl-C; run
`pnpm run serve` to start again without rebuilding.

### Developing

```bash
pnpm dev
```

Runs the API and the Vite dev server together for hot reload, on
http://localhost:5173, with `/api` proxied to the API on 8080.

| Command | What it does |
|---|---|
| `pnpm start` | Build, then serve the whole app on one port |
| `pnpm run serve` | Serve an existing build |
| `pnpm dev` | Both dev servers, with hot reload |
| `pnpm run build` | Typecheck, then build API bundle + SPA |
| `pnpm run test` | Run the store and dataset test suites |
| `pnpm run typecheck` | Typecheck every package |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate React Query hooks and Zod schemas from the OpenAPI spec |

Environment variables all have local defaults: `PORT` (8080 serving everything,
5173 for the Vite dev server), `HOST` (127.0.0.1), `DATA_DIR` (`./data` at the
repo root), `WEB_DIST` (the built dashboard), `API_URL` (the dev proxy target).

## Layout

- `artifacts/fantasy-draft-dashboard/src/App.tsx` — the whole dashboard: routes,
  draft state, filters, deep dives, team context, news.
- `artifacts/api-server/src/routes/fantasy.ts` — the `/api` endpoints.
- `lib/api-spec/openapi.yaml` — source of truth for the API contract. Generates
  `lib/api-zod` (server validation) and `lib/api-client-react` (typed hooks).
- `lib/dataset` — reads the player snapshot; `lib/store` — CSV persistence.
- `datasets/<date>/master.csv` — the 250-player dataset shipped with the app.
- `attached_assets/` — the Python `ff_analytics` pipeline that produces it.

## Stack

pnpm workspaces · TypeScript 5.9 · Express 5 · React 19 + Vite 7 · Tailwind 4 ·
TanStack Query · Zod · Orval codegen · esbuild

## Known state

- **The player data is fabricated.** `fantasy.ts` generates ranks 13–250 from a
  seeded PRNG using pools of first and last names; only the top 12 are real
  names, with invented numbers. The genuine dataset in `attached_assets/` is not
  yet wired in.
- The news feed is five hardcoded headlines.
- Reference data (the player list itself) is not yet file-backed — only your
  draft state is. That arrives with the real dataset.
