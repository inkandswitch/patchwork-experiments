/**
 * Does a worker step call a package's tool in the SharedWorker runner?
 *
 * Runs the real worker runner (runners/worker.js, served from this folder
 * as-is) in headless Chrome: a page makes a workflow step's session placed on
 * a worker, connects the shared runner with runners/worker-client.js, and the runner
 * — in a module SharedWorker, with no importmap — runs the step. The model is
 * a script (fixtures/mock-provider.js) that calls a real package's agent tools: it
 * makes an assumptions register with `assumptions_create` and reads it back
 * with `assumptions_read`, then calls a tool whose code cannot load in a
 * worker. What the probe checks, from the session document alone:
 *
 *   - the worker loaded at all, which it could not while the agent imported
 *     automerge by bare specifier;
 *   - it initialised automerge's slim build itself (the page's boot did it in
 *     the page; the worker gets the module uninitialised);
 *   - the step was offered the package's tools, and not the page's;
 *   - both assumptions tools ran in the worker and wrote the register;
 *   - a plugin tool there gets ctx.automerge (initialised) and ctx.plugins,
 *     whose registry holds a datatype the page registered, hook and all;
 *   - the tool that cannot load there was offered too, and its call parked
 *     as host-tier, for a tab.
 *
 * It also reports, without judging, whether the SharedWorker can start a
 * nested dedicated Worker (module and classic), as a Pyodide kernel would.
 *
 * It stands in for what Patchwork provides, and nothing else:
 *
 *   - its importmap: automerge's slim build and automerge-repo's, bundled
 *     from this package's node_modules as chunks sharing one automerge, as
 *     Patchwork's build emits them, with the page initialising the wasm as
 *     Patchwork's boot does; a MessageChannel network adapter; and a plugin
 *     registry holding the packages' `agent:tool` entries;
 *   - the model: providers/index.js is served with one scripted provider
 *     registered as "probe". Every other file is served as it is on disk.
 *
 * No network and no sync server: everything is served from this machine.
 *
 * Usage: node probes/worker-plugin-tool.mjs [--plugin ../assumptions]
 */

import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const here = dirname(fileURLToPath(import.meta.url))
const agent = join(here, "..")
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const plugin = resolve(option("plugin", join(agent, "..", "assumptions")))
if (!existsSync(join(plugin, "index.js"))) {
  console.error(`no package at ${plugin}; pass --plugin <dir> (a package registering agent:tool entries)`)
  process.exit(2)
}
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------ Patchwork's part

const stage = mkdtempSync(join(tmpdir(), "worker-plugin-tool-"))
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

// A package whose tool cannot load in a worker: it imports a bare specifier.
const BROKEN = {
  "index.js": `export const plugins = [{ type: "agent:tool", id: "broken_tool", name: "Needs the importmap", description: "A tool whose code imports automerge by name.", where: "worker", risk: "read", input_schema: { type: "object", properties: {} }, async load() { return (await import("./impl.js")).default } }]`,
  "impl.js": `import { getHeads } from "@automerge/automerge"\nexport default { execute: () => "ran " + typeof getHeads }`,
}

// A package whose tool reports what its ctx holds in the worker — the
// registry (with a datatype the page registered, and its hook) and
// automerge — and whether it can start a nested dedicated Worker there, as a
// Pyodide kernel would. Its datatype is registered in the page only.
const CTX = {
  "index.js": `export const plugins = [
    { type: "agent:tool", id: "ctx_probe", name: "What ctx holds", description: "Reports ctx.plugins, ctx.automerge and nested workers.", where: "worker", risk: "read", input_schema: { type: "object", properties: {} }, async load() { return (await import("./impl.js")).default } },
    { type: "patchwork:datatype", id: "probe-type", name: "Probe type", async load() { return { asSource: () => "source of probe-type" } } },
  ]`,
  "impl.js": `
    const nested = (url, options) => new Promise((resolve) => {
      let w
      try { w = new Worker(url, options) } catch (e) { return resolve("throws: " + e.message) }
      w.onmessage = (e) => { resolve(e.data); w.terminate() }
      w.onerror = (e) => resolve("error: " + (e.message ?? "unknown"))
      setTimeout(() => resolve("timeout"), 5000)
    })
    export default { async execute(input, ctx) {
      const out = {
        inSharedWorker: typeof SharedWorkerGlobalScope !== "undefined" && self instanceof SharedWorkerGlobalScope,
        automerge: typeof ctx.automerge?.getHeads === "function",
        automergeReady: ctx.automerge?.isWasmInitialized?.() ?? null,
        plugins: typeof ctx.plugins?.getRegistry === "function",
        workerConstructor: typeof Worker,
      }
      try {
        const dt = await ctx.plugins.getRegistry("patchwork:datatype").load("probe-type")
        out.hook = dt?.module?.asSource?.() ?? null
      } catch (e) { out.hook = "throws: " + e.message }
      out.nestedModule = await nested(new URL("./nested.js", import.meta.url), { type: "module" })
      out.nestedClassic = await nested(new URL("./nested.js", import.meta.url))
      return JSON.stringify(out)
    } }`,
  "nested.js": `postMessage("hello from a nested worker")`,
}

