<script lang="ts">
  import { healthProblem } from "../lib/companies";
  import { ago } from "../lib/format";
  import type { Company } from "../lib/types";

  // newCount is null until the first listings load.
  let { companies, newCount }: { companies: Company[]; newCount: number | null } = $props();

  const items = $derived.by(() => {
    const open = companies.reduce((n, c) => n + (c.open_count ?? 0), 0);
    const failing = companies.filter(healthProblem).length;
    const last = companies
      .map((c) => c.last_success_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    return [
      ["Companies tracked", companies.length],
      ["Open roles", open.toLocaleString()],
      ...(newCount != null ? [["New in view", newCount, newCount ? "new" : ""]] : []),
      ["Last poll", last ? ago(last) : "never"],
      ["Failing polls", failing, failing ? "bad" : "good"],
    ] as [string, string | number, string?][];
  });
</script>

<section class="card overview">
  <h2>Overview</h2>
  <dl aria-live="polite">
    {#if companies.length}
      {#each items as [label, value, cls = ""] (label)}
        <div class={cls}><dt>{label}</dt><dd>{value}</dd></div>
      {/each}
    {:else}
      <div><dt>Loading…</dt><dd></dd></div>
    {/if}
  </dl>
</section>
