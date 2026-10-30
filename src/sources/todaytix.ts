// TodayTix: read the __NEXT_DATA__ JSON, never the rendered HTML.
// 1 category page lists the rush/lottery shows; each show page has per-performance windows.
// Entries happen in the TodayTix app, so `url` is the show page, never an entry action.
import { fileURLToPath } from "node:url";
import { fetchPage } from "../string.js";
import type { OfferType, RawOffer } from "../normalize.js";

const BASE = "https://www.todaytix.com";
const CATEGORY_URL = `${BASE}/nyc/category/rush-tickets`;
const SOURCE = "todaytix";

type Price = { value?: number } | null | undefined;
type Window = { availableAfter?: string; availableUntil?: string; lowPrice?: Price } | null | undefined;

function nextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// Show URLs come from the page's own links: `slug` is null for some shows.
export function showUrls(html: string, shows: any[]): string[] {
  const hrefs = new Map<string, string>();
  for (const m of html.matchAll(/href="(?:https:\/\/www\.todaytix\.com)?(\/nyc\/shows\/(\d+)-[^"?#]*)"/g)) {
    if (!hrefs.has(m[2])) hrefs.set(m[2], m[1]);
  }
  const urls: string[] = [];
  for (const s of shows) {
    if (s?.id == null) continue;
    const path = hrefs.get(String(s.id)) ?? `/nyc/shows/${s.id}${s.slug ? `-${s.slug}` : ""}`;
    urls.push(BASE + path);
  }
  return urls;
}

function priceOf(p: Price): number | null {
  return typeof p?.value === "number" ? p.value : null;
}

export function offersFromShowPage(url: string, html: string, now: number): RawOffer[] {
  const props = nextData(html)?.props?.pageProps;
  const product = props?.product;
  if (!product) {
    console.warn(`[todaytix] no product data: ${url}`);
    return [];
  }
  if (product.venue?.area !== "Broadway") return [];

  const show = product.displayName ?? product.name ?? null;
  const theatre = product.venue?.name ?? null;
  const rushFallback = priceOf(props?.rushSettings?.rushPrice);
  const offers: RawOffer[] = [];

  for (const st of Array.isArray(props?.initialShowtimes) ? props.initialShowtimes : []) {
    const windows: [OfferType, Window][] = [["lottery", st?.lotteryTickets], ["rush", st?.rushTickets]];
    for (const [type, w] of windows) {
      if (!w) continue;
      const closes = w.availableUntil ? Date.parse(w.availableUntil) : NaN;
      if (!Number.isNaN(closes) && closes < now) continue; // window already closed
      offers.push({
        source: SOURCE,
        show,
        theatre,
        type,
        price: priceOf(w.lowPrice) ?? (type === "rush" ? rushFallback : null),
        opensAt: w.availableAfter ?? null,
        closesAt: w.availableUntil ?? null,
        performanceAt: st?.datetime ?? null,
        url,
      });
    }
  }
  return offers;
}

export async function fetchTodayTix(now = Date.now()): Promise<RawOffer[]> {
  const cat = await fetchPage(CATEGORY_URL);
  if (cat.blocked) {
    console.warn(`[todaytix] category blocked: ${cat.blockReason}`);
    return [];
  }
  const shows = nextData(cat.body)?.props?.pageProps?.productList?.results?.shows;
  if (!Array.isArray(shows)) {
    console.warn("[todaytix] productList.results.shows not found on category page");
    return [];
  }

  const urls = showUrls(cat.body, shows);
  const offers: RawOffer[] = [];
  let i = 0;
  for (const url of urls) {
    i++;
    try {
      const page = await fetchPage(url);
      if (page.blocked) {
        console.warn(`[todaytix] ${i}/${urls.length} blocked (${page.blockReason}): ${url}`);
        continue;
      }
      const found = offersFromShowPage(url, page.body, now);
      console.log(`[todaytix] ${i}/${urls.length} ${page.fromCache ? "cache" : "fetch"} ${found.length} offers  ${url}`);
      offers.push(...found);
    } catch (err) {
      console.warn(`[todaytix] ${i}/${urls.length} failed: ${url}: ${(err as Error).message}`);
    }
  }
  return offers;
}

// CLI: npx tsx --env-file=.env src/sources/todaytix.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const offers = await fetchTodayTix();
  console.log(JSON.stringify(offers, null, 2));
}
