// The worker check: does a Super NES joiner catching up stall the page?
// Bundles bench/worker/page.js and src/worker/worker.js with esbuild, serves
// the package, and runs the page in headless Chrome once per mode (worker,
// main, greedy; see page.js), each in a fresh browser. Prints the reports,
// and writes them to report.json in outdir if one is given. The bundles go
// to a temporary directory, served as /out/.
//
//   node bench/worker/run.mjs [outdir]          (pnpm check:worker)
//   MODES=worker node bench/worker/run.mjs
//   CHROME=/path/to/chrome node bench/worker/run.mjs
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import * as esbuild from "esbuild";

const root = resolve(new URL("../..", import.meta.url).pathname);
const out = process.argv[2] && resolve(process.argv[2]);
const bundles = mkdtempSync(join(tmpdir(), "machine-worker-bundles-"));
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const modes = (process.env.MODES ?? "worker,main,greedy").split(","); // worker:10 is worker with a 10 ms budget (25 by default)

// Automerge's and Subduction's "browser" entries import their wasm as an ES
// module, which esbuild does not do; their plain "import" entries inline it
// as base64. A neutral platform takes those; the browser field's
// replacements still apply through mainFields.
await esbuild.build({
  absWorkingDir: root,
  entryPoints: { page: "bench/worker/page.js", worker: "src/worker/worker.js" },
  bundle: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["browser", "module", "main"],
  outdir: bundles,
  logLevel: "warning",
});

const MIME = { ".js": "text/javascript", ".html": "text/html", ".wasm": "application/wasm" };
let finish;
const server = createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(204).end();
      if (req.url === "/report") finish(JSON.parse(body));
      else if (process.env.PROBE_LOG) console.error("page:", body);
    });
    return;
  }
  const url = new URL(req.url, "http://x").pathname;
  const [base, rel] = url.startsWith("/out/") ? [bundles, url.slice(5)] : [root, url];
  const path = join(base, rel);
  if (!path.startsWith(base) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(res);
}).listen(0);
const port = server.address().port;

const reports = [];
for (const mode of modes) {
  const reported = new Promise((r) => (finish = r));
  const profile = mkdtempSync(join(tmpdir(), "machine-worker-"));
  const browser = spawn(chrome, [
    "--headless=new",
    "--no-first-run", "--mute-audio",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    `http://localhost:${port}/bench/worker/probe.html?mode=${mode.split(":")[0]}&budget=${mode.split(":")[1] ?? 25}`,
  ], { stdio: "ignore" });
  const exited = new Promise((r) => browser.on("exit", r));
  const timeout = setTimeout(() => finish({ ok: false, fatal: `${mode}: no report within 240 s` }), 240_000);
  const report = await reported;
  clearTimeout(timeout);
  browser.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  if (!report.ok) {
    console.error(report.fatal);
    process.exit(1);
  }
  const r = report.result;
  reports.push(r);
  console.log(JSON.stringify({ mode, joiner: { ...r.joiner, stats: undefined }, before: r.before, join: r.join, ticks: r.ticks }));
}
server.close();
rmSync(bundles, { recursive: true, force: true });
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.json"), JSON.stringify(reports, null, 2));
}
const problems = [];
for (const r of reports) {
  if (new Set(Object.values(r.ticks)).size !== 1) problems.push(`${r.mode}: peers stopped at different ticks ${JSON.stringify(r.ticks)}`);
  for (const [n, s] of Object.entries(r.status)) if (s.error || s.fault || s.desync.length) problems.push(`${r.mode}: ${n} ${JSON.stringify(s)}`);
}
for (const r of reports.filter((r) => r.mode.startsWith("worker")))
  if (r.join.longtasks.count > 0) problems.push(`${r.mode}: ${r.join.longtasks.count} long tasks while c caught up`);
console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "every peer stopped at the same tick; the worker joiner made no long task on the page");
process.exit(problems.length ? 1 : 0);
