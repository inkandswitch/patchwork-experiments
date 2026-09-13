import { describe, it, expect } from "vitest"
import { walkTree, docSearch, docTree } from "./tools/discovery.js"

/** A repo of folders and files, addressed by url. */
function fakeRepo(docs) {
  return { async find(url) {
    if (!(url in docs)) throw new Error(`no doc ${url}`)
    return { url, doc: () => docs[url] }
  } }
}

const TREE = {
  "automerge:root": { docs: [
    { name: "Recipes", type: "folder", url: "automerge:recipes" },
    { name: "notes.md", type: "file", url: "automerge:notes" },
  ] },
  "automerge:recipes": { docs: [
    { name: "Leek Soup", type: "recipe", url: "automerge:leek" },
    { name: "Bread", type: "recipe", url: "automerge:bread" },
  ] },
  "automerge:leek": { title: "Leek Soup", ingredients: ["leeks"] },
  "automerge:bread": { title: "Bread" },
  "automerge:notes": { content: "remember the milk\nand the leeks", name: "notes.md" },
}

const ctx = { repo: fakeRepo(TREE), rootFolderUrl: "automerge:root" }

describe("walkTree", () => {
  it("visits every entry breadth-first with its path", async () => {
    const seen = []
    await walkTree(ctx.repo, "automerge:root", ({ path }) => { seen.push(path); return false })
    expect(seen).toEqual(["Recipes", "notes.md", "Recipes/Leek Soup", "Recipes/Bread"])
  })

  it("stops when the visitor says so", async () => {
    const seen = []
    await walkTree(ctx.repo, "automerge:root", ({ path }) => { seen.push(path); return true })
    expect(seen).toEqual(["Recipes"])
  })

  it("does not loop forever on a cycle", async () => {
    const cyclic = {
      "automerge:a": { docs: [{ name: "b", type: "folder", url: "automerge:b" }] },
      "automerge:b": { docs: [{ name: "a", type: "folder", url: "automerge:a" }] },
    }
    const seen = []
    const result = await walkTree(fakeRepo(cyclic), "automerge:a", ({ path }) => { seen.push(path); return false })
    expect(seen.length).toBeLessThan(10)
    expect(result.visits).toBeLessThan(10)
  })

  it("skips entries it cannot load rather than failing the walk", async () => {
    const broken = {
      "automerge:root": { docs: [
        { name: "gone", type: "folder", url: "automerge:missing" },
        { name: "ok", type: "file", url: "automerge:notes" },
      ] },
      "automerge:notes": { content: "hi" },
    }
    const seen = []
    await walkTree(fakeRepo(broken), "automerge:root", ({ path }) => { seen.push(path); return false })
    expect(seen).toContain("ok")
  })

  it("honours the visit budget", async () => {
    const result = await walkTree(ctx.repo, "automerge:root", () => false, { maxVisits: 1 })
    expect(result.truncated).toBe(true)
  })
})

describe("doc_search", () => {
  it("finds a document by name", async () => {
    const out = await docSearch.execute({ query: "leek" }, ctx)
    expect(out).toContain("Recipes/Leek Soup")
    expect(out).toContain("automerge:leek")
  })

  it("matches on the path as well as the name", async () => {
    const out = await docSearch.execute({ query: "Recipes/Bread" }, ctx)
    expect(out).toContain("automerge:bread")
  })

  it("filters by type", async () => {
    const out = await docSearch.execute({ query: "", type: "folder" }, ctx)
    expect(out).toContain("Recipes")
    expect(out).not.toContain("automerge:leek")
  })

  it("searches file contents when asked, and says so when it did not", async () => {
    const missed = await docSearch.execute({ query: "milk" }, ctx)
    expect(missed).toMatch(/No documents matched/)
    expect(missed).toMatch(/content: true/)

    const found = await docSearch.execute({ query: "milk", content: true }, ctx)
    expect(found).toContain("notes.md")
    expect(found).toContain("remember the milk")
  })

  it("treats an invalid regex as a literal instead of throwing", async () => {
    const out = await docSearch.execute({ query: "Leek (Soup" }, ctx)
    expect(out).toMatch(/No documents matched/)
  })

  it("explains itself when there is no root at all", async () => {
    await expect(docSearch.execute({ query: "x" }, { repo: ctx.repo })).rejects.toThrow(/no root folder|pass `root`/i)
  })

  it("honours the limit", async () => {
    const out = await docSearch.execute({ query: "", limit: 1 }, ctx)
    expect(JSON.parse(out).results).toHaveLength(1)
  })
})

describe("doc_tree", () => {
  it("outlines folders and their contents", async () => {
    const out = await docTree.execute({}, ctx)
    expect(out).toContain("Recipes/")
    expect(out).toContain("Leek Soup")
    expect(out).toContain("notes.md")
  })

  it("respects the depth limit", async () => {
    const shallow = await docTree.execute({ depth: 1 }, ctx)
    expect(shallow).toContain("Recipes/")
    expect(shallow).not.toContain("Leek Soup")
  })
})
