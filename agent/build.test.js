import { describe, it, expect, beforeEach } from "vitest"
import {
  isExternal, loaderFor, normalizePath, resolveInPackage, entryPointFor,
  materialize, absorb, makers, packagePlugin, packageBuild, IMPORTMAP_EXTERNALS, _resetEsbuild, loadEsbuild, loaderFor,
} from "./tools/build.js"

describe("what stays external", () => {
  it("keeps everything the importmap provides out of the bundle", () => {
    for (const specifier of IMPORTMAP_EXTERNALS) expect(isExternal(specifier)).toBe(true)
    expect(isExternal("@automerge/automerge/slim")).toBe(true)
    expect(isExternal("solid-js/web")).toBe(true)
  })

  it("bundles everything else", () => {
    expect(isExternal("three")).toBe(false)
    expect(isExternal("three/addons/controls/OrbitControls.js")).toBe(false)
    expect(isExternal("d3")).toBe(false)
  })

  it("does not treat a lookalike as external", () => {
    expect(isExternal("solid-js-confusable")).toBe(false)
  })
})

describe("path handling", () => {
  it("picks a loader by extension", () => {
    expect(loaderFor("a/b.ts")).toBe("ts")
    expect(loaderFor("x.tsx")).toBe("tsx")
    expect(loaderFor("x.json")).toBe("json")
    expect(loaderFor("x.css")).toBe("css")
    expect(loaderFor("x.mjs")).toBe("js")
  })

  it("collapses . and .. segments", () => {
    expect(normalizePath("src/./a/../b.ts")).toBe("src/b.ts")
    expect(normalizePath("a/b/../../c")).toBe("c")
  })
})

describe("resolveInPackage", () => {
  const files = new Map([
    ["src/index.ts", ""],
    ["src/scene.ts", ""],
    ["src/util/index.ts", ""],
    ["src/data.json", ""],
  ])

  it("resolves a sibling with an implied extension", () => {
    expect(resolveInPackage(files, "src/index.ts", "./scene")).toBe("src/scene.ts")
    expect(resolveInPackage(files, "src/index.ts", "./scene.ts")).toBe("src/scene.ts")
  })

  it("resolves a directory to its index", () => {
    expect(resolveInPackage(files, "src/index.ts", "./util")).toBe("src/util/index.ts")
  })

  it("resolves json", () => {
    expect(resolveInPackage(files, "src/index.ts", "./data.json")).toBe("src/data.json")
  })

  it("walks up", () => {
    expect(resolveInPackage(files, "src/util/index.ts", "../scene")).toBe("src/scene.ts")
  })

  it("returns null when nothing matches", () => {
    expect(resolveInPackage(files, "src/index.ts", "./missing")).toBeNull()
  })
})

describe("entryPointFor", () => {
  it("prefers an explicit entry", () => {
    expect(entryPointFor(new Map([["a.ts", ""]]), "a.ts")).toBe("a.ts")
  })

  it("ignores package.json main when it points at output that does not exist yet", () => {
    const files = new Map([
      ["package.json", '{"main":"./dist/index.js"}'],
      ["src/index.ts", ""],
    ])
    expect(entryPointFor(files)).toBe("src/index.ts")
  })

  it("uses package.json main when it points at real source", () => {
    const files = new Map([["package.json", '{"main":"./app.ts"}'], ["app.ts", ""]])
    expect(entryPointFor(files)).toBe("app.ts")
  })

  it("survives a malformed package.json", () => {
    expect(entryPointFor(new Map([["package.json", "{not json"], ["index.ts", ""]]))).toBe("index.ts")
  })

  it("returns null when there is nothing to build", () => {
    expect(entryPointFor(new Map([["README.md", ""]]))).toBeNull()
  })
})

function fakeRepo(seed = {}) {
  let n = 0
  const docs = new Map(Object.entries(seed))
  const handle = (url) => ({ url, doc: () => docs.get(url), change(fn) { fn(docs.get(url)) } })
  return {
    docs,
    async create2() { const url = `automerge:n${++n}`; docs.set(url, {}); return handle(url) },
    async find(url) { if (!docs.has(url)) throw new Error(`missing ${url}`); return handle(url) },
  }
}

