/**
 * Running a package's tests, in a page or a worker.
 *
 * `tool_check` answers "does this tool mount and respond to a click". It cannot
 * answer "is this function correct", which is what tests are for — and an agent
 * that writes tests it cannot run has written documentation, not tests.
 *
 * The mechanism is the build machinery pointed at a different entry point:
 * each test file is bundled with esbuild, its `vitest` import rewritten to a
 * bridge to the runtime, and the bundle imported while vitest's own runner
 * collects it (vitest-runtime.js, over the vendored engine). The same engine
 * runs the package's tests under `vitest run`, so a test means the same thing
 * in every host.
 *
 * Two hosts: the page, which has the real DOM, and a worker, which has none —
 * where code meant for workers has to be shown to work. A file that declares
 * a DOM environment (`// @vitest-environment happy-dom`) is skipped in the
 * worker, with the reason.
 *
 * Host tier either way: the build and the importmap are the tab's.
 */

import { materialize, loadEsbuild, packagePlugin, isExternal, loaderFor } from "./build.js"
import { createRuntime, captureConsole } from "./vitest-runtime.js"
import { resolveImportMap } from "../worker-client.js"

export { captureConsole }

/** Test files, by the conventions everyone already uses. */
export const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/

export function findTestFiles(files, filter) {
  const all = [...files.keys()].filter((path) => TEST_FILE_PATTERN.test(path))
  if (!filter) return all.sort()
  let pattern
  try {
    pattern = new RegExp(filter, "i")
  } catch {
    pattern = new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
  }
  return all.filter((path) => pattern.test(path)).sort()
}

/** The DOM environment a test file asks for in its pragma, or null. */
export function domEnvironmentOf(source) {
  return /@vitest-environment\s+(happy-dom|jsdom)\b/.exec(String(source ?? ""))?.[1] ?? null
}

/**
 * The module a test file gets when it imports `vitest`: a bridge to the
 * runtime the host installed, so the file registers its suites with the
 * runner that is collecting it.
 */
export const VITEST_BRIDGE = `
const vitest = globalThis.__patchworkVitest
if (!vitest) throw new Error("no vitest runtime — run these through package_test")
export const { describe, suite, it, test, beforeAll, afterAll, beforeEach, afterEach, onTestFailed, onTestFinished, expect, assert, chai, vi } = vitest
export { vi as vitest }
export default vitest
`

/** Specifiers a test file might import the API from; the jest-shaped ones mean the same calls. */
const VITEST_SPECIFIERS = ["vitest", "@jest/globals", "bun:test"]

/**
 * A specifier through an importmap's `imports`: an exact entry, else the
 * longest prefix entry ending in "/".
 */
export function resolveSpecifier(imports, specifier) {
  if (Object.hasOwn(imports, specifier)) return imports[specifier]
  let best = null
  for (const key of Object.keys(imports)) {
    if (key.endsWith("/") && specifier.startsWith(key) && (!best || key.length > best.length)) best = key
  }
  return best ? imports[best] + specifier.slice(best.length) : null
}

/**
 * Where the service worker serves a package's files: Patchwork's
 * `getImportableUrlFromAutomergeUrl`. Null outside a browser.
 */
export function packageBaseUrl(folderUrl) {
  let origin
  try {
    origin = new URL(globalThis.document.baseURI).origin
  } catch {
    origin = globalThis.location?.origin
  }
  return origin && origin !== "null" ? `${origin}/${encodeURIComponent(folderUrl)}/` : null
}

/**
 * The package plugin, with `vitest` resolved to the bridge.
 *
 * With `importMap` (resolved to absolute URLs), Patchwork's externals are
 * rewritten to those URLs, for a worker, which has no importmap of its own.
 *
 * With `baseUrl`, each package module's `import.meta.url` is its own file's
 * service-worker URL, as if it had been imported unbundled — so
 * `fetch(new URL("./data.json", import.meta.url))` reads the package, rather
 * than resolving against the blob the bundle runs from.
 */
