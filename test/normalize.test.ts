import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanShowName, normalize, nyDate, nyLocalToIso, toNyIso, type RawOffer } from "../src/normalize.js";

const raw = (over: Partial<RawOffer> = {}): RawOffer => ({
  source: "todaytix", show: "& Juliet", theatre: "Stephen Sondheim Theatre", type: "rush", price: 49,
  opensAt: "2026-10-30T09:00:00-04:00", closesAt: "2026-10-30T17:40:00-04:00",
  performanceAt: "2026-10-30T20:00:00-04:00", url: "https://www.todaytix.com/nyc/shows/25598-and-juliet-on-broadway",
  ...over,
});

test("nyLocalToIso uses the NY offset for that date, across the 2026-11-01 DST change", () => {
  assert.equal(nyLocalToIso(2026, 10, 31, 14, 0), "2026-10-31T14:00:00-04:00");
  assert.equal(nyLocalToIso(2026, 11, 1, 13, 0), "2026-11-01T13:00:00-05:00");
  assert.equal(nyLocalToIso(2026, 1, 15, 20, 0), "2026-01-15T20:00:00-05:00");
  assert.equal(nyLocalToIso(2026, 3, 8, 12, 0), "2026-03-08T12:00:00-04:00");
});

test("toNyIso gives one format for every input shape", () => {
  assert.equal(toNyIso("2026-10-26T00:00-04:00"), "2026-10-26T00:00:00-04:00"); // TodayTix lottery: no seconds
  assert.equal(toNyIso("2026-10-30T18:25:32Z"), "2026-10-30T14:25:00-04:00"); // UTC in, NY out
  assert.equal(toNyIso("2026-11-02T19:00:00-05:00"), "2026-11-02T19:00:00-05:00");
});

test("toNyIso returns null for missing or unparseable times", () => {
  for (const v of [null, undefined, "", "garbage", "Closes Today"]) assert.equal(toNyIso(v), null);
});

test("nyDate is the New York calendar date, not UTC", () => {
  // 02:00 UTC on Oct 31 is still the evening of Oct 30 in New York.
  assert.deepEqual(nyDate(Date.parse("2026-10-31T02:00:00Z")), [2026, 10, 30]);
});

test("cleanShowName strips (NY) and title-cases all-caps names only", () => {
  assert.equal(cleanShowName("THE LION KING (NY)"), "The Lion King");
  assert.equal(cleanShowName("STRANGER THINGS: THE FIRST SHADOW (NY)"), "Stranger Things: The First Shadow");
  assert.equal(cleanShowName("MJ (NY)"), "MJ");
  assert.equal(cleanShowName("Paranormal Activity "), "Paranormal Activity");
  assert.equal(cleanShowName("School Girls; Or, The African Mean Girls Play"), "School Girls; Or, The African Mean Girls Play");
  assert.equal(cleanShowName("& Juliet"), "& Juliet");
  assert.equal(cleanShowName(""), null);
  assert.equal(cleanShowName(null), null);
});

test("normalize flags prices outside $30-50 instead of dropping them", () => {
  const out = normalize([30, 50, 55, 29.99, null].map((price, i) => raw({ price, url: `u${i}` })));
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((o) => [o.price, o.priceInRange]), [[30, true], [50, true], [55, false], [29.99, false], [null, null]]);
});

test("normalize turns bad fields into null and never throws", () => {
  const [o] = normalize([raw({ show: null, theatre: "   ", price: Number.NaN, opensAt: "garbage", closesAt: null, url: null })]);
  assert.equal(o.show, null);
  assert.equal(o.theatre, null);
  assert.equal(o.price, null);
  assert.equal(o.priceInRange, null);
  assert.equal(o.opensAt, null);
  assert.equal(o.url, null);
  assert.doesNotThrow(() => normalize([{} as RawOffer, { price: "abc" } as unknown as RawOffer]));
});

test("normalize removes duplicates and sorts by show, then performance", () => {
  const out = normalize([
    raw({ show: "WICKED (NY)", performanceAt: "2026-10-31T20:00:00-04:00", url: "w" }),
    raw({ show: "Wicked", performanceAt: "2026-10-31T14:00:00-04:00", url: "w" }),
    raw({ show: "Aladdin", url: "a" }),
    raw({ show: "Aladdin", url: "a" }), // exact duplicate
  ]);
  assert.deepEqual(out.map((o) => `${o.show} ${o.performanceAt}`), [
    "Aladdin 2026-10-30T20:00:00-04:00",
    "Wicked 2026-10-31T14:00:00-04:00",
    "Wicked 2026-10-31T20:00:00-04:00",
  ]);
});

test("normalized records have exactly the feed fields", () => {
  const [o] = normalize([raw()]);
  assert.deepEqual(Object.keys(o).sort(), [
    "closesAt", "opensAt", "performanceAt", "price", "priceInRange", "show", "source", "theatre", "type", "url",
  ]);
});
