<script lang="ts">
  import { tick, untrack } from "svelte";
  import Filters from "./components/Filters.svelte";
  import JobRow from "./components/JobRow.svelte";
  import Stats from "./components/Stats.svelte";
  import { api } from "./lib/api";
  import { sortCompanies } from "./lib/companies";
  import { readFilters, toQuery } from "./lib/filters";
  import { dayLabel, truncate } from "./lib/format";
  import { initialSince, markAllSeen } from "./lib/seen";
  import type { Company, Listing } from "./lib/types";

  let filters = $state(readFilters(location.search));
  let companies = $state<Company[]>([]);
  let since = $state(initialSince());

  let listings = $state<Listing[]>([]);
  let total = $state(0);
  let dayKey = $state<"first_seen_at" | "published_at">("first_seen_at");
  let view = $state("inbox"); // view of the loaded listings (not the live filter)
  let loaded = $state(false); // first listings response has arrived
  let loading = $state(true);
  let loadId = $state(0); // bumped per load; re-keys the feed so rows animate in again
  let note = $state<string | null>(null); // replaces the summary until the next load
  let cursor = $state(-1);
  let expanded = $state<string[]>([]);
  let refreshing = $state(false);

  let searchInput = $state<HTMLInputElement>();
  let feedEl: HTMLElement;

  // ---------- loading ----------
  async function loadCompanies() {
    companies = sortCompanies(await api.companies());
  }

  let reqId = 0;
  async function loadListings(query = toQuery(filters), { keepCursor = false } = {}) {
    const id = ++reqId;
    loading = true;
    note = null;
    const data = await api.listings(query);
    if (id !== reqId) return; // a newer request superseded this one
    const p = new URLSearchParams(query);
    listings = data.listings;
    total = data.total;
    dayKey = p.get("sort") === "posted" ? "published_at" : "first_seen_at";
    view = p.get("view") ?? "inbox";
    cursor = keepCursor ? Math.min(cursor, listings.length - 1) : -1;
    expanded = [];
    loaded = true;
    loading = false;
    loadId++;
  }

  loadCompanies();

  // Filters -> URL + listings. First run loads immediately; later changes are
  // debounced so typing in the search box doesn't fire a request per key.
  let firstRun = true;
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const query = toQuery(filters);
    if (firstRun) {
      firstRun = false;
      untrack(() => loadListings(query));
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      history.replaceState(null, "", query ? `?${query}` : location.pathname);
      loadListings(query);
    }, 200);
  });

  // ---------- derived view ----------
  const isNew = (l: Listing) => l.first_seen_at > since && !l.closed_at;
  const newCount = $derived(loaded ? listings.filter(isNew).length : null);

  const days = $derived.by(() => {
    const out: { label: string; rows: { l: Listing; i: number }[] }[] = [];
    listings.forEach((l, i) => {
      const at = l[dayKey];
      const label = at ? dayLabel(at) : "Undated";
      const last = out.at(-1);
      if (last?.label === label) last.rows.push({ l, i });
      else out.push({ label, rows: [{ l, i }] });
    });
    return out;
  });

  const summary = $derived.by(() => {
    if (loading) return "Loading…";
    if (note) return note;
    const shown = listings.length < total ? `${listings.length} of ${total}` : total;
    return `${shown} role${total === 1 ? "" : "s"}`;
  });

  // ---------- archiving ----------
  // Optimistic: rows update (or leave the inbox/archived view) immediately and
  // are put back if the request fails. Undo lasts as long as the toast.
  let toast = $state<{ text: string; undo: boolean } | null>(null);
  let lastAction: { ids: string[]; archived: boolean } | null = null;
  let toastTimer: ReturnType<typeof setTimeout>;

  function showToast(text: string, undo = false) {
    toast = { text, undo };
    if (!undo) lastAction = null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = null;
      lastAction = null;
    }, 8000);
  }

  async function setArchived(items: Listing[], archived: boolean) {
    items = items.filter((l) => !!l.archived_at !== archived);
    if (!items.length) return;
    const ids = items.map((l) => l.id);
    const before = { listings, total, cursor, expanded, stamps: items.map((l) => l.archived_at) };

    const stamp = archived ? new Date().toISOString() : null;
    for (const l of items) l.archived_at = stamp;
    // In the inbox or archived view the rows no longer match, so they leave;
    // the cursor stays put, landing on the next row.
    const leaves = view !== "all";
    if (leaves) {
      const gone = new Set(ids);
      listings = listings.filter((l) => !gone.has(l.id));
      total -= items.length;
      expanded = expanded.filter((id) => !gone.has(id));
      cursor = Math.min(cursor, listings.length - 1);
    }

    try {
      await api.archive(ids, archived);
    } catch (err) {
      items.forEach((l, i) => (l.archived_at = before.stamps[i]));
      ({ listings, total, cursor, expanded } = before);
      const reason = err instanceof Error ? err.message : String(err);
      showToast(`Couldn't ${archived ? "archive" : "unarchive"} (${reason}). If your sign-in expired, reload.`);
      return;
    }

    lastAction = { ids, archived };
    const what = items.length === 1 ? `“${truncate(items[0].title, 60)}”` : `${items.length} roles`;
    showToast(`${archived ? "Archived" : "Unarchived"} ${what}`, true);
    // Emptied the page but more match (the list is capped): fetch the next lot.
    if (leaves && !listings.length && total > 0) loadListings();
  }

  async function undo() {
    if (!lastAction) return;
    const { ids, archived } = lastAction;
    lastAction = null;
    toast = null;
    try {
      await api.archive(ids, !archived);
    } catch (err) {
      showToast(`Couldn't undo (${err instanceof Error ? err.message : err}). If your sign-in expired, reload.`);
      return;
    }
    await loadListings(undefined, { keepCursor: true }); // brings the rows back in place
    showToast("Undone");
  }

  function archiveAllShown() {
    const archiving = view !== "archived";
    const items = listings.filter((l) => !!l.archived_at !== archiving);
    if (!items.length) return;
    const verb = archiving ? "Archive" : "Unarchive";
    if (confirm(`${verb} all ${items.length} role${items.length === 1 ? "" : "s"} shown? You can undo this.`)) {
      setArchived(items, archiving);
    }
  }

  // ---------- interaction ----------
  async function setCursor(i: number) {
    cursor = Math.max(0, Math.min(i, listings.length - 1));
    await tick();
    feedEl.querySelectorAll(".job")[cursor]?.scrollIntoView({ block: "nearest" });
  }

  function toggle(id: string) {
    expanded = expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id];
  }

  function onkeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const typing = target.matches?.("input, select, textarea") ?? false;
    if (e.key === "/" && !typing) {
      e.preventDefault();
      searchInput?.focus();
      return;
    }
    if (e.key === "Escape" && typing) return target.blur();
    if (typing || e.metaKey || e.ctrlKey) return;
    const current = listings[cursor];
    if (e.key === "j") setCursor(cursor + 1);
    else if (e.key === "k") setCursor(cursor - 1);
    else if (e.key === "Enter" && current) toggle(current.id);
    else if (e.key === "o" && current) window.open(current.url, "_blank", "noopener");
    else if (e.key === "e" && current) setArchived([current], !current.archived_at);
    else if (e.key === "z") undo();
  }

  function onMarkSeen() {
    since = markAllSeen();
    loadListings();
  }

  async function onRefresh() {
    refreshing = true;
    try {
      const { queued } = await api.refresh();
      note = `Polling ${queued} companies — results land over the next minute or two.`;
      setTimeout(async () => {
        await loadCompanies();
        await loadListings();
      }, 30_000);
    } finally {
      setTimeout(() => (refreshing = false), 30_000);
    }
  }
