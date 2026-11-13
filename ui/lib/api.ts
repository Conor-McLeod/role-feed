import type { Company, Listing, ListingDetail } from "./types";

const get = async <T>(url: string): Promise<T> => (await fetch(url)).json();

export const api = {
  companies: () => get<Company[]>("/api/companies"),
  listings: (query: string) => get<{ total: number; listings: Listing[] }>(`/api/listings?${query}`),
  listing: (id: string) => get<ListingDetail>(`/api/listings/${encodeURIComponent(id)}`),
  refresh: async (): Promise<{ queued: number }> => (await fetch("/api/refresh", { method: "POST" })).json(),
};
