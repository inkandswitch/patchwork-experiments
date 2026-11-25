import { describe, it, expect } from "vitest"
import * as A from "@automerge/automerge"
import { treeNode, treeEntries, entriesOf, isTreeEntry, treeEnter, treeLink, treeRemove, treeFiles, resolvePath, ensurePath, findPath } from "./tree.js"

/** Documents by url, each found as a handle that changes it in place. */
function fakeRepo(docs) {
  const loaded = []
  let next = 0
  const handle = (url) => ({ url, doc: () => docs[url], change: (fn) => fn(docs[url]) })
  return {
    docs,
    loaded,
    async find(url) {
      loaded.push(url)
      if (!(url in docs)) throw new Error(`no doc ${url}`)
      return handle(url)
    },
    async create2() {
      const url = `automerge:new${next++}`
      docs[url] = {}
      return handle(url)
    },
  }
}

const world = () =>
  fakeRepo({
    "automerge:root": { title: "root", docs: [
      { name: "notes.md", type: "file", url: "automerge:notes" },
      { name: "Pkg", type: "directory", url: "automerge:pkg" },
      { name: "Sub", type: "folder", url: "automerge:sub" },
      { name: "Essay", type: "essay", url: "automerge:essay" },
    ] },
    "automerge:sub": { title: "Sub", docs: [{ name: "a.txt", type: "file", url: "automerge:a" }] },
    "automerge:pkg": {
      "@patchwork": { type: "directory" },
      title: "pkg",
      "package.json": "automerge:manifest",
      "src/index.js": new A.ImmutableString("automerge:index"),
      "src/lib/util.js": "automerge:util#heads",
      "dist/out.js": "automerge:out",
      lastSyncAt: 5,
      stray: 3,
    },
    "automerge:notes": { content: "hi" },
    "automerge:essay": { title: "Essay" },
    "automerge:a": { content: "a" },
    "automerge:manifest": { content: "{}" },
    "automerge:index": { content: "x" },
    "automerge:util": { content: "u" },
    "automerge:out": { content: "o" },
  })

describe("tree nodes", () => {
  it("lists a folder document and a directory document as the same kind of entries", async () => {
    const repo = world()
    const root = treeNode(await repo.find("automerge:root"))
    expect(treeEntries(root).map(({ name, type, url }) => [name, type, url])).toEqual([
      ["notes.md", "file", "automerge:notes"],
      ["Pkg", "directory", "automerge:pkg"],
      ["Sub", "folder", "automerge:sub"],
      ["Essay", "essay", "automerge:essay"],
    ])
    const pkg = treeNode(await repo.find("automerge:pkg"))
    expect(treeEntries(pkg).map(({ name, type, url, node }) => [name, type, url, node?.prefix ?? null])).toEqual([
      ["package.json", "file", "automerge:manifest", null],
      ["src", "folder", null, "src/"],
      ["dist", "folder", null, "dist/"],
    ])
    expect(treeEntries({ handle: pkg.handle, prefix: "src/" }).map((e) => [e.name, e.url])).toEqual([
      ["index.js", "automerge:index"],
      ["lib", null],
    ])
    expect(treeNode(await repo.find("automerge:essay"))).toBe(null)
  })

  it("reads a document's top entries without a handle", () => {
    const { docs } = world()
    expect(entriesOf(docs["automerge:pkg"]).map((e) => e.name)).toEqual(["package.json", "src", "dist"])
    expect(entriesOf(docs["automerge:root"]).map((e) => e.name)).toEqual(["notes.md", "Pkg", "Sub", "Essay"])
    expect(entriesOf(docs["automerge:essay"])).toBe(null)
  })

  it("judges from the listing alone which entries may be trees", async () => {
    const repo = world()
    const root = treeNode(await repo.find("automerge:root"))
    const pkg = treeNode(await repo.find("automerge:pkg"))
    expect(treeEntries(root).map(isTreeEntry)).toEqual([false, true, true, false])
    expect(treeEntries(pkg).map(isTreeEntry)).toEqual([false, true, true])
  })

  it("enters a link at its live document, and a prefix in place", async () => {
    const repo = world()
    const pkg = treeNode(await repo.find("automerge:pkg"))
    const src = treeEntries(pkg).find((e) => e.name === "src")
    expect((await treeEnter(repo, src)).node).toEqual({ handle: pkg.handle, prefix: "src/" })
    const lib = treeEntries(src.node).find((e) => e.name === "lib")
    const util = treeEntries(lib.node)[0]
    const entered = await treeEnter(repo, util)
    expect([entered.handle.url, entered.node]).toEqual(["automerge:util", null])
  })
})