const PACKAGE = {
  "automerge:pkg": { title: "thing", docs: [
    { name: "package.json", type: "file", url: "automerge:pj" },
    { name: "src", type: "folder", url: "automerge:src" },
  ] },
  "automerge:pj": { name: "package.json", content: '{"name":"thing","main":"./dist/index.js"}' },
  "automerge:src": { title: "src", docs: [{ name: "index.ts", type: "file", url: "automerge:ts" }] },
  "automerge:ts": { name: "index.ts", content: "export const x: number = 1" },
}

describe("document ↔ files", () => {
  it("materializes a package into paths and contents", async () => {
    const files = await materialize(fakeRepo(PACKAGE), "automerge:pkg")
    expect([...files.keys()].sort()).toEqual(["package.json", "src/index.ts"])
    expect(files.get("src/index.ts")).toContain("number")
  })

  it("absorbs output into a dist folder it creates", async () => {
    const repo = fakeRepo(structuredClone(PACKAGE))
    const written = await absorb(repo, "automerge:pkg", new Map([["dist/index.js", "built"]]), makers(repo))

    expect(written[0]).toMatch(/dist\/index\.js · created/)
    const dist = repo.docs.get("automerge:pkg").docs.find((d) => d.name === "dist")
    expect(repo.docs.get(repo.docs.get(dist.url).docs[0].url).content).toBe("built")
  })

  it("updates a rebuilt file in place so an installed module picks it up", async () => {
    const repo = fakeRepo(structuredClone(PACKAGE))
    await absorb(repo, "automerge:pkg", new Map([["dist/index.js", "v1"]]), makers(repo))
    const distUrl = repo.docs.get("automerge:pkg").docs.find((d) => d.name === "dist").url
    const fileUrl = repo.docs.get(distUrl).docs[0].url

    await absorb(repo, "automerge:pkg", new Map([["dist/index.js", "v2"]]), makers(repo))

    expect(repo.docs.get(distUrl).docs).toHaveLength(1)
    expect(repo.docs.get(fileUrl).content).toBe("v2")
  })
})

describe("the esbuild plugin", () => {
  /** Capture what the plugin registers, then drive it like esbuild would. */
  function drive(files, options) {
    const resolvers = []
    const loaders = []
    packagePlugin(files, options).setup({
      onResolve: (_filter, fn) => resolvers.push(fn),
      onLoad: (filter, fn) => loaders.push({ filter, fn }),
    })
    return {
      resolve: (args) => resolvers[0](args),
      load: (args) => loaders.find((l) => l.filter.namespace === args.namespace).fn(args),
    }
  }

  const files = new Map([["src/index.ts", "import './scene'"], ["src/scene.ts", "export const s = 1"]])

  it("resolves the entry point inside the package, not as a dependency", () => {
    const { resolve } = drive(files)
    expect(resolve({ path: "src/index.ts", importer: "", kind: "entry-point" })).toEqual({
      path: "src/index.ts",
      namespace: "package",
    })
  })

  it("leaves importmap specifiers external", () => {
    const { resolve } = drive(files)
    expect(resolve({ path: "@automerge/automerge", importer: "src/index.ts" })).toEqual({
      path: "@automerge/automerge",
      external: true,
    })
  })

  it("sends a bare dependency to the CDN", () => {
    const { resolve } = drive(files)
    expect(resolve({ path: "three", importer: "src/index.ts" })).toEqual({
      path: "https://esm.sh/three",
      namespace: "cdn",
    })
  })

  it("resolves relative imports inside the package", () => {
    const { resolve } = drive(files)
    expect(resolve({ path: "./scene", importer: "src/index.ts" })).toEqual({
      path: "src/scene.ts",
      namespace: "package",
    })
  })

  it("says what the package contains when an import is missing", () => {
    const { resolve } = drive(files)
    const result = resolve({ path: "./nope", importer: "src/index.ts" })
    expect(result.errors[0].text).toMatch(/Cannot find '\.\/nope'/)
    expect(result.errors[0].text).toContain("src/scene.ts")
  })

  it("keeps a CDN module's absolute re-exports on the CDN", () => {
    // esm.sh answers `import "three"` with a module that does
    // `export * from "/three@0.186.0/es2022/three.mjs"`.
    const { resolve } = drive(files)
    expect(
      resolve({ path: "/three@0.186.0/es2022/three.mjs", importer: "https://esm.sh/three", namespace: "cdn" })
    ).toEqual({ path: "https://esm.sh/three@0.186.0/es2022/three.mjs", namespace: "cdn" })
  })

  it("keeps a CDN module's relative imports on the CDN", () => {
    const { resolve } = drive(files)
    expect(
      resolve({ path: "./chunk.js", importer: "https://esm.sh/three@0.160.0/es.js", namespace: "cdn" })
    ).toEqual({ path: "https://esm.sh/three@0.160.0/chunk.js", namespace: "cdn" })
  })

  it("loads package files with the right loader", async () => {
    const { load } = drive(files)
    expect(await load({ path: "src/scene.ts", namespace: "package" })).toEqual({
      contents: "export const s = 1",
      loader: "ts",
    })
  })

  it("fetches and caches CDN modules", async () => {
    let calls = 0
    const fetchImpl = async (url) => {
      calls++
      return { ok: true, url, text: async () => "export default 1" }
    }
    const { load } = drive(files, { fetchImpl })

    await load({ path: "https://esm.sh/three", namespace: "cdn" })
    await load({ path: "https://esm.sh/three", namespace: "cdn" })
    expect(calls).toBe(1)
  })

  it("reports a dependency that could not be fetched", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, url: "x" })
    const { load } = drive(files, { fetchImpl })
    const result = await load({ path: "https://esm.sh/nope", namespace: "cdn" })
    expect(result.errors[0].text).toMatch(/Could not fetch/)
  })
})

