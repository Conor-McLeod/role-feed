<script lang="ts">
  import { api } from "./lib/api";
  import { ATS_LABELS, categoryLabel, boardUrl, healthProblem, parseBoardUrl, sortCompanies } from "./lib/companies";
  import { ago } from "./lib/format";
  import type { Ats, Company } from "./lib/types";

  let companies = $state<Company[]>([]);
  let loaded = $state(false);

  async function load() {
    companies = sortCompanies(await api.companies());
    loaded = true;
  }
  load();

  const polled = $derived(companies.filter((c) => c.enabled).length);
  const categories = $derived([...new Set(companies.map((c) => c.category))]);

  // ---------- add form ----------
  const NEW_CATEGORY = "__new";
  let form = $state({ url: "", ats: "" as Ats | "", slug: "", name: "", category: "", newCategory: "" });
  let saving = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);

  // Pasting a careers-page link fills in the board and slug.
  const parsed = $derived(form.url.trim() ? parseBoardUrl(form.url) : null);
  $effect(() => {
    if (!parsed) return;
    form.ats = parsed.ats;
    form.slug = parsed.slug;
  });

  async function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!form.ats) return;
    saving = true;
    result = null;
    const category = form.category === NEW_CATEGORY ? form.newCategory : form.category;
    try {
      const added = await api.addCompany({ name: form.name, category, ats: form.ats, slug: form.slug });
      companies = sortCompanies([...companies, added]);
      result = { ok: true, text: `Added ${added.name}. Its first poll is queued, so roles should appear within a minute or two.` };
      // Keep the category for adding several in a row.
      form = { ...form, url: "", ats: "", slug: "", name: "" };
      highlight = added.key;
    } catch (err) {
      result = { ok: false, text: err instanceof Error ? err.message : String(err) };
    } finally {
      saving = false;
    }
  }

  // ---------- list ----------
  let show = $state<"all" | "polled" | "paused">("all");
  let q = $state("");
  let highlight = $state<string | null>(null); // just added

  const SHOW = [
    ["all", "All"],
    ["polled", "Polled"],
    ["paused", "Paused"],
  ] as const;

  const groups = $derived.by(() => {
    const term = q.trim().toLowerCase();
    const out: { category: string; companies: Company[] }[] = [];
    for (const c of companies) {
      if (show === "polled" && !c.enabled) continue;
      if (show === "paused" && c.enabled) continue;
      if (term && !`${c.name} ${c.slug} ${c.ats}`.toLowerCase().includes(term)) continue;
      const last = out.at(-1);
      if (last?.category === c.category) last.companies.push(c);
      else out.push({ category: c.category, companies: [c] });
    }
    return out;
  });

  // Optimistic; put back if the request fails.
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout>;
  function showToast(text: string) {
    toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 6000);
  }

  async function toggle(c: Company) {
    const enabled = !c.enabled;
    c.enabled = enabled;
    try {
      const updated = await api.setCompanyEnabled(c.key, enabled);
      Object.assign(c, updated);
      showToast(enabled ? `Resumed ${c.name}; polling it now` : `Paused ${c.name}; its roles are hidden from the feed`);
    } catch (err) {
      c.enabled = !enabled;
      const reason = err instanceof Error ? err.message : String(err);
      showToast(`Couldn't ${enabled ? "resume" : "pause"} ${c.name} (${reason}). If your sign-in expired, reload.`);
    }
  }

  function status(c: Company): { text: string; cls: string } {
    if (!c.enabled) return { text: "Paused", cls: "muted" };
    const problem = healthProblem(c);
    if (problem) return { text: problem.text, cls: "bad" };
    if (c.last_success_at) return { text: `Polled ${ago(c.last_success_at)}`, cls: "" };
    return { text: "Waiting for first poll", cls: "muted" };
  }
</script>

