/**
 * Does the session view work in a real browser?
 *
 * The view's tests run in a simulated DOM, which cannot say whether a click
 * lands, focus is kept or a stylesheet loads. This mounts ui/session-view.js
 * in headless Chrome on a real session document (probes/session-view-page.js)
 * and does what a person does: follows a link to a document, types while the
 * view redraws, opens and closes the settings, and answers an approval card.
 * It checks each from the page and from the session document.
 *
 * It stands in for what Patchwork provides, and nothing else: an importmap
 * (automerge and automerge-repo bundled from this package's node_modules,
 * and as much of the plugin registry as the agent reads) and automerge's
 * wasm. No model is called: the session has no key, and nothing here needs
 * one.
 *
 *   node probes/session-view.mjs
 */

import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const here = dirname(fileURLToPath(import.meta.url))
const agent = join(here, "..")
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------ Patchwork's part

const stage = mkdtempSync(join(tmpdir(), "session-view-"))
const entries = {
  "automerge.js": `export * from "@automerge/automerge/slim"`,
  "automerge-repo.js": `export * from "@automerge/automerge-repo/slim"`,
  // The adapter Patchwork's importmap provides, in a dozen lines.
  "messagechannel.js": `
    import { NetworkAdapter } from "@automerge/automerge-repo/slim"
    export class MessageChannelNetworkAdapter extends NetworkAdapter {
      constructor(port) { super(); this.port = port }
      isReady() { return this.ready ?? false }
      whenReady() { return Promise.resolve() }
      connect(peerId, peerMetadata) {
        this.peerId = peerId
        this.port.onmessage = ({ data }) => {
          if (data.type === "hello") { this.port.postMessage({ type: "welcome", senderId: peerId, peerMetadata }); this.emit("peer-candidate", { peerId: data.senderId, peerMetadata: data.peerMetadata }) }
          else if (data.type === "welcome") this.emit("peer-candidate", { peerId: data.senderId, peerMetadata: data.peerMetadata })
          else this.emit("message", data)
        }
        this.port.start?.()
        this.port.postMessage({ type: "hello", senderId: peerId, peerMetadata })
        this.ready = true
        this.emit("ready", { network: this })
      }
      send(message) { this.port.postMessage(message) }
      disconnect() { this.port.close() }
    }`,
  // The plugin registry, as much of it as the agent reads.
  "plugins.js": `
    const registries = new Map()
    export function getRegistry(type) {
      if (!registries.has(type)) {
        const entries = new Map(), listeners = new Set()
        registries.set(type, {
          all: () => [...entries.values()],
          get: (id) => entries.get(id),
          async load(id) { const e = entries.get(id); return e && { ...e, module: await e.load() } },
          register(entry, importUrl) { entries.set(entry.id, { ...entry, importUrl }); for (const f of listeners) f() },
          on(event, f) { if (event === "changed") listeners.add(f); return () => listeners.delete(f) },
        })
      }
      return registries.get(type)
    }`,
}
for (const [name, source] of Object.entries(entries)) writeFileSync(join(stage, name), source)

// automerge-subduction's "browser" entry imports its wasm the way vite does;
// its web entry initialises itself, which is what a plain page can load.
const subductionWeb = {
  name: "subduction-web",
  setup(b) {
    b.onResolve({ filter: /^@automerge\/automerge-subduction$/ }, async (a) => {
      if (a.pluginData?.again) return
      const found = await b.resolve(a.path, { kind: a.kind, resolveDir: a.resolveDir, pluginData: { again: true } })
      return { path: found.path.replace("/esm/bundler.js", "/esm/web.js") }
    })
  },
}
const bundle = await build({
  entryPoints: Object.keys(entries).map((name) => join(stage, name)),
  nodePaths: [join(agent, "node_modules")],
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  conditions: ["browser", "import"],
  outdir: "/packages",
  write: false,
  logLevel: "error",
  plugins: [subductionWeb],
})
const packages = new Map(bundle.outputFiles.map((f) => [f.path.slice(f.path.lastIndexOf("/packages/")), f.contents]))

// ------------------------------------------------------------ the page

