import { describe, it, expect } from "vitest"
import { fsList, fsRead, fsGrep, fsWrite, fsEdit, fsDelete } from "./tools/folders.js"
import { materialize, absorb, makers, packageBuild } from "./tools/build.js"
import { packageContentHash } from "./tools/checking.js"

/**
 * A package the way pushwork writes it: one directory document keyed by full
 * path, each value a link to a file document, with build output pinned to
 * heads. The livelymerge package is this shape, and package_build saw it as
 * empty because it only knew folder documents.
 */
function fakeRepo() {
  let n = 0
  const heads = new Map()
  const docs = new Map([
    ["automerge:lm", {
      "@patchwork": { type: "directory", title: "livelymerge" },
      "package.json": "automerge:pkg",
      "src/index.ts": "automerge:index",
      "src/runtime/eval.ts": "automerge:eval",
      "dist/index.js": "automerge:dist#h1",
    }],
    ["automerge:pkg", { name: "package.json", content: '{ "main": "./dist/index.js" }' }],
    ["automerge:index", { name: "index.ts", content: 'import { run } from "./runtime/eval"\nexport const plugins = [run()]\n' }],
    ["automerge:eval", { name: "eval.ts", content: "export function run() { return 1 }\n" }],
    ["automerge:dist", { name: "index.js", content: "old build" }],
  ])
  const handle = (url) => ({
    url,
    doc: () => docs.get(url),
    change(fn) {
      if (url.includes("#")) throw new Error("cannot change a view")
      fn(docs.get(url))
      heads.set(url, `h${(Number(String(heads.get(url) ?? "h1").slice(1)) || 1) + 1}`)
    },
    heads: () => [heads.get(url) ?? "h1"],
    view: ([h]) => ({ url: `${url}#${h}` }),
  })
  return {
    docs,
    async create2() { const url = `automerge:d${++n}`; docs.set(url, {}); return handle(url) },
    async find(url) {
      const bare = url.split("#")[0]
      if (!docs.has(bare)) throw new Error(`missing ${url}`)
      return url.includes("#") ? { ...handle(bare), url, change() { throw new Error("cannot change a view") } } : handle(bare)
    },
  }
}

const ctx = (repo) => ({ repo, rootFolderUrl: "automerge:lm" })
const dir = (repo) => repo.docs.get("automerge:lm")

describe("a directory document reads as a tree", () => {
  it("lists its top level, with path prefixes as folders", async () => {
    const out = await fsList.execute({}, ctx(repo()))
    expect(out).toContain('"name": "package.json"')
    expect(out).toMatch(/"name": "src",\s*"type": "folder"/)
    expect(out).toMatch(/"name": "dist",\s*"type": "folder"/)
    expect(out).not.toContain("@patchwork")
  })

  it("lists a prefix as a folder of its own", async () => {
    const out = await fsList.execute({ path: "src" }, ctx(repo()))
    expect(out).toContain('"name": "index.ts"')
    expect(out).toMatch(/"name": "runtime",\s*"type": "folder"/)
  })

  it("reads and greps files by path", async () => {
    const r = repo()
    expect(await fsRead.execute({ path: "src/runtime/eval.ts" }, ctx(r))).toContain("export function run")
    const hits = await fsGrep.execute({ pattern: "run\\(" }, ctx(r))
    expect(hits).toContain("/src/index.ts:2:")
    expect(hits).toContain("/src/runtime/eval.ts:1:")
  })

  it("materializes every file for a build, by its full path", async () => {
    const files = await materialize(repo(), "automerge:lm")
    expect([...files.keys()].sort()).toEqual(["dist/index.js", "package.json", "src/index.ts", "src/runtime/eval.ts"])
    expect(files.get("src/runtime/eval.ts")).toContain("return 1")
  })

  it("fingerprints the files behind the keys, not just the directory", async () => {
    const r = repo()
    const before = await packageContentHash(r, "automerge:lm")
    ;(await r.find("automerge:eval")).change((d) => { d.content = "changed" })
    expect(await packageContentHash(r, "automerge:lm")).not.toBe(before)
  })
})

describe("writing into a directory document", () => {
  it("adds a new file as a key, not as a folder document", async () => {
    const r = repo()
    await fsWrite.execute({ path: "src/runtime/new.ts", content: "export {}" }, ctx(r))
    const url = dir(r)["src/runtime/new.ts"]
    expect(url).toMatch(/^automerge:d\d+$/)
    expect(r.docs.get(url).content).toBe("export {}")
    expect(Object.values(dir(r)).some((v) => v?.["@patchwork"]?.type === "folder")).toBe(false)
  })

  it("updates an existing file in place and moves the package version", async () => {
    const r = repo()
    const out = await fsWrite.execute({ path: "src/runtime/eval.ts", content: "export function run() { return 2 }\n" }, ctx(r))
    expect(r.docs.get("automerge:eval").content).toContain("return 2")
    expect(dir(r).contentVersion).toBeTruthy()
    expect(out.text).toContain("Package version moved: / (automerge:lm)")
  })

  it("re-pins a link that was pinned to heads, so the new version is what is served", async () => {
    const r = repo()
    await fsWrite.execute({ path: "dist/index.js", content: "new build" }, ctx(r))
    expect(r.docs.get("automerge:dist").content).toBe("new build")
    expect(dir(r)["dist/index.js"]).toBe("automerge:dist#h2")
  })

  it("edits by path", async () => {
    const r = repo()
    const out = await fsEdit.execute({ path: "src/runtime/eval.ts", old: "return 1", new: "return 3" }, ctx(r))
    expect(r.docs.get("automerge:eval").content).toContain("return 3")
    expect(out.text).toMatch(/Package version moved/)
  })

  it("deletes a prefix and everything under it", async () => {
    const r = repo()
    const out = await fsDelete.execute({ path: "src" }, ctx(r))
    expect(Object.keys(dir(r)).filter((k) => k.startsWith("src/"))).toEqual([])
    expect(dir(r)["package.json"]).toBe("automerge:pkg")
    expect(out).toMatch(/Removed folder 'src' and the 2 entries in it/)
    expect(out).toMatch(/documents in it still exist/)
  })
})

describe("package_build on a directory document", () => {
  it("finds the source, and writes the build back to the pinned link", async () => {
    const r = repo()
    const esbuild = {
      initialize: async () => {},
      build: async (options) => {
        expect(options.entryPoints).toEqual(["src/index.ts"])
        return { outputFiles: [{ text: "bundled" }], warnings: [] }
      },
    }
    const out = await packageBuild.execute({ url: "automerge:lm" }, { repo: r, importModule: async () => esbuild })
    expect(out).toMatch(/Built src\/index\.ts → dist\/index\.js/)
    expect(r.docs.get("automerge:dist").content).toBe("bundled")
    expect(dir(r)["dist/index.js"]).toBe("automerge:dist#h2")
  })

  it("creates build output as a key when there is none yet", async () => {
    const r = repo()
    delete dir(r)["dist/index.js"]
    await absorb(r, "automerge:lm", new Map([["dist/index.js", "fresh"]]), makers(r))
    expect(r.docs.get(dir(r)["dist/index.js"]).content).toBe("fresh")
  })
})

function repo() {
  return fakeRepo()
}
