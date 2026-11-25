/**
 * Why does package_test say `Cannot call "initialize" more than once`?
 *
 * The hypothesis: esbuild's initialization state lives on the esbuild module,
 * which the browser keys by absolute URL and therefore shares; our guard against
 * double-initialization lives on OUR module, which the browser keys by *its*
 * URL. Import the agent package at two URLs — a pinned one and an unpinned one,
 * which is exactly what happens after a sync while a tab is open — and there are
 * two guards in front of one esbuild.
 *
 * This probe imports build.js twice, both ways, and reports what each call did.
 * Run it before and after the fix.
 *
 * Usage: node probes/esbuild-twice.mjs
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

const profile = mkdtempSync(join(tmpdir(), "esbuild-twice-"))
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

  for (let i = 0; i < 120; i++) {
    const ready = await cdp
      .send("Runtime.evaluate", { expression: "!!window.repo", returnByValue: true })
      .then((r) => r.result?.value)
      .catch(() => false)
    if (ready) break
    await sleep(500)
  }
  console.log("booted")

  const report = await evaluate(
    cdp,
    `(async () => {
      const out = { attempts: [] }
      const bare = ${JSON.stringify(PACKAGE)}.split("#")[0]

      // Two different module URLs for the same source. This is not contrived:
      // a heads-pinned import and an unpinned one both happen in normal use,
      // and they are different modules to the browser.
      const handle = await window.repo.find(bare)
      const heads = handle.heads?.() ?? []
      const pinned = "/" + encodeURIComponent(heads.length ? bare + "#" + [...heads].sort().join("|") : bare) + "/"
      const plain = "/" + encodeURIComponent(bare) + "/"
      out.urls = { pinned, plain }

      const attempt = async (label, base) => {
        const record = { label, base }
        try {
          const mod = await import(base + "tools/build.js")
          record.sameModuleInstance = mod === out.firstModule
          if (!out.firstModule) out.firstModule = mod
          const started = Date.now()
          await mod.loadEsbuild({})
          record.ok = true
          record.ms = Date.now() - started

          // Prove it is usable, not merely that the call returned.
          const built = await mod.loadEsbuild({}).then((e) =>
            e.transform("const x: number = 1", { loader: "ts" })
          )
          record.transformed = built.code.trim()
        } catch (err) {
          record.ok = false
          record.error = String(err?.message ?? err)
        }
        out.attempts.push(record)
      }

      await attempt("first import (pinned)", pinned)
      await attempt("second import (unpinned, a different module)", plain)
      // And once more through the first URL, which should be a cache hit.
      await attempt("third import (pinned again, cached)", pinned)

      out.distinctModules = out.attempts.filter((a) => a.sameModuleInstance === false).length
      return out
    })()`
  )

  console.log("\n=== module urls ===")
  console.log(`  pinned:   ${report.urls.pinned}`)
  console.log(`  unpinned: ${report.urls.plain}`)

  console.log("\n=== attempts ===")
  for (const a of report.attempts) {
    console.log(`  ${a.ok ? "ok   " : "FAIL "} ${a.label}`)
    if (a.error) console.log(`         ${a.error}`)
    if (a.transformed) console.log(`         transform -> ${a.transformed}`)
  }

  const allOk = report.attempts.every((a) => a.ok)
  console.log("\n=== verdict ===")
  console.log(`${allOk ? "PASS" : "FAIL"}  every copy of build.js can load esbuild`)
  for (const a of report.attempts) {
    console.log(`${a.ok ? "PASS" : "FAIL"}  ${a.label}`)
  }
  exitCode = allOk ? 0 : 1

  const errors = cdp.logs.filter((l) => /error|exception/i.test(l))
  if (errors.length) {
    console.log("\n=== page errors ===")
    for (const line of errors.slice(-5)) console.log(`  ${line.slice(0, 250)}`)
  }
} catch (err) {
  console.error("PROBE FAILED:", err.message)
} finally {
  await sleep(Number(option("flush", "2000")))
  chrome.kill("SIGKILL")
}
process.exit(exitCode)
