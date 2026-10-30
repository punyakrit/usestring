// fetchPage with a mocked global fetch, in a temp working dir: no real String requests.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectBlock, fetchPage } from "../src/string.js";

const realFetch = globalThis.fetch;
const startDir = process.cwd();
let dir = "";

type Call = { url: string; init: RequestInit; start: number; end: number };
let calls: Call[] = [];
let inFlight = 0;
let maxInFlight = 0;

// Mock String: echoes an envelope; `respond` decides what the destination "returned".
let respond: (target: string) => { status: number; body: string } = () => ({
  status: 200,
  body: JSON.stringify({ statusCode: 200, headers: {}, data: "<html><title>Real page</title>" + "x".repeat(30_000) + "</html>" }),
});

before(() => {
  dir = mkdtempSync(join(tmpdir(), "string-test-"));
  process.chdir(dir);
  process.env.STRING_API_KEY = "test-key";
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = { url: String(url), init, start: Date.now(), end: 0 };
    calls.push(call);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 50));
    const target = JSON.parse(String(init.body)).url;
    const { status, body } = respond(target);
    inFlight--;
    call.end = Date.now();
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  process.chdir(startDir);
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  maxInFlight = 0;
});

test("detectBlock: the passive Cloudflare beacon on a real page is NOT a block (regression)", () => {
  const page = `<title>Lottery | Broadway Direct</title><script>var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js'</script>${"x".repeat(30_000)}`;
  assert.equal(detectBlock(200, page), null);
});

test("detectBlock: real block pages are caught even with HTTP 200", () => {
  assert.equal(detectBlock(200, "<title>Just a moment...</title><script>window._cf_chl_opt={}</script>"), "cloudflare challenge");
  assert.equal(detectBlock(200, "<h1>Access Denied</h1>"), "access denied");
  assert.equal(detectBlock(200, "Please verify you are a human"), "human verification");
  assert.equal(detectBlock(200, "<title>Captcha</title>" + "x".repeat(30_000)), "captcha");
  assert.equal(detectBlock(200, "<div>solve the captcha</div>"), "captcha"); // tiny page
  assert.equal(detectBlock(200, "   "), "empty body");
  assert.equal(detectBlock(403, "<html>ok</html>"), "HTTP 403");
  assert.equal(detectBlock(429, "<html>ok</html>"), "HTTP 429");
});

test("detectBlock: a big real page that loads reCAPTCHA for its own form is NOT a block", () => {
  const page = `<title>Aladdin (NY) Lottery</title><script src="https://www.google.com/recaptcha/api.js"></script>${"x".repeat(30_000)}`;
  assert.equal(detectBlock(200, page), null);
});

test("fetchPage sends a GET-only, no-captcha-solving request to String with the key", async () => {
  const r = await fetchPage("https://example.com/a");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://request.usestring.ai/v1/fetch");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer test-key");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body, { url: "https://example.com/a", method: "GET", solveCaptcha: false });
  assert.equal(r.statusCode, 200);
  assert.equal(r.blocked, false);
  assert.match(r.body, /Real page/); // page comes from the envelope's .data
});

test("fetchPage serves a second call for the same URL from .cache/ without a request", async () => {
  await fetchPage("https://example.com/cached");
  const second = await fetchPage("https://example.com/cached");
  assert.equal(calls.length, 1);
  assert.equal(second.fromCache, true);
  assert.ok(readdirSync(".cache").length >= 1);
});

test("fetchPage refetches once the cache entry is older than 30 minutes", async () => {
  await fetchPage("https://example.com/stale");
  const file = readdirSync(".cache").map((f) => join(".cache", f))
    .find((f) => JSON.parse(readFileSync(f, "utf8")).url === "https://example.com/stale")!;
  const entry = JSON.parse(readFileSync(file, "utf8"));
  entry.fetchedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  writeFileSync(file, JSON.stringify(entry));
  const r = await fetchPage("https://example.com/stale");
  assert.equal(calls.length, 2);
  assert.equal(r.fromCache, false);
});

test("fetchPage keeps one request in flight and at least 1.5 s between requests", async () => {
  await Promise.all(["https://example.com/q1", "https://example.com/q2", "https://example.com/q3"].map((u) => fetchPage(u)));
  assert.equal(calls.length, 3);
  assert.equal(maxInFlight, 1);
  for (let i = 1; i < calls.length; i++) {
    const gap = calls[i].start - calls[i - 1].end;
    assert.ok(gap >= 1490, `gap ${i} was ${gap} ms`);
  }
});

test("fetchPage marks a 200 block page as blocked and caches it for inspection", async () => {
  respond = () => ({ status: 200, body: JSON.stringify({ statusCode: 200, headers: {}, data: "<title>Access Denied</title>" }) });
  const r = await fetchPage("https://example.com/blocked");
  assert.equal(r.blocked, true);
  assert.equal(r.blockReason, "access denied");
  const again = await fetchPage("https://example.com/blocked");
  assert.equal(again.fromCache, true);
  assert.equal(again.blocked, true); // block check re-runs on cached reads
  assert.equal(calls.length, 1);
});

test("fetchPage treats a String API error as blocked and does not cache it", async () => {
  respond = () => ({ status: 402, body: JSON.stringify({ error: "insufficient_credits" }) });
  const r = await fetchPage("https://example.com/no-credit");
  assert.equal(r.blocked, true);
  assert.match(r.blockReason ?? "", /String API 402/);
  await fetchPage("https://example.com/no-credit");
  assert.equal(calls.length, 2); // not cached, so it is retried
});

test("fetchPage reports the destination status from the envelope, not String's 200", async () => {
  respond = () => ({ status: 200, body: JSON.stringify({ statusCode: 403, headers: {}, data: "<html>forbidden</html>" }) });
  const r = await fetchPage("https://example.com/forbidden");
  assert.equal(r.statusCode, 403);
  assert.equal(r.blockReason, "HTTP 403");
});
