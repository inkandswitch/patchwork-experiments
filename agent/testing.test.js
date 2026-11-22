import { describe, it, expect } from "vitest"
import * as esbuild from "esbuild"
import { createRequire } from "node:module"
import {
  findTestFiles, formatResults, testPlugin, packageTest, VITEST_BRIDGE, TEST_FILE_PATTERN,
  resolveSpecifier, domEnvironmentOf, packageBaseUrl, LOGGED_MAX_LINES,
} from "./tools/testing.js"
import { _resetEsbuild } from "./tools/build.js"
import * as engine from "./tools/vendor/vitest-engine.js"
import { reportOf } from "./tools/vitest-runtime.js"

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

describe("the vendored engine", () => {
  it("is the version this package's own `vitest run` uses", () => {
    const require = createRequire(import.meta.url)
    const vitest = require("vitest/package.json").version
    expect(engine.versions["@vitest/runner"]).toBe(vitest)
    expect(engine.versions["@vitest/expect"]).toBe(vitest)
    expect(engine.versions["@vitest/spy"]).toBe(vitest)
  })
})

describe("the runtime's report", () => {
  it("is plain text even where vitest coloured it for devtools", () => {
    const file = { type: "file", tasks: [{ type: "test", name: "x", mode: "run", result: { state: "fail", errors: [
      { message: "\x1b[31mexpected 1\x1b[39m", diff: "\x1b[32m- Expected\x1b[39m\n\x1b[31m+ Received\x1b[39m" },
    ] } }] }
    expect(reportOf(file).results[0]).toMatchObject({ status: "failed", error: "expected 1", diff: "- Expected\n+ Received" })
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

  it("says why a whole file was skipped, without counting it as a failure", () => {
    const { report, failed } = formatResults([{ file: "view.test.js", skippedBecause: "needs a DOM" }])
    expect(report).toContain("- view.test.js  (skipped: needs a DOM)")
    expect(failed).toBe(0)
  })

  it("fails a file whose tests passed but which left an unhandled error", () => {
    const { report, unhandled } = formatResults([
      { file: "a.test.js", results: [{ label: "x", status: "passed" }], unhandled: ["TypeError: boom"] },
    ])
    expect(report).toContain("✗ a.test.js")
    expect(report).toContain("unhandled error while this file ran: TypeError: boom")
    expect(report).toContain("1 passed, 0 failed, 1 unhandled error")
    expect(unhandled).toBe(1)
  })

  it("keeps a bounded amount of what was logged", () => {
    const logged = Array.from({ length: LOGGED_MAX_LINES + 15 }, (_, i) => `line ${i}`)
    const { report } = formatResults([{ file: "a.test.js", results: [], logged }])
    expect(report).toContain(`line ${LOGGED_MAX_LINES - 1}`)
    expect(report).not.toContain(`line ${LOGGED_MAX_LINES}\n`)
    expect(report).toContain("… 15 more lines")
  })
})

describe("resolving through an importmap", () => {
  const imports = {
    "@automerge/automerge-repo": "https://p.example/repo.js",
    "@automerge/automerge-repo/": "https://p.example/repo/",
    "@codemirror/": "https://p.example/cm/",
  }

  it("takes an exact entry first, else the longest prefix", () => {
    expect(resolveSpecifier(imports, "@automerge/automerge-repo")).toBe("https://p.example/repo.js")
    expect(resolveSpecifier(imports, "@automerge/automerge-repo/slim")).toBe("https://p.example/repo/slim")
    expect(resolveSpecifier(imports, "@codemirror/view")).toBe("https://p.example/cm/view")
    expect(resolveSpecifier(imports, "solid-js")).toBeNull()
  })
})

describe("the test plugin", () => {
  const setUp = (options) => {
    const resolvers = []
    const loaders = []
    testPlugin(new Map(), options).setup({
      onResolve: (_f, fn) => resolvers.push(fn),
      onLoad: (filter, fn) => loaders.push({ filter, fn }),
    })
    return { resolve: (path) => resolvers[0]({ path }), loaders }
  }

  it("bridges every vitest-shaped specifier to the runtime the host installed", () => {
    const { resolve, loaders } = setUp()
    for (const specifier of ["vitest", "@jest/globals", "bun:test"]) {
      expect(resolve(specifier)).toEqual({ path: "vitest", namespace: "vitest" })
    }
    expect(resolve("./math")).toBeUndefined()
    expect(loaders.find((l) => l.filter.namespace === "vitest").fn({}).contents).toBe(VITEST_BRIDGE)
    expect(VITEST_BRIDGE).toContain("__patchworkVitest")
  })

  it("leaves Patchwork's externals bare for a page, whose importmap resolves them", () => {
    expect(setUp().resolve("@automerge/automerge-repo")).toBeUndefined()
  })

  it("rewrites them to absolute URLs for a worker, which has no importmap", () => {
    const { resolve } = setUp({ importMap: { "@automerge/automerge-repo": "https://p.example/repo.js" } })
    expect(resolve("@automerge/automerge-repo")).toEqual({ path: "https://p.example/repo.js", external: true })
    expect(resolve("@automerge/automerge").errors[0].text).toMatch(/importmap.*no entry/)
  })
})

describe("where the package's files are served", () => {
  it("is Patchwork's service-worker URL for the folder", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "location")
    Object.defineProperty(globalThis, "location", { value: { origin: "https://patchwork.example" }, configurable: true })
    const document = globalThis.document
    delete globalThis.document
    try {
      expect(packageBaseUrl("automerge:abc")).toBe("https://patchwork.example/automerge%3Aabc/")
    } finally {
      if (original) Object.defineProperty(globalThis, "location", original)
      else delete globalThis.location
      if (document) globalThis.document = document
    }
  })
})