// ------------------------------------------------------------ the model

const SCRIPT = `
// ---- probe: a scripted model, registered for probes/worker-plugin-tool.mjs
import { makeMock as __makeMock } from "../fixtures/mock-provider.js"
const __urls = (value) => JSON.stringify(value).match(/automerge:[1-9A-HJ-NP-Za-km-z]+/g) ?? []
const __offered = (request) => (request.tools ?? []).map((t) => t.id ?? t.name ?? t.function?.name)
register({
  ...__makeMock([
    (request) => [{ type: "text", delta: "offered: " + __offered(request).join(" ") + "\\n" }, { type: "call", id: "c1", name: "assumptions_create", input: { folder: __urls(request.messages)[0], title: "Probe register" } }],
    (request) => [{ type: "call", id: "c2", name: "assumptions_read", input: { register: __urls(request.messages.at(-1))[0] } }],
    () => [{ type: "call", id: "c3", name: "ctx_probe", input: {} }],
    () => [{ type: "call", id: "c4", name: "broken_tool", input: {} }],
    () => [{ type: "text", delta: "done" }],
  ]),
  id: "probe",
  name: "probe",
})
`

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
<pre id="result"></pre>
<script type="module">
const out = { events: [] }
try {
  // Patchwork's boot: automerge's slim build, initialised in the page.
  const Automerge = await import("@automerge/automerge/slim")
  await Automerge.initializeWasm(new Request("/automerge.wasm"))
  const { Repo, initSubduction } = await import("@automerge/automerge-repo")
  await initSubduction()
  const repo = new Repo({ network: [] })
  // Its registry, holding the packages' agent:tool entries.
  const plugins = await import("@inkandswitch/patchwork-plugins")
  for (const url of ["/plugin/index.js", "/broken/index.js", "/ctx/index.js"]) {
    const absolute = new URL(url, location.href).href
    for (const p of (await import(absolute)).plugins) if (["agent:tool", "patchwork:datatype"].includes(p.type)) plugins.getRegistry(p.type).register(p, absolute)
  }

  const { initSession } = await import("/agent/session/schema.js")
  const { makeTurn, textBlock } = await import("/agent/session/blocks.js")
  const { initPlan } = await import("/agent/workflow/plan.js")
  const folder = repo.create({ "@patchwork": { type: "folder" }, title: "Task", docs: [] })
  const plan = repo.create({})
  plan.change((d) => initPlan(d, { title: "Probe", goal: "g", steps: [{ id: "s", title: "Register", prompt: "p", why: "w", where: "worker", tier: "fast" }] }))
  // A worker step's session, as the driver makes one.
  const session = repo.create({})
  session.change((d) => {
    initSession(d, { title: "Probe · Register", config: { providerId: "probe", model: null } })
    d.workflow = { planUrl: plan.url, stepId: "s" }
    d.tools = { where: "worker" }
    d.turns.push(makeTurn("user", [textBlock("Make an assumptions register for the task folder " + folder.url + " and read it back.")]))
  })
  out.folder = folder.url

  const { connectWorkerRunner } = await import("/agent/runners/worker-client.js")
  const { statusOf } = await import("/agent/session/status.js")
  const worker = await connectWorkerRunner({ repo, sessionUrl: session.url, key: "probe-key", providerId: "probe", account: {}, onEvent: (e) => out.events.push(e?.type === "worker-error" ? "worker-error: " + e.error : e?.type) })
  out.connected = !!worker
  out.runnerUrl = worker?.runnerUrl ?? null
  const deadline = Date.now() + 60000
  while (Date.now() < deadline && !["parked", "error"].includes(statusOf(session.doc()))) await new Promise((r) => setTimeout(r, 200))
  const doc = session.doc()
  out.status = statusOf(doc)
  out.lease = doc.lease?.runner ?? null
  out.turns = doc.turns.map((t) => ({ role: t.role, blocks: t.blocks.map((b) => ({ type: b.type, id: b.id, text: b.text == null ? undefined : String(b.text), tool: b.tool, where: b.where, status: b.status, callId: b.callId, output: b.output == null ? undefined : String(b.output), isError: b.isError })) }))
  out.folderDocs = (await repo.find(folder.url)).doc().docs
  const filed = out.folderDocs[0]?.url
  out.register = filed ? (await repo.find(filed)).doc() : null
} catch (err) {
  out.error = String(err?.stack ?? err)
}
document.getElementById("result").textContent = JSON.stringify(out)
document.title = "done"
</script>`

// ------------------------------------------------------------ serving

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".css": "text/css" }
const WASM = join(agent, "node_modules", "@automerge", "automerge", "dist", "automerge.wasm")
const served = []
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname)
  served.push(path)
  const send = (type, body) => {
    res.writeHead(200, { "content-type": type })
    res.end(body)
  }
  try {
    if (path === "/page.html") return send("text/html", PAGE)
    if (packages.has(path)) return send("text/javascript", packages.get(path))
    if (path === "/automerge.wasm") return send("application/wasm", await readFile(WASM))
    if (path.startsWith("/broken/") && BROKEN[path.slice(8)]) return send("text/javascript", BROKEN[path.slice(8)])
    if (path.startsWith("/ctx/") && CTX[path.slice(5)]) return send("text/javascript", CTX[path.slice(5)])
    if (path === "/agent/providers/index.js") return send("text/javascript", (await readFile(join(agent, "providers", "index.js"), "utf8")) + SCRIPT)
    const file = path.startsWith("/agent/") ? join(agent, path.slice(7)) : path.startsWith("/plugin/") ? join(plugin, path.slice(8)) : null
    if (!file) throw new Error("not found")
    send(TYPES[extname(file)] ?? "application/octet-stream", await readFile(file))
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const port = server.address().port

const debugPort = 9300 + Math.floor(Math.random() * 600)
const profile = mkdtempSync(join(tmpdir(), "worker-plugin-tool-chrome-"))
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

  const blocks = (out.turns ?? []).flatMap((t) => t.blocks)
  const call = (n) => blocks.find((b) => b.type === "call" && b.id === `c${n}`)
  const result = (n) => blocks.find((b) => b.type === "result" && b.callId === `c${n}`)
  const offered = (blocks.find((b) => b.type === "text" && b.text?.startsWith("offered: "))?.text ?? "").slice(9).trim().split(/\s+/)
  const c4 = call(4)
  let seen = {}
  try {
    seen = JSON.parse(result(3)?.output ?? "{}")
  } catch {
    /* an error message */
  }
  console.log(JSON.stringify({ connected: out.connected, runnerUrl: out.runnerUrl, status: out.status, events: [...new Set(out.events)], offered: offered.filter((t) => /^(assumptions_|broken_|ctx_|view_|doc_edit|workflow_)/.test(t)), results: [result(1), result(2), result(3)].map((r) => r && { isError: r.isError, output: String(r.output ?? "").slice(0, 400) }), c4, folderDocs: out.folderDocs, registerTitle: out.register?.title }, null, 2))
  // Reported, not checked: whether Chrome lets a SharedWorker start a nested
  // dedicated Worker (a Pyodide kernel needs one).
  console.log(`\nnested Worker in the SharedWorker: constructor ${seen.workerConstructor}; module: ${seen.nestedModule}; classic: ${seen.nestedClassic}`)

  const checks = [
    ["the shared runner connected (its modules loaded with no importmap)", out.connected === true && /^worker-/.test(out.runnerUrl ?? "")],
    ["the step was offered the package's tools", ["assumptions_create", "assumptions_read", "assumptions_set", "broken_tool", "ctx_probe"].every((t) => offered.includes(t))],
    ["…and the worker tools, and not the page's", offered.includes("doc_edit") && !offered.includes("view_mount") && !offered.some((t) => t?.startsWith("workflow_") && t !== "workflow_request")],
    ["assumptions_create ran in the worker", result(1) && !result(1).isError && /Created the assumptions register/.test(result(1).output)],
    ["…and filed the register in the folder", out.folderDocs?.length === 1 && out.register?.title === "Probe register"],
    ["assumptions_read ran in the worker and read it back", result(2) && !result(2).isError && /automerge:/.test(result(2).output)],
    ["a plugin tool in the worker gets ctx.automerge, initialised", seen.inSharedWorker === true && seen.automerge === true && seen.automergeReady !== false],
    ["…and ctx.plugins, holding the datatype the page registered, loadable with its hook", seen.plugins === true && seen.hook === "source of probe-type"],
    ["the tool that cannot load there was parked for a tab", c4?.tool === "broken_tool" && c4.where === "host" && out.status === "parked"],
  ]
  console.log("\n=== verdict ===")
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
  failed = checks.some(([, ok]) => !ok)
  if (failed) console.log(`\nserved: ${[...new Set(served)].filter((p) => !p.startsWith("/agent/tools/")).join(" ")}`)
} finally {
  const exited = new Promise((r) => chrome.once("exit", r))
  chrome.kill()
  await exited
  server.close()
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  rmSync(stage, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
