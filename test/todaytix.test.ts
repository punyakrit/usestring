// Fixtures mirror the real __NEXT_DATA__ paths recorded in NOTES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { offersFromShowPage, showUrls } from "../src/sources/todaytix.js";

const NOW = Date.parse("2026-10-30T14:30:00-04:00");
const URL = "https://www.todaytix.com/nyc/shows/25598-and-juliet-on-broadway";

const nextPage = (pageProps: unknown) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></body></html>`;

const price = (value: number) => ({ value, currency: "USD", display: `$${value}` });

const broadwayShow = (initialShowtimes: unknown[], rushSettings: unknown = null) => nextPage({
  product: { displayName: "& Juliet", name: "& Juliet on Broadway", venue: { name: "Stephen Sondheim Theatre", area: "Broadway" } },
  rushSettings,
  initialShowtimes,
});

test("keeps open and upcoming windows on a Broadway show, one offer per performance", () => {
  const html = broadwayShow([
    { datetime: "2026-10-30T20:00:00-04:00", rushTickets: { availableAfter: "2026-10-30T09:00:00-04:00", availableUntil: "2026-10-30T17:40:00-04:00", lowPrice: price(49) }, lotteryTickets: null },
    { datetime: "2026-11-02T19:00:00-05:00", lotteryTickets: { availableAfter: "2026-10-26T00:00-04:00", availableUntil: "2026-10-30T09:00-04:00", lowPrice: price(40) }, rushTickets: null }, // closed
    { datetime: "2026-11-06T19:00:00-05:00", lotteryTickets: { availableAfter: "2026-11-02T00:00-05:00", availableUntil: "2026-11-06T09:00-05:00", lowPrice: price(40) }, rushTickets: null },
  ]);
  const offers = offersFromShowPage(URL, html, NOW);
  assert.equal(offers.length, 2);
  assert.deepEqual(offers[0], {
    source: "todaytix", show: "& Juliet", theatre: "Stephen Sondheim Theatre", type: "rush", price: 49,
    opensAt: "2026-10-30T09:00:00-04:00", closesAt: "2026-10-30T17:40:00-04:00",
    performanceAt: "2026-10-30T20:00:00-04:00", url: URL,
  });
  assert.equal(offers[1].type, "lottery");
  assert.equal(offers[1].performanceAt, "2026-11-06T19:00:00-05:00");
});

test("drops a window whose closing time has passed", () => {
  const html = broadwayShow([
    { datetime: "2026-10-30T20:00:00-04:00", rushTickets: { availableAfter: "2026-10-30T09:00:00-04:00", availableUntil: "2026-10-30T12:00:00-04:00", lowPrice: price(49) } },
  ]);
  assert.deepEqual(offersFromShowPage(URL, html, NOW), []);
});

test("falls back to rushSettings.rushPrice when a rush window has no price", () => {
  const html = broadwayShow(
    [{ datetime: "2026-10-30T20:00:00-04:00", rushTickets: { availableAfter: "2026-10-30T09:00:00-04:00", availableUntil: "2026-10-30T17:40:00-04:00" } }],
    { rushPrice: price(49) },
  );
  assert.equal(offersFromShowPage(URL, html, NOW)[0].price, 49);
});

test("missing price and times become null, not a crash", () => {
  const html = broadwayShow([{ datetime: null, lotteryTickets: {} }]);
  const [o] = offersFromShowPage(URL, html, NOW);
  assert.equal(o.price, null);
  assert.equal(o.opensAt, null);
  assert.equal(o.closesAt, null);
  assert.equal(o.performanceAt, null);
});

test("skips shows that are not in a Broadway venue", () => {
  const html = nextPage({
    product: { displayName: "Perfect Crime", venue: { name: "The Theater Center", area: "Off-Broadway" } },
    initialShowtimes: [{ datetime: "2026-10-30T20:00:00-04:00", rushTickets: { availableUntil: "2026-10-30T17:00:00-04:00", lowPrice: price(40) } }],
  });
  assert.deepEqual(offersFromShowPage(URL, html, NOW), []);
});

test("returns [] for a page without product data or with broken __NEXT_DATA__", () => {
  assert.deepEqual(offersFromShowPage(URL, nextPage({}), NOW), []);
  assert.deepEqual(offersFromShowPage(URL, `<script id="__NEXT_DATA__">{not json</script>`, NOW), []);
  assert.deepEqual(offersFromShowPage(URL, "<html>no next data</html>", NOW), []);
});

test("showUrls takes the page's own link when slug is null, else builds id-slug", () => {
  const html = `<a href="/nyc/shows/127-the-book-of-mormon">Mormon</a><a href="https://www.todaytix.com/nyc/shows/127-the-book-of-mormon">again</a>`;
  assert.deepEqual(showUrls(html, [{ id: 127, slug: null }, { id: 25598, slug: "and-juliet-on-broadway" }, { id: 9, slug: null }, { id: null }]), [
    "https://www.todaytix.com/nyc/shows/127-the-book-of-mormon",
    "https://www.todaytix.com/nyc/shows/25598-and-juliet-on-broadway",
    "https://www.todaytix.com/nyc/shows/9",
  ]);
});
