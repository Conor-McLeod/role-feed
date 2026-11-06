// JSON API for the feed UI.

import { enqueueAll } from "./poll";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/listings") return listListings(env.DB, url.searchParams);

  if (req.method === "GET" && path.startsWith("/api/listings/")) {
    const id = decodeURIComponent(path.slice("/api/listings/".length));
    const row = await env.DB.prepare(
      `SELECT l.*, c.name AS company, c.category FROM listings l
       JOIN companies c ON c.key = l.company_key WHERE l.id = ?1`,
    )
      .bind(id)
      .first();
    return row ? json(row) : json({ error: "not found" }, 404);
  }

  if (req.method === "GET" && path === "/api/companies") {
    const { results } = await env.DB.prepare("SELECT * FROM companies ORDER BY category, name").all();
    return json(results);
  }

  // Re-poll every company now (the daily cron does the same).
  if (req.method === "POST" && path === "/api/refresh") {
    const n = await enqueueAll(env);
    return json({ queued: n });
  }

  return json({ error: "not found" }, 404);
}

/**
 * Query params (all optional):
 *   q         space-separated terms, all must match (title, company, team, department, location)
 *   desc=1    also match q against the description
 *   exclude   comma-separated terms; drop titles containing any of them
 *   company   comma-separated company keys
 *   category  comma-separated categories
 *   remote=1  remote-friendly only
 *   location  substring of any location
 *   status    open (default) | closed | all
 *   posted    only roles published in the last N days
 *   seen      only roles first seen in the last N days
 *   sort      seen (default) | posted
 *   limit     default 500, max 2000
 */
async function listListings(db: D1Database, p: URLSearchParams): Promise<Response> {
  const where: string[] = [];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `?${args.length}`;
  };
  const like = (s: string) => arg(`%${s.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
  const list = (k: string) => (p.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);

  const haystack = ["l.title", "c.name", "l.team", "l.department", "l.locations"];
  if (p.get("desc") === "1") haystack.push("l.description");
  for (const term of (p.get("q") ?? "").split(/\s+/).filter(Boolean).slice(0, 10)) {
    const t = like(term);
    where.push(`(${haystack.map((h) => `${h} LIKE ${t} ESCAPE '\\'`).join(" OR ")})`);
  }
  for (const term of list("exclude")) where.push(`l.title NOT LIKE ${like(term)} ESCAPE '\\'`);

  const companies = list("company");
  if (companies.length) where.push(`l.company_key IN (${companies.map(arg).join(", ")})`);
  const categories = list("category");
  if (categories.length) where.push(`c.category IN (${categories.map(arg).join(", ")})`);

  if (p.get("remote") === "1") where.push("l.remote = 1");
  const loc = p.get("location")?.trim();
  if (loc) where.push(`l.locations LIKE ${like(loc)} ESCAPE '\\'`);

  const status = p.get("status") ?? "open";
  if (status === "open") where.push("l.closed_at IS NULL");
  else if (status === "closed") where.push("l.closed_at IS NOT NULL");

  const daysAgo = (k: string) => {
    const n = Number(p.get(k));
    return n > 0 ? new Date(Date.now() - n * 86_400_000).toISOString() : null;
  };
  const posted = daysAgo("posted");
  if (posted) where.push(`l.published_at >= ${arg(posted)}`);
  const seen = daysAgo("seen");
  if (seen) where.push(`l.first_seen_at >= ${arg(seen)}`);

  const order =
    p.get("sort") === "posted"
      ? "l.published_at DESC NULLS LAST, l.first_seen_at DESC"
      : "l.first_seen_at DESC, l.published_at DESC NULLS LAST";
  const limit = Math.min(Math.max(Number(p.get("limit")) || 500, 1), 2000);

  const sql = `
    SELECT l.id, l.company_key, c.name AS company, c.category, l.title, l.department, l.team,
           l.location, l.locations, l.remote, l.workplace, l.employment, l.compensation, l.url,
           l.published_at, l.first_seen_at, l.closed_at,
           count(*) OVER () AS total
    FROM listings l JOIN companies c ON c.key = l.company_key
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${order}
    LIMIT ${limit}`;

  const { results } = await db.prepare(sql).bind(...args).all<Record<string, unknown>>();
  const total = (results[0]?.total as number | undefined) ?? 0;
  for (const r of results) delete r.total;
  return json({ total, listings: results });
}
