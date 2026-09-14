/**
 * Can Patchwork run a package's tests, in the browser?
 *
 * Same machinery as the build, pointed at a test file: bundle it, rewrite its
 * `vitest` import to the injected harness, execute the bundle, and collect what
 * passed and failed. If this works, the agent can write a test and find out
 * whether it holds — which it otherwise cannot.
 *
 * The package under test deliberately contains one passing test and one failing
 * one, because a runner that only ever reports success is not a runner.
 *
 * Usage: node probes/browser-test.mjs [--package automerge:…]
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

const profile = mkdtempSync(join(tmpdir(), "browser-test-"))
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
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

  for (let i = 0; i < 120; i++) {
    const ready = await cdp
      .send("Runtime.evaluate", { expression: "!!window.repo && !!window.accountDocHandle", returnByValue: true })
      .then((r) => r.result?.value)
      .catch(() => false)
    if (ready) break
    await sleep(500)
  }
  console.log("booted")

  const report = await evaluate(
    cdp,
    `(async () => {
      const out = {}
      try {
        const SOURCE = {
          "package.json": JSON.stringify({ name: "mathy", type: "module", main: "./dist/index.js" }),
          "src/math.ts": [
            'export function add(a: number, b: number): number { return a + b }',
            'export function divide(a: number, b: number): number {',
            '  if (b === 0) throw new Error("cannot divide by zero")',
            '  return a / b',
            '}',
          ].join("\\n"),
          "src/math.test.ts": [
            'import { describe, it, expect } from "vitest"',
            'import { add, divide } from "./math"',
            '',
            'describe("add", () => {',
            '  it("adds two numbers", () => { expect(add(2, 3)).toBe(5) })',
            '  it("is wrong on purpose", () => { expect(add(2, 3)).toBe(6) })',
            '})',
            '',
            'describe("divide", () => {',
            '  it("divides", () => { expect(divide(6, 3)).toBe(2) })',
            '  it("refuses zero", () => { expect(() => divide(1, 0)).toThrow(/divide by zero/) })',
            '  it("handles async", async () => {',
            '    const value = await Promise.resolve(add(1, 1))',
            '    expect(value).toBe(2)',
            '  })',
            '})',
          ].join("\\n"),
        }

        const makeFile = async (name, content) => {
          const h = await window.repo.create2()
          const extension = name.split(".").pop()
          h.change((d) => {
            d.name = name; d.extension = extension; d.mimeType = "text/plain"
            d.content = content; d["@patchwork"] = { type: "file" }
          })
          return h
        }
        const makeFolder = async (name) => {
          const h = await window.repo.create2()
          h.change((d) => { d.title = name; d.docs = []; d["@patchwork"] = { type: "folder" } })
          return h
        }

        const pkg = await makeFolder("mathy")
        const src = await makeFolder("src")
        pkg.change((d) => d.docs.push({ name: "src", type: "folder", url: src.url }))
        for (const [path, content] of Object.entries(SOURCE)) {
          const parts = path.split("/")
          const file = await makeFile(parts.at(-1), content)
          const into = parts.length > 1 ? src : pkg
          into.change((d) => d.docs.push({ name: parts.at(-1), type: "file", url: file.url }))
        }
        out.packageUrl = pkg.url

        const testing = await import("/" + encodeURIComponent(${JSON.stringify(PACKAGE)}) + "/tools/testing.js")
        const started = Date.now()
        out.report = await testing.packageTest.execute({ url: pkg.url }, { repo: window.repo })
        out.ms = Date.now() - started
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
    console.log(`\n=== report (${report.ms}ms) ===`)
    console.log(report.report)

    const text = report.report
    const checks = [
      ["it ran the tests in the browser", /passed/.test(text)],
      ["four tests passed", /4 passed/.test(text)],
      ["the deliberate failure was caught", /1 failed/.test(text) && /is wrong on purpose/.test(text)],
      ["the failure message is useful", /expected 5 to be 6/.test(text)],
      ["passing tests are not listed individually", !/adds two numbers/.test(text)],
      ["a toThrow assertion worked", !/refuses zero/.test(text)],
      ["an async test worked", !/handles async/.test(text)],
    ]
    console.log("\n=== verdict ===")
    for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
    exitCode = checks.every(([, ok]) => ok) ? 0 : 1
    console.log(`\npackage: ${report.packageUrl}`)
  }

  const errors = cdp.logs.filter((l) => /error|exception/i.test(l))
  if (errors.length) {
    console.log("\n=== page errors ===")
    for (const line of errors.slice(-6)) console.log(`  ${line.slice(0, 300)}`)
  }
} catch (err) {
  console.error("PROBE FAILED:", err.message)
} finally {
  await sleep(Number(option("flush", "8000")))
  chrome.kill("SIGKILL")
}
process.exit(exitCode)
