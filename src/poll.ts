import companiesJson from "./companies.json";
import { fetchListings } from "./sources";
import { openCount, saveListings, syncCompanies } from "./store";
import { companyKey, type Company, type FetchMessage } from "./types";

export const COMPANIES = companiesJson as Company[];
export const BY_KEY = new Map(COMPANIES.map((c) => [companyKey(c), c]));

// If a board that had several open roles suddenly returns none, assume a
// glitch on their side rather than closing everything.
const SUSPICIOUS_EMPTY = 3;

/** Sync the company table and queue one fetch per company. */
export async function enqueueAll(env: Env): Promise<number> {
  await syncCompanies(env.DB, COMPANIES);
  const messages = COMPANIES.map((c) => ({ body: { key: companyKey(c) } satisfies FetchMessage }));
  for (let i = 0; i < messages.length; i += 100) {
    await env.FETCH_QUEUE.sendBatch(messages.slice(i, i + 100));
  }
  return messages.length;
}

/** Fetch one company's board and write the changes. */
export async function pollCompany(env: Env, company: Company) {
  const key = companyKey(company);
  const listings = await fetchListings(company);
  if (listings.length === 0 && (await openCount(env.DB, key)) >= SUSPICIOUS_EMPTY) {
    throw new Error("board returned 0 jobs; not closing existing listings");
  }
  await saveListings(env.DB, key, listings, new Date().toISOString());
  console.log(`${key}: ${listings.length} open`);
}