describe("package_build", () => {
  // esbuild is initialized once per context and cached, which is right in
  // production and means each test must start from a clean slate.
  beforeEach(_resetEsbuild)

  it("runs in a worker, since it needs no DOM", () => {
    expect(packageBuild.where).toBe("worker")
  })

  it("refuses an empty package", async () => {
    const repo = fakeRepo({ "automerge:empty": { docs: [] } })
    await expect(packageBuild.execute({ url: "automerge:empty" }, { repo })).rejects.toThrow(/no files/)
  })

  it("says what it found when there is no entry point", async () => {
    const repo = fakeRepo({
      "automerge:pkg": { docs: [{ name: "README.md", type: "file", url: "automerge:r" }] },
      "automerge:r": { name: "README.md", content: "hi" },
    })
    await expect(packageBuild.execute({ url: "automerge:pkg" }, { repo })).rejects.toThrow(/No entry point/)
  })

  it("bundles and writes the result back", async () => {
    const repo = fakeRepo(structuredClone(PACKAGE))
    const esbuild = {
      initialize: async () => {},
      build: async (options) => {
        expect(options.bundle).toBe(true)
        expect(options.format).toBe("esm")
        expect(options.entryPoints).toEqual(["src/index.ts"])
        return { outputFiles: [{ text: "// bundled\nexport const x = 1" }], warnings: [] }
      },
    }

    const out = await packageBuild.execute(
      { url: "automerge:pkg" },
      { repo, importModule: async () => esbuild }
    )

    expect(out).toMatch(/Built src\/index\.ts → dist\/index\.js/)
    const dist = repo.docs.get("automerge:pkg").docs.find((d) => d.name === "dist")
    expect(repo.docs.get(repo.docs.get(dist.url).docs[0].url).content).toContain("bundled")
  })

  it("surfaces esbuild's errors rather than a bare failure", async () => {
    const repo = fakeRepo(structuredClone(PACKAGE))
    const esbuild = {
      initialize: async () => {},
      build: async () => {
        const err = new Error("Build failed")
        err.errors = [{ text: "Expected ';' but found 'const'", location: { file: "src/index.ts" } }]
        throw err
      },
    }
    await expect(
      packageBuild.execute({ url: "automerge:pkg" }, { repo, importModule: async () => esbuild })
    ).rejects.toThrow(/Expected ';'/)
  })
})

