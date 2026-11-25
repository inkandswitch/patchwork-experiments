/**
 * Can Patchwork run a package's tests, in the browser?
 *
 * Same machinery as the build, pointed at a test file: bundle it, rewrite its
 * `vitest` import to the runtime (vitest's own engine), import the bundle, and collect what
 * passed and failed. If this works, the agent can write a test and find out
 * whether it holds — which it otherwise cannot.
 *
 * The package under test deliberately contains one passing test and one failing
 * one, because a runner that only ever reports success is not a runner.
 *
 * Runs it in a page and in a worker (package_test's `in`). With --target, it
 * also runs an existing package's own tests in both, and prints the reports.
 *
 * A fresh profile syncs the agent folder after the shell boots, and an early
 * read runs whatever version arrived first. --heads (the root heads
 * `pushwork sync` printed) makes it wait for the version just published.
 *
 * Pinning the root folder doesn't pin the documents beneath it, so it also
 * waits until the files on the test path read as they do on disk here.
 *
 * Usage: node probes/browser-test.mjs [--package automerge:…] [--heads …]
 *          [--target automerge:… [--target-dir <its folder on disk>]]
 */

import { spawn } from "node:child_process"
import { readFileSync, readdirSync, mkdtempSync } from "node:fs"
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
const TARGET = option("target", null)
const HEADS = option("heads", null)
// --target-dir: the target package on disk, as published; the probe waits
// until the browser has those files before running the target's tests.
const TARGET_DIR = option("target-dir", null)
function textFiles(root, dir = "", out = {}) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (["node_modules", "dist"].includes(e.name) || e.name.startsWith(".")) continue
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) textFiles(root, rel, out)
    else if (/\.(m?[jt]sx?|json|md|ya?ml)$/.test(e.name)) out[rel] = readFileSync(join(root, rel), "utf8")
  }
  return out
}
const TARGET_FILES = TARGET_DIR ? textFiles(TARGET_DIR) : {}
// The test path's modules, as this checkout has them (the version synced).
const ON_DISK = Object.fromEntries(
  [
    "tools/testing.js",
    "tools/test-worker.js",
    "tools/vitest-runtime.js",
    "tools/vendor/vitest-engine.js",
    "tools/build.js",
    "documents/format.js",
    "documents/values.js",
    "documents/tree.js",
    "tools/folders.js",
    "host/import.js",
    "runners/worker-client.js",
  ].map((path) => [path, readFileSync(join(here, "..", path), "utf8")])
)
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

      // Import the agent's modules PINNED TO HEADS. An unpinned URL is served
      // from the browser's module cache, so a freshly synced fix silently does
      // not run — which looks exactly like the fix not working.
      // A pushwork directory is one map from each file's path to its document.
      // Wait (up to four minutes) until each named file reads as given.
      const waitForFiles = async (handle, files) => {
        const text = (c) => (typeof c === "string" ? c : c instanceof Uint8Array ? new TextDecoder().decode(c) : String(c ?? ""))
        const fileDoc = async (path) => {
          const url = handle.doc()?.[path]
          return typeof url === "string" && url.startsWith("automerge:") ? (await window.repo.find(url)).doc() : null
        }
        let behind = Object.keys(files)
        for (let i = 0; i < 480 && behind.length; i++) {
          const still = []
          for (const path of behind) if (text((await fileDoc(path))?.content) !== files[path]) still.push(path)
          behind = still
          if (behind.length) await new Promise((r) => setTimeout(r, 500))
        }
        return behind
      }

      const agentUrl = ${JSON.stringify(PACKAGE)}
      const pinned = await (async () => {
        const handle = await window.repo.find(agentUrl)
        const want = ${JSON.stringify(HEADS)}
        for (let i = 0; want && i < 240 && [...(handle.heads?.() ?? [])].sort().join("|") !== want; i++) {
          await new Promise((r) => setTimeout(r, 500))
        }
        const heads = handle.heads?.() ?? []
        out.agentHeads = [...heads].sort().join("|")
        // Every file on the test path, as published, before anything imports it.
        out.behind = await waitForFiles(handle, ${JSON.stringify(ON_DISK)})
        const bare = agentUrl.split("#")[0]
        return "/" + encodeURIComponent(heads.length ? bare + "#" + [...heads].sort().join("|") : bare) + "/"
      })()
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
            'import { describe, it, expect, vi } from "vitest"',
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
            '',
            '// Things a hand-rolled subset cannot do — if these pass, the real',
            '// vitest assertion engine is what is running.',
            'describe("real vitest features", () => {',
            '  it("supports asymmetric matchers", () => {',
            '    expect({ a: 1, b: 2 }).toEqual(expect.objectContaining({ a: 1 }))',
            '    expect([1, 2, 3]).toEqual(expect.arrayContaining([2, 3]))',
            '    expect("hello").toEqual(expect.any(String))',
            '  })',
            '  it("supports vi.fn spies", () => {',
            '    const spy = vi.fn((n: number) => n * 2)',
            '    spy(21)',
            '    expect(spy).toHaveBeenCalledWith(21)',
            '    expect(spy).toHaveBeenCalledTimes(1)',
            '    expect(spy.mock.results[0].value).toBe(42)',
            '  })',
            '  it("supports deep property paths", () => {',
            '    expect({ a: { b: { c: 1 } } }).toHaveProperty("a.b.c", 1)',
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

        const testing = await import(pinned + "tools/testing.js")
        const run = async (url, host) => {
          const started = Date.now()
          try {
            const report = await testing.packageTest.execute({ url, in: host }, { repo: window.repo })
            return { report, ms: Date.now() - started }
          } catch (err) {
            return { report: "THREW: " + String(err?.stack ?? err), ms: Date.now() - started }
          }
        }
        out.hosts = {}
        for (const host of ["page", "worker"]) out.hosts[host] = await run(pkg.url, host)
        const target = ${JSON.stringify(TARGET)}
        if (target) {
          out.targetBehind = await waitForFiles(await window.repo.find(target), ${JSON.stringify(TARGET_FILES)})
          out.target = {}
          for (const host of ["page", "worker"]) out.target[host] = await run(target, host)
        }
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
    console.log(`agent heads: ${report.agentHeads}; still behind: ${report.behind?.join(", ") || "nothing"}`)
    console.log(report.error)
  } else {
    console.log(`agent heads: ${report.agentHeads}${HEADS && report.agentHeads !== HEADS ? `  (WANTED ${HEADS})` : ""}`)
    if (report.behind?.length) console.log(`STILL BEHIND what's on disk: ${report.behind.join(", ")}`)
    const results = []
    for (const [host, { report: text, ms }] of Object.entries(report.hosts)) {
      console.log(`\n=== in a ${host} (${ms}ms) ===`)
      console.log(text)
      const checks = [
        ["it ran the tests", /passed/.test(text)],
        ["seven pass, one fails by design", /7 passed/.test(text)],
        ["the deliberate failure was caught", /1 failed/.test(text) && /is wrong on purpose/.test(text)],
        ["the failure message is useful", /to be 6|expected 5/.test(text)],
        ["passing tests are not listed individually", !/adds two numbers/.test(text)],
        ["asymmetric matchers worked", !/supports asymmetric matchers/.test(text)],
        ["vi.fn spies worked", !/supports vi\.fn spies/.test(text)],
        ["deep property paths worked", !/deep property paths/.test(text)],
        ["it used vitest's engine, in this host", new RegExp(`vitest \\d+\\.\\d+\\.\\d+, in a ${host}`).test(text)],
      ]
      console.log(`\n=== verdict, in a ${host} ===`)
      for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
      results.push(...checks)
    }
    if (report.targetBehind?.length) console.log(`\ntarget STILL BEHIND what's on disk: ${report.targetBehind.join(", ")}`)
    for (const [host, { report: text, ms }] of Object.entries(report.target ?? {})) {
      console.log(`\n=== ${TARGET}, in a ${host} (${ms}ms) ===`)
      console.log(text)
    }
    exitCode = results.every(([, ok]) => ok) ? 0 : 1
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