describe("DOM environments", () => {
  it("reads the pragma vitest reads", () => {
    expect(domEnvironmentOf("// @vitest-environment happy-dom\nimport x")).toBe("happy-dom")
    expect(domEnvironmentOf("/** @vitest-environment jsdom */")).toBe("jsdom")
    expect(domEnvironmentOf("// @vitest-environment node")).toBeNull()
    expect(domEnvironmentOf("import { it } from 'vitest'")).toBeNull()
  })
})

// --- the tool, end to end: real esbuild, the vendored engine, a real import ---

function fakeRepo(seed) {
  const docs = new Map(Object.entries(seed))
  return { async find(url) { if (!docs.has(url)) throw new Error("missing"); return { url, doc: () => docs.get(url) } } }
}

/** A package folder from { name: source }. */
function pkg(sources) {
  const seed = { "automerge:pkg": { docs: [] } }
  for (const [i, [name, content]] of Object.entries(sources).entries()) {
    seed["automerge:pkg"].docs.push({ name, type: "file", url: `automerge:f${i}` })
    seed[`automerge:f${i}`] = { name, content }
  }
  return fakeRepo(seed)
}

/** Native esbuild stands in for esbuild-wasm, which needs a browser to start. */
const importModule = async () => ({ ...esbuild, initialize: async () => {} })
/** Node imports data: URLs, not blob: ones. */
const runBundle = (code) => import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)

async function run(sources, input = {}, ctx = {}) {
  _resetEsbuild()
  return packageTest.execute({ url: "automerge:pkg", ...input }, { repo: pkg(sources), importModule, runBundle, ...ctx })
}

const MATH = "export const add = (a, b) => a + b\n"

