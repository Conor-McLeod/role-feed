// role-feed UI: filters <-> URL query, fetch /api/listings, render grouped by day.

const $ = (s, el = document) => el.querySelector(s);
const form = $("#filters");
const feed = $("#feed");

const CATEGORY_LABELS = {
  "inference-platform": "Inference platforms",
  neocloud: "Neoclouds",
  "inference-silicon": "Inference silicon",
  "inference-software": "Inference software",
  "efficient-models": "Efficient models",
};

// ---------- "new since last visit" ----------
// `since` is fixed for the whole browser session so reloads keep the markers;
// the next session compares against this visit.
let since = sessionStorage.getItem("since");
if (!since) {
  since = localStorage.getItem("lastVisit") ?? new Date().toISOString();
  sessionStorage.setItem("since", since);
}
localStorage.setItem("lastVisit", new Date().toISOString());

// ---------- state <-> URL ----------
const state = { categories: new Set(), companies: new Set() };

function readUrl() {
  const p = new URLSearchParams(location.search);
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") el.checked = p.get(el.name) === "1";
    else if (p.has(el.name)) el.value = p.get(el.name);
  }
  state.categories = new Set((p.get("category") ?? "").split(",").filter(Boolean));
  state.companies = new Set((p.get("company") ?? "").split(",").filter(Boolean));
}

function params() {
  const p = new URLSearchParams();
  for (const el of form.elements) {
    if (!el.name || el.closest("#companies")) continue;
    if (el.type === "checkbox") { if (el.checked) p.set(el.name, "1"); }
    else if (el.value.trim()) p.set(el.name, el.value.trim());
  }
  if (p.get("status") === "open") p.delete("status");
  if (p.get("sort") === "seen") p.delete("sort");
  if (state.categories.size) p.set("category", [...state.categories].join(","));
  if (state.companies.size) p.set("company", [...state.companies].join(","));
  return p;
}

// ---------- companies + categories ----------
let companies = [];

async function loadCompanies() {
  const order = Object.keys(CATEGORY_LABELS);
  const rank = (cat) => (order.includes(cat) ? order.indexOf(cat) : order.length);
  companies = (await (await fetch("/api/companies")).json()).sort(
    (a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name),
  );
  renderCategories();
  renderCompanies();
  renderStats();
}

function renderCategories() {
  const cats = [...new Set(companies.map((c) => c.category))];
  $("#categories").replaceChildren(
    ...cats.map((cat) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = CATEGORY_LABELS[cat] ?? cat;
      b.setAttribute("aria-pressed", state.categories.has(cat));
      b.onclick = () => {
        state.categories.has(cat) ? state.categories.delete(cat) : state.categories.add(cat);
        b.setAttribute("aria-pressed", state.categories.has(cat));
        update();
      };
      return b;
    }),
  );
}

function renderCompanies() {
  const ul = $("#companies");
  ul.replaceChildren();
  let lastCat;
  for (const c of companies) {
    if (c.category !== lastCat) {
      lastCat = c.category;
      const h = document.createElement("h4");
      h.textContent = CATEGORY_LABELS[c.category] ?? c.category;
      ul.append(h);
    }
    const li = document.createElement("li");
    const err = c.last_error ? ` title="Last fetch failed: ${esc(c.last_error)}"` : "";
    li.innerHTML = `<label${err}><input type="checkbox" value="${esc(c.key)}" ${state.companies.has(c.key) ? "checked" : ""} />
      <span>${esc(c.name)}${c.last_error ? ' <span class="err">●</span>' : ""}</span>
      <span class="n">${c.last_success_at ? c.open_count : "–"}</span></label>`;
    li.querySelector("input").onchange = (e) => {
      e.target.checked ? state.companies.add(c.key) : state.companies.delete(c.key);
      update();
    };
    ul.append(li);
  }
}

