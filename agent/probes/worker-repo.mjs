/**
 * Can a SharedWorker get a working automerge repo, with no importmap and no CDN?
 *
 * Boots real Patchwork, reads the page's importmap, starts a SharedWorker
 * served out of this package's own document, hands it the resolved URLs and one
 * end of a MessageChannel, and reports what the worker managed to construct.
 *
 * Usage: node probes/worker-repo.mjs [--package automerge:…]
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
const PACKAGE =
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
      logs.push(`[${message.params.type}] ${(message.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")}`)
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

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

const profile = mkdtempSync(join(tmpdir(), "worker-repo-"))
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "ignore"] }
)

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

  for (let i = 0; i < 120; i++) {
    if (await evaluate(cdp, `!!window.repo && !!window.accountDocHandle`, false).catch(() => false)) break
    await sleep(500)
  }
  console.log("booted")

  const report = await evaluate(
    cdp,
    `(async () => {
      const out = {}

      // 1. Read the importmap out of the page and resolve every specifier to
      //    an absolute URL — this is the whole trick.
      const script = document.querySelector('script[type="importmap"]')
      if (!script) return { ok: false, error: "no importmap in the page" }
      const map = JSON.parse(script.textContent)
      const urls = {}
      for (const [specifier, target] of Object.entries(map.imports ?? {})) {
        urls[specifier] = new URL(target, location.href).href
      }
      out.resolvedCount = Object.keys(urls).length
      out.sampleUrl = urls["@automerge/automerge-repo"]

      // 2. Start a SharedWorker served out of the package document itself.
      const workerUrl = "/" + encodeURIComponent(${JSON.stringify(PACKAGE)}) + "/probes/worker-import-probe.js"
      out.workerUrl = workerUrl
      let worker
      try {
        worker = new SharedWorker(workerUrl, { type: "module", name: "agent-import-probe" })
      } catch (err) {
        return { ...out, ok: false, error: "SharedWorker construction failed: " + String(err?.message ?? err) }
      }

      // 3. Make a document on the page side, and wire the other end of the
      //    channel into the page's repo so the two can actually sync.
      const probeDoc = await window.repo.create2()
      probeDoc.change((d) => { d.title = "worker sync probe" })
      out.probeDocUrl = probeDoc.url

      const channel = new MessageChannel()
      try {
        const adapterModule = await import("@automerge/automerge-repo-network-messagechannel")
        const Adapter = adapterModule.MessageChannelNetworkAdapter ?? adapterModule.default
        const pageAdapter = new Adapter(channel.port1)
        if (window.repo.networkSubsystem?.addNetworkAdapter) {
          window.repo.networkSubsystem.addNetworkAdapter(pageAdapter)
          out.pageAdapterAttached = true
        } else {
          out.pageAdapterAttached = false
          out.pageAdapterWhy = "repo.networkSubsystem.addNetworkAdapter is not available"
        }
      } catch (err) {
        out.pageAdapterAttached = false
        out.pageAdapterWhy = String(err?.message ?? err)
      }
      const answer = new Promise((resolve) => {
        worker.port.onmessage = (event) => resolve(event.data)
        setTimeout(() => resolve({ ok: false, error: "worker never replied (30s)" }), 30000)
      })
      worker.port.start()
      worker.port.postMessage(
        { urls, repoPort: channel.port2, probeDocUrl: probeDoc.url },
        [channel.port2]
      )

      const workerReport = await answer
      return { ...out, worker: workerReport, ok: workerReport.ok }
    })()`
  )

  console.log(JSON.stringify(report, null, 2))

  console.log("\n=== verdict ===")
  const checks = [
    ["the importmap resolved", report.resolvedCount > 0],
    ["the SharedWorker started from the package document", !!report.worker],
    ["automerge-repo imported inside the worker", report.worker?.hasRepo === true],
    ["automerge imported inside the worker", report.worker?.hasSplice === true],
    ["a Repo was constructed over the donated port", report.worker?.repoConstructed === true],
    ["the page attached its end of the channel", report.pageAdapterAttached === true],
    ["the worker found the page's document", report.worker?.foundDoc === true],
    ["the worker wrote to it", report.worker?.wrote === true],
  ]
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
  if (report.worker?.error) console.log(`\nworker error at step "${report.worker.step}": ${report.worker.error}`)
  if (report.worker?.stack) console.log(report.worker.stack)

  const errors = cdp.logs.filter((l) => /error|exception/i.test(l))
  if (errors.length) {
    console.log("\n=== page errors ===")
    for (const line of errors.slice(-6)) console.log(`  ${line.slice(0, 300)}`)
  }
} catch (err) {
  console.error("FAILED:", err.message)
} finally {
  chrome.kill("SIGKILL")
}
process.exit(0)
