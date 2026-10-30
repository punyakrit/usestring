import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Offer } from "../src/normalize.js";
import { render } from "../src/render.js";

const startDir = process.cwd();
let dir = "";
before(() => { dir = mkdtempSync(join(tmpdir(), "render-test-")); process.chdir(dir); });
after(() => { process.chdir(startDir); rmSync(dir, { recursive: true, force: true }); });

const offer = (over: Partial<Offer> = {}): Offer => ({
  show: "Aladdin", theatre: "New Amsterdam Theatre", type: "lottery", price: 35,
  opensAt: null, closesAt: "2026-10-30T15:00:00-04:00", source: "broadwaydirect",
  url: "https://lottery.broadwaydirect.com/show/aladdin/", performanceAt: "2026-10-31T14:00:00-04:00", priceInRange: true,
  ...over,
});

const meta = { generatedAt: "2026-10-30T18:24:50.697Z", sources: { broadwaydirect: { offers: 2, error: null }, todaytix: { offers: 0, error: "boom" } } };

test("writes out/offers.json with the feed, counts and per-source errors", async () => {
  await render([offer(), offer({ show: "Wicked", price: 55, priceInRange: false })], meta);
  const feed = JSON.parse(readFileSync("out/offers.json", "utf8"));
  assert.equal(feed.count, 2);
  assert.deepEqual(feed.priceRange, [30, 50]);
  assert.equal(feed.sources.todaytix.error, "boom");
  assert.equal(feed.offers[1].priceInRange, false);
});

test("writes a self-contained out/index.html with table, filter box and open-now toggle", async () => {
  await render([offer()], meta);
  const html = readFileSync("out/index.html", "utf8");
  assert.match(html, /<title>Broadway Cheap Tickets<\/title>/);
  assert.match(html, /<input type="search" id="q"/);
  assert.match(html, /id="openNow"/);
  assert.match(html, /<th data-k="price">/);
  assert.doesNotMatch(html, /<script src=/); // no external scripts
});

test("scraped text cannot break out of the inline <script>", async () => {
  await render([offer({ show: "</script><img src=x onerror=alert(1)>" })], meta);
  const html = readFileSync("out/index.html", "utf8");
  assert.doesNotMatch(html, /<\/script><img/);
  assert.match(html, /\\u003c\/script>\\u003cimg/);
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /innerHTML/);
});

test('the page\'s "open right now" rule handles one-sided windows', async () => {
  await render([offer()], meta);
  const html = readFileSync("out/index.html", "utf8");
  const src = html.match(/function isOpen\(o, now\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, "isOpen not found in page");
  const isOpen = new Function(`${src}; return isOpen;`)() as (o: Partial<Offer>, now: number) => boolean;
  const now = Date.parse("2026-10-30T14:30:00-04:00");
  assert.equal(isOpen({ opensAt: "2026-10-30T09:00:00-04:00", closesAt: "2026-10-30T17:40:00-04:00" }, now), true);
  assert.equal(isOpen({ opensAt: null, closesAt: "2026-10-30T15:00:00-04:00" }, now), true); // BD active row
  assert.equal(isOpen({ opensAt: "2026-10-31T09:00:00-04:00", closesAt: null }, now), false); // BD upcoming row
  assert.equal(isOpen({ opensAt: null, closesAt: "2026-10-30T14:00:00-04:00" }, now), false); // closed
  assert.equal(isOpen({ opensAt: null, closesAt: null }, now), false); // unknown is never "open now"
});
