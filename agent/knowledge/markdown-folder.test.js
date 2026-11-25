import { describe, it, expect } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { markdownFolder } from "./markdown-folder.js"

await initSubduction()

function account() {
  const repo = new Repo({ network: [] })
  const root = repo.create({ title: "Root", docs: [], "@patchwork": { type: "folder" } })
  return { repo, root }
}

const store = () => markdownFolder({ name: "Shelf", parent: (ctx) => ctx.rootFolderUrl ?? null, given: (ctx) => ctx.shelfUrl ?? null, marker: "shelf", readme: "# Shelf\n" })

describe("a markdown folder", () => {
  it("has nowhere to be without a parent, and makes nothing finding that out", async () => {
    const { repo, root } = account()
    const shelf = store()
    expect(await shelf.folder({ repo })).toBe(null)
    expect(await shelf.write({ repo }, "a.md", "a")).toBe(null)
    expect(await shelf.folder({ repo, rootFolderUrl: root.url })).toBe(null)
    expect(root.doc().docs).toEqual([])
  })

  it("is made with its README and marker on the first write, and found again by a fresh context", async () => {
    const { repo, root } = account()
    const shelf = store()
    const url = await shelf.write({ repo, rootFolderUrl: root.url }, "b.md", "# B\n")
    expect(root.doc().docs).toEqual([{ name: "Shelf", type: "folder", url }])
    const folder = (await repo.find(url)).doc()
    expect([folder.shelf, folder.docs.map((d) => d.name)]).toEqual([true, ["README.md", "b.md"]])
    expect(await shelf.folder({ repo, rootFolderUrl: root.url })).toBe(url)
  })

  it("remembers its folder for a context without writing onto it", async () => {
    const { repo, root } = account()
    const shelf = store()
    const ctx = { repo, rootFolderUrl: root.url }
    const url = await shelf.folder(ctx, { create: true })
    root.change((d) => { d.docs.splice(0, 1) })
    expect(await shelf.folder(ctx)).toBe(url)
    expect(await shelf.folder({ repo, rootFolderUrl: root.url })).toBe(null)
    expect(Object.keys(ctx)).toEqual(["repo", "rootFolderUrl"])
  })

  it("uses the folder a context names outright", async () => {
    const { repo } = account()
    const named = repo.create({ title: "Mine", docs: [], "@patchwork": { type: "folder" } })
    const shelf = store()
    await shelf.write({ repo, shelfUrl: named.url }, "c.md", "c")
    expect(named.doc().docs.map((d) => d.name)).toEqual(["c.md"])
  })

  it("lists its markdown files by name, but not the README, other files or folders", async () => {
    const { repo, root } = account()
    const shelf = store()
    const ctx = { repo, rootFolderUrl: root.url }
    for (const [file, text] of [["z.md", "zed"], ["a.md", "ay"], ["pins.json", "{}"]]) await shelf.write(ctx, file, text)
    const folder = await repo.find(await shelf.folder(ctx))
    const inner = repo.create({ title: "inner", docs: [], "@patchwork": { type: "folder" } })
    folder.change((d) => { d.docs.push({ name: "inner.md", type: "folder", url: inner.url }) })
    const { files } = await shelf.list(ctx)
    expect(files.map(({ file, text }) => [file, text])).toEqual([["a.md", "ay"], ["z.md", "zed"]])
    expect(await shelf.read(ctx, "pins.json")).toBe("{}")
    expect(await shelf.read(ctx, "missing.md")).toBe(null)
  })

  it("rewrites a file in place, and unlinks one", async () => {
    const { repo, root } = account()
    const shelf = store()
    const ctx = { repo, rootFolderUrl: root.url }
    await shelf.write(ctx, "a.md", "one\n")
    const before = (await shelf.list(ctx)).files[0].url
    await shelf.write(ctx, "a.md", "one\ntwo\n")
    const after = (await shelf.list(ctx)).files[0]
    expect([after.url, after.text]).toEqual([before, "one\ntwo\n"])
    expect([await shelf.remove(ctx, "a.md"), await shelf.remove(ctx, "a.md")]).toEqual([true, false])
    expect((await shelf.list(ctx)).files).toEqual([])
  })
})
