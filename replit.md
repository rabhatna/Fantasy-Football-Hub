# The Draft Room

The Draft Room is a fantasy football analyst terminal for comparing 2025 production, 2026 market data, team context, and injury signals while building a draft board.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/fantasy-draft-dashboard/src/App.tsx` — dashboard routes, draft state, filters, deep dives, team context, and news screens.
- `artifacts/fantasy-draft-dashboard/src/index.css` — shared analyst-terminal theme, tokens, typography, and responsive styles.
- `artifacts/api-server/src/routes/fantasy.ts` — seeded fantasy data endpoints and draft/refresh API behavior.
- `lib/api-spec/openapi.yaml` — source of truth for the fantasy API contract.

## Architecture decisions

- The frontend uses generated React Query hooks from the shared OpenAPI contract rather than hand-written fetch types.
- Draft picks and player notes persist in browser localStorage so the board remains personal without requiring an account.
- The API starts with a curated preseason snapshot so all core flows work before live data connectors are added.
- The frontend is a single root artifact; the shared API server owns `/api` routes and is routed separately from the web app.

## Product

- Live draft room with ranked players, filters, sortable market/value signals, and local draft board.
- Player deep dives with 2025 vs 2026 comparisons, next-gen radar metrics, consistency charts, durability, and notes.
- Team offensive-line context matrix and injury/market signal feed.
- Refreshable cached-data status and draft summary metrics.

## User preferences

No additional preferences recorded.

## Gotchas

- Keep `lib/api-spec/openapi.yaml` and generated client/Zod outputs in sync by running the API codegen command after contract changes.
- The app expects workflow-provided `PORT` and `BASE_PATH`; use the managed web workflow for previews.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
