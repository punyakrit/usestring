// The only network path in this project: every page goes through the String
// Web Access API, one request at a time, with a cache in front of it.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://request.usestring.ai/v1/fetch";
const CACHE_DIR = ".cache";
const CACHE_TTL_MS = 30 * 60 * 1000;
const DELAY_MS = 1500;
const TIMEOUT_MS = 120_000;

export type FetchOptions = {
  executeJS?: boolean;
  countryCode?: string;
};

export type FetchResult = {
  url: string;
  statusCode: number | null;
  body: string;
  blocked: boolean;
  blockReason: string | null;
  fromCache: boolean;
  fetchedAt: string;
};

// Text that means "you got a challenge or block page, not the real page".
const BLOCK_PATTERNS: [RegExp, string][] = [
  [/access denied/i, "access denied"],
  [/verify you are (a )?human/i, "human verification"],
  // Not bare "challenge-platform": Cloudflare's passive /scripts/jsd/ beacon is on real pages too.
  [/cf-chl|cf_chl_opt|challenge-platform\/h\//i, "cloudflare challenge"],
  [/just a moment\.\.\./i, "cloudflare interstitial"],
  [/pardon our interruption/i, "bot wall"],
  [/px-captcha|perimeterx/i, "perimeterx captcha"],
  [/request blocked|you have been blocked/i, "request blocked"],
];

export function detectBlock(statusCode: number | null, body: string): string | null {
  if (statusCode !== null && (statusCode < 200 || statusCode >= 300)) return `HTTP ${statusCode}`;
  if (body.trim().length === 0) return "empty body";
  for (const [re, reason] of BLOCK_PATTERNS) if (re.test(body)) return reason;
  // Real pages can load reCAPTCHA for their own forms, so the bare word only
  // counts when it is in the title or the page is tiny.
  const title = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "";
  if (/captcha/i.test(title) || (body.length < 20_000 && /captcha/i.test(body))) return "captcha";
  return null;
}

function cachePath(url: string, opts: FetchOptions): string {
  const key = JSON.stringify({ url, executeJS: !!opts.executeJS, countryCode: opts.countryCode ?? null });
  return join(CACHE_DIR, createHash("sha1").update(key).digest("hex") + ".json");
}

async function readCache(path: string): Promise<FetchResult | null> {
  try {
    const cached = JSON.parse(await readFile(path, "utf8")) as FetchResult;
    if (Date.now() - Date.parse(cached.fetchedAt) > CACHE_TTL_MS) return null;
    // Re-check on read so a fixed block rule applies to cached pages too.
    const blockReason = detectBlock(cached.statusCode, cached.body);
    return { ...cached, blocked: blockReason !== null, blockReason, fromCache: true };
  } catch {
    return null;
  }
}

// Serialise all network calls: one in flight, DELAY_MS between them.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + DELAY_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await task();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  queue = run.catch(() => {});
  return run;
}

async function callString(url: string, opts: FetchOptions): Promise<FetchResult> {
  const apiKey = process.env.STRING_API_KEY;
  if (!apiKey) throw new Error("STRING_API_KEY is not set (copy .env.example to .env)");

  // GET only, and never solve captchas: a challenge means we stop.
  const payload: Record<string, unknown> = { url, method: "GET", solveCaptcha: false };
  if (opts.executeJS) payload.executeJS = true;
  if (opts.countryCode) payload.countryCode = opts.countryCode;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  const fetchedAt = new Date().toISOString();

  if (!res.ok) {
    // String itself refused (bad key, no credit, destination not enabled, upstream failure).
    return {
      url, statusCode: null, body: text, blocked: true,
      blockReason: `String API ${res.status}: ${text.slice(0, 200)}`, fromCache: false, fetchedAt,
    };
  }

  // Default format is the JSON envelope {statusCode, headers, data}.
  let statusCode: number | null = null;
  let body = text;
  try {
    const env = JSON.parse(text);
    statusCode = typeof env.statusCode === "number" ? env.statusCode : null;
    body = typeof env.data === "string" ? env.data : JSON.stringify(env.data ?? "");
  } catch {
    // Not an envelope; keep the raw text.
  }
  const blockReason = detectBlock(statusCode, body);
  return { url, statusCode, body, blocked: blockReason !== null, blockReason, fromCache: false, fetchedAt };
}

export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const path = cachePath(url, opts);
  const cached = await readCache(path);
  if (cached) return cached;

  const result = await enqueue(() => callString(url, opts));
  // Cache destination responses (blocked ones too, so we can inspect them),
  // but not String API errors, so a fixed key or topped-up account works at once.
  if (result.statusCode !== null) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path, JSON.stringify(result, null, 2));
  }
  return result;
}

// CLI: npm run fetch -- <url> [--js]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const urls = args.filter((a) => !a.startsWith("--"));
  const executeJS = args.includes("--js");
  for (const url of urls) {
    const t0 = Date.now();
    const r = await fetchPage(url, { executeJS });
    console.log(JSON.stringify({
      url: r.url, statusCode: r.statusCode, bytes: r.body.length, blocked: r.blocked,
      blockReason: r.blockReason, fromCache: r.fromCache, ms: Date.now() - t0,
      cacheFile: cachePath(url, { executeJS }),
    }));
  }
}
