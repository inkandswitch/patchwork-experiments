// Open any doc in the REAL Patchwork in headless Chrome, accept every offer to
// load a package, wait, and screenshot. For a scene: the builds happen in this
// browser, so give it time (--wait seconds).
//
//   node probes/real-look.mjs <automerge url> <out.png> [--wait 60] [--gpu] [--shell https://…]
import { browser, sleep } from "./cdp.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const [url, out] = process.argv.slice(2);
const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WAIT = Number(arg("--wait", 60));
const SHELL = arg("--shell", "https://patchwork.inkandswitch.com");
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const b = await browser({ root: PKG, port: 4799, cdp: 9799, page: "/README.md", width: 1500, height: 950, gpu: process.argv.includes("--gpu"), timeout: (WAIT + 120) * 1000 });
const DEEP = `(sel) => { const out = []; const walk = (root) => { out.push(...root.querySelectorAll(sel)); for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); }; walk(document); return out; }`;
await b.send("Page.navigate", { url: `${SHELL}/#doc=${url}` });
const clicked = [];
for (let t = 0; t < WAIT; t++) {
  await sleep(1000);
  const c = await b.js(`(() => { const hits = (${DEEP})("button").filter((x) => /^\\s*(load|load (it|them|package|packages)|trust and load)\\b/i.test(x.innerText ?? "")); setTimeout(() => hits.forEach((x) => x.click()), 0); return hits.map((x) => x.innerText.trim()); })()`);
  clicked.push(...c);
  await sleep(200);
  try { await b.send("Page.handleJavaScriptDialog", { accept: true }); clicked.push("(dialog)"); } catch {}
}
await b.shot(out);
console.log(JSON.stringify({ clicked, logs: b.logs.filter((l) => /error|exception|warn/i.test(l)).slice(-15) }, null, 2));
b.stop(0);
