/**
 * Drive the agent inside a real patchwork.inkandswitch.com tab.
 *
 * Headless Chrome with remote debugging, driven over CDP from node. The tool
 * comes from a locally-served bundle (`?system-package-list=`), everything else
 * is the deployed shell: real importmap, real registry, real repo, real sync,
 * and a real model call made from a browser origin.
 *
 * Usage:
 *   node scripts/build-static.mjs --filter agent --out /tmp/tools-dist
 *   node scripts/serve-tools.mjs --dir /tmp/tools-dist --port 4460
 *   node probes/patchwork-e2e.mjs [--headed] [--keep-open] [--model <slug>]
 */

import { spawn } from "node:child_process"
import { readFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

const SHELL = option("shell", "https://patchwork.inkandswitch.com/")
const MODULE = option(
  "module",
  (() => {
    try {
      return JSON.parse(readFileSync(join(here, "..", ".pushwork", "config.json"), "utf8")).rootUrl
    } catch {
      return null
    }
  })()
)
const MODEL = option("model", "anthropic/claude-sonnet-4.5")
const PROMPT = option(
  "prompt",
  "Rename this document's title to 'Leek and Potato Soup', then tell me what you changed."
)
// A fixed port risks connecting to somebody else's browser: CDP will happily
// hand us a page target from an unrelated Chrome that already holds it.
const PORT = Number(option("port", String(9400 + Math.floor(Math.random() * 400))))
const CHROME =
  option("chrome", null) ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

function readKey() {
  // The key lives OUTSIDE this package on purpose: `pushwork sync` publishes the
  // whole directory and honours only .pushwork/.git/node_modules, so a
  // credential stored in here would be shipped to the sync server.
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim()
  if (process.env.OPENROUTER_KEY_FILE) {
    try {
      return readFileSync(process.env.OPENROUTER_KEY_FILE, "utf8").trim()
    } catch (err) {
      console.error(`Could not read OPENROUTER_KEY_FILE: ${err.message}`)
      process.exit(2)
    }
  }
  console.error("No key. Set OPENROUTER_API_KEY, or OPENROUTER_KEY_FILE to a file holding one.")
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- CDP

async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true })
  })

  let nextId = 0
  const pending = new Map()
  const handlers = []

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data)
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      return
    }
    for (const handler of handlers) handler(message)
  })

  return {
    send(method, params = {}) {
      const id = ++nextId
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    on(handler) {
      handlers.push(handler)
    },
    close: () => socket.close(),
  }
}

async function evaluate(cdp, expression, { awaitPromise = true } = {}) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
    allowUnsafeEvalBlockedByCSP: false,
  })
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        JSON.stringify(result.exceptionDetails)
    )
  }
  return result.result?.value
}

async function findPageTarget(port) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* chrome is still starting */
    }
    await sleep(250)
  }
  throw new Error("Chrome never exposed a page target")
}

// ---------------------------------------------------------------- run

const key = readKey()
const profile = mkdtempSync(join(tmpdir(), "agent-probe-"))
if (!MODULE) {
  console.error("No module url. Run `pushwork sync` in agent/, or pass --module automerge:…")
  process.exit(2)
}

