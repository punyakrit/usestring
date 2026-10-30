// Writes out/offers.json and a single static out/index.html (data inlined, no build step).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRICE_MAX, PRICE_MIN, type Offer } from "./normalize.js";

const OUT_DIR = "out";

export type RenderMeta = {
  generatedAt: string;
  sources: Record<string, { offers: number; error: string | null }>;
};

export async function render(offers: Offer[], meta: RenderMeta): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const feed = { ...meta, count: offers.length, priceRange: [PRICE_MIN, PRICE_MAX], offers };
  await writeFile(join(OUT_DIR, "offers.json"), JSON.stringify(feed, null, 2) + "\n");
  await writeFile(join(OUT_DIR, "index.html"), page(feed));
}

// Scraped text ends up in a <script> block, so "<" must never appear raw.
const inlineJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

function page(feed: unknown): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Broadway Cheap Tickets</title>
<style>
  :root { --bg:#fbfaf7; --fg:#1d1b18; --muted:#6b665e; --line:#e6e2da; --head:#f3f0e9; --accent:#9b1c31; --ok:#1f6f43; --warn:#a15c00; --chip:#efeae0; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141312; --fg:#ece8e1; --muted:#a39d93; --line:#2c2a27; --head:#1d1c1a; --accent:#e0607a; --ok:#5cc28a; --warn:#e3a14a; --chip:#2a2825; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:1200px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font:600 28px/1.2 Georgia,"Times New Roman",serif; margin:0 0 4px; }
  h1 span { color:var(--accent); }
  .meta { color:var(--muted); font-size:13px; margin:0 0 20px; }
  .controls { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:12px; }
  input[type=search] { flex:1 1 260px; padding:9px 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--fg); font:inherit; }
  label { display:flex; gap:6px; align-items:center; cursor:pointer; user-select:none; }
  .count { color:var(--muted); font-size:13px; margin-left:auto; }
  .wrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; }
  table { border-collapse:collapse; width:100%; min-width:900px; }
  th, td { padding:9px 12px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; }
  th { background:var(--head); font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); cursor:pointer; white-space:nowrap; position:sticky; top:0; }
  th[aria-sort=ascending]::after { content:" ▲"; } th[aria-sort=descending]::after { content:" ▼"; }
  tr:last-child td { border-bottom:0; }
  td.num { font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.time { white-space:nowrap; font-variant-numeric:tabular-nums; }
  .show { font-weight:600; }
  .chip { display:inline-block; padding:1px 8px; border-radius:999px; background:var(--chip); font-size:12px; }
  .rush { color:var(--accent); } .lottery { color:var(--ok); }
  .flag { color:var(--warn); font-size:12px; display:block; }
  .open { color:var(--ok); font-weight:600; font-size:12px; display:block; }
  .none { color:var(--muted); }
  a { color:var(--accent); }
  .empty { padding:24px; text-align:center; color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Broadway <span>cheap tickets</span></h1>
  <p class="meta" id="meta"></p>
  <div class="controls">
    <input type="search" id="q" placeholder="Filter by show, theatre, type or source…" aria-label="Filter offers">
    <label><input type="checkbox" id="openNow"> Open right now</label>
    <span class="count" id="count"></span>
  </div>
  <div class="wrap">
    <table>
      <thead><tr>
        <th data-k="show">Show</th><th data-k="theatre">Theatre</th><th data-k="type">Type</th>
        <th data-k="price">Price</th><th data-k="opensAt">Opens</th><th data-k="closesAt">Closes</th>
        <th data-k="performanceAt">Performance</th><th data-k="source">Source</th><th>Link</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
</main>
<script>
const FEED = ${inlineJson(feed)};
const [MIN, MAX] = FEED.priceRange;
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const when = (iso) => iso ? fmt.format(new Date(iso)) : null;

// Open now needs at least one known bound, and no known bound may exclude now.
function isOpen(o, now) {
  const opens = o.opensAt ? Date.parse(o.opensAt) : null;
  const closes = o.closesAt ? Date.parse(o.closesAt) : null;
  if (opens === null && closes === null) return false;
  return (opens === null || opens <= now) && (closes === null || now < closes);
}

let sortKey = "opensAt", sortDir = 1;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function cmp(a, b) {
  const x = a[sortKey], y = b[sortKey];
  if (x == null && y == null) return 0;
  if (x == null) return 1; if (y == null) return -1; // nulls last either way
  return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * sortDir;
}

function draw() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const onlyOpen = document.getElementById("openNow").checked;
  const now = Date.now();
  const rows = FEED.offers
    .filter((o) => !q || [o.show, o.theatre, o.type, o.source].some((v) => v && v.toLowerCase().includes(q)))
    .filter((o) => !onlyOpen || isOpen(o, now))
    .sort(cmp);

  const tbody = document.getElementById("rows");
  tbody.replaceChildren();
  for (const o of rows) {
    const tr = document.createElement("tr");
    tr.append(el("td", "show", o.show ?? "—"), el("td", null, o.theatre ?? "—"));
    const t = el("td"); t.append(el("span", "chip " + o.type, o.type)); tr.append(t);
    const p = el("td", "num", o.price == null ? "—" : "$" + o.price);
    if (o.priceInRange === false) p.append(el("span", "flag", "outside $" + MIN + "–" + MAX));
    tr.append(p);
    for (const k of ["opensAt", "closesAt", "performanceAt"]) tr.append(el("td", "time" + (o[k] ? "" : " none"), when(o[k]) ?? "unknown"));
    if (isOpen(o, now)) tr.children[4].append(el("span", "open", "open now"));
    tr.append(el("td", null, o.source));
    const l = el("td");
    if (o.url && /^https?:\\/\\//.test(o.url)) { const a = el("a", null, "Open ↗"); a.href = o.url; a.target = "_blank"; a.rel = "noopener noreferrer"; l.append(a); }
    else l.textContent = "—";
    tr.append(l);
    tbody.append(tr);
  }
  if (!rows.length) { const tr = document.createElement("tr"); const td = el("td", "empty", "No offers match."); td.colSpan = 9; tr.append(td); tbody.append(tr); }
  document.getElementById("count").textContent = rows.length + " of " + FEED.offers.length + " offers";
  document.querySelectorAll("th[data-k]").forEach((th) => th.setAttribute("aria-sort", th.dataset.k === sortKey ? (sortDir > 0 ? "ascending" : "descending") : "none"));
}

document.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => {
  sortDir = th.dataset.k === sortKey ? -sortDir : 1; sortKey = th.dataset.k; draw();
}));
document.getElementById("q").addEventListener("input", draw);
document.getElementById("openNow").addEventListener("change", draw);

const src = Object.entries(FEED.sources).map(([k, v]) => k + " " + v.offers + (v.error ? " (error: " + v.error + ")" : "")).join(" · ");
document.getElementById("meta").textContent = "Rush and lottery offers, America/New_York times. Updated " + when(FEED.generatedAt) + ". " + src + ". Read-only: links go to the official seller.";
draw();
</script>
</body>
</html>
`;
}
