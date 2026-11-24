// Open a published case in the REAL Patchwork (patchwork.inkandswitch.com) in
// headless Chrome, accept its offer to load this package, and check that the
// tool shows the case's finished run: its tiles, its plots, the runs table.
//
//   node probes/real-check.mjs <case url> [--shots dir] [--show] [--shell https://…]

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2];
if (!url?.startsWith("automerge:")) throw new Error("usage: real-check.mjs automerge:<case>");
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "openfoam-real"));
const SHELL = arg("--shell", "https://patchwork.inkandswitch.com");
mkdirSync(SHOTS, { recursive: true });

const b = await browser({ root: PKG, port: 4797, cdp: 9797, page: "/README.md", width: 1400, height: 1000, show: process.argv.includes("--show"), timeout: 240_000 });
const list = checklist();
const { check } = list;
// a querySelectorAll that goes through open shadow roots
const DEEP = `(sel) => { const out = []; const walk = (root) => { out.push(...root.querySelectorAll(sel)); for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); }; walk(document); return out; }`;
const deep = (sel, map) => b.js(`(${DEEP})(${JSON.stringify(sel)}).map(${map})`);
const shots = [];
try {
  await b.send("Page.navigate", { url: `${SHELL}/#doc=${url}` });
  // the shell offers to load a package a doc suggests: accept every offer it makes
  let clicked = [];
  let tool = false;
  for (let i = 0; i < 90 && !tool; i++) {
    await sleep(1000);
    // click after the evaluate returns: a click may open a native confirm(), which blocks the page
    const c = await b.js(`(() => { const all = (${DEEP})("button"); const hits = all.filter((x) => /^\\s*(load|load (it|them|package|packages)|trust and load)\\b/i.test(x.innerText ?? "")); setTimeout(() => hits.forEach((x) => x.click()), 0); return hits.map((x) => x.innerText.trim()); })()`);
    clicked.push(...c);
    await sleep(300);
    try {
      await b.send("Page.handleJavaScriptDialog", { accept: true });
      clicked.push("(accepted a dialog)");
    } catch {
      /* no dialog open */
    }
    tool = (await deep(".openfoam .tile", "(x) => 1")).length === 4;
  }
  check("the shell offered the package and the tool loaded", tool, { clicked });
  await sleep(2500);
  shots.push(await b.shot(join(SHOTS, "1-case.png")));
  const tiles = await deep(".openfoam .tile", "(x) => x.innerText.replace(/\\n+/g, ' | ')");
  const runs = await deep(".openfoam .runs-table tr[data-url]", "(x) => x.innerText.replace(/\\s+/g, ' ').trim()");
  const tabs = await deep(".openfoam .tabs button", "(x) => x.innerText");
  const hull = await deep(".openfoam .hull-chip", "(x) => x.innerText");
  check("it shows the selected run's figures", tiles.length === 4 && /N/.test(tiles[0]), tiles);
  check("it lists the case's runs", runs.length >= 1, runs);
  check("it offers the run's plots", tabs.length >= 3, tabs);
  check("it reads the linked hull", /glb/i.test(hull[0] ?? ""), hull);
  await b.js(`(${DEEP})(".openfoam")[0]?.querySelector(".results-box")?.scrollIntoView()`);
  await sleep(800);
  shots.push(await b.shot(join(SHOTS, "2-results.png")));
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
}
console.log(JSON.stringify({ checks: list.checks, details: list.details, shots, logs: b.logs.slice(-25) }, null, 2));
b.stop(list.failed ? 1 : 0);