export function testPlugin(files, { importMap = null, baseUrl = null, ...options } = {}) {
  const inner = packagePlugin(files, options)
  return {
    name: "patchwork-test",
    setup(build) {
      if (baseUrl) {
        build.onLoad({ filter: /.*/, namespace: "package" }, (args) => {
          const contents = files.get(args.path) ?? ""
          if (typeof contents !== "string") return undefined
          const url = JSON.stringify(new URL(args.path, baseUrl).href)
          return { contents: contents.replace(/\bimport\.meta\.url\b/g, url), loader: loaderFor(args.path) }
        })
      }
      build.onResolve({ filter: /.*/ }, (args) => {
        if (VITEST_SPECIFIERS.includes(args.path)) return { path: "vitest", namespace: "vitest" }
        if (importMap && isExternal(args.path)) {
          const url = resolveSpecifier(importMap, args.path)
          if (url) return { path: url, external: true }
          return { errors: [{ text: `'${args.path}' comes from Patchwork's importmap, which has no entry for it` }] }
        }
        return undefined // fall through to the package plugin
      })
      build.onLoad({ filter: /.*/, namespace: "vitest" }, () => ({ contents: VITEST_BRIDGE, loader: "js" }))
      inner.setup(build)
    },
  }
}

/** How much of what a file logged the report keeps. */
export const LOGGED_MAX_LINES = 60
export const LOGGED_MAX_CHARS = 6000
/** How many lines of a failure's diff the report keeps. */
export const DIFF_MAX_LINES = 16
/** How long a worker gets for one file before it is terminated. */
export const WORKER_FILE_DEADLINE_MS = 60_000

function describeLogged(logged) {
  if (!logged.length) return []
  const out = ["  console:"]
  let chars = 0
  for (const [i, line] of logged.entries()) {
    if (i >= LOGGED_MAX_LINES || chars + line.length > LOGGED_MAX_CHARS) {
      out.push(`    … ${logged.length - i} more line${logged.length - i === 1 ? "" : "s"}`)
      break
    }
    chars += line.length
    out.push(...line.split("\n").map((part) => `    ${part}`))
  }
  return out
}

function describeDiff(diff) {
  if (!diff) return []
  const lines = diff.split("\n")
  const kept = lines.slice(0, DIFF_MAX_LINES).map((line) => `      ${line}`)
  if (lines.length > DIFF_MAX_LINES) kept.push(`      … ${lines.length - DIFF_MAX_LINES} more lines`)
  return kept
}

/** Render results the way a test runner does, because that is what people read. */
export function formatResults(fileResults) {
  const lines = []
  let passed = 0
  let failed = 0
  let skipped = 0
  let unhandledCount = 0

  for (const { file, results = [], error, skippedBecause, unhandled = [], logged = [] } of fileResults) {
    if (skippedBecause) {
      lines.push(`- ${file}  (skipped: ${skippedBecause})`)
      continue
    }
    if (error) {
      lines.push(`✗ ${file}`)
      lines.push(`  could not run: ${error}`)
      lines.push(...describeLogged(logged))
      failed++
      continue
    }

    const fileFailed = results.some((r) => r.status === "failed") || unhandled.length > 0
    lines.push(`${fileFailed ? "✗" : "✓"} ${file}  (${results.length} test${results.length === 1 ? "" : "s"})`)

    for (const result of results) {
      if (result.status === "passed") passed++
      else if (result.status === "skipped") skipped++
      else failed++

      if (result.status === "failed") {
        lines.push(`  ✗ ${result.label}`)
        lines.push(`      ${result.error}`)
        lines.push(...describeDiff(result.diff))
        if (result.stack) lines.push(`      ${result.stack.split("\n")[0]?.trim() ?? ""}`)
      } else if (result.status === "skipped") {
        lines.push(`  - ${result.label} (skipped)`)
      }
    }
    for (const message of unhandled) lines.push(`  ✗ unhandled error while this file ran: ${message}`)
    unhandledCount += unhandled.length
    lines.push(...describeLogged(logged))
  }

  lines.push("")
  lines.push(
    `${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}` +
      (unhandledCount ? `, ${unhandledCount} unhandled error${unhandledCount === 1 ? "" : "s"}` : "")
  )
  return { report: lines.join("\n"), passed, failed, skipped, unhandled: unhandledCount }
}

