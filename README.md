# role-feed

A daily feed of open roles at AI inference / infrastructure companies.
Cloudflare Worker + Cron + Queues + D1, with a Svelte UI built by Vite.

## How it works

- The `companies` table in D1 lists companies by job board (`ashby`, `greenhouse`, `gem`, `lever`) and
  board slug. It's managed from the Companies page in the UI (see [Managing companies](#managing-companies)).
- A cron (`0 12 * * *`, 12:00 UTC) queues one message per enabled company.
- The queue consumer handles one company per invocation: fetch the public job board API, normalise
  (`src/sources.ts`), upsert into D1, mark anything no longer listed as closed (`src/store.ts`).
  Unchanged listings aren't rewritten.
- Messages that exhaust their retries go to `role-feed-dlq`, which records the give-up on the company.
- Each company has a health status (`src/health.ts`): `failed` (error recorded), `interrupted` (started
  but never finished, e.g. killed for CPU), or `stale` (no success in 36h). The UI marks these, and
  the daily cron logs a `company_unhealthy` warning for each. Logs are structured objects (`event:
  "poll"` carries per-company write counts, response size and fetch time), so they can be filtered
  in Workers Logs.
- `/api/*` serves the feed. The UI is a Svelte 5 app in `ui/` (entry `index.html`), built by Vite
  and served as static assets. "New" is relative to your last visit (localStorage).
- One Vite dev server runs both: `@cloudflare/vite-plugin` runs the Worker from `wrangler.jsonc` in
  workerd with local D1 and Queues. `vite build` writes `dist/` plus a generated `wrangler.json`,
  which `wrangler deploy` picks up automatically (via `.wrangler/deploy/config.json`).

## Develop

```bash
pnpm install
pnpm db:migrate:local
pnpm dev                                                 # http://localhost:8787
curl "http://localhost:8787/cdn-cgi/handler/scheduled"   # run the daily poll now
pnpm typecheck                                           # Worker (tsc 7) + UI (svelte-check)
```

`svelte-check` needs TypeScript 6, so `typescript` is pinned to 6 and TypeScript 7 is installed as
`@typescript/native`, which the Worker check calls directly.

## Deploy

```bash
npx wrangler login
npx wrangler queues create role-feed-fetch
npx wrangler queues create role-feed-dlq
pnpm run deploy                  # vite build + wrangler deploy; creates D1 on first deploy
pnpm db:migrate:remote
```

That order is only for the first deploy, when D1 doesn't exist until `wrangler deploy` creates it. After
that, run `pnpm db:migrate:remote` **before** `pnpm run deploy`: new code can depend on new columns (e.g.
`companies.enabled` from `0003`), and every endpoint, the cron and the queue consumer fail until they exist.

The Worker is served only on the custom domain in `wrangler.jsonc` (`routes`); `workers_dev` and
`preview_urls` are off, so there's no unprotected `*.workers.dev` hostname. Put that domain behind
Cloudflare Access (Zero Trust → Access → Applications → Self-hosted). Without that, anyone with the
URL can read the feed and trigger `/api/refresh`. Then sign in and press "Refresh now" for the first
fill (or wait for the daily cron).

## Managing companies

Open the **Companies** page (`/#companies`):

- **Add a company**: paste its careers page link (`jobs.ashbyhq.com/<slug>`, `job-boards.greenhouse.io/<slug>`,
  `jobs.gem.com/<slug>`, `jobs.lever.co/<slug>`) to fill in the job board and slug, then give it a name and
  category. The Worker checks the board exists before saving (a mistyped slug is rejected) and queues its
  first poll straight away.
- **Pause / resume**: the switch on each row. A paused company isn't polled and its roles are left out of
  the feed, but the company and its listings stay in D1. Resuming polls it immediately.

API: `POST /api/companies` with `{ name, category, ats, slug }`; `PATCH /api/companies/<ats>:<slug>` with
`{ enabled }`. The list used to live in `src/companies.json`; migration `0003` seeded the table from it.