const PAGE = `<!doctype html><meta charset="utf-8"><title>running</title>
<script type="importmap">{ "imports": {
  "@automerge/automerge": "/packages/automerge.js",
  "@automerge/automerge/slim": "/packages/automerge.js",
  "@automerge/automerge-repo": "/packages/automerge-repo.js",
  "@automerge/automerge-repo/slim": "/packages/automerge-repo.js",
  "@automerge/automerge-repo-network-messagechannel": "/packages/messagechannel.js",
  "@inkandswitch/patchwork-plugins": "/packages/plugins.js"
} }</script>
<div id="host" style="width: 900px; height: 700px; display: flex"></div>
<pre id="result" hidden></pre>
<script type="module" src="/page.js"></script>`

// ------------------------------------------------------------ serving

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".css": "text/css" }
const WASM = join(agent, "node_modules", "@automerge", "automerge", "dist", "automerge.wasm")
const missing = []
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname)
  const send = (type, body) => {
    res.writeHead(200, { "content-type": type })
    res.end(body)
  }
  try {
    if (path === "/page.html") return send("text/html", PAGE)
    if (path === "/page.js") return send("text/javascript", await readFile(join(here, "session-view-page.js")))
    if (packages.has(path)) return send("text/javascript", packages.get(path))
    if (path === "/automerge.wasm") return send("application/wasm", await readFile(WASM))
    if (!path.startsWith("/agent/")) throw new Error("not found")
    const file = join(agent, path.slice(7))
    send(TYPES[extname(file)] ?? "application/octet-stream", await readFile(file))
  } catch {
    missing.push(path)
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const port = server.address().port

const debugPort = 9300 + Math.floor(Math.random() * 600)
const profile = mkdtempSync(join(tmpdir(), "session-view-chrome-"))
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" })

let failed = true
try {
  for (let i = 0; i < 100; i++) {
    try {
      await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()
      break
    } catch {
      await sleep(100)
    }
  }
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/page.html`)}`, { method: "PUT" })).json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    socket.onopen = r
    socket.onerror = j
  })
  let id = 0
  const pending = new Map()
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data)
    pending.get(m.id)?.(m.result)
    pending.delete(m.id)
  }
  const evaluate = (expression) =>
    new Promise((r) => {
      pending.set(++id, (result) => r(result?.result?.value))
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }))
    })
  const deadline = Date.now() + 120_000
  let out = null
  while (Date.now() < deadline) {
    if ((await evaluate("document.title")) === "done") {
      out = JSON.parse(await evaluate("document.getElementById('result').textContent"))
      break
    }
    await sleep(250)
  }
  socket.close()
  if (!out) throw new Error("the page never finished")
  if (out.error) console.log(`page error: ${out.error}`)
  console.log(JSON.stringify({ ...out, transcript: String(out.transcript ?? "").slice(0, 200) }, null, 2))

  const checks = [
    ["the view mounted in a real browser, with its stylesheet", out.mounted === true && out.styled === true],
    ["its title, hint and transcript are the session's", out.title === "Probe session" && out.hint === "Add an API key to start" && /Please edit it\./.test(out.transcript ?? "")],
    ["the side pane shows the subject document", out.side === true],
    ["a link to a document opens it, exactly once", out.opened?.length === 1 && out.opened[0] === out.otherUrl],
    ["what is being typed survives a redraw, focus and cursor with it", out.cost === "$0.02" && out.typing?.same === true && out.typing.value === "half-typed" && out.typing.focused === true && out.typing.cursor === 4],
    ["the settings panel opens and closes from the model button", out.settings?.before === false && out.settings.opened === true && out.settings.closed === true],
    ["the effort menu is the same node after a redraw", out.settings?.sameSelect === true],
    ["a click on Allow once approves the call in the document, and the card goes", out.approval?.shown === true && out.approval.buttons.includes("Deny") && out.approval.status === "approved" && out.approval.cardGone === true],
    ["…and what was typed is still there", out.typedAfter === "half-typed"],
    ["closing the view removes it", out.disposed === true],
    ["nothing threw", !out.error && (out.errors ?? []).length === 0],
  ]
  console.log("\n=== verdict ===")
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
  failed = checks.some(([, ok]) => !ok)
  if (missing.length) console.log(`\nnot served: ${[...new Set(missing)].join(" ")}`)
} finally {
  const exited = new Promise((r) => chrome.once("exit", r))
  chrome.kill()
  await exited
  server.close()
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  rmSync(stage, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
