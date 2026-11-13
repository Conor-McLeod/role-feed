import type { Company, Listing, ListingDetail, NewCompany } from "./types";

// Throws with the API's error message, or the HTTP status if there isn't one.
async function send<T>(method: string, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

const get = async <T>(url: string): Promise<T> => (await fetch(url)).json();

export const api = {
  companies: () => get<Company[]>("/api/companies"),
  addCompany: (c: NewCompany) => send<Company>("POST", "/api/companies", c),
  setCompanyEnabled: (key: string, enabled: boolean) =>
    send<Company>("PATCH", `/api/companies/${encodeURIComponent(key)}`, { enabled }),
  listings: (query: string) => get<{ total: number; listings: Listing[] }>(`/api/listings?${query}`),
  listing: (id: string) => get<ListingDetail>(`/api/listings/${encodeURIComponent(id)}`),
  refresh: async (): Promise<{ queued: number }> => (await fetch("/api/refresh", { method: "POST", headers: { "Content-Type": "application/json" } })).json(),
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
