/**
 * Control experiment: is the boot failure caused by installing the module, or
 * by reloading at all?
 *
 * Boots a clean profile, reloads with nothing installed, then installs the
 * module and reloads again — reporting whether each boot completed. One of
 * these two is the culprit and guessing between them wastes more time than
 * measuring.
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
const IGNORE_CACHE = args.includes("--ignore-cache")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true })
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
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

async function waitForBoot(cdp, label, seconds = 60) {
  const started = Date.now()
  for (let i = 0; i < seconds * 2; i++) {
    const state = await evaluate(
      cdp,
      `(() => ({ ok: !!window.repo && !!window.accountDocHandle, body: (document.body?.innerText ?? "").slice(0, 80) }))()`,
      false
    ).catch(() => null)
    if (state?.ok) {
      console.log(`${label}: booted in ${Date.now() - started}ms`)
      return true
    }
    if (state?.body?.includes("Something went wrong")) {
      console.log(`${label}: FAILED after ${Date.now() - started}ms — ${state.body.replace(/\n/g, " ")}`)
      return false
    }
    await sleep(500)
  }
  console.log(`${label}: TIMED OUT after ${seconds}s`)
  return false
}

const profile = mkdtempSync(join(tmpdir(), "agent-control-"))
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
  const first = await waitForBoot(cdp, "1. first load")

  await cdp.send("Page.reload", { ignoreCache: IGNORE_CACHE })
  await sleep(500)
  const second = await waitForBoot(cdp, `2. reload (no module, ignoreCache=${IGNORE_CACHE})`)

  if (second) {
    const installed = await evaluate(
      cdp,
      `(async () => {
        const settings = await window.repo.find(window.accountDocHandle.doc().moduleSettingsUrl)
        settings.change((d) => { if (!d.modules) d.modules = []; d.modules.push(${JSON.stringify(MODULE)}) })
        return settings.doc().modules
      })()`
    )
    console.log(`   installed: ${JSON.stringify(installed)}`)

    await cdp.send("Page.reload", { ignoreCache: IGNORE_CACHE })
    await sleep(500)
    await waitForBoot(cdp, "3. reload (module installed)")
  }
} catch (err) {
  console.error("FAILED:", err.message)
} finally {
  chrome.kill("SIGKILL")
}
process.exit(0)
