// The whole loop in the REAL Patchwork: open a case, point it at a live
// daemon's inbox, set a speed, press Run, and wait until the run comes back
// done, all through the UI (headless Chrome, a fresh profile).
//
//   node probes/real-run.mjs <case url> <inbox url> [--knots 5] [--shots dir] [--wait 600]

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [caseUrl, inbox] = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const KNOTS = Number(arg("--knots", 5));
const WAIT = Number(arg("--wait", 600));
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "openfoam-real-run"));
mkdirSync(SHOTS, { recursive: true });
const b = await browser({ root: PKG, port: 4796, cdp: 9796, page: "/README.md", width: 1400, height: 1000, timeout: (WAIT + 240) * 1000 });
const list = checklist();
const { check } = list;
const DEEP = `(sel) => { const out = []; const walk = (root) => { out.push(...root.querySelectorAll(sel)); for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); }; walk(document); return out; }`;
const q = (sel) => `(${DEEP})(${JSON.stringify(sel)})[0]`;
/** set an input's value and fire change, as a person typing and leaving it */
const fill = (sel, value) => b.js(`(() => { const el = ${q(sel)}; if (!el) return false; el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const text = (sel) => b.js(`${q(sel)}?.innerText ?? null`);
const t0 = Date.now();
const s = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
try {
  await b.send("Page.navigate", { url: `https://patchwork.inkandswitch.com/#doc=${caseUrl}` });
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) {
    await sleep(1000);
    await b.js(`(() => { const hits = (${DEEP})("button").filter((x) => /^\\s*(load|load (it|them|package|packages))\\b/i.test(x.innerText ?? "")); setTimeout(() => hits.forEach((x) => x.click()), 0); })()`);
    await sleep(200);
    try {
      await b.send("Page.handleJavaScriptDialog", { accept: true });
    } catch {}
    ready = await b.js(`!!${q(".openfoam .run")}`);
  }
  check("the case opened in the tool", ready);
  // the server: forget any, then paste the live inbox
  await b.js(`${q(".openfoam .server-forget")}?.hidden === false && ${q(".openfoam .server-forget")}.click()`);
  await sleep(500);
  check("the inbox link is accepted", await fill(".openfoam .server-url", inbox));
  let online = false;
  for (let i = 0; i < 30 && !online; i++) {
    await sleep(1000);
    online = /online/.test((await text(".openfoam .server-box")) ?? "");
  }
  check("the daemon shows online", online, await text(".openfoam .server-box"));
  await fill('.openfoam select[data-k="mode"]', "double-body");
  await fill('.openfoam select[data-k="speedUnit"]', "kn");
  await sleep(300);
  await fill('.openfoam input[data-k="speed"]', KNOTS);
  await sleep(800);
  const label = await text(".openfoam .run");
  check(`Run names ${KNOTS} kn`, new RegExp(`${KNOTS.toFixed(2)} kn`).test(label ?? ""), label);
  const before = await b.js(`(${DEEP})(".openfoam .runs-table tr[data-url]").length`);
  await b.js(`${q(".openfoam .run")}.click()`);
  console.error(`${s()} pressed Run`);
  let last = "";
  let done = false;
  for (let i = 0; i < WAIT && !done; i++) {
    await sleep(1000);
    const st = (await text(".openfoam .status-chip")) ?? "";
    const prog = (await text(".openfoam .head-info")) ?? "";
    const line = `${st.trim()} ${prog.replace(/\s+/g, " ").slice(0, 90)}`;
    if (line !== last) console.error(`${s()} ${line}`);
    last = line;
    if (i === 25) await b.shot(join(SHOTS, "1-running.png"));
    done = /Done|Failed|Cancelled/.test(st);
  }
  const after = await b.js(`(${DEEP})(".openfoam .runs-table tr[data-url]").length`);
  check("a run was added to the case", after === before + 1, { before, after });
  check("it came back done", /Done/.test((await text(".openfoam .status-chip")) ?? ""), await text(".openfoam .status-chip"));
  await sleep(2000);
  const tiles = await b.js(`(${DEEP})(".openfoam .tile").map((x) => x.innerText.replace(/\\n+/g, " | "))`);
  check("its figures are shown", tiles.length === 4, tiles);
  await b.js(`${q(".openfoam .results-box")}?.scrollIntoView()`);
  await sleep(800);
  await b.shot(join(SHOTS, "2-done.png"));
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
}
console.log(JSON.stringify({ checks: list.checks, details: list.details, logs: b.logs.filter((l) => /error|exception/i.test(l)).slice(-10) }, null, 2));
b.stop(list.failed ? 1 : 0);
