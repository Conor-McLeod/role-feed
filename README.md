# role-feed

A daily feed of open roles at AI inference / infrastructure companies.
Cloudflare Worker + Cron + Queues + D1, with a static UI.

## How it works

- `src/companies.json` lists companies by job board (`ashby`, `greenhouse`, `gem`, `lever`) and board slug.
- A cron (`0 12 * * *`, 12:00 UTC) queues one message per company.
- The queue consumer handles one company per invocation: fetch the public job board API, normalise
  (`src/sources.ts`), upsert into D1, mark anything no longer listed as closed (`src/store.ts`).
  Unchanged listings aren't rewritten.
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
npx wrangler deploy              # creates the D1 database on first deploy
pnpm db:migrate:remote
curl -X POST https://role-feed.<your-subdomain>.workers.dev/api/refresh   # first fill
```

Then put it behind Cloudflare Access (Zero Trust → Access → Applications → Self-hosted, for the
workers.dev hostname). Without that, anyone with the URL can read the feed and trigger `/api/refresh`.

## Adding a company

Find the board slug in the careers page URL (`jobs.ashbyhq.com/<slug>`,
`job-boards.greenhouse.io/<slug>`, `jobs.gem.com/<slug>`, `jobs.lever.co/<slug>`), add an entry to
`src/companies.json`, and deploy.
