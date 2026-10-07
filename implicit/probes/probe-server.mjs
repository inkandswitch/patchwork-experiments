// Probe server: serves this package (so the BUILT dist/ is what gets tested),
// the Patchwork theme CSS at /themes/, and an importmap for the externals the
// host normally provides (automerge + codemirror), resolved out of this
// package's own node_modules. POST /report prints the JSON and exits.
//
//   pnpm build && node probes/probe-server.mjs 4471
//   open http://localhost:4471/probes/probe.html
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const themes = resolve(root, "../theming/src");
const port = Number(process.argv[2] ?? 4471);
const keepAlive = process.argv.includes("--keep");
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html", ".wasm": "application/wasm", ".png": "image/png" };

// bare specifier -> file, found in node_modules/.pnpm
const store = join(root, "node_modules/.pnpm");
function pkgDir(name) {
  const flat = name.replace("/", "+");
  const hit = readdirSync(store).find((d) => d.startsWith(`${flat}@`));
  if (!hit) throw new Error(`probe: ${name} is not installed`);
  return join(store, hit, "node_modules", name);
}
function entry(name) {
  if (name === "@automerge/automerge") return join(pkgDir(name), "dist/mjs/entrypoints/fullfat_base64.js");
  const dir = pkgDir(name);
  const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const exp = pj.exports?.["."];
  const file = (typeof exp === "string" ? exp : exp?.import?.default ?? exp?.import ?? exp?.default) ?? pj.module ?? pj.main;
  return join(dir, typeof file === "string" ? file : "index.js");
}
const BARE = [
  "@automerge/automerge", "@codemirror/state", "@codemirror/view", "@codemirror/language",
  "@lezer/common", "@lezer/highlight", "style-mod", "w3c-keyname", "crelt", "@marijn/find-cluster-break",
];
const importmap = { imports: Object.fromEntries(BARE.map((n) => [n, "/" + relative(root, entry(n))])) };

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "POST" && req.url === "/report") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(204).end();
      console.log(body);
      if (!keepAlive) setTimeout(() => process.exit(0), 50);
    });
    return;
  }
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const path = url.startsWith("/themes/") ? join(themes, url.slice(8)) : join(root, url);
  if (!existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
  if (extname(path) === ".html") {
    res.end(readFileSync(path, "utf8").replace("{{IMPORTMAP}}", JSON.stringify(importmap, null, 2)));
    return;
  }
  createReadStream(path).pipe(res);
});
server.listen(port, () => console.error(`probe server on http://localhost:${port}`));
if (!keepAlive) setTimeout(() => { console.error("TIMEOUT: no report"); process.exit(2); }, 240_000);
