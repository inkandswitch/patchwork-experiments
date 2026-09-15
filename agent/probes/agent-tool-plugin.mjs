/**
 * Can a package hand the agent a capability, rather than only a UI?
 *
 * A Patchwork tool is a render function: something a person operates. That
 * leaves an agent asked to "use the git-clone tool" with three bad options —
 * drive its UI through view_mount and hope the selectors hold, reimplement its
 * logic with http_request and watch the two diverge, or refuse. Watched happen
 * in a real session, at length, before it picked one.
 *
 * The answer is the `agent:tool` registry: a package declares an API surface
 * beside its UI, and the agent gets a real tool with a schema and a
 * description. The wiring for that has existed in tools/index.js since the
 * beginning and had never once been run against a real Patchwork — which is
 * exactly the kind of thing that turns out not to work.
 *
 * This writes such a package, installs it, and checks that the agent's toolset
 * picks it up, describes it, and can execute it.
 *
 * Usage: node probes/agent-tool-plugin.mjs
 */

import { spawn } from "node:child_process"
import { readFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}

const SHELL = option("shell", "https://patchwork.inkandswitch.com/")
const AGENT =
  option("package", null) ??
  JSON.parse(readFileSync(join(here, "..", ".pushwork", "config.json"), "utf8")).rootUrl
const PORT = Number(option("port", String(9400 + Math.floor(Math.random() * 400))))
const CHROME = option("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true })
  })
  let nextId = 0
  const pending = new Map()
  const logs = []
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data)
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
      return
    }
    if (message.method === "Runtime.consoleAPICalled") {
      logs.push(
        `[${message.params.type}] ${(message.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")}`
      )
    }
  })
  return {
    logs,
    send(method, params = {}) {
      const id = ++nextId
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 600000,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

const profile = mkdtempSync(join(tmpdir(), "agent-tool-"))
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "ignore"] }
)

