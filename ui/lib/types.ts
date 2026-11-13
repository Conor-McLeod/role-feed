// Shapes returned by the Worker's /api/* routes (see src/api.ts).

export type Health = "ok" | "pending" | "failed" | "interrupted" | "stale";

export interface Company {
  key: string;
  name: string;
  category: string;
  ats: string;
  slug: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  open_count: number;
  enabled: boolean; // false: paused, not polled and hidden from the feed
  added_at: string | null; // null for companies seeded from the old companies.json
  health: Health | null; // null while paused
}

export type Ats = "ashby" | "greenhouse" | "gem" | "lever";

export interface NewCompany {
  name: string;
  category: string;
  ats: Ats;
  slug: string;
}

export interface Listing {
  id: string;
  company_key: string;
  company: string;
  category: string;
  title: string;
  department: string | null;
  team: string | null;
  location: string | null;
  locations: string | null;
  remote: 0 | 1;
  workplace: "remote" | "hybrid" | "onsite" | null;
  employment: string | null;
  compensation: string | null;
  url: string;
  published_at: string | null;
  first_seen_at: string;
  closed_at: string | null;
  archived_at: string | null;
}

export interface ListingDetail extends Listing {
  description: string | null;
}
