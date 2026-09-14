/**
 * Running a package's tests, in the browser.
 *
 * `tool_check` answers "does this tool mount and respond to a click". It cannot
 * answer "is this function correct", which is what tests are for — and an agent
 * that writes tests it cannot run has written documentation, not tests.
 *
 * The mechanism is the build machinery pointed at a different entry point: each
 * test file is bundled with esbuild, its `vitest` import rewritten to a harness
 * we inject, and the bundle executed. What comes back is a pass/fail list with
 * real failure messages.
 *
 * Host tier, because tests routinely touch the DOM and a SharedWorker has none.
 */

import { materialize, loadEsbuild, packagePlugin } from "./build.js"
import { createHarness, loadVitestAssertions } from "./harness.js"
import { truncate } from "./format.js"

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

/**
 * The module a test file gets when it imports `vitest`.
 *
 * Ten lines, because the harness itself is real code living on the page — the
 * bundle only needs a bridge to it. Inlining the whole harness as a string
 * would make it untestable, which would be a poor joke in a testing tool.
 */
export const HARNESS_SHIM = `
const harness = globalThis.__patchworkHarness
if (!harness) throw new Error("test harness missing — run these through package_test")
export const describe = harness.describe
export const it = harness.it
export const test = harness.test
export const expect = harness.expect
export const vi = harness.vi
export const beforeEach = harness.beforeEach
export const afterEach = harness.afterEach
export const beforeAll = harness.beforeAll
export const afterAll = harness.afterAll
export default harness
`

/** The specifiers a test file might import a harness from. */
const HARNESS_SPECIFIERS = ["vitest", "jest", "node:test", "@jest/globals", "bun:test"]

/** Wrap the package plugin so harness imports resolve to the shim. */
export function testPlugin(files, options = {}) {
  const inner = packagePlugin(files, options)
  return {
    name: "patchwork-test",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (HARNESS_SPECIFIERS.includes(args.path)) {
          return { path: "__harness__", namespace: "harness" }
        }
        return undefined // fall through to the package plugin
      })
      build.onLoad({ filter: /.*/, namespace: "harness" }, () => ({
        contents: HARNESS_SHIM,
        loader: "js",
      }))
      inner.setup(build)
    },
  }
}

/** Render results the way a test runner does, because that is what people read. */
export function formatResults(fileResults) {
  const lines = []
  let passed = 0
  let failed = 0
  let skipped = 0

  for (const { file, results, error } of fileResults) {
    if (error) {
      lines.push(`✗ ${file}`)
      lines.push(`  could not run: ${error}`)
      failed++
      continue
    }

    const fileFailed = results.filter((r) => r.status === "failed")
    lines.push(`${fileFailed.length ? "✗" : "✓"} ${file}  (${results.length} test${results.length === 1 ? "" : "s"})`)

    for (const result of results) {
      if (result.status === "passed") passed++
      else if (result.status === "skipped") skipped++
      else failed++

      if (result.status === "failed") {
        lines.push(`  ✗ ${result.label}`)
        lines.push(`      ${result.error}`)
        if (result.stack) lines.push(`      ${result.stack.split("\n")[0]?.trim() ?? ""}`)
      } else if (result.status === "skipped") {
        lines.push(`  - ${result.label} (skipped)`)
      }
    }
  }

  lines.push("")
  lines.push(`${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`)
  return { report: lines.join("\n"), passed, failed, skipped }
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
    "They run in the browser: each file is bundled and executed. The assertions are REAL vitest — @vitest/expect on chai, so every matcher you know works, including asymmetric ones (expect.objectContaining, expect.arrayContaining, expect.any) — and `vi.fn()` / `vi.spyOn()` come from @vitest/spy. Only vitest's CLI cannot run here, so there is no vi.mock, no snapshots and no coverage.",
    "With no network it falls back to a smaller built-in matcher set and says so in the report, rather than pretending.",
    "",
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
      timeoutMs: { type: "number", description: "Per-test timeout. Default 5000." },
    },
  },

  async execute(input, ctx) {
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

    // Real vitest matchers where the network allows, the built-in subset where
    // it does not. Loaded once for the whole run, not once per file.
    const assertions = await loadVitestAssertions({ importModule: ctx.importModule })
    const fileResults = []
    let engine = null

    for (const file of testFiles) {
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
          plugins: [testPlugin(files, { fetchImpl: ctx.fetchImpl })],
          logLevel: "silent",
        })
        bundle = built.outputFiles?.[0]?.text
      } catch (err) {
        const errors = (err?.errors ?? []).map((e) => `${e.location?.file ?? ""}: ${e.text}`).join("; ")
        fileResults.push({ file, error: `build failed — ${errors || err?.message || String(err)}` })
        continue
      }

      // A harness per file, so one file's suites and hooks cannot leak into
      // another's.
      const harness = createHarness({ timeoutMs: input.timeoutMs ?? 5000, assertions })
      engine = harness.engine
      const previous = globalThis.__patchworkHarness
      globalThis.__patchworkHarness = harness.api

      const run = ctx.runBundle ?? defaultRunBundle
      try {
        await run(bundle)
        const results = await harness.run()
        fileResults.push({ file, results })
      } catch (err) {
        fileResults.push({ file, error: String(err?.message ?? err) })
      } finally {
        globalThis.__patchworkHarness = previous
      }
    }

    const { report, failed } = formatResults(fileResults)
    const footer = `\nassertions: ${engine ?? "none"}`
    return failed
      ? `${report}${footer}\n\nFix the failures and run package_test again.`
      : `${report}${footer}`
  },

  summarize(input, output) {
    const counts = String(output ?? "").match(/(\d+) passed, (\d+) failed/)
    if (!counts) return "ran tests"
    return `tests · ${counts[1]} passed${counts[2] === "0" ? "" : `, ${counts[2]} failed`}`
  },
}

/** Execute a bundle by importing it. Replaceable in tests. */
async function defaultRunBundle(code) {
  const blob = new Blob([code], { type: "text/javascript" })
  const url = URL.createObjectURL(blob)
  try {
    await import(/* @vite-ignore */ url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default [packageTest]
