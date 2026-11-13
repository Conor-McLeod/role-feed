<script lang="ts">
  import { categoryLabel, healthProblem } from "../lib/companies";
  import type { Filters } from "../lib/filters";
  import type { Company } from "../lib/types";

  // Search, view (inbox/archived/all) and sort live in the main pane: the
  // search bar, the tabs and the table's column headers respectively.
  let { filters = $bindable(), companies }: { filters: Filters; companies: Company[] } = $props();

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
  <p class="section">Filter</p>

  <label class="field">
    <span>Exclude titles containing</span>
    <input name="exclude" type="text" placeholder="sales, recruiter, intern" bind:value={filters.exclude} />
  </label>

  <label class="field">
    <span>Location</span>
    <input name="location" type="text" placeholder="San Francisco" bind:value={filters.location} />
  </label>
  <label class="check"><input name="remote" type="checkbox" bind:checked={filters.remote} /> Remote-friendly only</label>

  <div class="row2">
    <label class="field">
      <span>Posted within</span>
      <select name="posted" bind:value={filters.posted}>
        <option value="">Any time</option>
        <option value="1">1 day</option>
        <option value="7">7 days</option>
        <option value="30">30 days</option>
        <option value="90">90 days</option>
      </select>
    </label>
    <label class="field">
      <span>Status</span>
      <select name="status" bind:value={filters.status}>
        <option value="open">Open</option>
        <option value="closed">Closed</option>
        <option value="all">All</option>
      </select>
    </label>
  </div>

  <p class="section">
    Category
    {#if filters.categories.length}<button type="button" class="link" onclick={() => (filters.categories = [])}>Clear</button>{/if}
  </p>
  <ul class="nav">
    {#each categories as cat (cat)}
      <li>
        <button
          type="button"
          class="nav-item"
          aria-pressed={filters.categories.includes(cat)}
          onclick={() => (filters.categories = toggled(filters.categories, cat))}
        >
          {categoryLabel(cat)}
        </button>
      </li>
    {/each}
  </ul>

  <p class="section">
    Companies
    {#if filters.companies.length}<button type="button" class="link" onclick={() => (filters.companies = [])}>Clear</button>{/if}
  </p>
  <ul class="companies">
    {#each groups as g (g.category)}
      <h4>{categoryLabel(g.category)}</h4>
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
</form>
