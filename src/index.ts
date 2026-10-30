// npm start: run every source (one failing never stops the others), normalise, render.
import { normalize, type RawOffer } from "./normalize.js";
import { render, type RenderMeta } from "./render.js";
import { fetchBroadwayDirect } from "./sources/broadwaydirect.js";
import { fetchTodayTix } from "./sources/todaytix.js";

const SOURCES: [string, () => Promise<RawOffer[]>][] = [
  ["todaytix", () => fetchTodayTix()],
  ["broadwaydirect", () => fetchBroadwayDirect()],
];

const raws: RawOffer[] = [];
const sources: RenderMeta["sources"] = {};

for (const [name, run] of SOURCES) {
  try {
    const found = await run();
    raws.push(...found);
    sources[name] = { offers: found.length, error: null };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[${name}] failed: ${message}`);
    sources[name] = { offers: 0, error: message };
  }
}

const offers = normalize(raws);
await render(offers, { generatedAt: new Date().toISOString(), sources });

console.log(`\n${offers.length} offers → out/offers.json, out/index.html`);
for (const [name, s] of Object.entries(sources)) console.log(`  ${name}: ${s.offers}${s.error ? ` (error: ${s.error})` : ""}`);
