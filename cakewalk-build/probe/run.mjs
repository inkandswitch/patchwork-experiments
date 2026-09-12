// End-to-end: aria's repo as a pushwork-shaped folder document, built by cakewalk-build using
// the build system carried inside that same document, and browsed with site-viewer.
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import FS from "node:fs"
import Path from "node:path"
import OS from "node:os"

const REPO = process.env.REPO ?? `${process.env.HOME}/dev/aria-sgai-notebook`
const TOOLS = process.env.TOOLS ?? `${process.env.HOME}/dev/patchwork-experiments`
const SHELL = process.env.SHELL_DIST ?? `${process.env.HOME}/dev/patchwork/sites/tiny-patchwork/dist`
const PORT = 4501
// HEADED=1 opens a real window and leaves it up at the end, so the run can be watched
// rather than read about. Headless is the fast loop; headed is the one that tells you
// autoplay, focus and layout are fine too.
const HEADED = process.env.HEADED === "1"
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

// What a CakeWalk repo contains that a build needs, plus the build system itself.
const ROOTS = ["content", "template", "fonts"]
const LOOSE = ["Redirects.txt", "dist/site-build.js"]

const TEXT = new Set([".html", ".css", ".js", ".json", ".xml", ".svg", ".txt", ".md", ".webmanifest", ""])
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".xml": "application/xml", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".ico": "image/x-icon",
  ".md": "text/markdown", ".txt": "text/plain", ".wasm": "application/wasm", ".map": "application/json",
  ".webmanifest": "application/manifest+json", ".mp4": "video/mp4",
}

const repo = {}
const add = (abs, rel) => {
  const ext = Path.extname(abs)
  const bytes = FS.readFileSync(abs)
  repo[rel] = TEXT.has(ext)
    ? { encoding: "utf8", content: bytes.toString(), mimeType: MIME[ext] ?? "text/plain" }
    : { encoding: "base64", content: bytes.toString("base64"), mimeType: MIME[ext] ?? "application/octet-stream" }
}
const walk = (dir, prefix) => {
  for (const e of FS.readdirSync(dir, { withFileTypes: true })) {
    const abs = Path.join(dir, e.name)
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    e.isDirectory() ? walk(abs, rel) : add(abs, rel)
  }
}
for (const root of ROOTS) if (FS.existsSync(Path.join(REPO, root))) walk(Path.join(REPO, root), root)
for (const file of LOOSE) if (FS.existsSync(Path.join(REPO, file))) add(Path.join(REPO, file), file)
if (!repo["dist/site-build.js"]) { console.error("no dist/site-build.js in the repo — run pnpm build:browser there"); process.exit(2) }

const serveDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "cwb-probe-"))
FS.cpSync(SHELL, serveDir, { recursive: true })
for (const tool of ["site-viewer", "cakewalk-build"]) {
  FS.mkdirSync(Path.join(serveDir, tool))
  for (const f of FS.readdirSync(Path.join(TOOLS, tool)).filter((n) => /\.(js|css)$/.test(n))) {
    FS.copyFileSync(Path.join(TOOLS, tool, f), Path.join(serveDir, tool, f))
  }
}
FS.writeFileSync(Path.join(serveDir, "repo.json"), JSON.stringify(repo))
console.error(`repo: ${Object.keys(repo).length} files, bundle ${(repo["dist/site-build.js"].content.length / 1e3).toFixed(0)}kb`)

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://x")
  const p = Path.join(serveDir, decodeURIComponent(pathname))
  const file = FS.existsSync(p) && FS.statSync(p).isDirectory() ? Path.join(p, "index.html") : p
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless")
  if (!FS.existsSync(file) || FS.statSync(file).isDirectory()) return void res.writeHead(404).end("not found")
  res.writeHead(200, { "content-type": MIME[Path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" })
  FS.createReadStream(file).pipe(res)
}).listen(PORT)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = FS.mkdtempSync(Path.join(OS.tmpdir(), "chrome-cwb-"))
const chrome = spawn(CHROME, [...(HEADED ? [] : ["--headless=new"]), "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--remote-debugging-port=9224", "about:blank"], { stdio: "ignore" })

const waitForEnter = () => new Promise((r) => {
  console.error("\n--- window is open. press enter to close it ---")
  process.stdin.resume()
  process.stdin.once("data", () => { process.stdin.pause(); r() })
})

const cleanup = async () => {
  if (HEADED) await waitForEnter()
  try { chrome.kill() } catch {}
  try { server.close() } catch {}
  await wait(300)
  for (const d of [profile, serveDir]) { try { FS.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch {} }
}

let targets
for (let i = 0; i < 60; i++) { try { targets = await (await fetch("http://localhost:9224/json/list")).json(); if (targets.length) break } catch {} ; await wait(500) }
const page = targets?.find((t) => t.type === "page")
if (!page) { console.error("no chrome target"); await cleanup(); process.exit(2) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => { const n = ++id; ws.send(JSON.stringify({ id: n, method, params })); return new Promise((r) => pending.set(n, r)) }

await send("Runtime.enable"); await send("Page.enable")
await send("Page.navigate", { url: `http://localhost:${PORT}/` })
let ready = false
for (let i = 0; i < 120; i++) {
  const r = await send("Runtime.evaluate", { expression: "typeof window.repo?.create2 === 'function'", returnByValue: true })
  if (r.result?.result?.value === true) { ready = true; break }
  await wait(1000)
}
if (!ready) { console.error("shell never booted"); await cleanup(); process.exit(2) }

const result = await send("Runtime.evaluate", {
  expression: FS.readFileSync(new URL("./probe.js", import.meta.url), "utf8"),
  awaitPromise: true, returnByValue: true, timeout: 300_000,
})
if (result.result?.exceptionDetails) {
  console.error("THREW:", JSON.stringify(result.result.exceptionDetails, null, 2)); await cleanup(); process.exit(1)
}
console.log(JSON.stringify(result.result.result.value, null, 2))
await cleanup()
