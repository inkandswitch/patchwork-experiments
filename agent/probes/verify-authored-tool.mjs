/**
 * Verify a tool the agent wrote actually works.
 *
 * The agent reporting "I created and installed the dice tool" is a claim, not
 * evidence. This installs the package it produced into a clean Patchwork,
 * reloads, and then does what a person would: create a document of the new
 * datatype, mount the new tool, click its button, and check the document
 * changed.
 *
 * Usage: node probes/verify-authored-tool.mjs --package automerge:… [--datatype dice]
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
const PACKAGE = option("package", null)
const DATATYPE = option("datatype", "dice")
const PORT = Number(option("port", String(9400 + Math.floor(Math.random() * 400))))
const CHROME = option("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

if (!PACKAGE) {
  console.error("Pass --package automerge:… (the url tool_write returned)")
  process.exit(2)
}

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

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

const profile = mkdtempSync(join(tmpdir(), "verify-tool-"))
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    // NOT --disable-gpu: that leaves no WebGL at all, so anything drawing with
    // three.js or a canvas fails in a way that looks like a bug in the tool.
    // SwiftShader gives headless a software GL implementation.
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
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

  const waitBoot = async () => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(cdp, `!!window.repo && !!window.accountDocHandle`, false).catch(() => false)) return true
      await sleep(500)
    }
    return false
  }
  if (!(await waitBoot())) throw new Error("did not boot")
  console.log("booted")

  // Read the source the agent wrote, so a failure can be diagnosed.
  const source = await evaluate(
    cdp,
    `(async () => {
      const pkg = await window.repo.find(${JSON.stringify(PACKAGE)})
      const doc = pkg.doc()
      const files = {}
      for (const entry of doc.docs ?? []) {
        const file = await window.repo.find(entry.url)
        files[entry.name] = String(file.doc()?.content ?? "")
      }
      return files
    })()`
  )
  console.log(`\n=== files the agent wrote (${Object.keys(source).join(", ")}) ===`)
  for (const [name, content] of Object.entries(source)) {
    console.log(`\n--- ${name} (${content.length} chars) ---`)
    console.log(content.length > 1800 ? `${content.slice(0, 1800)}\n… truncated` : content)
  }

  await evaluate(
    cdp,
    `(async () => {
      const settings = await window.repo.find(window.accountDocHandle.doc().moduleSettingsUrl)
      settings.change((d) => { if (!d.modules) d.modules = []; d.modules.push(${JSON.stringify(PACKAGE)}) })
      return settings.doc().modules
    })()`
  )
  await cdp.send("Page.reload", { ignoreCache: false })
  await sleep(1000)
  if (!(await waitBoot())) throw new Error("did not boot after installing the package")
  console.log("\nrebooted with the package installed")

  // Wait for registration rather than checking once. A package created moments
  // ago in another profile may not have reached this one's module loader yet,
  // and the resulting "not registered" looks exactly like a broken package.
  const registered = await (async () => {
    for (let i = 0; i < 30; i++) {
      const found = await evaluate(
        cdp,
        `(async () => {
          try {
            const { getRegistry } = await import("@inkandswitch/patchwork-plugins")
            return getRegistry("patchwork:datatype").all().some((p) => p.id === ${JSON.stringify(DATATYPE)})
          } catch { return false }
        })()`
      ).catch(() => false)
      if (found) return true
      await sleep(1000)
    }
    return false
  })()
  console.log(`datatype registered: ${registered}${registered ? "" : " (waited 30s)"}`)

  const report = await evaluate(
    cdp,
    `(async () => {
      const out = {}
      const { getRegistry, createDocOfDatatype2 } = await import("@inkandswitch/patchwork-plugins")
      const dt = getRegistry("patchwork:datatype").all().find((p) => p.id === ${JSON.stringify(DATATYPE)})
      const tl = getRegistry("patchwork:tool").all().find((p) => p.id === ${JSON.stringify(DATATYPE)})
      out.datatypeRegistered = !!dt
      out.toolRegistered = !!tl
      if (!dt || !tl) return out

      const datatype = await getRegistry("patchwork:datatype").load(${JSON.stringify(DATATYPE)})
      const handle = await createDocOfDatatype2(datatype, window.repo)
      out.created = JSON.parse(JSON.stringify(handle.doc()))

      const tool = await getRegistry("patchwork:tool").load(${JSON.stringify(DATATYPE)})
      const host = document.createElement("div")
      host.style.cssText = "position:fixed;inset:0;z-index:99999;background:white"
      document.body.append(host)
      let cleanup = null
      try {
        cleanup = tool.module(handle, host)
        out.mounted = true
      } catch (err) {
        out.mounted = false
        out.mountError = String(err?.message ?? err)
        return out
      }

      out.renderedText = (host.innerText ?? "").slice(0, 200)
      const buttons = [...host.querySelectorAll("button")]
      const inputs = [...host.querySelectorAll("input, select, textarea")]
      out.buttonCount = buttons.length
      out.inputCount = inputs.length
      out.interactive = buttons.length + inputs.length

      // Drawing tools render to a canvas and may have no controls at all, so
      // check for one and whether it actually has pixels in it.
      const canvas = host.querySelector("canvas")
      out.hasCanvas = !!canvas
      if (canvas) {
        out.canvasSize = canvas.width + "x" + canvas.height
        out.webglContext = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"))
      }

      const before = JSON.parse(JSON.stringify(handle.doc()))
      // Whatever the tool offers: a button to click, else an input to change.
      if (buttons.length) {
        buttons[0].click()
        out.interactedWith = "button"
      } else if (inputs.length) {
        const field = inputs[0]
        const value = field.type === "range" || field.type === "number"
          ? String(Number(field.value || 0) + (Number(field.step) || 1))
          : "probe"
        field.value = value
        field.dispatchEvent(new Event("input", { bubbles: true }))
        field.dispatchEvent(new Event("change", { bubbles: true }))
        out.interactedWith = "input"
      }
      await new Promise((r) => setTimeout(r, 400))
      const after = JSON.parse(JSON.stringify(handle.doc()))
      out.before = before
      out.after = after
      out.changed = JSON.stringify(before) !== JSON.stringify(after)
      out.renderedAfter = (host.innerText ?? "").slice(0, 200)

      out.cleanupReturned = typeof cleanup === "function"
      try { cleanup?.() } catch (err) { out.cleanupError = String(err?.message ?? err) }
      host.remove()
      return out
    })()`
  )

  console.log("\n=== verification ===")
  console.log(JSON.stringify(report, null, 2))

  const checks = [
    ["the datatype registered", report.datatypeRegistered === true],
    ["the tool registered", report.toolRegistered === true],
    ["the tool mounted without throwing", report.mounted === true],
    ["it rendered something", report.interactive > 0 || report.hasCanvas === true || !!report.renderedText],
    ["it returned a cleanup function", report.cleanupReturned === true],
  ]
  // A tool with controls should respond to them; a pure drawing tool need not.
  if (report.interactive > 0) {
    checks.push([`interacting with its ${report.interactedWith} changed the document`, report.changed === true])
  }
  if (report.hasCanvas) {
    checks.push(["it has a live WebGL canvas", report.webglContext === true])
  }
  console.log("\n=== verdict ===")
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
  exitCode = checks.every(([, ok]) => ok) ? 0 : 1

  const errors = cdp.logs.filter((l) => /error|exception/i.test(l))
  if (errors.length) {
    console.log("\n=== page errors ===")
    for (const line of errors.slice(-10)) console.log(`  ${line.slice(0, 300)}`)
  }
} catch (err) {
  console.error("FAILED:", err.message)
} finally {
  chrome.kill("SIGKILL")
}
process.exit(exitCode)
