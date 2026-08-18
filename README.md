# The Draft Room

A local fantasy football analyst terminal for the 2026 season: compare 2025
production, 2026 market data, team context, and injury signals while building a
draft board. Runs entirely on your machine.

## Requirements

- Node.js 22+ (tested on 24)
- pnpm 10 (`corepack enable pnpm` — the version is pinned in `package.json`)

## Run locally

Two processes. In separate terminals:

```bash
pnpm --filter @workspace/api-server run dev
```

```bash
pnpm --filter @workspace/fantasy-draft-dashboard run dev
```

Then open http://127.0.0.1:5173. The dashboard proxies `/api` to the API server
on port 8080, so both work from one origin in the browser.

| Command | What it does |
|---|---|
| `pnpm run typecheck` | Typecheck every package |
| `pnpm run build` | Typecheck, then build API bundle + SPA |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate React Query hooks and Zod schemas from the OpenAPI spec |

Environment variables all have local defaults: `PORT` (8080 API / 5173 web),
`HOST` (127.0.0.1), `BASE_PATH` (`/`), `API_URL` (the dev proxy target).

## Layout

- `artifacts/fantasy-draft-dashboard/src/App.tsx` — the whole dashboard: routes,
  draft state, filters, deep dives, team context, news.
- `artifacts/api-server/src/routes/fantasy.ts` — the `/api` endpoints.
- `lib/api-spec/openapi.yaml` — source of truth for the API contract. Generates
  `lib/api-zod` (server validation) and `lib/api-client-react` (typed hooks).
- `attached_assets/` — the real 250-player dataset (CSV + XLSX) and the Python
  `ff_analytics` pipeline that produces it.

## Stack

pnpm workspaces · TypeScript 5.9 · Express 5 · React 19 + Vite 7 · Tailwind 4 ·
TanStack Query · Zod · Orval codegen · esbuild

## Known state

- **The player data is fabricated.** `fantasy.ts` generates ranks 13–250 from a
  seeded PRNG using pools of first and last names; only the top 12 are real
  names, with invented numbers. The genuine dataset in `attached_assets/` is not
  yet wired in.
- **Nothing persists.** Draft picks live in an in-memory array that dies with the
  process, mirrored into browser `localStorage`. Player notes are localStorage
  only. Both are lost on a restart or a cleared browser profile.
- The news feed is five hardcoded headlines.
