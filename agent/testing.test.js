import { describe, it, expect } from "vitest"
import {
  findTestFiles, formatResults, testPlugin, packageTest, HARNESS_SHIM, TEST_FILE_PATTERN,
} from "./tools/testing.js"
import { _resetEsbuild } from "./tools/build.js"

describe("finding test files", () => {
  const files = new Map([
    ["src/index.ts", ""],
    ["src/math.ts", ""],
    ["src/math.test.ts", ""],
    ["src/ui.spec.tsx", ""],
    ["legacy.test.js", ""],
    ["README.md", ""],
  ])

  it("finds the conventional names and nothing else", () => {
    expect(findTestFiles(files)).toEqual(["legacy.test.js", "src/math.test.ts", "src/ui.spec.tsx"])
  })

  it("filters by pattern", () => {
    expect(findTestFiles(files, "math")).toEqual(["src/math.test.ts"])
  })

  it("treats an invalid regex as a literal", () => {
    expect(findTestFiles(files, "math(")).toEqual([])
  })

  it("does not mistake source for tests", () => {
    expect(TEST_FILE_PATTERN.test("src/testing.ts")).toBe(false)
    expect(TEST_FILE_PATTERN.test("src/latest.ts")).toBe(false)
  })
})

describe("formatResults", () => {
  it("reads like a test runner and counts correctly", () => {
    const { report, passed, failed } = formatResults([
      { file: "a.test.ts", results: [
        { label: "x › works", status: "passed" },
        { label: "x › broken", status: "failed", error: "expected 1 to be 2", stack: "  at a.test.ts:3" },
      ] },
      { file: "b.test.ts", results: [{ label: "y", status: "passed" }] },
    ])

    expect(passed).toBe(2)
    expect(failed).toBe(1)
    expect(report).toContain("✗ a.test.ts")
    expect(report).toContain("✓ b.test.ts")
    expect(report).toContain("expected 1 to be 2")
    expect(report).toContain("2 passed, 1 failed")
  })

  it("reports a file that could not even be built", () => {
    const { report, failed } = formatResults([{ file: "a.test.ts", error: "build failed — missing ';'" }])
    expect(report).toContain("could not run: build failed")
    expect(failed).toBe(1)
  })

  it("counts skips separately", () => {
    const { report, skipped } = formatResults([
      { file: "a.test.ts", results: [{ label: "later", status: "skipped" }] },
    ])
    expect(skipped).toBe(1)
    expect(report).toContain("(skipped)")
  })
})

describe("the harness shim", () => {
  it("bridges to the harness on globalThis rather than inlining it", () => {
    expect(HARNESS_SHIM).toContain("__patchworkHarness")
    expect(HARNESS_SHIM).toContain("export const expect")
    expect(HARNESS_SHIM.split("\n").length).toBeLessThan(20)
  })

  it("resolves every harness specifier people write", () => {
    const resolvers = []
    const loaders = []
    testPlugin(new Map()).setup({
      onResolve: (_f, fn) => resolvers.push(fn),
      onLoad: (filter, fn) => loaders.push({ filter, fn }),
    })

    for (const specifier of ["vitest", "jest", "node:test", "@jest/globals", "bun:test"]) {
      expect(resolvers[0]({ path: specifier })).toEqual({ path: "__harness__", namespace: "harness" })
    }
    // anything else falls through to the package resolver
    expect(resolvers[0]({ path: "./math" })).toBeUndefined()

    const loaded = loaders.find((l) => l.filter.namespace === "harness").fn({})
    expect(loaded.contents).toBe(HARNESS_SHIM)
  })
})

function fakeRepo(seed) {
  const docs = new Map(Object.entries(seed))
  return { async find(url) { if (!docs.has(url)) throw new Error("missing"); return { url, doc: () => docs.get(url) } } }
}

const PACKAGE = {
  "automerge:pkg": { docs: [
    { name: "math.ts", type: "file", url: "automerge:m" },
    { name: "math.test.ts", type: "file", url: "automerge:mt" },
  ] },
  "automerge:m": { name: "math.ts", content: "export const add = (a, b) => a + b" },
  "automerge:mt": { name: "math.test.ts", content: "import {it,expect} from 'vitest'" },
}

describe("package_test", () => {
  it("runs where a DOM exists, because tests touch one", () => {
    expect(packageTest.where).toBe("host")
  })

  it("says what the package contains when there are no tests", async () => {
    const repo = fakeRepo({
      "automerge:pkg": { docs: [{ name: "index.ts", type: "file", url: "automerge:i" }] },
      "automerge:i": { name: "index.ts", content: "" },
    })
    await expect(packageTest.execute({ url: "automerge:pkg" }, { repo })).rejects.toThrow(
      /No test files.*index\.ts/s
    )
  })

  it("bundles each test file, runs it, and reports the results", async () => {
    _resetEsbuild()
    const repo = fakeRepo(PACKAGE)

    const esbuild = {
      initialize: async () => {},
      build: async (options) => {
        expect(options.entryPoints).toEqual(["math.test.ts"])
        return { outputFiles: [{ text: "BUNDLE" }] }
      },
    }

    // Stand in for importing the bundle: register a passing and a failing test.
    const runBundle = async (code) => {
      expect(code).toBe("BUNDLE")
      const h = globalThis.__patchworkHarness
      h.describe("add", () => {
        h.it("adds", () => h.expect(1 + 1).toBe(2))
        h.it("is wrong", () => h.expect(1 + 1).toBe(3))
      })
    }

    const out = await packageTest.execute(
      { url: "automerge:pkg" },
      { repo, importModule: async () => esbuild, runBundle }
    )

    // Like a real runner: the file line carries the count, and only failures
    // are listed individually — printing every passing test is noise.
    expect(out).toContain("✗ math.test.ts  (2 tests)")
    expect(out).toContain("✗ add › is wrong")
    expect(out).toContain("expected 2 to be 3")
    expect(out).not.toContain("add › adds")
    expect(out).toContain("1 passed, 1 failed")
    expect(out).toContain("run package_test again")
  })

  it("reports a test file that fails to build without stopping the run", async () => {
    _resetEsbuild()
    const repo = fakeRepo(PACKAGE)
    const esbuild = {
      initialize: async () => {},
      build: async () => {
        const err = new Error("Build failed")
        err.errors = [{ text: "Unexpected token", location: { file: "math.test.ts" } }]
        throw err
      },
    }

    const out = await packageTest.execute({ url: "automerge:pkg" }, { repo, importModule: async () => esbuild })
    expect(out).toContain("could not run: build failed")
    expect(out).toContain("Unexpected token")
  })

  it("leaves no harness behind on globalThis", async () => {
    _resetEsbuild()
    const repo = fakeRepo(PACKAGE)
    const esbuild = { initialize: async () => {}, build: async () => ({ outputFiles: [{ text: "x" }] }) }
    await packageTest.execute(
      { url: "automerge:pkg" },
      { repo, importModule: async () => esbuild, runBundle: async () => {} }
    )
    expect(globalThis.__patchworkHarness).toBeUndefined()
  })
})
