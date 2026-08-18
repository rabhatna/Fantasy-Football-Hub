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
`HOST` (127.0.0.1), `BASE_PATH` (`/`), `API_URL` (the dev proxy target), and
`DATA_DIR` (`./data`).

## Your data

Draft state persists to CSV files under `DATA_DIR`, so it survives a restart, a
rebuilt container, and a cleared browser:

```
data/user/draft_picks.csv    your board
data/user/player_notes.csv   your notes
data/user/backups/           snapshot taken before each session's first write
```

These are ordinary CSVs — open them in Excel, edit them, save, then hit
**Refresh** in the app to reload from disk. Every write goes to a temp file and
is renamed over the target, so an interrupted write cannot leave a truncated
file. `data/` is gitignored.

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
- The news feed is five hardcoded headlines.
- Reference data (the player list itself) is not yet file-backed — only your
  draft state is. That arrives with the real dataset.
