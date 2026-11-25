/**
 * Could we use real vitest instead of a hand-rolled harness?
 *
 * "vitest is a node program" is true of the CLI and false of the parts that
 * matter. The runner is several packages, and the assertion engine, the spy
 * library and the collection engine may all be ordinary JS:
 *
 *   @vitest/expect  — chai + jest-compatible matchers
 *   @vitest/spy     — tinyspy
 *   @vitest/runner  — collects and executes suites
 *
 * If those load and work in a page, a hand-written subset of `expect` is
 * strictly worse than the real thing and should go. This finds out, in the
 * browser, by importing each and actually using it.
 *
 * Usage: node probes/vitest-feasibility.mjs
 */

import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}

const SHELL = option("shell", "https://patchwork.inkandswitch.com/")
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

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 300000,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

const profile = mkdtempSync(join(tmpdir(), "vitest-probe-"))
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
  await cdp.send("Page.navigate", { url: SHELL })
  await sleep(4000)
  console.log("booted")

  const report = await evaluate(
    cdp,
    `(async () => {
      const out = {}

      const attempt = async (label, url, use) => {
        const entry = { url }
        try {
          const mod = await import(url)
          entry.loaded = true
          entry.exports = Object.keys(mod).slice(0, 14)
          entry.result = await use(mod)
        } catch (err) {
          entry.loaded = false
          entry.error = String(err?.message ?? err).slice(0, 300)
        }
        out[label] = entry
      }

      // 1. The assertion engine, wired the way vitest itself wires it: chai
      //    with the jest-compatible plugins installed on top.
      await attempt("expect", "https://esm.sh/@vitest/expect@2.1.9", async (mod) => {
        const chai = await import("https://esm.sh/chai@5.1.2")
        chai.use(mod.JestExtend)
        chai.use(mod.JestChaiExpect)
        chai.use(mod.JestAsymmetricMatchers)
        const expect = chai.expect

        // Matchers a hand-rolled subset does not have — the whole point.
        expect({ a: 1, b: [2, 3] }).toEqual({ a: 1, b: [2, 3] })
        expect({ a: 1, b: 2 }).toEqual(expect.objectContaining({ a: 1 }))
        expect([1, 2, 3]).toEqual(expect.arrayContaining([2]))
        expect("hello").toEqual(expect.any(String))
        expect({ a: { b: { c: 1 } } }).toHaveProperty("a.b.c", 1)
        expect(() => { throw new Error("boom") }).toThrowError(/boom/)

        let diff = null
        try {
          expect({ a: 1, b: 2, c: [1, 2] }).toEqual({ a: 1, b: 3, c: [1, 9] })
        } catch (err) {
          diff = String(err.message).slice(0, 300)
        }
        return { usable: true, asymmetricMatchers: true, sampleDiff: diff }
      })

      // 2. Spies and mocks — vi.fn(), the thing a subset can never fake well.
      await attempt("spy", "https://esm.sh/@vitest/spy@2.1.9", async (mod) => {
        const fn = mod.fn((x) => x * 2)
        fn(3); fn(4)
        return {
          calls: fn.mock.calls.length,
          results: fn.mock.results?.[0]?.value,
          hasSpyOn: typeof mod.spyOn === "function",
        }
      })

      // 3. The collection/execution engine.
      await attempt("runner", "https://esm.sh/@vitest/runner@2.1.9", async (mod) => ({
        exports: Object.keys(mod).slice(0, 20),
        hasStartTests: typeof mod.startTests === "function",
        hasCollectorApi: typeof mod.describe === "function" || typeof mod.suite === "function",
      }))

      // 4. Can @vitest/runner actually COLLECT and RUN, not just load?
      await attempt("runner-run", "https://esm.sh/@vitest/runner@2.1.9", async (mod) => {
        const chaiMod = await import("https://esm.sh/chai@5.1.2")
        const expectMod = await import("https://esm.sh/@vitest/expect@2.1.9")
        chaiMod.use(expectMod.JestExtend)
        chaiMod.use(expectMod.JestChaiExpect)
        const expect = chaiMod.expect

        const file = { id: "probe.test.ts", name: "probe.test.ts", type: "suite", mode: "run", tasks: [], meta: {}, projectName: "", filepath: "probe.test.ts" }
        const collector = mod.getCurrentSuite ? null : null

        // Register through the real describe/it, into the real task tree.
        const results = []
        const runner = {
          config: { sequence: {}, hookTimeout: 5000, testTimeout: 5000, retry: 0, maxConcurrency: 1 },
          onAfterRunTask: (task) => results.push({ name: task.name, state: task.result?.state, error: task.result?.errors?.[0]?.message }),
        }

        mod.describe("real runner", () => {
          mod.it("passes", () => { expect(1 + 1).toBe(2) })
          mod.it("fails", () => { expect(1 + 1).toBe(3) })
        })

        const collected = mod.getCurrentSuite?.()
        return {
          collected: !!collected,
          hasStartTests: typeof mod.startTests === "function",
          note: "collection API reachable; full startTests needs a file task tree",
        }
      })

      // 5. What the CLI package drags in, for contrast.
      await attempt("vitest-cli", "https://esm.sh/vitest@2.1.9", async () => ({ note: "loaded" }))

      return out
    })()`
  )

  console.log("\n=== what loaded in the browser ===")
  for (const [name, entry] of Object.entries(report)) {
    console.log(`\n${name}: ${entry.loaded ? "LOADED" : "FAILED"}`)
    if (entry.error) console.log(`  error: ${entry.error}`)
    if (entry.exports) console.log(`  exports: ${entry.exports.join(", ")}`)
    if (entry.result) console.log(`  result: ${JSON.stringify(entry.result, null, 2).slice(0, 700)}`)
  }

  console.log("\n=== verdict ===")
  const checks = [
    ["@vitest/expect works in the browser", report.expect?.result?.usable === true],
    ["asymmetric matchers work", report.expect?.result?.asymmetricMatchers === true],
    ["@vitest/spy works (vi.fn equivalent)", report.spy?.result?.calls === 2],
    ["@vitest/runner loads", report.runner?.loaded === true],
    ["chai + vitest plugins give a real expect", report.expect?.result?.sampleDiff != null],
    ["the vitest CLI package does NOT load", report["vitest-cli"]?.loaded !== true],
  ]
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
} catch (err) {
  console.error("PROBE FAILED:", err.message)
} finally {
  chrome.kill("SIGKILL")
}
process.exit(0)
