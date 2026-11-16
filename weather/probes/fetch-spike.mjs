// W0 spike (WEATHER.md, "Spike"): can code running in the real Patchwork page
// fetch Open-Meteo? Opens https://patchwork.inkandswitch.com/ with no doc (so
// nothing is written anywhere), then in the page context reads any CSP meta,
// listens for securitypolicyviolation, and fetches the forecast and archive
// APIs with coordinates and variable names only. Prints one JSON line.
// One headless Chrome; the caller holds the machine's Chrome lock.
//   node probes/fetch-spike.mjs
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { browser, sleep } from "./cdp.mjs";

const URLS = [
  "https://api.open-meteo.com/v1/forecast?latitude=48.454&longitude=-123.2915&current=wind_speed_10m",
  "https://archive-api.open-meteo.com/v1/archive?latitude=48.95&longitude=-125.558&start_date=2025-07-15&end_date=2025-07-15&hourly=wind_speed_10m",
];
const b = await browser({ root: dirname(fileURLToPath(import.meta.url)), port: 4917, cdp: 9917, page: "/blank.html", timeout: 300_000 });
let code = 1;
try {
  await b.send("Page.navigate", { url: "https://patchwork.inkandswitch.com/" });
  await sleep(8000);
  const out = await b.js(`(async () => {
    const violations = [];
    addEventListener("securitypolicyviolation", (e) => violations.push({ directive: e.violatedDirective, blocked: e.blockedURI }));
    const meta = [...document.querySelectorAll('meta[http-equiv]')].map((m) => [m.httpEquiv, m.content]);
    const frames = document.querySelectorAll("iframe").length;
    const results = [];
    for (const url of ${JSON.stringify(URLS)}) {
      try { const r = await fetch(url); const j = await r.json(); results.push({ url, status: r.status, keys: Object.keys(j), current: j.current ?? null, hours: j.hourly?.time?.length ?? null }); }
      catch (e) { results.push({ url, error: String(e) }); }
    }
    await new Promise((r) => setTimeout(r, 500));
    return { origin: location.origin, title: document.title, meta, frames, results, violations };
  })()`);
  console.log(JSON.stringify(out));
  code = out.results.every((r) => r.status === 200) && !out.violations.length ? 0 : 1;
} catch (e) {
  console.error(e);
} finally {
  b.stop(code);
}
