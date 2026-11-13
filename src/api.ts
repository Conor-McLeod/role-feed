// JSON API for the feed UI.

import { companyHealth, type CompanyStatus } from "./health";
import { enqueueAll } from "./poll";
import { probeBoard } from "./sources";
import { addCompany, setEnabled } from "./store";
import { ATS, companyKey, type Ats, type Company, type FetchMessage } from "./types";

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

  if (req.method === "GET" && path === "/api/companies") return json(await listCompanies(env.DB));

  // Add a company. Body: { name, category, ats, slug }.
  if (req.method === "POST" && path === "/api/companies") return createCompany(env, req);

  // Pause or resume polling. Body: { enabled: boolean }.
  if (req.method === "PATCH" && path.startsWith("/api/companies/")) {
    return updateCompany(env, req, decodeURIComponent(path.slice("/api/companies/".length)));
  }

  // Archive or unarchive listings. Body: { ids: string[], archived: boolean }.
  if (req.method === "POST" && path === "/api/archive") return archive(env.DB, req);

  // Re-poll every company now (the daily cron does the same).
  if (req.method === "POST" && path === "/api/refresh") {
    const n = await enqueueAll(env);
    console.log({ event: "enqueue", trigger: "manual", queued: n });
    return json({ queued: n });
  }

  return json({ error: "not found" }, 404);
}

async function listCompanies(db: D1Database, key?: string) {
  const { results } = await db
    .prepare(`SELECT * FROM companies ${key ? "WHERE key = ?1" : ""} ORDER BY category, name`)
    .bind(...(key ? [key] : []))
    .all<CompanyStatus & { key: string; enabled: number }>();
  const now = Date.now();
  // health is null for paused companies (not polled).
  return results.map((c) => ({ ...c, enabled: !!c.enabled, health: c.enabled ? companyHealth(c, now) : null }));
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const ATS_NAMES: Record<Ats, string> = { ashby: "Ashby", greenhouse: "Greenhouse", gem: "Gem", lever: "Lever" };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CATEGORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function createCompany(env: Env, req: Request): Promise<Response> {
  const body = await readJson(req);
  if (!body) return json({ error: "invalid JSON" }, 400);
  const ats = str(body.ats) as Ats;
  const company: Company = {
    name: str(body.name),
    // "Inference Silicon" -> "inference-silicon", matching the existing keys.
    category: str(body.category).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    ats,
    slug: str(body.slug),
  };
  if (!ATS.includes(ats)) return json({ error: `Job board must be one of ${ATS.join(", ")}` }, 400);
  if (!SLUG.test(company.slug)) return json({ error: "Board slug should be the last part of the job board URL, e.g. baseten" }, 400);
  if (!company.name || company.name.length > 100) return json({ error: "Name is required (at most 100 characters)" }, 400);
  if (!CATEGORY.test(company.category) || company.category.length > 50) return json({ error: "Category is required" }, 400);

  const key = companyKey(company);
  const existing = await env.DB.prepare("SELECT name, enabled FROM companies WHERE key = ?1")
    .bind(key)
    .first<{ name: string; enabled: number }>();
  if (existing) {
    const state = existing.enabled ? "already being polled" : "already in the list but paused; resume it there";
    return json({ error: `${existing.name} (${key}) is ${state}` }, 409);
  }

  // Catch a mistyped slug now rather than as a failed poll tomorrow.
  let probe: { ok: boolean; status: number };
  try {
    probe = await probeBoard(company);
  } catch (err) {
    return json({ error: `Couldn't reach the ${ATS_NAMES[ats]} API: ${err instanceof Error ? err.message : err}` }, 502);
  }
  if (!probe.ok) {
    const why = probe.status === 404 ? "no such board" : `HTTP ${probe.status}`;
    return json({ error: `No ${ATS_NAMES[ats]} job board found at "${company.slug}" (${why})` }, 422);
  }

  if (!(await addCompany(env.DB, company, new Date().toISOString()))) {
    return json({ error: `${key} already exists` }, 409);
  }
  // First poll right away instead of waiting for tomorrow's cron.
  await env.FETCH_QUEUE.send({ key } satisfies FetchMessage);
  console.log({ event: "company_added", company: key });
  const [row] = await listCompanies(env.DB, key);
  return json(row, 201);
}

async function updateCompany(env: Env, req: Request, key: string): Promise<Response> {
  const body = await readJson(req);
  if (typeof body?.enabled !== "boolean") return json({ error: "expected { enabled: boolean }" }, 400);
  const { enabled } = body;
  if (!(await setEnabled(env.DB, key, enabled))) return json({ error: "not found" }, 404);
  // Resumed: catch up now rather than at the next cron.
  if (enabled) await env.FETCH_QUEUE.send({ key } satisfies FetchMessage);
  console.log({ event: enabled ? "company_resumed" : "company_paused", company: key });
  const [row] = await listCompanies(env.DB, key);
  return json(row);
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

/**
 * Query params (all optional):
 *   q         space-separated terms, all must match (title, company, team, department, location)
 *   desc=1    also match q against the description
 *   exclude   comma-separated terms; drop titles containing any of them
 *   company   comma-separated company keys (listings of paused companies are never returned)
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
  const where: string[] = ["c.enabled = 1"];
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
           l.published_at, l.first_seen_at, l.closed_at, l.archived_at,
           count(*) OVER () AS total
    FROM listings l JOIN companies c ON c.key = l.company_key
    WHERE ${where.join(" AND ")}
    ORDER BY ${order}
    LIMIT ${limit}`;

  const { results } = await db.prepare(sql).bind(...args).all<Record<string, unknown>>();
  const total = (results[0]?.total as number | undefined) ?? 0;
  for (const r of results) delete r.total;
  return json({ total, listings: results });
}
