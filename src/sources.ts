// Adapters for each job board's public postings API. Each one turns the
// board's JSON into normalised Listings.

import type { Ats, Company, Listing } from "./types";

// Ashby rejects requests without a User-Agent.
const USER_AGENT = "role-feed/1.0 (personal job feed)";
const MAX_DESCRIPTION = 20_000;

export interface FetchResult {
  listings: Listing[];
  bytes: number; // response body size, in UTF-16 code units
  fetch_ms: number; // network time; Date.now() only advances across I/O in Workers
}

export async function fetchListings(company: Company): Promise<FetchResult> {
  const start = Date.now();
  const res = await fetch(SOURCES[company.ats].url(company.slug), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${company.ats}/${company.slug}: HTTP ${res.status}`);
  const body = await res.text();
  const fetch_ms = Date.now() - start;
  const prefix = `${company.ats}:${company.slug}:`;
  const listings = SOURCES[company.ats]
    .parse(JSON.parse(body))
    .map((l) => ({ ...l, id: prefix + l.id, published_at: toUtc(l.published_at) }));
  return { listings, bytes: body.length, fetch_ms };
}

/**
 * Check that a board exists without parsing it (a big board's JSON.parse can
 * cost more CPU than a request handler gets). All four APIs answer 404 for an
 * unknown slug.
 */
export async function probeBoard(company: Pick<Company, "ats" | "slug">): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(SOURCES[company.ats].url(company.slug), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  await res.body?.cancel();
  return { ok: res.ok, status: res.status };
}

interface Source {
  url(slug: string): string;
  parse(data: any): Listing[]; // ids are the board's own job id; prefixed by caller
}

const SOURCES: Record<Ats, Source> = {
  ashby: {
    url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s)}?includeCompensation=true`,
    parse: (d) =>
      (d.jobs ?? [])
        .filter((j: any) => j.isListed !== false)
        .map((j: any): Listing => {
          const workplace = normWorkplace(j.workplaceType);
          const all = [j.location, ...(j.secondaryLocations ?? []).map((l: any) => l.location)];
          return {
            id: String(j.id),
            title: j.title,
            department: j.department || null,
            team: j.team || null,
            location: j.location || null,
            locations: joinLocations(all),
            remote: flag(workplace === "remote" || j.isRemote || mentionsRemote(all)),
            workplace,
            employment: normEmployment(j.employmentType),
            compensation: j.compensation?.compensationTierSummary || null,
            url: j.jobUrl,
            published_at: j.publishedAt ?? null,
            description: cap(j.descriptionPlain),
          };
        }),
  },

  greenhouse: {
    url: (s) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s)}/jobs?content=true`,
    parse: (d) => (d.jobs ?? []).map(greenhouseLike),
  },

  // Gem's public job board API returns Greenhouse-shaped postings, plus a
  // plain-text body and a location_type.
  gem: {
    url: (s) => `https://api.gem.com/job_board/v0/${encodeURIComponent(s)}/job_posts/`,
    parse: (d) => (Array.isArray(d) ? d : []).map(greenhouseLike),
  },

  lever: {
    url: (s) => `https://api.lever.co/v0/postings/${encodeURIComponent(s)}?mode=json`,
    parse: (d) =>
      (Array.isArray(d) ? d : []).map((j: any): Listing => {
        const c = j.categories ?? {};
        const all = c.allLocations?.length ? c.allLocations : [c.location];
        const workplace = normWorkplace(j.workplaceType);
        return {
          id: String(j.id),
          title: j.text,
          department: c.department || null,
          team: c.team || null,
          location: c.location || null,
          locations: joinLocations(all),
          remote: flag(workplace === "remote" || mentionsRemote(all)),
          workplace,
          employment: c.commitment || null,
          compensation: leverSalary(j.salaryRange),
          url: j.hostedUrl,
          published_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
          description: cap(j.descriptionPlain),
        };
      }),
  },
};

function greenhouseLike(j: any): Listing {
  const offices: string[] = (j.offices ?? []).map((o: any) => o.location?.name ?? o.name);
  const all = [j.location?.name, ...offices];
  // Greenhouse has no workplace field; Gem has location_type.
  const workplace = normWorkplace(j.location_type) ?? (mentionsRemote([j.location?.name]) ? "remote" : null);
  return {
    id: String(j.id),
    title: j.title,
    department: j.departments?.[0]?.name || null,
    team: null,
    location: j.location?.name || null,
    locations: joinLocations(all),
    remote: flag(workplace === "remote" || mentionsRemote(all)),
    workplace,
    employment: normEmployment(j.employment_type),
    compensation: null,
    url: j.absolute_url,
    published_at: j.first_published_at ?? j.first_published ?? j.updated_at ?? null,
    description: cap(j.content_plain ?? htmlToText(j.content)),
  };
}

// --- helpers ---------------------------------------------------------------

// Boards report local offsets (e.g. -04:00); store UTC ISO so strings sort.
function toUtc(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const flag = (b: unknown): 0 | 1 => (b ? 1 : 0);

const mentionsRemote = (locs: (string | null | undefined)[]) => locs.some((l) => l && /remote/i.test(l));

function joinLocations(locs: (string | null | undefined)[]): string | null {
  const uniq = [...new Set(locs.filter((l): l is string => !!l?.trim()).map((l) => l.trim()))];
  return uniq.length ? uniq.join(" · ") : null;
}

function normWorkplace(v: unknown): Listing["workplace"] {
  const s = String(v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (s === "remote") return "remote";
  if (s === "hybrid") return "hybrid";
  if (s === "onsite" || s === "inoffice" || s === "office") return "onsite";
  return null;
}

// "FullTime" / "full_time" -> "full-time"
function normEmployment(v: unknown): string | null {
  if (!v || typeof v !== "string") return null;
  return v.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
}

function leverSalary(r: any): string | null {
  if (!r || (r.min == null && r.max == null)) return null;
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
  const cur = r.currency === "USD" || !r.currency ? "$" : `${r.currency} `;
  const range = [r.min, r.max].filter((n) => n != null).map((n) => cur + fmt(n)).join(" – ");
  const per = r.interval?.includes("hour") ? " /hr" : "";
  return range + per;
}

function cap(s: unknown): string | null {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  return t.length > MAX_DESCRIPTION ? t.slice(0, MAX_DESCRIPTION) + "…" : t;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Greenhouse sends entity-escaped HTML; decode, then drop tags.
function htmlToText(html: unknown): string | null {
  if (!html || typeof html !== "string") return null;
  return decodeEntities(
    decodeEntities(html)
      .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}
