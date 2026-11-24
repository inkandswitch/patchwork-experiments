// The browser check: runs scenario.js in Node, then in headless Chrome
// (served from this package, IWAD included), and compares. Writes the
// browser's frames as PNGs and the report as JSON into the output directory.
//
//   node bench/browser/run.mjs [outdir]       (needs engines/doom/test/freedoom1.wad)
//   CHROME=/path/to/chrome node bench/browser/run.mjs
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { scenario } from "./scenario.js";

const root = resolve(new URL("../..", import.meta.url).pathname);
const iwad = process.env.FREEDOOM1 ?? join(root, "engines/doom/test/freedoom1.wad");
const out = resolve(process.argv[2] ?? join(root, "bench/browser/out"));
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(out, { recursive: true });

const node = await scenario({
  load: async (p) => new Uint8Array(readFileSync(p === "iwad" ? iwad : join(root, p))),
  now: () => performance.now(),
});

const MIME = { ".js": "text/javascript", ".html": "text/html", ".wasm": "application/wasm" };
let finish;
const reported = new Promise((r) => (finish = r));
const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/log") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => (res.writeHead(204).end(), process.env.PROBE_LOG && console.error("page:", body)));
    return;
  }
  if (req.method === "POST" && req.url === "/report") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(204).end();
      finish(JSON.parse(body));
    });
    return;
  }
  const url = new URL(req.url, "http://x").pathname;
  const path = url === "/iwad" ? iwad : join(root, url);
  if (!path.startsWith(root) && path !== iwad) return void res.writeHead(403).end();
  if (!existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(res);
}).listen(0);
const port = server.address().port;

const profile = mkdtempSync(join(tmpdir(), "machine-probe-"));
const browser = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run", "--mute-audio",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "--enable-logging=stderr",
  `http://localhost:${port}/bench/browser/probe.html`,
], { stdio: ["ignore", "ignore", "pipe"] });
let log = "";
browser.stderr.on("data", (d) => (log += d));
const exited = new Promise((r) => browser.on("exit", r));
const timeout = setTimeout(() => finish({ ok: false, fatal: "no report within 120 s" }), 120_000);
const report = await reported;
clearTimeout(timeout);
browser.kill();
await exited;
server.close();
rmSync(profile, { recursive: true, force: true, maxRetries: 5 });

if (!report.ok) {
  console.error(report.fatal);
  console.error(log.split("\n").filter((l) => /CONSOLE|ERROR/.test(l)).slice(-20).join("\n"));
  process.exit(1);
}
for (const [name, url] of Object.entries(report.pngs))
  writeFileSync(join(out, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
const web = report.result;
const problems = [];
for (const engine of Object.keys(node)) {
  if (JSON.stringify(node[engine].hashes) !== JSON.stringify(web[engine].hashes)) problems.push(`${engine}: hashes differ`);
  if (JSON.stringify(node[engine].pictures) !== JSON.stringify(web[engine].pictures)) problems.push(`${engine}: frames differ`);
  if (!web[engine].restored) problems.push(`${engine}: restore did not come back to the same state in the browser`);
  if (!node[engine].restored) problems.push(`${engine}: restore did not come back to the same state in Node`);
}
writeFileSync(join(out, "report.json"), JSON.stringify({ userAgent: report.userAgent, node, browser: web, problems }, null, 2));
for (const engine of Object.keys(node))
  console.log(engine, JSON.stringify({ hashes: web[engine].hashes, node_ms: node[engine].ms, browser_ms: web[engine].ms, snapshot_bytes: web[engine].snapshot_bytes, size: web[engine].size }));
console.log(report.userAgent);
console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : `node and browser agree on every hash and every frame; PNGs in ${out}`);
process.exit(problems.length ? 1 : 0);
