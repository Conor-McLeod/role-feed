# role-feed

A daily feed of open roles at AI inference / infrastructure companies.
Cloudflare Worker + Cron + Queues + D1, with a Svelte UI built by Vite.

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

The Worker is served only on the custom domain in `wrangler.jsonc` (`routes`); `workers_dev` and
`preview_urls` are off, so there's no unprotected `*.workers.dev` hostname. Put that domain behind
Cloudflare Access (Zero Trust → Access → Applications → Self-hosted). Without that, anyone with the
URL can read the feed and trigger `/api/refresh`. Then sign in and press "Refresh now" for the first
fill (or wait for the daily cron).

## Add to Notion

Each role has an "Add to Notion" button (or press `n`) that creates a page in the Notion **Jobs**
database, where applications are tracked: `Position` is "<title> @ <company>", `Link` is the posting
URL, and the page body is the job description (`src/notion.ts`). If a page with that `Link` already
exists it's linked instead of duplicated. The page URL is stored in `listings.notion_url`, and the row
then shows "In Notion".

Setup:

1. notion.so/profile/integrations → New integration (internal), with read + insert content.
2. Open the Jobs database → ••• → Connections → add the integration.
3. `npx wrangler secret put NOTION_TOKEN` (and for local dev, copy `.dev.vars.example` to
   `.dev.vars` and fill it in).
4. `pnpm db:migrate:remote` for the `notion_url` column.

The data source ID and property names are `vars` in `wrangler.jsonc`. Without a token the button
reports "Notion isn't configured".

## Adding a company

Find the board slug in the careers page URL (`jobs.ashbyhq.com/<slug>`,
`job-boards.greenhouse.io/<slug>`, `jobs.gem.com/<slug>`, `jobs.lever.co/<slug>`), add an entry to
`src/companies.json`, and deploy.
