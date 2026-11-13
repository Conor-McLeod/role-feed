// JSON API for the feed UI.

import { companyHealth, type CompanyStatus } from "./health";
import { createJobPage, findJobPage, NotionError, notionConfig } from "./notion";
import { BY_KEY, enqueueAll } from "./poll";

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
    const { results } = await env.DB.prepare("SELECT * FROM companies ORDER BY category, name").all<
      CompanyStatus & { key: string }
    >();
    const now = Date.now();
    // health is null for companies no longer in companies.json (not polled any more).
    return json(results.map((c) => ({ ...c, health: BY_KEY.has(c.key) ? companyHealth(c, now) : null })));
  }

  // Archive or unarchive listings. Body: { ids: string[], archived: boolean }.
  if (req.method === "POST" && path === "/api/archive") return archive(env.DB, req);

  // Send a listing to the Notion Jobs database. Body: { id: string }.
  if (req.method === "POST" && path === "/api/notion") return addToNotion(env, req);

  // Re-poll every company now (the daily cron does the same).
  if (req.method === "POST" && path === "/api/refresh") {
    const n = await enqueueAll(env);
    console.log({ event: "enqueue", trigger: "manual", queued: n });
    return json({ queued: n });
  }

  return json({ error: "not found" }, 404);
}

const MAX_ARCHIVE_IDS = 2000; // matches the listings limit, so "archive all shown" fits

async function archive(db: D1Database, req: Request): Promise<Response> {
  let body: { ids?: unknown; archived?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const { ids, archived } = body;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string") || typeof archived !== "boolean") {
    return json({ error: "expected { ids: string[], archived: boolean }" }, 400);
  }
  if (ids.length > MAX_ARCHIVE_IDS) return json({ error: `at most ${MAX_ARCHIVE_IDS} ids` }, 400);
  if (!ids.length) return json({ updated: 0 });

  // One query regardless of count (ids go in as a JSON array); rows already in
  // the requested state aren't rewritten. Re-archiving keeps the original time.
  const result = await db
    .prepare(
      `UPDATE listings SET archived_at = CASE WHEN ?2 THEN ?3 ELSE NULL END
       WHERE id IN (SELECT value FROM json_each(?1))
         AND (archived_at IS NULL) = ?2`,
    )
    .bind(JSON.stringify(ids), archived ? 1 : 0, new Date().toISOString())
    .run();
  return json({ updated: result.meta.changes ?? 0 });
}

async function addToNotion(env: Env, req: Request): Promise<Response> {
  const cfg = notionConfig(env);
  if (!cfg) return json({ error: "Notion isn't configured (set NOTION_TOKEN and NOTION_DATA_SOURCE_ID)" }, 501);

  let id: unknown;
  try {
    ({ id } = await req.json<{ id?: unknown }>());
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  if (typeof id !== "string") return json({ error: "expected { id: string }" }, 400);

  const row = await env.DB.prepare(
    `SELECT l.title, l.url, l.description, l.notion_url, c.name AS company
     FROM listings l JOIN companies c ON c.key = l.company_key WHERE l.id = ?1`,
  )
    .bind(id)
    .first<{ title: string; url: string; description: string | null; notion_url: string | null; company: string }>();
  if (!row) return json({ error: "not found" }, 404);
  if (row.notion_url) return json({ notion_url: row.notion_url, created: false });

  try {
    // Already in Notion (added by hand, or a previous request that failed to
    // record it): link to that page instead of making a duplicate.
    const existing = await findJobPage(cfg, row.url);
    const page = existing ?? (await createJobPage(cfg, row));
    const created = !existing;
    await env.DB.prepare("UPDATE listings SET notion_url = ?2 WHERE id = ?1").bind(id, page.url).run();
    console.log({ event: "notion_add", listing: id, page: page.id });
    return json({ notion_url: page.url, created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error({ event: "notion_failed", listing: id, error: message });
    return json({ error: message }, err instanceof NotionError ? 502 : 500);
  }
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
 *   view      inbox (default, not archived) | archived | all
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

  const view = p.get("view") ?? "inbox";
  if (view === "inbox") where.push("l.archived_at IS NULL");
  else if (view === "archived") where.push("l.archived_at IS NOT NULL");

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
           l.published_at, l.first_seen_at, l.closed_at, l.archived_at, l.notion_url,
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
