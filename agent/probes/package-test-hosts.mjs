/**
 * Does package_test run a package's tests in a real page and a real worker?
 *
 * Runs the actual tool (tools/testing.js, served from this folder as-is) in
 * headless Chrome against a package on disk, once with `in: "page"` and once
 * with `in: "worker"`, and prints both reports. It stands in for the two
 * things Patchwork provides, and nothing else:
 *
 *   - an importmap, with @automerge/automerge-repo bundled from this
 *     package's node_modules (the base64 wasm entries, as a page needs);
 *   - the service worker's /automerge%3A<folder>/<path> URLs, answered from
 *     the package directory, so tests that fetch package files can.
 *
 * esbuild-wasm comes from esm.sh, as it does in Patchwork, so this needs the
 * network. probes/browser-test.mjs is the same question against the deployed
 * shell and a synced package.
 *
 * Usage: node probes/package-test-hosts.mjs <package dir> [page,worker]
 */

import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const here = dirname(fileURLToPath(import.meta.url))
const agent = join(here, "..")
const [pkgArg, hosts = "page,worker"] = process.argv.slice(2)
if (!pkgArg) {
  console.error("usage: node probes/package-test-hosts.mjs <package dir> [page,worker]")
  process.exit(2)
}
const pkg = resolve(pkgArg)
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// automerge's "browser" entries import .wasm the way vite does; the base64
// entries initialise themselves, which is what a plain page can load.
const wasmBase64 = {
  name: "automerge-base64",
  setup(b) {
    b.onResolve({ filter: /^@automerge\/automerge(-subduction)?$/ }, async (args) => {
      if (args.pluginData?.again) return
      const found = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, pluginData: { again: true } })
      return {
        path: found.path
          .replace("/entrypoints/fullfat_bundler.js", "/entrypoints/fullfat_base64.js")
          .replace("/esm/bundler.js", "/esm/web.js"),
      }
    })
  },
}
const repoBundle = (
  await build({
    stdin: { contents: 'export * from "@automerge/automerge-repo"', resolveDir: agent, loader: "js" },
    platform: "neutral",
    conditions: ["browser", "import"],
    mainFields: ["browser", "module", "main"],
    format: "esm",
    bundle: true,
    write: false,
    logLevel: "error",
    plugins: [wasmBase64],
  })
).outputFiles[0].contents

const PAGE = `<!doctype html><meta charset="utf-8"><title>running</title>
<script type="importmap">{ "imports": { "@automerge/automerge-repo": "/vendor/automerge-repo.js" } }</script>
<pre id="result"></pre>
<script type="module">
import { packageTest } from "/agent/tools/testing.js"
const sources = await (await fetch("/files.json")).json()
const docs = new Map([["automerge:pkg", { docs: [] }]])
Object.entries(sources).forEach(([name, content], i) => {
  docs.get("automerge:pkg").docs.push({ name, type: "file", url: "automerge:f" + i })
  docs.set("automerge:f" + i, { name, content })
})
const repo = { async find(url) { return { url, doc: () => docs.get(url) } } }
const out = {}
for (const host of new URLSearchParams(location.search).get("in").split(",")) {
  const started = performance.now()
  try { out[host] = await packageTest.execute({ url: "automerge:pkg", in: host }, { repo }) }
  catch (err) { out[host] = "THREW: " + (err?.stack ?? err) }
  out[host] += "\\n(" + Math.round(performance.now() - started) + " ms)"
}
document.getElementById("result").textContent = JSON.stringify(out)
document.title = "done"
</script>`

async function packageFiles() {
  const out = {}
  const walk = async (dir, prefix) => {
    for (const e of await readdir(join(pkg, dir), { withFileTypes: true })) {
      if (["node_modules", "dist"].includes(e.name) || e.name.startsWith(".")) continue
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) await walk(join(dir, e.name), rel)
      else if (/\.(m?[jt]sx?|json|md)$/.test(e.name)) out[rel] = await readFile(join(pkg, dir, e.name), "utf8")
    }
  }
  await walk("", "")
  return out
}

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" }
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname)
  const send = (type, body) => {
    res.writeHead(200, { "content-type": type })
    res.end(body)
  }
  try {
    if (path === "/page.html") return send("text/html", PAGE)
    if (path === "/files.json") return send("application/json", JSON.stringify(await packageFiles()))
    if (path === "/vendor/automerge-repo.js") return send("text/javascript", repoBundle)
    const file = path.startsWith("/automerge:pkg/")
      ? join(pkg, path.slice("/automerge:pkg/".length))
      : path.startsWith("/agent/")
        ? join(agent, path.slice("/agent/".length))
        : null
    if (!file) throw new Error("not found")
    send(TYPES[extname(file)] ?? "application/octet-stream", await readFile(file))
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const port = server.address().port

// A random debugging port: a fixed one can adopt somebody else's Chrome.
const debugPort = 9300 + Math.floor(Math.random() * 600)
const profile = mkdtempSync(join(tmpdir(), "package-test-hosts-"))
const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore" }
)

try {
  for (let i = 0; i < 100; i++) {
    try {
      await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()
      break
    } catch {
      await sleep(100)
    }
  }
  const target = await (
    await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/page.html?in=${hosts}`)}`, { method: "PUT" })
  ).json()
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
  // Wait on the page's own signal, in real time, so workers get to finish.
  const deadline = Date.now() + 180_000
  let result = null
  while (Date.now() < deadline) {
    if ((await evaluate("document.title")) === "done") {
      result = JSON.parse(await evaluate("document.getElementById('result').textContent"))
      break
    }
    await sleep(200)
  }
  socket.close()
  if (!result) throw new Error("the page never finished")
  for (const [host, report] of Object.entries(result)) console.log(`===== in a ${host}\n${report}\n`)
} finally {
  const exited = new Promise((r) => chrome.once("exit", r))
  chrome.kill()
  await exited // Chrome writes its profile until it is gone
  server.close()
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