describe("package_test", () => {
  it("runs where a DOM exists, because tests touch one", () => {
    expect(packageTest.where).toBe("host")
  })

  it("says what the package contains when there are no tests", async () => {
    await expect(run({ "index.ts": "" })).rejects.toThrow(/No test files.*index\.ts/s)
  })

  it("builds each test file with its imports, runs it, and reports like a runner", async () => {
    const out = await run({
      "math.ts": MATH,
      "math.test.ts": `
        import { describe, it, expect } from "vitest"
        import { add } from "./math"
        describe("add", () => {
          it("adds", () => expect(add(1, 1)).toBe(2))
          it("is wrong", () => expect(add(1, 1)).toBe(3))
        })`,
    })
    // Only failures are listed individually — printing every pass is noise.
    expect(out).toContain("✗ math.test.ts  (2 tests)")
    expect(out).toContain("✗ add › is wrong")
    expect(out).toContain("expected 2 to be 3")
    expect(out).not.toContain("add › adds")
    expect(out).toContain("1 passed, 1 failed")
    expect(out).toContain(`vitest ${engine.versions["@vitest/runner"]}, in a page`)
    expect(out).toContain("run package_test again")
  })

  it("shows vitest's diff for a structural mismatch", async () => {
    const out = await run({
      "a.test.js": `import { it, expect } from "vitest"
        it("shapes", () => expect({ hull: "ketch", masts: 2 }).toEqual({ hull: "ketch", masts: 3 }))`,
    })
    expect(out).toContain("- Expected")
    expect(out).toContain('"masts": 3')
  })

  it("is vitest's runner: each, hook order, only, skip and todo mean what they mean there", async () => {
    const out = await run({
      "a.test.js": `import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest"
        const order = []
        describe("outer", () => {
          beforeAll(() => order.push("beforeAll"))
          beforeEach(() => order.push("outer.beforeEach"))
          describe("inner", () => {
            beforeEach(() => order.push("inner.beforeEach"))
            afterEach(() => order.push("inner.afterEach"))
            it("records", () => order.push("test"))
          })
          it("saw the hooks in vitest's order", () =>
            expect(order).toEqual(["beforeAll", "outer.beforeEach", "inner.beforeEach", "test", "inner.afterEach", "outer.beforeEach"]))
        })
        it.each([[1, 1, 2], [2, 3, 5]])("add(%i, %i) = %i", (a, b, sum) => expect(a + b).toBe(sum))
        it.skip("not yet", () => { throw new Error("ran a skipped test") })
        it.todo("someday")`,
    })
    expect(out).toContain("✓ a.test.js  (6 tests)")
    expect(out).toContain("4 passed, 0 failed, 2 skipped")
  })

  it("honours it.only within a file", async () => {
    const out = await run({
      "a.test.js": `import { it } from "vitest"
        it.only("this one", () => {})
        it("not this one", () => { throw new Error("ran") })`,
    })
    expect(out).toContain("1 passed, 0 failed, 1 skipped")
  })

  it("times out a test that hangs, and keeps going", async () => {
    const out = await run(
      {
        "a.test.js": `import { it } from "vitest"
          it("hangs", () => new Promise(() => {}))
          it("after", () => {})`,
      },
      { timeoutMs: 50 }
    )
    expect(out).toContain("✗ hangs")
    expect(out).toMatch(/timed out in 50ms/i)
    expect(out).toContain("1 passed, 1 failed")
  })

  it("reports a failing beforeAll against its suite", async () => {
    const out = await run({
      "a.test.js": `import { describe, it, beforeAll } from "vitest"
        describe("rig", () => {
          beforeAll(() => { throw new Error("no mast") })
          it("stands", () => {})
        })`,
    })
    expect(out).toContain("✗ rig (hook)")
    expect(out).toContain("no mast")
  })

  it("enforces expect.assertions, and gives vi.fn but explains vi.mock", async () => {
    const out = await run({
      "a.test.js": `import { it, expect, vi } from "vitest"
        it("counts", () => { expect.assertions(2); expect(1).toBe(1) })
        it("spies", () => { const f = vi.fn(); f(3); expect(f).toHaveBeenCalledWith(3) })
        it("mocks", () => vi.mock("./x"))`,
    })
    expect(out).toContain("expected number of assertions to be 2, but got 1")
    expect(out).toContain("vi.mock isn't available in package_test")
    expect(out).toContain("1 passed, 2 failed")
  })

  it("reports a file that throws while loading as unable to run", async () => {
    const out = await run({ "a.test.js": `throw new Error("bad import")` })
    expect(out).toContain("✗ a.test.js")
    expect(out).toContain("could not run: bad import")
  })

  it("reports a test file that fails to build without stopping the run", async () => {
    const out = await run({
      "a.test.js": "this is not javascript (",
      "b.test.js": `import { it } from "vitest"; it("fine", () => {})`,
    })
    expect(out).toContain("✗ a.test.js\n  could not run: build failed")
    expect(out).toContain("✓ b.test.js  (1 test)")
  })

  it("shows what the tests logged, under their file, and puts the console back", async () => {
    const log = console.log
    const out = await run({
      "a.test.js": `import { it } from "vitest"
        console.log("loading", { hulls: 2 })
        it("reads the hull", () => {
          console.log("bbox", [0, -5.5, 2.6])
          console.warn("no rig contract")
        })`,
    })
    expect(out).toContain('  console:\n    loading {"hulls":2}\n    bbox [0,-5.5,2.6]\n    [warn] no rig contract')
    expect(console.log).toBe(log)
  })

  it("leaves no runtime behind, and leaves the vitest running it alone", async () => {
    expect.assertions(2)
    await run({ "a.test.js": `import { it, expect } from "vitest"; it("x", () => expect(1).toBe(1))` })
    expect(globalThis.__patchworkVitest).toBeUndefined()
    expect(1).toBe(1) // counted by the outer vitest, so its expect is back
  })

  it("in a worker: skips files that need a DOM, and sends the rest with externals as URLs", async () => {
    const sent = []
    const runInWorker = async (file, code) => {
      sent.push({ file, code })
      return { results: [{ label: "x", status: "passed" }], unhandled: [], logged: [] }
    }
    const out = await run(
      {
        "repo.test.js": `import { it } from "vitest"
          import { Repo } from "@automerge/automerge-repo"
          it("x", () => new Repo())`,
        "view.test.js": `// @vitest-environment happy-dom
          import { it } from "vitest"; it("x", () => document.body)`,
      },
      { in: "worker" },
      { runInWorker, importMap: { "@automerge/automerge-repo": "https://p.example/repo.js" } }
    )
    expect(sent.map((s) => s.file)).toEqual(["repo.test.js"])
    expect(sent[0].code).toContain('"https://p.example/repo.js"')
    expect(out).toContain('- view.test.js  (skipped: needs a DOM (@vitest-environment happy-dom); run it with in: "page")')
    expect(out).toContain("in a worker")
  })

  it("gives each package module its service-worker URL as import.meta.url, so tests can fetch package files", async () => {
    let code = ""
    const out = await run(
      {
        "src/lib.js": "export const where = import.meta.url\n",
        "a.test.js": `import { it, expect } from "vitest"
          import { where } from "./src/lib.js"
          it("knows where it lives", () => {
            expect(import.meta.url).toBe("https://p.example/automerge%3Apkg/a.test.js")
            expect(new URL("./data.json", import.meta.url).href).toBe("https://p.example/automerge%3Apkg/data.json")
            expect(where).toBe("https://p.example/automerge%3Apkg/src/lib.js")
          })`,
      },
      {},
      { packageBaseUrl: "https://p.example/automerge%3Apkg/", runBundle: (bundle) => runBundle((code = bundle)) }
    )
    expect(out).toContain("1 passed, 0 failed")
    expect(code).not.toContain("import.meta.url")
  })

  it("refuses a host it doesn't have", async () => {
    await expect(run({ "a.test.js": "" }, { in: "node" })).rejects.toThrow(/"page" or "worker"/)
  })
})
