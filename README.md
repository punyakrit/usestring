# Broadway cheap-ticket feed

Collects **rush and lottery offers** for current Broadway shows from official sellers and turns them into one normalised list:

- `out/offers.json`: the feed
- `out/index.html`: a static page with a sortable table, a filter box and an "open right now" toggle

Every page is fetched through the [String Web Access API](https://usestring.ai/web-access). The tool is **read-only**: it never enters a lottery, logs in, buys or submits anything. Links in the feed go to the official seller, where you enter or buy yourself.

## Setup

Requires **Node 24+**.

```bash
npm install
cp .env.example .env   # then put your key in STRING_API_KEY
```

Get a key at [portal.usestring.ai](https://portal.usestring.ai/sign-up). `.env` and `.cache/` are git-ignored.

## Run

```bash
npm start
```

Then open `out/index.html` in a browser. `npm start` prints a count per source, for example:

```
235 offers → out/offers.json, out/index.html
  todaytix: 215
  broadwaydirect: 20
```

Other commands:

| Command | What it does |
|---|---|
| `npm run source:todaytix` | Run only the TodayTix source and print its raw offers |
| `npm run source:broadwaydirect` | Run only the Broadway Direct source |
| `npm run fetch -- <url> [--js]` | Fetch one URL through String (cached) and print status, size and block check |
| `DEBUG=1 npm start` | Also print String's HTTP status, content-type and first 300 chars of each response |
| `npm test` | Offline test suite (no String requests, about 16 s) |
| `npm run typecheck` | `tsc --noEmit` |

### Tests

`npm test` runs 35 tests with Node's built-in runner (`node:test` via tsx, no extra dependencies). They run fully offline: `fetch` is mocked, and the fixtures are small hand-written pages shaped like the real TodayTix `__NEXT_DATA__` and Broadway Direct markup.

| File | Covers |
|---|---|
| `test/string.test.ts` | GET-only + `solveCaptcha: false` request body, cache hit, 30-min expiry, **one request in flight and ≥1.5 s between requests**, block pages on HTTP 200, the Cloudflare-beacon false positive, String API errors not cached, destination status read from the envelope |
| `test/todaytix.test.ts` | Broadway-only filter, closed windows dropped, rush price fallback, null fields, broken `__NEXT_DATA__`, show URLs when `slug` is null |
| `test/broadwaydirect.test.ts` | Closed / active / upcoming rows, "Closes Today" resolved against fetch time, DST offset, entry link vs show page, unknown status |
| `test/normalize.test.ts` | NY offsets across DST, one time format, name cleaning, $30-50 flag, null on bad input, dedupe and sort |
| `test/render.test.ts` | `offers.json` shape, page controls present, scraped text can't break out of the inline `<script>`, the "open right now" rule |

### Request budget

A cold run makes **about 59 String requests** (TodayTix: 1 category page + 49 show pages; Broadway Direct: 1 home page + 8 show pages) and takes **about 3.5 minutes**, because requests are sent one at a time with 1.5 s between them. Every response is cached in `.cache/` for **30 minutes** (keyed by URL and fetch options), so a re-run within that window makes no requests.

## Output format

`out/offers.json`:

```jsonc
{
  "generatedAt": "2026-10-30T18:24:50.697Z",
  "sources": { "todaytix": { "offers": 215, "error": null }, "broadwaydirect": { "offers": 20, "error": null } },
  "count": 235,
  "priceRange": [30, 50],
  "offers": [
    {
      "show": "& Juliet",
      "theatre": "Stephen Sondheim Theatre",
      "type": "rush",                              // "rush" | "lottery"
      "price": 49,
      "opensAt": "2026-10-30T09:00:00-04:00",      // America/New_York ISO, or null
      "closesAt": "2026-10-30T17:40:00-04:00",
      "source": "todaytix",
      "url": "https://www.todaytix.com/nyc/shows/25598-and-juliet-on-broadway",
      "performanceAt": "2026-10-30T20:00:00-04:00", // the performance the offer is for
      "priceInRange": true                          // false outside $30-50, null if price unknown
    }
  ]
}
```

There is one row per performance. Offers whose window has already closed are dropped. Missing fields are `null`, and a source that fails records its `error` without stopping the others.

## Sources covered

| Source | What we read | Offers | Link in feed |
|---|---|---|---|
| **TodayTix** (`todaytix.com`) | The `__NEXT_DATA__` JSON (not the HTML) on `/nyc/category/rush-tickets`, then each show page's `initialShowtimes[].lotteryTickets` / `rushTickets`. Kept only when `product.venue.area === "Broadway"`. | Rush + lottery | Show page (entries happen in the TodayTix app) |
| **Broadway Direct** (`lottery.broadwaydirect.com`) | Server-rendered HTML with cheerio: `.content-card` on the home page, then `.lotteries-row` and `.venue-information` on each `/show/<slug>/` page. | Lottery | Official entry page when the lottery is open, otherwise the show page |
| Telecharge (`rush.telecharge.com`) | Not covered yet (stretch goal). | | |

## How it works

```
src/index.ts             runs each source, normalises, renders
src/sources/todaytix.ts  TodayTix → raw offers
src/sources/broadwaydirect.ts
src/string.ts            the only network path: String API + .cache/ + 1-at-a-time queue + block detection
src/normalize.ts         names, NY times, price flag, dedupe, sort
src/render.ts            out/offers.json + out/index.html
```

- **Polite pace:** one request in flight at a time, at least 1.5 s apart, GET only.
- **Block detection:** a 200 can still be a block page. Non-2xx, "access denied", Cloudflare challenge markers (`cf-chl`, `challenge-platform/h/`), "verify you are human", PerimeterX, or "captcha" in the title (or in a tiny page) all count as blocked. A blocked page makes that source skip it; String is called with `solveCaptcha: false`.
- **Times:** every time is converted to `America/New_York` with the correct offset for that date, including the DST change on 2026-11-01.

## Known gaps

- **Broadway Direct gives only one bound per performance.** An open lottery shows "Closes Today at 3:00 pm" (so `opensAt` is `null`); an upcoming one shows "Opens 10/31/26 at 9:00 am" (so `closesAt` is `null`). The other bound only exists in per-show prose, which we don't parse.
- **"Today" on Broadway Direct** is resolved against the time the page was fetched. That is correct within the 30-minute cache, but the page itself is a snapshot.
- **TodayTix lottery rows are numerous.** Some shows publish a lottery window for every future performance (Cursed Child about 94, The Fantasticks about 111). All are kept; use the filter or "open right now" toggle.
- **TodayTix coverage** is limited to shows in its rush & lottery category. Rush and lottery entry happen in the TodayTix app, so the link is the show page.
- **Prices outside $30-50 are flagged, not dropped** (for example Wicked lottery, $55). Filter on `priceInRange` if you want strictly $30-50.
- **Telecharge** is not covered.
- **Name styling:** all-caps names are title-cased, so "SIX" appears as "Six".
- **The page is static.** "Open right now" is evaluated in the browser when you view it, but the data is as fresh as the last `npm start`.
- **Selectors and JSON paths can change.** When a page no longer matches, the source logs a warning and returns fewer offers rather than crashing. See `NOTES.md` for what was inspected and what broke.

## License

[MIT](LICENSE)
