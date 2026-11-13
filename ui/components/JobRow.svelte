<script lang="ts">
  import { api } from "../lib/api";
  import { ago, esc, highlight, truncate } from "../lib/format";
  import type { Listing, ListingDetail } from "../lib/types";

  let {
    listing: l,
    index,
    isNew,
    cursor,
    open,
    q,
    onselect,
    onarchive,
  }: {
    listing: Listing;
    index: number;
    isNew: boolean;
    cursor: boolean;
    open: boolean;
    q: string;
    onselect: () => void;
    onarchive: () => void; // toggles archived
  } = $props();

  // The description isn't in the list payload; fetch it each time the row opens.
  let detail = $state<ListingDetail | null>(null);
  $effect(() => {
    if (!open) return;
    const id = l.id;
    api.listing(id).then((d) => {
      if (open && l.id === id) detail = d;
    });
    return () => (detail = null);
  });

  function onclick(e: MouseEvent) {
    if ((e.target as Element).closest("a, button, .detail")) return;
    onselect();
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString();
</script>

<!-- Keyboard access is the page-level j/k/enter handler in App.svelte. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="job"
  class:new={isNew}
  class:closed={!!l.closed_at}
  class:archived={!!l.archived_at}
  class:cursor
  class:open
  style:--i={index}
  data-index={index}
  role="row"
  tabindex="-1"
  {onclick}
>
  <div class="co" role="cell" title={l.company}>{l.company}</div>
  <div class="role" role="cell">
    <div class="title-wrap">
      <a class="title" href={l.url} target="_blank" rel="noopener">{l.title}</a>
      {#if isNew}<span class="pill blue">New</span>{/if}
      {#if l.closed_at}<span class="pill grey" title="Closed {fmt(l.closed_at)}">Closed</span>{/if}
      {#if l.archived_at}<span class="pill grey" title="Archived {fmt(l.archived_at)}">Archived</span>{/if}
    </div>
    <div class="meta">
      {#if l.team || l.department}<span>{l.team || l.department}</span>{/if}
      {#if l.employment && !/full/.test(l.employment)}<span>{l.employment}</span>{/if}
      {#if l.compensation}<span class="comp">{l.compensation}</span>{/if}
    </div>
  </div>
  <div class="loc" role="cell">
    {#if l.remote}<span class="pill green">Remote</span>{:else if l.workplace}<span class="pill grey">{l.workplace}</span>{/if}
    {#if l.locations}<span class="loc-text" title={l.locations}>{truncate(l.locations, 90)}</span>{/if}
    {#if !l.locations && !l.remote && !l.workplace}<span class="none">–</span>{/if}
  </div>
  <div class="date" role="cell" data-label="Posted" title={l.published_at ? fmt(l.published_at) : "No posting date"}>
    {l.published_at ? ago(l.published_at) : "–"}
  </div>
  <div class="date" role="cell" data-label="Seen" title={fmt(l.first_seen_at)}>{ago(l.first_seen_at)}</div>
  <div class="act" role="cell">
    <button
      type="button"
      class="icon archive"
      aria-label={l.archived_at ? "Unarchive" : "Archive"}
      title={l.archived_at ? "Move back to the inbox (e)" : "Hide from the inbox (e)"}
      onclick={onarchive}
    >
      {#if l.archived_at}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12v3H2zM3 6v7h10V6M8 12V8m-2 2 2-2 2 2" /></svg>
      {:else}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12v3H2zM3 6v7h10V6M6.5 9h3" /></svg>
      {/if}
    </button>
  </div>
  {#if open}
    <div class="detail" role="cell">
      {#if detail}
        {#if l.locations}<p class="detail-loc">{l.locations}</p>{/if}
        <!-- Escaped first, then only <mark> tags are added. -->
        <div class="desc">{@html highlight(esc(detail.description ?? "No description provided."), q)}</div>
        <div class="links"><a class="btn primary" href={detail.url} target="_blank" rel="noopener">Open posting ↗</a></div>
      {:else}
        <p class="desc">Loading…</p>
      {/if}
    </div>
  {/if}
</div>
