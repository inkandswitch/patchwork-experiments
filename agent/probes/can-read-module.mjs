/**
 * Can a fresh Patchwork browser profile actually read the module document that
 * `pushwork sync` published?
 *
 * Installing a module makes boot block on loading it, so a doc the browser
 * cannot fetch looks like "boot did not finish" with no further explanation.
 * This isolates the question: boot a clean profile, try to find the doc, and
 * report what comes back.
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
const MODULE =
  option("module", null) ??
  JSON.parse(readFileSync(join(here, "..", ".pushwork", "config.json"), "utf8")).rootUrl
const PORT = Number(option("port", String(9400 + Math.floor(Math.random() * 400))))
const CHROME = option("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data)
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    }
  })
  return {
    send(method, params = {}) {
      const id = ++nextId
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
  }
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

const profile = mkdtempSync(join(tmpdir(), "agent-read-"))
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
      /* still starting */
    }
    if (!target) await sleep(250)
  }
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send("Runtime.enable")
  await cdp.send("Page.enable")
  await cdp.send("Page.navigate", { url: SHELL })

  for (let i = 0; i < 120; i++) {
    const ready = await evaluate(cdp, `!!window.repo && !!window.accountDocHandle`, false).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  console.log("booted")

  const report = await evaluate(
    cdp,
    `(async () => {
      const url = ${JSON.stringify(MODULE)}
      const out = { url }
      const withTimeout = (promise, ms) =>
        Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout after " + ms + "ms")), ms))])
      try {
        const handle = await withTimeout(window.repo.find(url), 20000)
        const doc = handle.doc()
        out.found = true
        out.isFolder = Array.isArray(doc?.docs)
        out.entries = (doc?.docs ?? []).map((d) => d.name)
        out.keys = Object.keys(doc ?? {})
      } catch (err) {
        out.found = false
        out.error = String(err?.message ?? err)
      }
      // Can the service worker serve a file out of it?
      try {
        const response = await withTimeout(fetch("/" + encodeURIComponent(url) + "/package.json"), 15000)
        out.swStatus = response.status
        out.swBody = (await response.text()).slice(0, 120)
      } catch (err) {
        out.swError = String(err?.message ?? err)
      }
      // The decisive test: can the entry module be imported the way the module
      // loader imports it, and does it expose a plugins array?
      try {
        const entry = "/" + encodeURIComponent(url) + "/index.js"
        const mod = await withTimeout(import(entry), 20000)
        out.importOk = true
        out.pluginCount = mod.plugins?.length ?? 0
        out.pluginIds = (mod.plugins ?? []).map((p) => p.type + ":" + p.id)
      } catch (err) {
        out.importOk = false
        out.importError = String(err?.message ?? err)
      }
      // And can each plugin entry survive the structuredClone into the worker?
      try {
        const entry = "/" + encodeURIComponent(url) + "/index.js"
        const mod = await import(entry)
        out.cloneable = (mod.plugins ?? []).map((p) => {
          const { load, ...rest } = p
          try {
            structuredClone(rest)
            return p.id + ":ok"
          } catch (err) {
            return p.id + ":" + String(err?.message ?? err)
          }
        })
      } catch (err) {
        out.cloneError = String(err?.message ?? err)
      }
      return out
    })()`
  )

  console.log(JSON.stringify(report, null, 2))
} catch (err) {
  console.error("FAILED:", err.message)
} finally {
  chrome.kill("SIGKILL")
}
process.exit(0)
