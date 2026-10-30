# NOTES

Things that broke and how we fixed them.

## 2026-10-30: Broadway Direct falsely flagged as a Cloudflare challenge

- **Symptom:** `lottery.broadwaydirect.com` came back HTTP 200, 125 KB, title "Lottery | Broadway Direct", but `detectBlock` said "cloudflare challenge".
- **Cause:** the pattern matched any `challenge-platform`. Cloudflare injects a passive beacon (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`) into normal pages.
- **Fix:** match only real challenge markers: `cf-chl`, `cf_chl_opt`, `challenge-platform/h/`. A blocked page is cached from a destination response, so the corrected check re-runs on the cached copy with no new request.

## 2026-10-30: `.env.*` in .gitignore also ignored `.env.example`

- **Fix:** added `!.env.example` to `.gitignore`.

## Source structure (inspected 2026-10-30 from real String fetches in .cache/)

### TodayTix
- `/nyc/category/rush-tickets`: `__NEXT_DATA__` → `props.pageProps.productList.results.shows[]` (49 shows, Broadway and Off-Broadway mixed). Fields used: `id`, `displayName`, `venue` (string), `slug`, `lowPriceForLotteryTickets.value`. **`slug` can be null** (Book of Mormon, Perfect Crime). No rush price and no times in the list.
- `/nyc/shows/<id>-<slug>`: `props.pageProps`
  - `product.venue.name` and `product.venue.area` (`"Broadway"` for Broadway houses).
  - `initialShowtimes[]` → `datetime` (performance), `lotteryTickets` / `rushTickets`, each `{availableAfter, availableUntil, lowPrice.value}`. The ISO strings carry the NY offset and match the `*Epoch` fields.
  - `rushSettings` holds `rushPrice` for shows with rush, and an error object (`"No active rush found"`) for shows without.
- Past showtimes keep their lottery windows (Cursed Child has 242 showtimes, many already closed), so filter on `availableUntil`.

### Broadway Direct (lottery.broadwaydirect.com), server-rendered, no executeJS needed
- `/`: `.content-card` → `h4` (name, e.g. "ALADDIN (NY)"), `.price`, `a[href]` to `/show/<slug>/`. 8 shows.
- `/show/<slug>/`: `.venue-information h2` = theatre. `.lotteries-row` per performance:
  - `.lotteries-time` = "10/31/26, 2:00 pm" (performance)
  - `.lotteries-status` is one of: "Closed" | "Active/ Closes Today at 3:00 pm" | "Opens 10/31/26 at 9:00 am"
  - `.price`; when active, `a.enter-lottery-link` → `/enter-lottery/?lottery=<id>&window=popup`
- Each row states only one bound (opens *or* closes). The other bound is only in per-show prose ("starting 9AM the day prior … until 3PM").

## 2026-10-30: TodayTix parser, first full run

- 1 category page + 49 show pages = 50 String requests, 2m56s (47 fetched, 2 from cache). No blocks.
- 215 offers from 10 Broadway shows (39 of the 49 shows are Off-Broadway, dropped by `product.venue.area !== "Broadway"`).
- **Lottery rows flood the list:** Cursed Child (94) and The Fantasticks (111) publish a not-yet-closed weekly/daily lottery window for every future performance. Rush rows are same-day only (1 per show).
- The category list's `venue` is a **plain string** (`"Lyric Theatre"`), not `{name}`. `venue.name` exists only on the show page (`product.venue.name`), which is what we use.

## 2026-10-30: fetch debugging

- `DEBUG=1` prints String's HTTP status, content-type and the first 300 chars of the response (stderr).
- We keep the default JSON envelope instead of `format: "raw"`: the envelope's `statusCode` is the destination's status, which `detectBlock` needs. A raw body would hide a 403/429 behind String's own 200.

## 2026-10-30: Broadway Direct parser, first full run

- Home page + 8 show pages (6 fetched, 2 from cache), 26 s, no blocks, no executeJS needed.
- 20 open/upcoming lottery offers from 8 shows; "Closed" rows are skipped.
- Each row states only one bound. Active rows give `closesAt` ("Closes Today at 3:00 pm"); upcoming rows give `opensAt` ("Opens 10/31/26 at 9:00 am"). The other bound stays `null`.
- **"Today" is relative to when the page was fetched**, so we resolve it with the cached `fetchedAt` in NY time, not the clock at parse time.
- **DST:** US clocks fall back on 2026-11-01, and some performances are that day. `nyLocalToIso` uses `Intl` to get the real offset for each wall time (Oct 31 → `-04:00`, Nov 1 afternoon → `-05:00`).
- Wicked is $55, above the $30-50 range; flagged in step 5, not dropped.
- Active rows link to `/enter-lottery/?lottery=<id>&window=popup`. We only output the link; we never request it.
- Removed an unchecked selector (`.lottery-hd h1`) before the first run; the show name comes from the home page card, which was inspected.

## 2026-10-31: normalize.ts

- Tested on the saved step 3/4 output (235 raw → 235 offers, no duplicates), so no String requests were spent.
- Times: TodayTix lottery times arrive as `2026-10-26T00:00-04:00` (no seconds), rush as `…T09:00:00-04:00`. `toNyIso` re-renders every time as `YYYY-MM-DDTHH:mm:ss±hh:mm` in America/New_York.
- Broadway Direct names are all caps with "(NY)". `cleanShowName` strips the suffix and title-cases all-caps names only, keeping 2-letter initials (MJ). **Bug fixed:** "Stranger Things: the First Shadow"; a small word right after a colon now keeps its capital.
- Known cosmetic gap: "SIX" becomes "Six" (the official styling is all caps).
- `priceInRange` is `false` only for Wicked ($55); `null` would mean an unknown price (none today).
- Garbage input (NaN price, unparseable time, blank theatre) becomes `null` fields, not an exception.

## 2026-10-31: render.ts + index.ts

- `out/index.html` is one static file with the feed inlined. Scraped text is in a `<script>` block, so `<` is escaped as `<`, rows are built with `textContent` (never `innerHTML`), and links must be `http(s)`.
- "Open right now" needs at least one known bound, and no known bound may exclude now. This matters for Broadway Direct rows that have only `closesAt` (active) or only `opensAt` (upcoming). Checked at 2:31 PM NY on Oct 30: 15 of 235 open.
- `offers.json` is `{generatedAt, sources, count, priceRange, offers}` rather than a bare array, so a failed source shows up as `error` instead of silently looking like zero offers.
- The first preview was rendered from saved step 3/4 output (no String requests); `generatedAt` is the time that data was fetched.
- `tsx -e` compiles to CJS and rejects top-level `await`; wrap ad-hoc scripts in an async IIFE.

## 2026-10-31: test suite

- `npm test`: 35 tests, `node:test` via `tsx --test`, about 16 s (most of it is the real 1.5 s spacing in the queue tests). Offline: `fetch` is mocked and tests `chdir` into a temp dir, so `.cache/` and `out/` are untouched.
- To make the parsers testable, `offersFromShowPage` (both sources) and `showUrls` (TodayTix) are now exported.
- The "open right now" test pulls `isOpen` out of the generated `index.html`, so it tests the code that actually ships, not a copy.
- **Mutation check:** putting back the old bare `challenge-platform` pattern fails the Cloudflare-beacon regression test; setting `DELAY_MS = 0` fails the queue-spacing test. Both were restored afterwards.
