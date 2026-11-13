// "New since last visit". `since` is fixed for the whole browser session so
// reloads keep the NEW markers; the next session compares against this visit.

export function initialSince(): string {
  let since = sessionStorage.getItem("since");
  if (!since) {
    since = localStorage.getItem("lastVisit") ?? new Date().toISOString();
    sessionStorage.setItem("since", since);
  }
  localStorage.setItem("lastVisit", new Date().toISOString());
  return since;
}

/** Clear the NEW markers: everything seen so far counts as seen. */
export function markAllSeen(): string {
  const now = new Date().toISOString();
  sessionStorage.setItem("since", now);
  localStorage.setItem("lastVisit", now);
  return now;
}