const chrome = spawn(
  CHROME,
  [
    flag("headed") ? "--no-first-run" : "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ].filter(Boolean),
  { stdio: ["ignore", "pipe", "pipe"] }
)

const consoleLines = []
let exitCode = 1

try {
  const target = await findPageTarget(PORT)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)

  cdp.on((message) => {
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? "")
        .join(" ")
      consoleLines.push(`[${message.params.type}] ${text}`)
    }
    if (message.method === "Runtime.exceptionThrown") {
      consoleLines.push(
        `[exception] ${message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text}`
      )
    }
  })

  await cdp.send("Runtime.enable")
  await cdp.send("Page.enable")

  // Seed the key on the shell's origin before the app boots, so the tool sees
  // it on first render rather than needing a reload.
  await cdp.send("Page.navigate", { url: SHELL })
  await sleep(2500)
  await evaluate(
    cdp,
    `(() => {
      localStorage.setItem(${JSON.stringify("patchwork-agent:key:openrouter")}, ${JSON.stringify(key)})
      // A previous run may have pinned a localhost manifest here; if it stays,
      // the shell loads no tools at all and never mounts a frame.
      localStorage.removeItem("systemPackageListURL")
      return "seeded"
    })()`,
    { awaitPromise: false }
  )

  console.log(`shell: ${SHELL}`)

  // Wait for Patchwork itself to be up.
  const booted = await (async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const ready = await evaluate(
        cdp,
        `(() => ({ repo: !!window.repo, account: !!window.accountDocHandle, body: document.body?.innerText?.slice(0,120) ?? "" }))()`,
        { awaitPromise: false }
      ).catch(() => null)
      // The account handle is what we need, and it only appears once a frame
      // tool has mounted — so this also catches "no tools loaded".
      if (ready?.repo && ready?.account) return ready
      await sleep(500)
    }
    return null
  })()

  if (!booted) throw new Error("Patchwork never booted (window.repo absent after 60s)")
  console.log("patchwork booted")

  // Install the module the way a person would: append its automerge URL to the
  // account's module-settings document. Serving a manifest off localhost does
  // not work against the deployed shell — Patchwork's service worker intercepts
  // the cross-origin request and answers 503 — and this is the real path anyway.
  const installed = await evaluate(
    cdp,
    `(async () => {
      const accountDoc = window.accountDocHandle.doc()
      const settingsUrl = accountDoc?.moduleSettingsUrl
      if (!settingsUrl) return { ok: false, why: "account has no moduleSettingsUrl" }
      const settings = await window.repo.find(settingsUrl)
      const already = (settings.doc()?.modules ?? []).some((m) => m.startsWith(${JSON.stringify(MODULE)}))
      if (!already) settings.change((d) => { if (!d.modules) d.modules = []; d.modules.push(${JSON.stringify(MODULE)}) })
      return { ok: true, already, modules: settings.doc().modules.length, settingsUrl }
    })()`
  )
  console.log(`installed module: ${JSON.stringify(installed)}`)
  if (!installed?.ok) throw new Error(`Could not install the module: ${installed?.why}`)

  // Reload so the module watcher picks it up from a clean boot.
  //
  // NOT `ignoreCache: true`: a cache-busting reload evicts the service worker's
  // cached wasm and Patchwork's boot then times out after 30s. Measured with
  // probes/reload-control.mjs — plain reload boots in ~0.5s, hard reload fails
  // every time, with or without a module installed.
  await cdp.send("Page.reload", { ignoreCache: false })
  await sleep(1000)
  const rebooted = await (async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const ready = await evaluate(cdp, `!!window.repo && !!window.accountDocHandle`, {
        awaitPromise: false,
      }).catch(() => false)
      if (ready) return true
      await sleep(500)
    }
    return false
  })()
  if (!rebooted) {
    const diagnostic = await evaluate(
      cdp,
      `(() => ({
        repo: !!window.repo,
        account: !!window.accountDocHandle,
        body: (document.body?.innerText ?? "").slice(0, 400),
        html: document.body?.innerHTML?.length ?? 0,
      }))()`,
      { awaitPromise: false }
    ).catch((err) => ({ evaluateFailed: String(err.message) }))
    console.error("reboot diagnostic:", JSON.stringify(diagnostic, null, 2))
    console.error("\n=== console lines mentioning modules ===")
    for (const line of consoleLines.filter((l) => /module|agent|plugin|import|fail|error/i.test(l))) {
      console.error(`  ${line.slice(0, 400)}`)
    }
    throw new Error("Patchwork did not come back after reload")
  }

  // Wait for our plugins to actually register rather than guessing at a delay.
  const registered = await (async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const found = await evaluate(
        cdp,
        `(async () => {
          try {
            const { getRegistry } = await import("@inkandswitch/patchwork-plugins")
            return getRegistry("patchwork:tool").all().some((p) => p.id === "agent-session")
          } catch { return false }
        })()`
      ).catch(() => false)
      if (found) return true
      await sleep(1000)
    }
    return false
  })()
  console.log(`agent plugins registered: ${registered}`)

  const pageScript = readFileSync(join(here, "e2e-page.js"), "utf8")
  await evaluate(cdp, pageScript, { awaitPromise: false })

  const report = await evaluate(
    cdp,
    `window.__agentProbe(${JSON.stringify({ prompt: PROMPT, model: MODEL, keepOpen: flag("keep-open") })})`
  )

  console.log("\n=== steps ===")
  for (const s of report.steps ?? []) {
    const { t, name, ...rest } = s
    console.log(`${String(t).padStart(6)}ms  ${name}  ${Object.keys(rest).length ? JSON.stringify(rest) : ""}`)
  }

  if (report.runnersSeen?.length) {
    console.log(`\nrunners that held the lease: ${report.runnersSeen.join(", ")}`)
  }

  if (report.statusTrail?.length) {
    console.log("\n=== status trajectory ===")
    for (const entry of report.statusTrail) {
      console.log(`${String(entry.t).padStart(6)}ms  ${entry.status}`)
    }
  }

  if (!report.ok) {
    console.log("\n=== FAILED ===")
    console.log(report.error)
  } else {
    console.log("\n=== calls ===")
    for (const call of report.session.calls) {
      console.log(`${call.status.padEnd(9)} ${call.tool}  ${JSON.stringify(call.input).slice(0, 160)}`)
    }
    console.log("\n=== results ===")
    for (const result of report.session.results) {
      console.log(`${result.isError ? "ERROR" : "ok   "}  ${result.output.replace(/\n/g, " ").slice(0, 160)}`)
    }
    console.log("\n=== transcript rows (what the sidebar shows) ===")
    for (const row of report.transcriptRows) console.log(`  ${row}`)
    console.log("\n=== assistant text ===")
    console.log(report.session.text)
    console.log("\n=== subject document afterwards ===")
    console.log(JSON.stringify(report.subject.doc, null, 2))

    const title = report.subject.doc?.title
    const expectTitle = option("expect-title", args.includes("--prompt") ? null : "Leek and Potato Soup")
    const expectTools = option("expect-tools", null)
    const checks = [
      ["the tool is registered", report.steps.find((s) => s.name === "registry")?.tool === true],
      ["the panel component is registered", report.steps.find((s) => s.name === "registry")?.panel === true],
      ["it asked before acting", report.approved > 0],
      ["it finished idle", report.finalStatus === "idle"],
    ]
    if (expectTitle) {
      checks.push(["the document was actually changed", title === expectTitle])
    }
    if (expectTools) {
      for (const wanted of expectTools.split(",")) {
        checks.push([`it called ${wanted}`, report.session.calls.some((c) => c.tool === wanted)])
      }
    }
    console.log("\n=== verdict ===")
    for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
    exitCode = checks.every(([, ok]) => ok) ? 0 : 1
    console.log(`\nsession: ${report.sessionUrl}\nsubject: ${report.subjectUrl}`)
  }

  if (consoleLines.length) {
    console.log("\n=== page console (last 30) ===")
    for (const line of consoleLines.slice(-30)) console.log(`  ${line}`)
  }

  if (flag("keep-open")) {
    console.log("\n--keep-open: leaving the browser up. Ctrl-C when done.")
    await new Promise(() => {})
  }
} catch (err) {
  console.error("\nPROBE FAILED:", err.message)
  if (consoleLines.length) {
    console.error("\n=== page console (last 30) ===")
    for (const line of consoleLines.slice(-30)) console.error(`  ${line}`)
  }
} finally {
  chrome.kill("SIGKILL")
}

process.exit(exitCode)
