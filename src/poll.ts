import { companyHealth } from "./health";
import { fetchListings } from "./sources";
import { markAttempt, openCount, saveListings } from "./store";
import { companyKey, type Company, type FetchMessage } from "./types";

// If a board that had several open roles suddenly returns none, assume a
// glitch on their side rather than closing everything.
const SUSPICIOUS_EMPTY = 3;

/** Queue one fetch per enabled company. */
export async function enqueueAll(env: Env): Promise<number> {
  const { results } = await env.DB.prepare("SELECT key FROM companies WHERE enabled = 1").all<{ key: string }>();
  const messages = results.map(({ key }) => ({ body: { key } satisfies FetchMessage }));
  for (let i = 0; i < messages.length; i += 100) {
    await env.FETCH_QUEUE.sendBatch(messages.slice(i, i + 100));
  }
  return messages.length;
}

/** Fetch one company's board and write the changes. */
export async function pollCompany(env: Env, company: Company) {
  const key = companyKey(company);
  const now = new Date().toISOString();
  await markAttempt(env.DB, key, now);
  const { listings, bytes, fetch_ms } = await fetchListings(company);
  if (listings.length === 0 && (await openCount(env.DB, key)) >= SUSPICIOUS_EMPTY) {
    throw new Error("board returned 0 jobs; not closing existing listings");
  }
  const counts = await saveListings(env.DB, key, listings, now);
  console.log({ event: "poll", company: key, open: listings.length, ...counts, bytes, fetch_ms });
}

/** Log a warning for every polled company whose last poll didn't succeed. Runs before each daily poll. */
export async function logUnhealthy(env: Env) {
  const { results } = await env.DB.prepare(
    "SELECT key, last_attempt_at, last_success_at, last_error FROM companies WHERE enabled = 1",
  ).all<{ key: string; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null }>();
  const now = Date.now();
  let unhealthy = 0;
  for (const { key, ...status } of results) {
    const health = companyHealth(status, now);
    if (health === "ok" || health === "pending") continue;
    unhealthy++;
    console.warn({ event: "company_unhealthy", company: key, health, ...status });
  }
  return unhealthy;
}
