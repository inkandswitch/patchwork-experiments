import { describe, it, expect } from "vitest"
import { fsWrite, fsList, fsRead } from "./tools/folders.js"
import { needsApproval, initSession, grantKey } from "./session.js"

/** A repo of plain-object documents with a root folder. */
function fakeRepo() {
  let n = 0
  const docs = new Map([["automerge:root", { title: "root", docs: [], "@patchwork": { type: "folder" } }]])
  const handle = (url) => ({ url, doc: () => docs.get(url), change(fn) { fn(docs.get(url)) } })
  return {
    docs,
    async create2() { const url = `automerge:d${++n}`; docs.set(url, {}); return handle(url) },
    async find(url) { if (!docs.has(url)) throw new Error(`missing ${url}`); return handle(url) },
  }
}

const ctx = (repo) => ({ repo, rootFolderUrl: "automerge:root" })
const entry = (repo, folderUrl, name) => repo.docs.get(folderUrl).docs.find((d) => d.name === name)

describe("fs_write creates what does not exist", () => {
  it("creates a file at the root", async () => {
    const repo = fakeRepo()
    const out = await fsWrite.execute({ path: "notes.md", content: "hello" }, ctx(repo))

    expect(out.text).toMatch(/created 1 lines/)
    const link = entry(repo, "automerge:root", "notes.md")
    expect(link.type).toBe("file")
    const file = repo.docs.get(link.url)
    expect(file.content).toBe("hello")
    expect(file.mimeType).toBe("text/markdown")
    expect(file["@patchwork"].type).toBe("file")
  })

  it("creates intermediate folders", async () => {
    const repo = fakeRepo()
    await fsWrite.execute({ path: "a/b/c.js", content: "x" }, ctx(repo))

    const a = repo.docs.get(entry(repo, "automerge:root", "a").url)
    expect(a["@patchwork"].type).toBe("folder")
    const b = repo.docs.get(a.docs.find((d) => d.name === "b").url)
    expect(repo.docs.get(b.docs.find((d) => d.name === "c.js").url).content).toBe("x")
  })

  it("updates an existing file instead of duplicating it", async () => {
    const repo = fakeRepo()
    await fsWrite.execute({ path: "a/x.js", content: "one" }, ctx(repo))
    const a = repo.docs.get(entry(repo, "automerge:root", "a").url)
    const fileUrl = a.docs.find((d) => d.name === "x.js").url

    const out = await fsWrite.execute({ path: "a/x.js", content: "two" }, ctx(repo))
    expect(out.text).toMatch(/updated/)
    expect(a.docs).toHaveLength(1)
    expect(repo.docs.get(fileUrl).content).toBe("two") // same document, history kept
  })

  it("reuses a folder rather than making a second one", async () => {
    const repo = fakeRepo()
    await fsWrite.execute({ path: "pkg/a.js", content: "1" }, ctx(repo))
    await fsWrite.execute({ path: "pkg/b.js", content: "2" }, ctx(repo))
    expect(repo.docs.get("automerge:root").docs.filter((d) => d.name === "pkg")).toHaveLength(1)
  })

  it("writes several files in one call and names the containing folder", async () => {
    const repo = fakeRepo()
    const out = await fsWrite.execute(
      {
        files: {
          "my-tool/package.json": '{"main":"./index.js"}',
          "my-tool/index.js": "export const plugins = []",
          "my-tool/tool.js": "export default () => {}",
        },
      },
      ctx(repo)
    )

    expect(out.text).toMatch(/Wrote 3 file\(s\)/)
    const folderUrl = out.text.match(/Containing folder: (automerge:\S+)/)[1]
    expect(repo.docs.get(folderUrl).docs.map((d) => d.name).sort()).toEqual([
      "index.js", "package.json", "tool.js",
    ])
  })

  it("is how a tool gets made — a folder of files, nothing special", async () => {
    const repo = fakeRepo()
    const out = await fsWrite.execute(
      {
        files: {
          "counter/package.json": JSON.stringify({ name: "counter", type: "module", main: "./index.js" }),
          "counter/index.js": "export const plugins = [{ type: 'patchwork:tool', id: 'counter' }]",
        },
      },
      ctx(repo)
    )
    const folderUrl = out.text.match(/Containing folder: (automerge:\S+)/)[1]

    // Readable straight back through the ordinary folder tools.
    const listed = await fsList.execute({ path: "counter" }, ctx(repo))
    expect(listed).toContain("index.js")
    const read = await fsRead.execute({ path: "counter/index.js" }, ctx(repo))
    expect(read).toContain("patchwork:tool")
    expect(folderUrl).toMatch(/^automerge:/)
  })

  it("overwrites by url when given one", async () => {
    const repo = fakeRepo()
    await fsWrite.execute({ path: "x.txt", content: "a" }, ctx(repo))
    const url = entry(repo, "automerge:root", "x.txt").url
    await fsWrite.execute({ url, content: "b" }, ctx(repo))
    expect(repo.docs.get(url).content).toBe("b")
  })

  it("refuses a url that is not a file", async () => {
    const repo = fakeRepo()
    await expect(fsWrite.execute({ url: "automerge:root", content: "x" }, ctx(repo))).rejects.toThrow(/not a file/)
  })

  it("needs something to write", async () => {
    await expect(fsWrite.execute({}, ctx(fakeRepo()))).rejects.toThrow(/Pass `path`/)
  })
})

describe("risk on the document, not the verb", () => {
  const doc = () => { const d = {}; initSession(d, {}); return d }
  const editTool = { id: "doc_edit", risk: "write" }
  const SETTINGS = "automerge:module-settings"

  it("always asks for a write to a sensitive document, even with a grant", () => {
    const d = doc()
    d.grants[grantKey("doc_edit", SETTINGS)] = "session"
    expect(needsApproval(d, editTool, { input: { url: SETTINGS } }, null, [SETTINGS])).toBe(true)
  })

  it("does not bother the user about ordinary documents", () => {
    const d = doc()
    d.grants[grantKey("doc_edit", "automerge:notes")] = "session"
    expect(needsApproval(d, editTool, { input: { url: "automerge:notes" } }, null, [SETTINGS])).toBe(false)
  })

  it("covers any tool, not just the one that used to be special", () => {
    // The point of moving risk onto the document: a different write tool
    // cannot route around the gate.
    const d = doc()
    const otherTool = { id: "fs_write", risk: "write" }
    d.grants[grantKey("fs_write", SETTINGS)] = "session"
    expect(needsApproval(d, otherTool, { input: { url: SETTINGS } }, null, [SETTINGS])).toBe(true)
  })
})
