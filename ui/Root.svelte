<script lang="ts">
  import App from "./App.svelte";
  import Companies from "./Companies.svelte";

  // Two pages. The roles feed keeps its filters in the query string, so the
  // companies page lives in the hash and going back restores the filters.
  type Page = "roles" | "companies";
  const current = (): Page => (location.hash === "#companies" ? "companies" : "roles");
  let page = $state<Page>(current());

  function go(e: MouseEvent, to: Page) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let new-tab clicks through
    e.preventDefault();
    if (to === page) return;
    history.pushState(null, "", to === "companies" ? "#companies" : location.pathname + location.search);
    page = to;
    scrollTo(0, 0);
  }

  const PAGES = [
    ["roles", "Roles", "./"],
    ["companies", "Companies", "#companies"],
  ] as const;
</script>

<svelte:window onpopstate={() => (page = current())} onhashchange={() => (page = current())} />

<header class="topbar">
  <a class="brand" href="/"><span class="logo" aria-hidden="true"></span>role-feed</a>
  <nav class="pages" aria-label="Pages">
    {#each PAGES as [value, label, href] (value)}
      <a {href} aria-current={page === value ? "page" : undefined} onclick={(e) => go(e, value)}>{label}</a>
    {/each}
  </nav>
  <span class="crumb">Inference &amp; infrastructure openings, wired daily</span>
</header>

{#if page === "companies"}
  <Companies />
{:else}
  <App />
{/if}