describe("initializing esbuild exactly once per realm", () => {
  beforeEach(_resetEsbuild)

  /**
   * An esbuild double with the real one's rules: initialize may be called once,
   * and nothing works until the promise it returned has resolved.
   */
  function fakeEsbuild({ initMs = 0 } = {}) {
    let initCalled = false
    let initDone = false
    return {
      get initCalls() {
        return initCalled ? 1 : 0
      },
      async initialize() {
        if (initCalled) throw new Error('Cannot call "initialize" more than once')
        initCalled = true
        await new Promise((resolve) => setTimeout(resolve, initMs))
        initDone = true
      },
      async transform(code) {
        if (!initCalled) throw new Error('You need to call "initialize" before calling this')
        if (!initDone) {
          throw new Error('You need to wait for the promise returned from "initialize" to be resolved before calling this')
        }
        return { code }
      },
    }
  }

  it("initializes once however many callers there are", async () => {
    const esbuild = fakeEsbuild()
    const importModule = async () => esbuild
    await Promise.all([loadEsbuild({ importModule }), loadEsbuild({ importModule }), loadEsbuild({ importModule })])
    expect(esbuild.initCalls).toBe(1)
  })

  it("shares readiness with a second copy of this module", async () => {
    // The actual bug: two copies of build.js at two URLs, one esbuild between
    // them. The second copy's loader must not call initialize again — and must
    // not fail when its own initialize call is refused.
    const esbuild = fakeEsbuild()
    await loadEsbuild({ importModule: async () => esbuild })

    // Simulate the other copy: its module-level state is empty, so it starts
    // from scratch against the same esbuild.
    _resetEsbuild()
    const again = await loadEsbuild({ importModule: async () => esbuild })

    expect(again).toBe(esbuild)
    expect(esbuild.initCalls).toBe(1)
    expect((await again.transform("x")).code).toBe("x")
  })

  it("waits for an initialization somebody else started, rather than racing it", async () => {
    // esbuild's build() does NOT wait for initialize(), so returning as soon as
    // the "more than once" error arrives would hand back an esbuild that throws
    // "you need to wait" on first use.
    const esbuild = fakeEsbuild({ initMs: 60 })
    const first = loadEsbuild({ importModule: async () => esbuild })
    await new Promise((resolve) => setTimeout(resolve, 5))

    _resetEsbuild() // the other copy of the module, arriving mid-initialization
    const second = await loadEsbuild({ importModule: async () => esbuild })

    await expect(second.transform("y")).resolves.toEqual({ code: "y" })
    await first
    expect(esbuild.initCalls).toBe(1)
  })

  it("lets a later call retry after a failed load", async () => {
    let attempt = 0
    const importModule = async () => {
      if (++attempt === 1) throw new Error("network died")
      return fakeEsbuild()
    }
    await expect(loadEsbuild({ importModule })).rejects.toThrow("network died")
    await expect(loadEsbuild({ importModule })).resolves.toBeTruthy()
  })

  it("does not swallow an initialization error that is not the double-call one", async () => {
    const esbuild = {
      async initialize() {
        throw new Error("failed to fetch the wasm")
      },
    }
    await expect(loadEsbuild({ importModule: async () => esbuild })).rejects.toThrow("failed to fetch the wasm")
  })
})

describe("binary files in a package", () => {
  const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xff, 0xfe])

  it("materializes bytes as bytes, not as replacement characters", async () => {
    const docs = new Map([
      ["automerge:pkg", { docs: [{ name: "engine.wasm", type: "file", url: "automerge:w" }], "@patchwork": { type: "folder" } }],
      ["automerge:w", { name: "engine.wasm", content: wasm, "@patchwork": { type: "file" } }],
    ])
    const repo = { async find(url) { return { url, doc: () => docs.get(url) } } }

    const files = await materialize(repo, "automerge:pkg")
    const got = files.get("engine.wasm")
    expect(got).toBeInstanceOf(Uint8Array)
    expect([...got]).toEqual([...wasm])
  })

  it("gives binary assets a loader that does not parse them as JavaScript", () => {
    expect(loaderFor("engine.wasm")).toBe("binary")
    expect(loaderFor("logo.png")).toBe("dataurl")
    expect(loaderFor("Inter.woff2")).toBe("dataurl")
    expect(loaderFor("notes.md")).toBe("text")
    expect(loaderFor("index.ts")).toBe("ts")
  })

  it("hands esbuild the bytes untouched", () => {
    const files = new Map([["engine.wasm", wasm]])
    const plugin = packagePlugin(files)
    // Two onLoad handlers are registered, one per namespace; take the package one.
    const handlers = new Map()
    plugin.setup({
      onResolve: () => {},
      onLoad: (options, fn) => handlers.set(options.namespace, fn),
    })
    const result = handlers.get("package")({ path: "engine.wasm", namespace: "package" })
    expect(result.contents).toBe(wasm)
    expect(result.loader).toBe("binary")
  })
})