<main class="page">
  <header class="page-head">
    <div>
      <h1>Companies</h1>
      <p class="sub">
        {#if loaded}{polled} polled · {companies.length - polled} paused{:else}Loading…{/if}
      </p>
    </div>
  </header>

  <section class="card add-card" aria-labelledby="add-title">
    <h2 id="add-title">Add a company</h2>
    <form {onsubmit} autocomplete="off">
      <label class="field wide">
        <span>Careers page link</span>
        <input
          type="text"
          bind:value={form.url}
          placeholder="https://jobs.ashbyhq.com/acme"
          aria-describedby="url-hint"
        />
        <small id="url-hint" class:ok={parsed} class:warn={form.url.trim() && !parsed}>
          {#if parsed}
            Found a {ATS_LABELS[parsed.ats]} board: <code>{parsed.slug}</code>
          {:else if form.url.trim()}
            Not a link I recognise. Fill in the job board and slug below.
          {:else}
            Paste a link to the company's Ashby, Greenhouse, Gem or Lever board to fill in the next two fields.
          {/if}
        </small>
      </label>

      <div class="add-grid">
        <label class="field">
          <span>Job board</span>
          <select bind:value={form.ats} required>
            <option value="" disabled>Choose…</option>
            {#each Object.entries(ATS_LABELS) as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Board slug</span>
          <input type="text" bind:value={form.slug} required placeholder="acme" spellcheck="false" />
        </label>
        <label class="field">
          <span>Company name</span>
          <input type="text" bind:value={form.name} required maxlength="100" placeholder="Acme AI" />
        </label>
        <label class="field">
          <span>Category</span>
          <select bind:value={form.category} required>
            <option value="" disabled>Choose…</option>
            {#each categories as cat (cat)}
              <option value={cat}>{categoryLabel(cat)}</option>
            {/each}
            <option value={NEW_CATEGORY}>New category…</option>
          </select>
        </label>
        {#if form.category === NEW_CATEGORY}
          <label class="field">
            <span>New category name</span>
            <input type="text" bind:value={form.newCategory} required maxlength="50" placeholder="Training infra" />
          </label>
        {/if}
      </div>

      <div class="add-foot">
        <button type="submit" class="btn primary" disabled={saving}>{saving ? "Checking board…" : "Add and poll"}</button>
        {#if form.ats && form.slug.trim()}
          <a class="board-link" href={boardUrl(form.ats, form.slug.trim())} target="_blank" rel="noopener">
            Preview {boardUrl(form.ats, form.slug.trim()).replace("https://", "")} ↗
          </a>
        {/if}
        {#if result}
          <p class="result" class:bad={!result.ok} role="status">{result.text}</p>
        {/if}
      </div>
    </form>
  </section>

  <nav class="tabs" aria-label="Show">
    {#each SHOW as [value, label] (value)}
      <button type="button" aria-current={show === value ? "page" : undefined} onclick={() => (show = value)}>
        {label}
        <small>
          {value === "all" ? companies.length : value === "polled" ? polled : companies.length - polled}
        </small>
      </button>
    {/each}
  </nav>

  <div class="search-card">
    <label class="search">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
      <input type="search" placeholder="Find a company" aria-label="Find a company" bind:value={q} />
    </label>
  </div>

  <div class="table co-table" role="table" aria-label="Companies">
    <div class="co-head" role="row">
      <div role="columnheader">Poll</div>
      <div role="columnheader">Company</div>
      <div role="columnheader">Job board</div>
      <div role="columnheader" class="num">Open roles</div>
      <div role="columnheader">Status</div>
    </div>
    {#if loaded && !groups.length}
      <div class="empty" role="row"><div role="cell">No companies match.</div></div>
    {/if}
    {#each groups as g (g.category)}
      <div class="day" role="row">
        <div role="cell">{categoryLabel(g.category)} <small>{g.companies.length}</small></div>
      </div>
      {#each g.companies as c (c.key)}
        {@const s = status(c)}
        <div class="co-row" class:paused={!c.enabled} class:added={highlight === c.key} role="row">
          <div role="cell">
            <label class="switch" title={c.enabled ? "Polled daily. Click to pause." : "Paused. Click to resume polling."}>
              <input type="checkbox" role="switch" checked={c.enabled} onchange={() => toggle(c)} />
              <span class="sr-only">Poll {c.name}</span>
            </label>
          </div>
          <div role="cell" class="co-name">{c.name}</div>
          <div role="cell" class="co-board">
            <a href={boardUrl(c.ats, c.slug)} target="_blank" rel="noopener">
              <span class="pill grey">{ATS_LABELS[c.ats as Ats] ?? c.ats}</span>
              <code>{c.slug}</code>
            </a>
          </div>
          <div role="cell" class="num">{c.last_success_at ? c.open_count : "–"}</div>
          <div role="cell" class="co-status {s.cls}">{s.text}</div>
        </div>
      {/each}
    {/each}
  </div>
  <p class="hint">
    Paused companies aren't polled and their roles are left out of the feed. Nothing is deleted: resume one and
    it's polled straight away.
  </p>
</main>

<div class="toast-region" role="status" aria-live="polite">
  {#if toast}
    <div class="toast"><span>{toast}</span></div>
  {/if}
</div>
