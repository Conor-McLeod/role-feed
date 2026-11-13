export const ATS = ["ashby", "greenhouse", "gem", "lever"] as const;
export type Ats = (typeof ATS)[number];

export interface Company {
  category: string;
  name: string;
  ats: Ats;
  slug: string;
}

/** A job posting normalised across job boards. */
export interface Listing {
  id: string; // "<ats>:<slug>:<job id>"
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
  description: string | null;
}

export interface FetchMessage {
  key: string; // company key, "<ats>:<slug>"
}

export const companyKey = (c: Pick<Company, "ats" | "slug">) => `${c.ats}:${c.slug}`;
