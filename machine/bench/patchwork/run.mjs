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
import { build } from "esbuild";

const root = resolve(new URL("../..", import.meta.url).pathname);
const iwad = process.env.FREEDOOM1 ?? join(root, "engines/doom/test/freedoom1.wad");
const out = resolve(process.argv[2] ?? join(root, "bench/patchwork/out"));
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(out, { recursive: true });

// automerge's "bundler" entry expects a bundler that loads .wasm as a module;
// the base64 entry carries its wasm inline, which is what a plain page needs.
const base64Automerge = {
  name: "automerge-base64",
  setup(b) {
    // automerge, and subduction's slim and base64 builds, from wherever pnpm put them
    const sub = "node_modules/.pnpm/node_modules/@automerge/automerge-subduction";
    const paths = {
      "@automerge/automerge": "node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js",
      "@automerge/automerge-subduction/slim": `${sub}/dist/esm/slim.js`,
      "@automerge/automerge-subduction/wasm-base64": `${sub}/dist/esm/wasm-base64.js`,
    };
    b.onResolve({ filter: /^@automerge\/(automerge|automerge-subduction\/slim|automerge-subduction\/wasm-base64)$/ }, (args) => {
      for (let d = args.resolveDir; d !== "/"; d = resolve(d, "..")) {
        const f = join(d, paths[args.path]);
        if (existsSync(f)) return { path: f };
      }
    });
  },
};
const kind = process.argv[3] ?? "snes";
mkdirSync(join(root, "bench/patchwork/out"), { recursive: true });
await build({ entryPoints: [join(root, "bench/patchwork/entry.js")], bundle: true, format: "esm", platform: "browser", outfile: join(root, "bench/patchwork/out/repo.js"), logLevel: "error", loader: { ".wasm": "binary" }, plugins: [base64Automerge] });

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
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "--enable-logging=stderr",
  `http://localhost:${port}/bench/patchwork/probe.html?kind=${kind}`,
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
for (const [name, url] of Object.entries(report.pngs)) writeFileSync(join(out, `${kind}-${name}.png`), Buffer.from(url.split(",")[1], "base64"));
delete report.pngs;
console.log(JSON.stringify(report, null, 1));
