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
</script>

<!-- Keyboard access is the page-level j/k/enter handler in App.svelte. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article
  class="job"
  class:new={isNew}
  class:closed={!!l.closed_at}
  class:archived={!!l.archived_at}
  class:cursor
  style:--i={index}
  data-index={index}
  {onclick}
>
  <div class="co" title={l.company}>{l.company}</div>
  <div class="title-wrap"><a class="title" href={l.url} target="_blank" rel="noopener">{l.title}</a>{#if isNew}<span class="badge">NEW</span>{/if}</div>
  <div class="when">
    <span title="Posted {l.published_at ?? '?'} · first seen {l.first_seen_at}">
      {l.published_at ? ago(l.published_at) : "–"}
    </span>
    <button
      type="button"
      class="link archive"
      title={l.archived_at ? "Move back to the inbox (e)" : "Hide from the inbox (e)"}
      onclick={onarchive}
    >
      {l.archived_at ? "unarchive" : "archive"}
    </button>
  </div>
  <div class="meta">
    {#if l.locations}<span>{truncate(l.locations, 90)}</span>{/if}
    {#if l.remote}<span class="remote">remote ok</span>{:else if l.workplace}<span>{l.workplace}</span>{/if}
    {#if l.team || l.department}<span>{l.team || l.department}</span>{/if}
    {#if l.employment && !/full/.test(l.employment)}<span>{l.employment}</span>{/if}
    {#if l.compensation}<span class="comp">{l.compensation}</span>{/if}
    {#if l.closed_at}<span>closed {ago(l.closed_at)}</span>{/if}
    {#if l.archived_at}<span>archived {ago(l.archived_at)}</span>{/if}
  </div>
  {#if open}
    <div class="detail">
      {#if detail}
        <div class="links"><a href={detail.url} target="_blank" rel="noopener">Open posting ↗</a></div>
        <!-- Escaped first, then only <mark> tags are added. -->
        <div class="desc">{@html highlight(esc(detail.description ?? "No description provided."), q)}</div>
      {:else}
        <p class="desc">Loading…</p>
      {/if}
    </div>
  {/if}
</article>
