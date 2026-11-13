<script lang="ts">
  import { tick, untrack } from "svelte";
  import Filters from "./components/Filters.svelte";
  import JobRow from "./components/JobRow.svelte";
  import Stats from "./components/Stats.svelte";
  import { api } from "./lib/api";
  import { sortCompanies } from "./lib/companies";
  import { readFilters, toQuery } from "./lib/filters";
  import { dayLabel } from "./lib/format";
  import { initialSince, markAllSeen } from "./lib/seen";
  import type { Company, Listing } from "./lib/types";

  let filters = $state(readFilters(location.search));
  let companies = $state<Company[]>([]);
  let since = $state(initialSince());

  let listings = $state<Listing[]>([]);
  let total = $state(0);
  let dayKey = $state<"first_seen_at" | "published_at">("first_seen_at");
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
  async function loadListings(query = toQuery(filters)) {
    const id = ++reqId;
    loading = true;
    note = null;
    const data = await api.listings(query);
    if (id !== reqId) return; // a newer request superseded this one
    listings = data.listings;
    total = data.total;
    dayKey = new URLSearchParams(query).get("sort") === "posted" ? "published_at" : "first_seen_at";
    cursor = -1;
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
            />
          {/each}
        {/each}
      {/key}
    </div>

    <p class="hint">
      Keys: <kbd>/</kbd> search · <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>enter</kbd> expand · <kbd>o</kbd> open posting
    </p>
  </main>
</div>