function renderStats(newCount = null) {
  const open = companies.reduce((n, c) => n + (c.open_count ?? 0), 0);
  const failing = companies.filter((c) => c.last_error).length;
  const last = companies.map((c) => c.last_success_at).filter(Boolean).sort().at(-1);
  const items = [
    ["Companies", companies.length],
    ["Open roles", open.toLocaleString()],
    ...(newCount != null ? [["New in view", newCount, newCount ? "hot" : ""]] : []),
    ["Last poll", last ? ago(last) : "never"],
    ...(failing ? [["Failing", failing, "hot"]] : []),
  ];
  $("#stats").innerHTML = items
    .map(([k, v, cls = ""]) => `<div class="${cls}"><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");
}

// ---------- listings ----------
let listings = [];
let cursor = -1;
let reqId = 0;

async function loadListings() {
  const p = params();
  const id = ++reqId;
  $("#summary").textContent = "Loading…";
  const res = await fetch(`/api/listings?${p}`);
  if (id !== reqId) return; // a newer request superseded this one
  const data = await res.json();
  listings = data.listings;
  cursor = -1;
  render(p.get("sort") === "posted" ? "published_at" : "first_seen_at");
  const shown = listings.length < data.total ? `${listings.length} of ${data.total}` : data.total;
  $("#summary").textContent = `${shown} role${data.total === 1 ? "" : "s"}`;
}

function render(dayKey) {
  if (!listings.length) {
    feed.innerHTML = `<p class="empty">Nothing on the wire matching that.</p>`;
    renderStats(0);
    return;
  }
  const frag = document.createDocumentFragment();
  let lastDay;
  let newCount = 0;
  listings.forEach((l, i) => {
    const day = l[dayKey] ? dayLabel(l[dayKey]) : "Undated";
    if (day !== lastDay) {
      lastDay = day;
      const h = document.createElement("h3");
      h.className = "day";
      const n = listings.filter((x) => (x[dayKey] ? dayLabel(x[dayKey]) : "Undated") === day).length;
      h.innerHTML = `${day} <small>${n} role${n === 1 ? "" : "s"}</small>`;
      frag.append(h);
    }
    const isNew = l.first_seen_at > since && !l.closed_at;
    if (isNew) newCount++;
    const row = document.createElement("article");
    row.className = `job${isNew ? " new" : ""}${l.closed_at ? " closed" : ""}`;
    row.style.setProperty("--i", i);
    row.dataset.index = i;
    const meta = [
      l.locations && `<span>${esc(truncate(l.locations, 90))}</span>`,
      l.remote ? `<span class="remote">remote ok</span>` : l.workplace && `<span>${l.workplace}</span>`,
      (l.team || l.department) && `<span>${esc(l.team || l.department)}</span>`,
      l.employment && !/full/.test(l.employment) && `<span>${esc(l.employment)}</span>`,
      l.compensation && `<span class="comp">${esc(l.compensation)}</span>`,
      l.closed_at && `<span>closed ${ago(l.closed_at)}</span>`,
    ].filter(Boolean);
    row.innerHTML = `
      <div class="co" title="${esc(l.company)}">${esc(l.company)}</div>
      <div class="title-wrap"><a class="title" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>${isNew ? '<span class="badge">NEW</span>' : ""}</div>
      <div class="when" title="Posted ${l.published_at ?? "?"} · first seen ${l.first_seen_at}">${l.published_at ? ago(l.published_at) : "–"}</div>
      <div class="meta">${meta.join("")}</div>`;
    row.addEventListener("click", (e) => {
      if (e.target.closest("a, .detail")) return;
      setCursor(i);
      toggle(row, l);
    });
    frag.append(row);
  });
  feed.replaceChildren(frag);
  renderStats(newCount);
}

async function toggle(row, l) {
  const open = $(".detail", row);
  if (open) return open.remove();
  const d = document.createElement("div");
  d.className = "detail";
  d.innerHTML = `<p class="desc">Loading…</p>`;
  row.append(d);
  const full = await (await fetch(`/api/listings/${encodeURIComponent(l.id)}`)).json();
  d.innerHTML = `
    <div class="links">
      <a href="${esc(full.url)}" target="_blank" rel="noopener">Open posting ↗</a>
    </div>
    <div class="desc">${highlight(esc(full.description ?? "No description provided."))}</div>`;
}

// ---------- keyboard ----------
function setCursor(i) {
  const rows = feed.querySelectorAll(".job");
  rows[cursor]?.classList.remove("cursor");
  cursor = Math.max(0, Math.min(i, rows.length - 1));
  rows[cursor]?.classList.add("cursor");
  rows[cursor]?.scrollIntoView({ block: "nearest" });
}

document.addEventListener("keydown", (e) => {
  const typing = e.target.matches("input, select, textarea");
  if (e.key === "/" && !typing) { e.preventDefault(); form.q.focus(); return; }
  if (e.key === "Escape" && typing) { e.target.blur(); return; }
  if (typing || e.metaKey || e.ctrlKey) return;
  const rows = feed.querySelectorAll(".job");
  if (e.key === "j") setCursor(cursor + 1);
  else if (e.key === "k") setCursor(cursor - 1);
  else if (e.key === "Enter" && rows[cursor]) toggle(rows[cursor], listings[cursor]);
  else if (e.key === "o" && listings[cursor]) window.open(listings[cursor].url, "_blank", "noopener");
});

// ---------- wiring ----------
let timer;
function update() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const p = params().toString();
    history.replaceState(null, "", p ? `?${p}` : location.pathname);
    loadListings();
  }, 200);
}

form.addEventListener("input", (e) => { if (!e.target.closest("#companies")) update(); });
form.addEventListener("submit", (e) => e.preventDefault());

$("#clear-companies").onclick = () => {
  state.companies.clear();
  renderCompanies();
  update();
};

$("#mark-seen").onclick = () => {
  since = new Date().toISOString();
  sessionStorage.setItem("since", since);
  localStorage.setItem("lastVisit", since);
  loadListings();
};

$("#refresh").onclick = async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  b.textContent = "Queued…";
  try {
    const { queued } = await (await fetch("/api/refresh", { method: "POST" })).json();
    $("#summary").textContent = `Polling ${queued} companies — results land over the next minute or two.`;
    setTimeout(async () => { await loadCompanies(); await loadListings(); }, 30_000);
  } finally {
    setTimeout(() => { b.disabled = false; b.textContent = "Refresh now"; }, 30_000);
  }
};

// ---------- utils ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function highlight(html) {
  const terms = (form.q.value || "").split(/\s+/).filter((t) => t.length > 1).map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return terms.length ? html.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>") : html;
}

function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)}d ago`;
  return `${Math.round(s / (86400 * 30))}mo ago`;
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

readUrl();
loadCompanies().then(loadListings);
