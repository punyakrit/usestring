// Shapes shared by every source, and the one place raw offers become the final list.

export type OfferType = "rush" | "lottery";

export const PRICE_MIN = 30;
export const PRICE_MAX = 50;

// The normalised record written to out/offers.json.
export type Offer = {
  show: string | null;
  theatre: string | null;
  type: OfferType;
  price: number | null;
  opensAt: string | null;
  closesAt: string | null;
  source: string;
  url: string | null;
  performanceAt: string | null;
  priceInRange: boolean | null; // null when the price is unknown
};

// What a source hands back: already per-performance, times as the site gave them.
export type RawOffer = {
  source: string;
  show: string | null;
  theatre: string | null;
  type: OfferType;
  price: number | null;
  opensAt: string | null;
  closesAt: string | null;
  performanceAt: string | null;
  url: string | null;
};

const NY = "America/New_York";

// Minutes NY is offset from UTC at a given instant (-240 in EDT, -300 in EST).
function nyOffsetMinutes(utcMs: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: NY, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(utcMs).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

// A New York wall-clock time -> ISO string with its offset, e.g. 2026-10-31T14:00:00-04:00.
export function nyLocalToIso(year: number, month: number, day: number, hour: number, minute: number): string | null {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(wall)) return null;
  // Guess with the offset at that wall time, then correct once (covers DST edges).
  let offset = nyOffsetMinutes(wall);
  offset = nyOffsetMinutes(wall - offset * 60_000);
  const sign = offset <= 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// The New York calendar date of an instant, as [year, month, day].
export function nyDate(utcMs: number): [number, number, number] {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: NY }).format(utcMs).split("-").map(Number);
  return [y, m, d];
}

// Any ISO-ish timestamp -> the same instant as a NY ISO string, so every source
// uses one format (TodayTix lottery times arrive without seconds, rush with them).
export function toNyIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: NY, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(ms).map((x) => [x.type, x.value]),
  );
  return nyLocalToIso(+p.year, +p.month, +p.day, +p.hour, +p.minute);
}

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);

// "THE LION KING (NY)" -> "The Lion King"; mixed-case names are only trimmed.
export function cleanShowName(name: string | null | undefined): string | null {
  if (!name) return null;
  let s = name.replace(/\s*\((NY|NYC|New York)\)\s*$/i, "").replace(/\s+/g, " ").trim();
  if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) {
    s = s.toLowerCase().split(" ").map((w, i, words) => {
      if (i > 0 && SMALL_WORDS.has(w) && !words[i - 1].endsWith(":")) return w;
      // Short all-caps tokens are usually initials (MJ), keep them upper case.
      if (w.length <= 2 && /^[a-z]+$/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }
  return s || null;
}

function cleanText(s: string | null | undefined): string | null {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t : null;
}

function cleanPrice(p: number | null | undefined): number | null {
  return typeof p === "number" && Number.isFinite(p) && p > 0 ? Math.round(p * 100) / 100 : null;
}

function normalizeOne(raw: RawOffer): Offer {
  const price = cleanPrice(raw.price);
  return {
    show: cleanShowName(raw.show),
    theatre: cleanText(raw.theatre),
    type: raw.type,
    price,
    opensAt: toNyIso(raw.opensAt),
    closesAt: toNyIso(raw.closesAt),
    source: raw.source,
    url: cleanText(raw.url),
    performanceAt: toNyIso(raw.performanceAt),
    priceInRange: price === null ? null : price >= PRICE_MIN && price <= PRICE_MAX,
  };
}

// Raw offers from all sources -> one deduplicated list sorted by show, then performance.
// A record that fails to normalise is logged and dropped, never thrown.
export function normalize(raws: RawOffer[]): Offer[] {
  const seen = new Set<string>();
  const out: Offer[] = [];
  for (const raw of raws) {
    let offer: Offer;
    try {
      offer = normalizeOne(raw);
    } catch (err) {
      console.warn(`[normalize] skipped a ${raw?.source} record: ${(err as Error).message}`);
      continue;
    }
    const key = [offer.source, offer.type, offer.show, offer.performanceAt, offer.url].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(offer);
  }
  return out.sort((a, b) =>
    (a.show ?? "").localeCompare(b.show ?? "") || (a.performanceAt ?? "").localeCompare(b.performanceAt ?? ""));
}
