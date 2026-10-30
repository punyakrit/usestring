// Broadway Direct official lotteries. Server-rendered HTML, parsed with cheerio.
// Home page lists the shows; each /show/<slug>/ page has one row per performance.
// We only read pages. The "Enter Now" href is passed through as a link, never followed.
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { fetchPage } from "../string.js";
import { nyDate, nyLocalToIso, type RawOffer } from "../normalize.js";

const HOME_URL = "https://lottery.broadwaydirect.com/";
const SOURCE = "broadwaydirect";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function parsePrice(text: string): number | null {
  const m = text.match(/\$\s?(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

// "10/31/26, 2:00 pm" -> NY ISO
function parseDateTime(text: string): string | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s*(?:at\s*)?(\d{1,2}):(\d{2})\s*([ap])\.?m/i);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return nyLocalToIso(year, Number(m[1]), Number(m[2]), to24h(Number(m[4]), m[6]), Number(m[5]));
}

function to24h(hour: number, ampm: string): number {
  const pm = ampm.toLowerCase() === "p";
  return (hour % 12) + (pm ? 12 : 0);
}

// "Closes Today at 3:00 pm" / "Opens 10/31/26 at 9:00 am" -> NY ISO.
// "Today" is the NY date the page was fetched, not the date we parse it.
function parseBound(status: string, word: "Opens" | "Closes", fetchedAt: number): string | null {
  const m = status.match(new RegExp(`${word}\\s+(Today|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})\\s+at\\s+(\\d{1,2}):(\\d{2})\\s*([ap])\\.?m`, "i"));
  if (!m) return null;
  let [y, mo, d] = nyDate(fetchedAt);
  if (m[1].toLowerCase() !== "today") {
    const [a, b, c] = m[1].split("/").map(Number);
    [y, mo, d] = [c < 100 ? 2000 + c : c, a, b];
  }
  return nyLocalToIso(y, mo, d, to24h(Number(m[2]), m[4]), Number(m[3]));
}

export function offersFromShowPage(url: string, html: string, fetchedAt: number, show: string | null, now: number): RawOffer[] {
  const $ = cheerio.load(html);
  const theatre = clean($(".venue-information h2").first().text()) || null;
  const offers: RawOffer[] = [];

  $(".lotteries-row").each((_, row) => {
    const $row = $(row);
    const status = clean($row.find(".lotteries-status").text());
    if (/^closed\b/i.test(status)) return;

    const opensAt = parseBound(status, "Opens", fetchedAt);
    const closesAt = parseBound(status, "Closes", fetchedAt);
    if (!opensAt && !closesAt) console.warn(`[broadwaydirect] unrecognised status "${status}" on ${url}`);
    if (closesAt && Date.parse(closesAt) < now) return;

    const enter = $row.find("a.enter-lottery-link, a.enter-button").attr("href");
    offers.push({
      source: SOURCE,
      show,
      theatre,
      type: "lottery",
      price: parsePrice($row.find(".price").text()),
      opensAt,
      closesAt,
      performanceAt: parseDateTime($row.find(".lotteries-time").text()),
      url: enter && enter !== "#" ? enter : url,
    });
  });
  return offers;
}

export async function fetchBroadwayDirect(now = Date.now()): Promise<RawOffer[]> {
  const home = await fetchPage(HOME_URL);
  if (home.blocked) {
    console.warn(`[broadwaydirect] home blocked: ${home.blockReason}`);
    return [];
  }
  const $ = cheerio.load(home.body);
  const shows = $(".content-card")
    .map((_, card) => ({
      name: clean($(card).find("h4").first().text()) || null,
      url: $(card).find("a[href*='/show/']").first().attr("href") ?? null,
    }))
    .get()
    .filter((s): s is { name: string | null; url: string } => !!s.url);
  if (shows.length === 0) console.warn("[broadwaydirect] no .content-card shows on home page");

  const offers: RawOffer[] = [];
  let i = 0;
  for (const s of shows) {
    i++;
    try {
      const page = await fetchPage(s.url);
      if (page.blocked) {
        console.warn(`[broadwaydirect] ${i}/${shows.length} blocked (${page.blockReason}): ${s.url}`);
        continue;
      }
      const found = offersFromShowPage(s.url, page.body, Date.parse(page.fetchedAt), s.name, now);
      console.log(`[broadwaydirect] ${i}/${shows.length} ${page.fromCache ? "cache" : "fetch"} ${found.length} offers  ${s.url}`);
      offers.push(...found);
    } catch (err) {
      console.warn(`[broadwaydirect] ${i}/${shows.length} failed: ${s.url}: ${(err as Error).message}`);
    }
  }
  return offers;
}

// CLI: npm run source:broadwaydirect
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const offers = await fetchBroadwayDirect();
  console.log(JSON.stringify(offers, null, 2));
}
