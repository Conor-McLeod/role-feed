<script lang="ts">
  import { CATEGORY_LABELS, healthProblem } from "../lib/companies";
  import type { Filters } from "../lib/filters";
  import type { Company } from "../lib/types";

  let {
    filters = $bindable(),
    companies,
    searchInput = $bindable(),
  }: { filters: Filters; companies: Company[]; searchInput?: HTMLInputElement } = $props();

  const categories = $derived([...new Set(companies.map((c) => c.category))]);

  // Companies grouped under their category (they arrive sorted by category).
  const groups = $derived.by(() => {
    const out: { category: string; companies: Company[] }[] = [];
    for (const c of companies) {
      const last = out.at(-1);
      if (last?.category === c.category) last.companies.push(c);
      else out.push({ category: c.category, companies: [c] });
    }
    return out;
  });

  const toggled = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
</script>

<form id="filters" autocomplete="off" onsubmit={(e) => e.preventDefault()}>
  <label class="field search">
    <span>Search <kbd>/</kbd></span>
    <input name="q" type="search" placeholder="inference kernels london" bind:value={filters.q} bind:this={searchInput} />
  </label>
  <label class="check"><input name="desc" type="checkbox" bind:checked={filters.desc} /> also search descriptions</label>

  <label class="field">
    <span>Exclude titles containing</span>
    <input name="exclude" type="text" placeholder="sales, recruiter, intern" bind:value={filters.exclude} />
  </label>

  <label class="field">
    <span>Location</span>
    <input name="location" type="text" placeholder="San Francisco" bind:value={filters.location} />
  </label>
  <label class="check"><input name="remote" type="checkbox" bind:checked={filters.remote} /> remote-friendly only</label>

  <div class="row2">
    <label class="field">
      <span>Posted within</span>
      <select name="posted" bind:value={filters.posted}>
        <option value="">any time</option>
        <option value="1">1 day</option>
        <option value="7">7 days</option>
        <option value="30">30 days</option>
        <option value="90">90 days</option>
      </select>
    </label>
    <label class="field">
      <span>Status</span>
      <select name="status" bind:value={filters.status}>
        <option value="open">open</option>
        <option value="closed">closed</option>
        <option value="all">all</option>
      </select>
    </label>
  </div>

  <div class="row2">
    <label class="field">
      <span>Show</span>
      <select name="view" bind:value={filters.view}>
        <option value="inbox">inbox</option>
        <option value="archived">archived</option>
        <option value="all">all</option>
      </select>
    </label>
    <label class="field">
      <span>Sort by</span>
      <select name="sort" bind:value={filters.sort}>
        <option value="seen">first seen</option>
        <option value="posted">posted date</option>
      </select>
    </label>
  </div>

  <fieldset class="field">
    <legend>Category</legend>
    <div class="chips">
      {#each categories as cat (cat)}
        <button
          type="button"
          class="chip"
          aria-pressed={filters.categories.includes(cat)}
          onclick={() => (filters.categories = toggled(filters.categories, cat))}
        >
          {CATEGORY_LABELS[cat] ?? cat}
        </button>
      {/each}
    </div>
  </fieldset>

  <fieldset class="field">
    <legend>
      Companies <button type="button" class="link" onclick={() => (filters.companies = [])}>clear</button>
    </legend>
    <ul class="companies">
      {#each groups as g (g.category)}
        <h4>{CATEGORY_LABELS[g.category] ?? g.category}</h4>
        {#each g.companies as c (c.key)}
          {@const problem = healthProblem(c)}
          <li>
            <label title={problem?.text}>
              <input
                type="checkbox"
                value={c.key}
                checked={filters.companies.includes(c.key)}
                onchange={() => (filters.companies = toggled(filters.companies, c.key))}
              />
              <span>{c.name}{#if problem}{" "}<span class="err">{problem.dot}</span>{/if}</span>
              <span class="n">{c.last_success_at ? c.open_count : "–"}</span>
            </label>
          </li>
        {/each}
      {/each}
    </ul>
  </fieldset>
</form>
