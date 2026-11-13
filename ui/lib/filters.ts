// Filter state <-> URL query string. The same query string is sent to
// /api/listings and mirrored into the page URL, so filtered views can be
// bookmarked. Defaults are left out of the URL.

export interface Filters {
  q: string;
  desc: boolean;
  exclude: string;
  location: string;
  remote: boolean;
  posted: string; // "" | days
  status: string; // open | closed | all
  view: string; // inbox | archived | all
  sort: string; // seen | posted
  categories: string[];
  companies: string[];
}

export function readFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  const list = (k: string) => (p.get(k) ?? "").split(",").filter(Boolean);
  return {
    q: p.get("q") ?? "",
    desc: p.get("desc") === "1",
    exclude: p.get("exclude") ?? "",
    location: p.get("location") ?? "",
    remote: p.get("remote") === "1",
    posted: p.get("posted") ?? "",
    status: p.get("status") ?? "open",
    view: p.get("view") ?? "inbox",
    sort: p.get("sort") ?? "seen",
    categories: list("category"),
    companies: list("company"),
  };
}

export function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  const text = (k: string, v: string, fallback = "") => {
    const t = v.trim();
    if (t && t !== fallback) p.set(k, t);
  };
  text("q", f.q);
  if (f.desc) p.set("desc", "1");
  text("exclude", f.exclude);
  text("location", f.location);
  if (f.remote) p.set("remote", "1");
  text("posted", f.posted);
  text("status", f.status, "open");
  text("view", f.view, "inbox");
  text("sort", f.sort, "seen");
  if (f.categories.length) p.set("category", f.categories.join(","));
  if (f.companies.length) p.set("company", f.companies.join(","));
  return p.toString();
}
