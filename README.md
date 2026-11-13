# role-feed

A daily feed of open roles at AI inference / infrastructure companies.
Cloudflare Worker + Cron + Queues + D1, with a static UI.

## How it works

- `src/companies.json` lists companies by job board (`ashby`, `greenhouse`, `gem`, `lever`) and board slug.
- A cron (`0 12 * * *`, 12:00 UTC) queues one message per company.
- The queue consumer handles one company per invocation: fetch the public job board API, normalise
  (`src/sources.ts`), upsert into D1, mark anything no longer listed as closed (`src/store.ts`).
  Unchanged listings aren't rewritten.
- Messages that exhaust their retries go to `role-feed-dlq`, which records the give-up on the company.
- Each company has a health status (`src/health.ts`): `failed` (error recorded), `interrupted` (started
  but never finished, e.g. killed for CPU), or `stale` (no success in 36h). The UI marks these, and
  the daily cron logs a `company_unhealthy` warning for each. Logs are structured objects (`event:
  "poll"` carries per-company write counts, response size and fetch time), so they can be filtered
  in Workers Logs.
- `/api/*` serves the feed; `public/` is the UI. "New" is relative to your last visit (localStorage).

## Develop

```bash
pnpm install
pnpm db:migrate:local
pnpm dev                                   # http://localhost:8787
curl "http://localhost:8787/__scheduled"   # run the daily poll now
```

## Deploy

```bash
npx wrangler login
npx wrangler queues create role-feed-fetch
npx wrangler queues create role-feed-dlq
npx wrangler deploy              # creates the D1 database on first deploy
pnpm db:migrate:remote
```

The Worker is served only on the custom domain in `wrangler.jsonc` (`routes`); `workers_dev` and
`preview_urls` are off, so there's no unprotected `*.workers.dev` hostname. Put that domain behind
Cloudflare Access (Zero Trust → Access → Applications → Self-hosted). Without that, anyone with the
URL can read the feed and trigger `/api/refresh`. Then sign in and press "Refresh now" for the first
fill (or wait for the daily cron).

## Adding a company

Find the board slug in the careers page URL (`jobs.ashbyhq.com/<slug>`,
`job-boards.greenhouse.io/<slug>`, `jobs.gem.com/<slug>`, `jobs.lever.co/<slug>`), add an entry to
`src/companies.json`, and deploy.