/** The vendored engine, loaded on first use: it is half a megabyte. */
function loadEngine() {
  return import("./vendor/vitest-engine.js")
}

/** Execute a bundle by importing it. Replaceable in tests. */
async function defaultRunBundle(code) {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
  try {
    await import(/* @vite-ignore */ url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Run one bundle in this page, under the runtime. */
async function runInPage(file, code, options, { engine, runBundle = defaultRunBundle }) {
  const runtime = createRuntime(engine)
  const previous = globalThis.__patchworkVitest
  globalThis.__patchworkVitest = runtime.api
  // Files run one after another, so what is logged meanwhile is this file's.
  const consoled = captureConsole()
  try {
    const report = await runtime.runFile(file, () => runBundle(code), options)
    return { ...report, logged: consoled.lines }
  } catch (err) {
    return { error: String(err?.message ?? err), logged: consoled.lines }
  } finally {
    consoled.stop()
    if (previous === undefined) delete globalThis.__patchworkVitest
    else globalThis.__patchworkVitest = previous
  }
}

const AUTOMERGE_SLIM = "@automerge/automerge/slim"
const AUTOMERGE_WASM = /\/automerge[^/]*\.wasm(\?|$)/

/**
 * What a fresh worker needs before a test's imports work as they do in the
 * page. Patchwork's importmap serves automerge's slim build, which the page's
 * boot initialises with its wasm (initializeWasm); a worker gets the module
 * uninitialised, and the first Repo dies with "Automerge.use() not called".
 * So the worker initialises it the same way, from the wasm this page loaded
 * (its resource timings name the build's own hashed copy).
 *
 * @returns {{ automerge: string, wasm: string } | null}
 */
export function workerPreparation(importMap, { resources = pageResources(), origin = pageOrigin() } = {}) {
  const automerge = importMap?.[AUTOMERGE_SLIM]
  if (!automerge) return null
  const loaded = resources.find((name) => AUTOMERGE_WASM.test(new URL(name, "http://x").pathname))
  const wasm = loaded ?? (origin ? new URL("/automerge.wasm", origin).href : null)
  return wasm ? { automerge, wasm } : null
}

function pageResources() {
  try {
    return globalThis.performance?.getEntriesByType?.("resource").map((e) => e.name) ?? []
  } catch {
    return []
  }
}

function pageOrigin() {
  try {
    return new URL(globalThis.document.baseURI).origin
  } catch {
    return null
  }
}

/** Run one bundle in a fresh module worker (test-worker.js). Replaceable in tests. */
function defaultRunInWorker(file, code, options, { deadlineMs = WORKER_FILE_DEADLINE_MS } = {}) {
  return new Promise((resolve) => {
    let worker
    try {
      worker = new Worker(new URL("./test-worker.js", import.meta.url), { type: "module" })
    } catch (err) {
      resolve({ error: `could not start a worker: ${err?.message ?? err}` })
      return
    }
    const finish = (report) => {
      clearTimeout(timer)
      worker.terminate()
      resolve(report)
    }
    const timer = setTimeout(
      () => finish({ error: `did not finish within ${deadlineMs / 1000}s; the worker was terminated` }),
      deadlineMs
    )
    worker.onmessage = (event) => finish(event.data)
    worker.onerror = (event) => {
      event.preventDefault?.()
      finish({ error: `the worker failed: ${event.message ?? "it could not load"}` })
    }
    worker.postMessage({ file, code, options })
  })
}

export const packageTest = {
  id: "package_test",
  name: "Run a package's tests",
  description: [
    "Run the tests in a package and report which passed and which failed, with the failure messages.",
    "",
    "Write tests as `*.test.ts` (or .js) beside the code, in the style you already know:",
    "  import { describe, it, expect } from 'vitest'",
    "  describe('thing', () => { it('works', () => { expect(add(1, 2)).toBe(3) }) })",
    "",
    "This is vitest's own engine (@vitest/runner, @vitest/expect, @vitest/spy), the version the package's `vitest run` uses, so describe/it/each/hooks/only/skip/todo, every matcher (including expect.objectContaining and friends) and vi.fn / vi.spyOn behave as they do there. What needs vitest's CLI is not here: vi.mock, fake timers, snapshots, coverage.",
    "",
    "`in` picks the host. \"page\" (the default) has the real DOM. \"worker\" has none; use it for code meant to run in a worker. A file that starts with `// @vitest-environment happy-dom` (or jsdom) needs a DOM, and is skipped in a worker with that reason.",
    "Read a package file from a test with fetch(new URL('./data.json', import.meta.url)), not node:fs.",
    "",
    "What the tests log with console.log (or warn, error) is shown under each file in the report.",
    "Test the logic you can test this way; use tool_check for whether the tool mounts and renders.",
  ].join("\n"),
  where: "host",
  risk: "write",
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "The package folder document URL." },
      filter: { type: "string", description: "Only run test files matching this pattern." },
      in: { type: "string", enum: ["page", "worker"], description: 'Where to run them. Default "page".' },
      timeoutMs: { type: "number", description: "Per-test timeout. Default 5000." },
    },
  },

  async execute(input, ctx) {
    const host = input.in ?? "page"
    if (host !== "page" && host !== "worker") throw new Error(`'in' is "page" or "worker", not ${JSON.stringify(input.in)}.`)

    const files = await materialize(ctx.repo, input.url)
    if (!files.size) throw new Error(`${input.url} has no files in it.`)

    const testFiles = findTestFiles(files, input.filter)
    if (!testFiles.length) {
      const names = [...files.keys()].join(", ")
      throw new Error(
        `No test files in this package${input.filter ? ` matching '${input.filter}'` : ""}. Name them *.test.ts or *.test.js. It contains: ${names}`
      )
    }

    const esbuild = await loadEsbuild({ importModule: ctx.importModule })
    const importMap = host === "worker" ? (ctx.importMap ?? resolveImportMap() ?? {}) : null
    const baseUrl = ctx.packageBaseUrl ?? packageBaseUrl(input.url)
    const engine = await loadEngine()
    const options = { testTimeout: input.timeoutMs ?? 5000 }
    const prepare = host === "worker" ? (ctx.workerPreparation ?? workerPreparation(importMap)) : null
    const fileResults = []

    for (const file of testFiles) {
      const environment = domEnvironmentOf(files.get(file))
      if (host === "worker" && environment) {
        fileResults.push({ file, skippedBecause: `needs a DOM (@vitest-environment ${environment}); run it with in: "page"` })
        continue
      }

      let bundle
      try {
        const built = await esbuild.build({
          entryPoints: [file],
          bundle: true,
          format: "esm",
          target: "es2022",
          platform: "browser",
          write: false,
          sourcemap: false,
          plugins: [testPlugin(files, { fetchImpl: ctx.fetchImpl, importMap, baseUrl })],
          logLevel: "silent",
        })
        bundle = built.outputFiles?.[0]?.text
      } catch (err) {
        const errors = (err?.errors ?? []).map((e) => `${e.location?.file ?? ""}: ${e.text}`).join("; ")
        fileResults.push({ file, error: `build failed — ${errors || err?.message || String(err)}` })
        continue
      }

      const report =
        host === "page"
          ? await runInPage(file, bundle, options, { engine, runBundle: ctx.runBundle })
          : await (ctx.runInWorker ?? defaultRunInWorker)(file, bundle, { ...options, prepare })
      fileResults.push({ file, ...report })
    }

    const { report, failed, unhandled } = formatResults(fileResults)
    const footer = `\nvitest ${engine.versions["@vitest/runner"]}, in a ${host}`
    return failed || unhandled
      ? `${report}${footer}\n\nFix the failures and run package_test again.`
      : `${report}${footer}`
  },

  summarize(input, output) {
    const counts = String(output ?? "").match(/(\d+) passed, (\d+) failed/)
    if (!counts) return "ran tests"
    return `tests · ${counts[1]} passed${counts[2] === "0" ? "" : `, ${counts[2]} failed`}${input?.in === "worker" ? " (worker)" : ""}`
  },
}

export default [packageTest]