describe("linking", () => {
  it("links into a folder with a type, and into a directory by key", async () => {
    const repo = world()
    const sub = treeNode(await repo.find("automerge:sub"))
    treeLink(sub, { name: "b.txt", url: "automerge:b" })
    treeLink(sub, { name: "Kept", type: "web-snapshot", url: "automerge:k" })
    expect(repo.docs["automerge:sub"].docs.slice(1)).toEqual([
      { name: "b.txt", type: "file", url: "automerge:b" },
      { name: "Kept", type: "web-snapshot", url: "automerge:k" },
    ])
    treeLink({ handle: await repo.find("automerge:pkg"), prefix: "src/" }, { name: "new.js", type: "file", url: "automerge:n" })
    expect(repo.docs["automerge:pkg"]["src/new.js"]).toBe("automerge:n")
  })

  it("unlinks a prefix folder and everything under it", async () => {
    const repo = world()
    const pkg = treeNode(await repo.find("automerge:pkg"))
    treeRemove(pkg, { name: "src" })
    expect(Object.keys(repo.docs["automerge:pkg"]).filter((k) => k.startsWith("src"))).toEqual([])
    expect(repo.docs["automerge:pkg"]["dist/out.js"]).toBe("automerge:out")
  })
})

describe("paths", () => {
  it("resolves a path through a folder into a directory and its prefixes", async () => {
    const repo = world()
    const found = await resolvePath(repo, "automerge:root", "Pkg/src/lib/util.js")
    expect([found.url, found.trail.join("/"), found.doc]).toEqual(["automerge:util#heads", "Pkg/src/lib/util.js", { content: "u" }])
    await expect(resolvePath(repo, "automerge:root", "Pkg/nope")).rejects.toThrow("'nope' is not in /Pkg. Contains: package.json, src, dist")
  })

  it("makes the folders a write needs, and finds without making any", async () => {
    const repo = world()
    expect(await findPath(repo, "automerge:root", ["Sub", "deep"])).toEqual({ node: null, missing: "/Sub/deep" })
    const deep = await ensurePath(repo, "automerge:root", ["Sub", "deep"])
    expect(repo.docs["automerge:sub"].docs.at(-1)).toEqual({ name: "deep", type: "folder", url: deep.handle.url })
    expect(repo.docs[deep.handle.url]).toEqual({ title: "deep", docs: [], "@patchwork": { type: "folder" } })
    const inPkg = await ensurePath(repo, "automerge:root", ["Pkg", "src", "fresh"])
    expect(inPkg.prefix).toBe("src/fresh/")
    expect((await findPath(repo, "automerge:root", ["Sub", "deep"])).node.handle.url).toBe(deep.handle.url)
  })
})

describe("treeFiles", () => {
  it("lists every file by path, loading only folders", async () => {
    const repo = world()
    const root = treeNode(await repo.find("automerge:root"))
    repo.loaded.length = 0
    const { files, truncated } = await treeFiles(repo, root)
    expect(files.map((f) => f.path)).toEqual(["notes.md", "Pkg/package.json", "Pkg/src/index.js", "Pkg/src/lib/util.js", "Pkg/dist/out.js", "Sub/a.txt", "Essay"])
    expect(truncated).toBe(false)
    expect(repo.loaded).toEqual(["automerge:pkg", "automerge:sub"])
  })

  it("skips, stops, and lists what lies past its depth as it is", async () => {
    const repo = world()
    const root = treeNode(await repo.find("automerge:root"))
    const skipped = await treeFiles(repo, root, { skip: (path) => /^Pkg\/dist(\/|$)/.test(path) })
    expect(skipped.files.map((f) => f.path)).not.toContain("Pkg/dist/out.js")
    const shallow = await treeFiles(repo, root, { maxDepth: 1 })
    expect(shallow.files.map((f) => f.path)).toEqual(["notes.md", "Pkg/package.json", "Pkg/src", "Pkg/dist", "Sub/a.txt", "Essay"])
    let n = 0
    const stopped = await treeFiles(repo, root, { stop: () => ++n > 3 })
    expect([stopped.files.map((f) => f.path), stopped.truncated]).toEqual([["notes.md", "Pkg/package.json"], true])
  })

  it("lists a link it cannot enter as a file", async () => {
    const repo = fakeRepo({ "automerge:r": { docs: [{ name: "gone", type: "folder", url: "automerge:missing" }] } })
    const { files } = await treeFiles(repo, treeNode(await repo.find("automerge:r")))
    expect(files.map((f) => f.path)).toEqual(["gone"])
  })
})