let exitCode = 1
try {
  let target = null
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    } catch {
      /* starting */
    }
    if (!target) await sleep(250)
  }
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send("Runtime.enable")
  await cdp.send("Page.enable")
  await cdp.send("Page.navigate", { url: SHELL })

  for (let i = 0; i < 180; i++) {
    const ready = await cdp
      .send("Runtime.evaluate", { expression: "!!window.repo && !!window.accountDocHandle", returnByValue: true })
      .then((r) => r.result?.value)
      .catch(() => false)
    if (ready) break
    await sleep(500)
  }
  console.log("booted")

  // --- 1. Write a package that contributes an agent tool -----------------
  const built = await evaluate(
    cdp,
    `(async () => {
      // The mime type is load-bearing: the service worker serves it verbatim,
      // and a module fetched as text/plain is refused by import() with
      // "Failed to fetch dynamically imported module" while a plain fetch of
      // the same URL returns 200 and the right bytes. fs_write maps extensions
      // to types for exactly this reason; a probe that hand-rolls it has to do
      // the same or it tests its own mistake.
      const MIME = { js: "text/javascript", mjs: "text/javascript", json: "application/json", css: "text/css" }
      const make = async (name, content) => {
        const h = await window.repo.create2()
        const extension = name.split(".").pop()
        h.change((d) => {
          d.name = name
          d.extension = extension
          d.mimeType = MIME[extension] ?? "text/plain"
          d.content = content
          d["@patchwork"] = { type: "file" }
        })
        return h
      }
      const folder = await window.repo.create2()
      folder.change((d) => { d.title = "wordcount"; d.docs = []; d["@patchwork"] = { type: "folder" } })

      const FILES = {
        "package.json": JSON.stringify({ name: "wordcount", type: "module", main: "./index.js" }),
        // The agent-facing half: metadata at the top level so it survives the
        // structured clone into the worker, behaviour behind load().
        "index.js": [
          'export const plugins = [',
          '  {',
          '    type: "agent:tool",',
          '    id: "wordcount_count",',
          '    name: "Count words",',
          '    description: "Count the words in a string. Contributed by the wordcount package.",',
          '    where: "worker",',
          '    risk: "read",',
          '    input_schema: { type: "object", required: ["text"], properties: { text: { type: "string", description: "The text to count." } } },',
          '    async load() { return (await import("./agent.js")).default },',
          '  },',
          ']',
        ].join("\\n"),
        "agent.js": [
          'export default {',
          '  async execute(input) {',
          '    const words = String(input.text ?? "").trim().split(/\\\\s+/).filter(Boolean)',
          '    return \`\${words.length} words\`',
          '  },',
          '  summarize(input, output) { return \`counted: \${output}\` },',
          '}',
        ].join("\\n"),
      }

      for (const [name, content] of Object.entries(FILES)) {
        const file = await make(name, content)
        folder.change((d) => d.docs.push({ name, type: "file", url: file.url }))
      }
      return { package: folder.url }
    })()`
  )
  console.log(`wrote package: ${built.package}`)

  // Read the files back. Building JS source inside a template literal inside a
  // CDP string is exactly where escaping goes wrong, and a package that fails
  // to register looks identical whether the cause is the mechanism or a stray
  // backslash in the file we wrote.
  const written = await evaluate(
    cdp,
    `(async () => {
      const folder = await window.repo.find(${JSON.stringify(built.package)})
      const out = {}
      for (const entry of folder.doc().docs ?? []) {
        out[entry.name] = (await window.repo.find(entry.url)).doc().content
      }
      return JSON.parse(JSON.stringify(out))
    })()`
  )
  if (option("show-files", null) !== null) {
    for (const [name, content] of Object.entries(written)) {
      console.log(`\n--- ${name} ---\n${content}`)
    }
  }

  // --- 2. Install it, then reload so the registry picks it up ------------
  const installed = await evaluate(
    cdp,
    `(async () => {
      const settingsUrl = window.accountDocHandle?.doc()?.moduleSettingsUrl
      const settings = await window.repo.find(settingsUrl)
      settings.change((d) => {
        if (!d.modules) d.modules = []
        for (const url of [${JSON.stringify(built.package)}, ${JSON.stringify(AGENT)}]) {
          if (!(d.modules ?? []).some((m) => m.split("#")[0] === url.split("#")[0])) d.modules.push(url)
        }
      })
      return settings.doc().modules.length
    })()`
  )
  console.log(`modules installed: ${installed}`)

  await cdp.send("Page.reload", { ignoreCache: false })
  await sleep(1000)
  for (let i = 0; i < 180; i++) {
    const ready = await cdp
      .send("Runtime.evaluate", { expression: "!!window.repo && !!window.accountDocHandle", returnByValue: true })
      .then((r) => r.result?.value)
      .catch(() => false)
    if (ready) break
    await sleep(500)
  }

  // --- 3. Does the agent see it, and can it run it? ----------------------
  const report = await evaluate(
    cdp,
    `(async () => {
      const out = {}
      const bare = ${JSON.stringify(AGENT)}.split("#")[0]
      const handle = await window.repo.find(bare)
      const heads = handle.heads?.() ?? []
      const base = "/" + encodeURIComponent(heads.length ? bare + "#" + [...heads].sort().join("|") : bare) + "/"

      try {
        const { getRegistry } = await import("@inkandswitch/patchwork-plugins")
        out.registered = (getRegistry("agent:tool").all() ?? []).map((p) => p.id)

        const tools = await import(base + "tools/index.js")
        const toolset = await tools.buildToolset({})
        out.toolCount = toolset.tools.length
        const found = toolset.get("wordcount_count")
        out.visible = !!found
        out.described = found?.description ?? null
        out.schema = found ? JSON.stringify(found.input_schema) : null
        out.where = found?.where ?? null
        out.risk = found?.risk ?? null

        if (found) {
          const outcome = await tools.runTool(found, { text: "the quick brown fox jumps" }, { repo: window.repo })
          out.ran = outcome.output
          out.isError = outcome.isError
          out.summary = outcome.summary
        }

        // And it must appear in what the MODEL is sent, not just in the map.
        out.inSchemas = toolset.schemas.some((s) => s.id === "wordcount_count")
        out.ok = true
        return out
      } catch (err) {
        out.ok = false
        out.error = String(err?.stack ?? err?.message ?? err)
        return out
      }
    })()`
  )

  if (!report.ok) {
    console.log("\n=== FAILED ===")
    console.log(report.error)
  } else {
    console.log("\n=== what happened ===")
    console.log(`  agent:tool registry:  ${JSON.stringify(report.registered)}`)
    console.log(`  tools in the toolset: ${report.toolCount}`)
    console.log(`  description:          ${report.described}`)
    console.log(`  where/risk:           ${report.where}/${report.risk}`)
    console.log(`  schema:               ${report.schema}`)
    console.log(`  executed:             ${JSON.stringify(report.ran)}  (${report.summary})`)

    const checks = [
      ["the package registered an agent:tool", (report.registered ?? []).includes("wordcount_count")],
      ["the agent's toolset picked it up", report.visible === true],
      ["it carries the package's description", /Count the words/.test(report.described ?? "")],
      ["it carries the package's schema", /"required":\["text"\]/.test(report.schema ?? "")],
      ["it declares a tier and a risk", report.where === "worker" && report.risk === "read"],
      ["it reaches the model's tool list", report.inSchemas === true],
      ["it actually runs", report.ran === "5 words" && report.isError === false],
      ["its own summarize is used", report.summary === "counted: 5 words"],
    ]
    console.log("\n=== verdict ===")
    for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
    exitCode = checks.every(([, ok]) => ok) ? 0 : 1
  }

  const errors = cdp.logs.filter((l) => /error|exception/i.test(l))
  if (errors.length) {
    console.log("\n=== page errors ===")
    for (const line of errors.slice(-6)) console.log(`  ${line.slice(0, 250)}`)
  }
} catch (err) {
  console.error("PROBE FAILED:", err.message)
} finally {
  await sleep(Number(option("flush", "4000")))
  chrome.kill("SIGKILL")
}
process.exit(exitCode)
