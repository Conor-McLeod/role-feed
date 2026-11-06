// D1 writes. The free plan allows 50 queries per invocation and 100 bound
// parameters per query, so listings go in as JSON blobs expanded with
// json_each(): a few queries per company regardless of how many jobs it has.

import type { Company, Listing } from "./types";
import { companyKey } from "./types";

const CHUNK_CHARS = 900_000; // stay under D1's 2 MB per-value limit

const LISTING_COLS = [
  "title", "department", "team", "location", "locations", "remote", "workplace",
  "employment", "compensation", "url", "published_at", "description",
] as const;

export async function syncCompanies(db: D1Database, companies: Company[]) {
  const rows = JSON.stringify(companies.map((c) => ({ ...c, key: companyKey(c) })));
  await db
    .prepare(
      `INSERT INTO companies (key, name, category, ats, slug)
       SELECT json_extract(value, '$.key'), json_extract(value, '$.name'),
              json_extract(value, '$.category'), json_extract(value, '$.ats'),
              json_extract(value, '$.slug')
       FROM json_each(?1) WHERE true
       ON CONFLICT (key) DO UPDATE SET name = excluded.name, category = excluded.category
       WHERE companies.name IS NOT excluded.name OR companies.category IS NOT excluded.category`,
    )
    .bind(rows)
    .run();
}

/**
 * Upsert a company's current listings and close anything no longer listed.
 * Only new, changed, closed or reopened rows are written.
 */
export async function saveListings(db: D1Database, key: string, listings: Listing[], now: string) {
  const cols = LISTING_COLS.join(", ");
  const extract = LISTING_COLS.map((c) => `json_extract(value, '$.${c}')`).join(", ");
  const changed = LISTING_COLS.map((c) => `listings.${c} IS NOT excluded.${c}`).join(" OR ");
  const update = LISTING_COLS.map((c) => `${c} = excluded.${c}`).join(", ");

  const upsert = db.prepare(
    `INSERT INTO listings (id, company_key, ${cols}, first_seen_at, updated_at)
     SELECT json_extract(value, '$.id'), ?2, ${extract}, ?3, ?3
     FROM json_each(?1) WHERE true
     ON CONFLICT (id) DO UPDATE SET ${update}, updated_at = excluded.updated_at, closed_at = NULL
     WHERE listings.closed_at IS NOT NULL OR ${changed}`,
  );

  const statements = chunk(listings).map((json) => upsert.bind(json, key, now));

  statements.push(
    db
      .prepare(
        `UPDATE listings SET closed_at = ?3, updated_at = ?3
         WHERE company_key = ?1 AND closed_at IS NULL
           AND id NOT IN (SELECT value FROM json_each(?2))`,
      )
      .bind(key, JSON.stringify(listings.map((l) => l.id)), now),
    db
      .prepare(
        `UPDATE companies SET last_attempt_at = ?2, last_success_at = ?2, last_error = NULL,
           open_count = (SELECT count(*) FROM listings WHERE company_key = ?1 AND closed_at IS NULL)
         WHERE key = ?1`,
      )
      .bind(key, now),
  );

  await db.batch(statements);
}

export async function openCount(db: D1Database, key: string): Promise<number> {
  const row = await db.prepare("SELECT open_count FROM companies WHERE key = ?1").bind(key).first<number>("open_count");
  return row ?? 0;
}

export async function recordError(db: D1Database, key: string, error: string, now: string) {
  await db
    .prepare("UPDATE companies SET last_attempt_at = ?2, last_error = ?3 WHERE key = ?1")
    .bind(key, now, error.slice(0, 500))
    .run();
}

// Split listings into JSON arrays no larger than CHUNK_CHARS.
function chunk(listings: Listing[]): string[] {
  const out: string[] = [];
  let parts: string[] = [];
  let size = 0;
  for (const l of listings) {
    const s = JSON.stringify(l);
    if (size + s.length > CHUNK_CHARS && parts.length) {
      out.push(`[${parts.join(",")}]`);
      parts = [];
      size = 0;
    }
    parts.push(s);
    size += s.length + 1;
  }
  if (parts.length) out.push(`[${parts.join(",")}]`);
  return out;
}