</script>

<svelte:window {onkeydown} />

<header class="masthead">
  <div class="brand">
    <h1>role<span>—</span>feed</h1>
    <p class="tagline">Inference &amp; infrastructure openings, wired daily.</p>
  </div>
  <Stats {companies} {newCount} />
</header>

<div class="layout">
  <aside class="rail">
    <Filters bind:filters {companies} bind:searchInput />
  </aside>

  <main>
    <div class="toolbar">
      <p>{summary}</p>
      <div class="actions">
        <button
          type="button"
          title={view === "archived" ? "Move every role shown back to the inbox" : "Hide every role shown from the inbox"}
          disabled={loading || !listings.some((l) => !!l.archived_at === (view === "archived"))}
          onclick={archiveAllShown}
        >
          {view === "archived" ? "Unarchive all shown" : "Archive all shown"}
        </button>
        <button type="button" title="Clear the NEW markers" onclick={onMarkSeen}>Mark all seen</button>
        <button type="button" title="Re-poll every company now" disabled={refreshing} onclick={onRefresh}>
          {refreshing ? "Queued…" : "Refresh now"}
        </button>
      </div>
    </div>

    <div class="feed" bind:this={feedEl}>
      {#key loadId}
        {#if loaded && !listings.length}
          <p class="empty">Nothing on the wire matching that.</p>
        {/if}
        {#each days as day, d (d)}
          <h3 class="day">{day.label} <small>{day.rows.length} role{day.rows.length === 1 ? "" : "s"}</small></h3>
          {#each day.rows as { l, i } (l.id)}
            <JobRow
              listing={l}
              index={i}
              isNew={isNew(l)}
              cursor={i === cursor}
              open={expanded.includes(l.id)}
              q={filters.q}
              onselect={() => {
                setCursor(i);
                toggle(l.id);
              }}
              onarchive={() => setArchived([l], !l.archived_at)}
            />
          {/each}
        {/each}
      {/key}
    </div>

    <p class="hint">
      Keys: <kbd>/</kbd> search · <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>enter</kbd> expand · <kbd>o</kbd> open posting ·
      <kbd>e</kbd> archive · <kbd>z</kbd> undo
    </p>
  </main>
</div>

<div class="toast-region" role="status" aria-live="polite">
  {#if toast}
    <div class="toast">
      <span>{toast.text}</span>
      {#if toast.undo}<button type="button" onclick={undo}>Undo <kbd>z</kbd></button>{/if}
    </div>
  {/if}
</div>
