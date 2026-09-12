// End-to-end: aria's real built site, in a directory doc, browsed through site-viewer, in a
// real Patchwork shell with a real service worker.
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import FS from "node:fs"
import Path from "node:path"
import OS from "node:os"

const SITE = process.env.SITE ?? `${process.env.HOME}/dev/aria-sgai-notebook/public`
const TOOL = process.env.TOOL ?? `${process.env.HOME}/dev/patchwork-experiments/site-viewer`
const SHELL = process.env.SHELL_DIST ?? `${process.env.HOME}/dev/patchwork/sites/tiny-patchwork/dist`
const PORT = 4499
// HEADED=1 opens a real window and leaves it up at the end, so the run can be watched
// rather than read about. Headless is the fast loop; headed is the one that tells you
// autoplay, focus and layout are fine too.
const HEADED = process.env.HEADED === "1"
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const TEXT = new Set([".html", ".css", ".js", ".json", ".xml", ".svg", ".txt", ".webmanifest", ""])
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".xml": "application/xml", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".wasm": "application/wasm", ".map": "application/json",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain",
}

// ---- the site, as it will go into the document -------------------------------------------------
const site = {}
const walk = (dir, prefix = "") => {
  for (const e of FS.readdirSync(dir, { withFileTypes: true })) {
    const p = Path.join(dir, e.name)
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) { walk(p, rel); continue }
    const ext = Path.extname(e.name)
    const bytes = FS.readFileSync(p)
    site[rel] = TEXT.has(ext)
      ? { encoding: "utf8", content: bytes.toString(), mimeType: MIME[ext] ?? "text/plain" }
      : { encoding: "base64", content: bytes.toString("base64"), mimeType: MIME[ext] ?? "application/octet-stream" }
  }
}
walk(SITE)

// ---- serve the shell, the tool and the site ----------------------------------------------------
const serveDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "site-viewer-probe-"))
FS.cpSync(SHELL, serveDir, { recursive: true })
FS.mkdirSync(Path.join(serveDir, "site-viewer"))
for (const f of ["tool.js", "paths.js", "styles.css", "index.js"]) FS.copyFileSync(Path.join(TOOL, f), Path.join(serveDir, "site-viewer", f))
FS.writeFileSync(Path.join(serveDir, "site.json"), JSON.stringify(site))

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

// ---- drive chrome over CDP ---------------------------------------------------------------------
const profile = FS.mkdtempSync(Path.join(OS.tmpdir(), "chrome-sv-"))
const chrome = spawn(CHROME, [...(HEADED ? [] : ["--headless=new"]), "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--remote-debugging-port=9223", "about:blank"], { stdio: "ignore" })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// Chrome keeps writing to its profile for a moment after kill(), so removing it can race.
// Cleanup must never be the reason a result is lost.
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
  for (const dir of [profile, serveDir]) {
    try { FS.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch {}
  }
}

let targets
for (let i = 0; i < 60; i++) { try { targets = await (await fetch("http://localhost:9223/json/list")).json(); if (targets.length) break } catch {} ; await wait(500) }
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
  const r = await send("Runtime.evaluate", { expression: "typeof window.repo?.create === 'function'", returnByValue: true })
  if (r.result?.result?.value === true) { ready = true; break }
  await wait(1000)
}
if (!ready) { console.error("shell never booted"); await cleanup(); process.exit(2) }

const result = await send("Runtime.evaluate", {
  expression: FS.readFileSync(new URL("./probe.js", import.meta.url), "utf8"),
  awaitPromise: true, returnByValue: true, timeout: 180_000,
})
// Print before cleaning up, so a cleanup problem cannot swallow the result.
if (result.result?.exceptionDetails) {
  console.error("THREW:", JSON.stringify(result.result.exceptionDetails, null, 2))
  await cleanup(); process.exit(1)
}
console.log(JSON.stringify(result.result.result.value, null, 2))
await cleanup()
