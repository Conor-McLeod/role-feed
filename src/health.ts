// Per-company fetch health, derived from the timestamps in `companies`.

export type Health = "ok" | "pending" | "failed" | "interrupted" | "stale";

export interface CompanyStatus {
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

// Polls run once a day; allow for a late or retried run before calling it stale.
const STALE_MS = 36 * 3600_000;
// A queue consumer can run for up to 15 minutes, so an attempt newer than this
// with no outcome may still be in progress.
const IN_FLIGHT_MS = 15 * 60_000;

export function companyHealth(c: CompanyStatus, now = Date.now()): Health {
  if (c.last_error) return "failed";
  if (!c.last_attempt_at) return "pending";
  const attempt = Date.parse(c.last_attempt_at);
  const success = c.last_success_at ? Date.parse(c.last_success_at) : null;
  // Started but never finished and never recorded an error: the invocation was
  // killed (most likely the CPU limit) before it could write anything.
  if ((success == null || attempt > success) && now - attempt > IN_FLIGHT_MS) return "interrupted";
  if (success == null) return "pending";
  if (now - success > STALE_MS) return "stale";
  return "ok";
}
