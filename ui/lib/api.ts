import type { Company, Listing, ListingDetail } from "./types";

const get = async <T>(url: string): Promise<T> => (await fetch(url)).json();

export const api = {
  companies: () => get<Company[]>("/api/companies"),
  listings: (query: string) => get<{ total: number; listings: Listing[] }>(`/api/listings?${query}`),
  listing: (id: string) => get<ListingDetail>(`/api/listings/${encodeURIComponent(id)}`),
  refresh: async (): Promise<{ queued: number }> => (await fetch("/api/refresh", { method: "POST" })).json(),
  // Throws on failure, including an expired Access session (the 302 to the
  // Access login is cross-origin, so fetch rejects).
  archive: async (ids: string[], archived: boolean): Promise<{ updated: number }> => {
    const res = await fetch("/api/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, archived }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  // Creates a page in the Notion Jobs database (or links an existing one for
  // the same posting URL). Throws with the server's reason on failure.
  addToNotion: async (id: string): Promise<{ notion_url: string; created: boolean }> => {
    const res = await fetch("/api/notion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  },
};
