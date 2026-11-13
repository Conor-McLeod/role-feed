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
      ["Companies", companies.length],
      ["Open roles", open.toLocaleString()],
      ...(newCount != null ? [["New in view", newCount, newCount ? "hot" : ""]] : []),
      ["Last poll", last ? ago(last) : "never"],
      ...(failing ? [["Failing", failing, "hot"]] : []),
    ] as [string, string | number, string?][];
  });
</script>

<dl class="stats" aria-live="polite">
  {#if companies.length}
    {#each items as [label, value, cls = ""] (label)}
      <div class={cls}><dt>{label}</dt><dd>{value}</dd></div>
    {/each}
  {/if}
</dl>
