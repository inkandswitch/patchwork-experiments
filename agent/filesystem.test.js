import { describe, it, expect } from "vitest"
import { fsWrite, fsList, fsRead, fsDelete, fsEdit } from "./tools/folders.js"
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
    const folderUrl = out.text.match(/Package folder: (automerge:\S+)/)[1]
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
    const folderUrl = out.text.match(/Package folder: (automerge:\S+)/)[1]

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

describe("a root the model filled in with a placeholder", () => {
  // Watched happen: the model sent `root: "automerge:"`, the call failed with
  // "Invalid AutomergeUrl", and the user got a red block in their transcript
  // while the agent spent a turn working out it should have omitted the field.
  it("treats an id-less automerge url as not given", async () => {
    const repo = fakeRepo()
    const out = await fsWrite.execute({ root: "automerge:", path: "notes.md", content: "hi" }, ctx(repo))
    expect(out.text).toMatch(/created 1 lines/)
    expect(entry(repo, "automerge:root", "notes.md")).toBeTruthy()
  })

  it("accepts the words a model reaches for when it means the default", async () => {
    const repo = fakeRepo()
    for (const root of ["", "root", "default"]) {
      await expect(fsWrite.execute({ root, path: `${root || "blank"}.md`, content: "x" }, ctx(repo))).resolves.toBeTruthy()
    }
  })

  it("still refuses something that is meant to be a real url and is not", async () => {
    const repo = fakeRepo()
    await expect(
      fsWrite.execute({ root: "my-folder", path: "a.md", content: "x" }, ctx(repo))
    ).rejects.toThrow(/not a document URL. Omit `root`/)
  })

  it("uses a real root when it is given one", async () => {
    const repo = fakeRepo()
    const other = "automerge:otherfolder"
    repo.docs.set(other, { title: "Other", docs: [], "@patchwork": { type: "folder" } })
    await fsWrite.execute({ root: other, path: "a.md", content: "x" }, ctx(repo))
    expect(entry(repo, other, "a.md")).toBeTruthy()
  })
})

describe("fs_delete", () => {
  async function pkg() {
    const repo = fakeRepo()
    await fsWrite.execute(
      { files: { "tally/index.js": "a", "tally/tool.js": "b", "tally/old/legacy.js": "c" } },
      ctx(repo)
    )
    return repo
  }

  it("takes a file out of its folder", async () => {
    const repo = await pkg()
    const out = await fsDelete.execute({ path: "tally/tool.js" }, ctx(repo))

    const folder = repo.docs.get(entry(repo, "automerge:root", "tally").url)
    expect(folder.docs.map((d) => d.name)).toEqual(["index.js", "old"])
    expect(out).toMatch(/Removed file 'tally\/tool\.js'/)
  })

  it("says plainly that it unlinked rather than destroyed", async () => {
    // Automerge keeps the document and its history; claiming otherwise would
    // make a recoverable mistake sound permanent.
    const repo = await pkg()
    const out = await fsDelete.execute({ path: "tally/tool.js" }, ctx(repo))
    expect(out).toMatch(/still exists at automerge:/)
    expect(out).toMatch(/unlinked it, it did not destroy it/)
  })

  it("removes a folder and says how much went with it", async () => {
    const repo = await pkg()
    const out = await fsDelete.execute({ path: "tally/old" }, ctx(repo))
    expect(out).toMatch(/Removed folder 'tally\/old' and the 1 entry in it/)
    const folder = repo.docs.get(entry(repo, "automerge:root", "tally").url)
    expect(folder.docs.map((d) => d.name)).toEqual(["index.js", "tool.js"])
  })

  it("lists what is there when the name is wrong", async () => {
    const repo = await pkg()
    await expect(fsDelete.execute({ path: "tally/nope.js" }, ctx(repo))).rejects.toThrow(
      /'nope\.js' is not in \/tally\. It contains: index\.js, tool\.js, old/
    )
  })

  it("does not create the folders it was asked to look in", async () => {
    // ensurePath would have made them, so a typo would silently build a tree
    // and then report finding nothing in it.
    const repo = await pkg()
    await expect(fsDelete.execute({ path: "typo/deep/file.js" }, ctx(repo))).rejects.toThrow(
      /\/typo does not exist/
    )
    expect(entry(repo, "automerge:root", "typo")).toBeUndefined()
  })

  it("refuses an empty path rather than removing something arbitrary", async () => {
    const repo = await pkg()
    await expect(fsDelete.execute({ path: "" }, ctx(repo))).rejects.toThrow(/Pass the path/)
    await expect(fsDelete.execute({ path: "/" }, ctx(repo))).rejects.toThrow(/Pass the path/)
  })

  it("leaves the package buildable afterwards", async () => {
    const repo = await pkg()
    await fsDelete.execute({ path: "tally/old" }, ctx(repo))
    const out = await fsList.execute({ path: "tally" }, ctx(repo))
    expect(out).not.toContain("old")
    expect(out).toContain("index.js")
  })
})

describe("writing into a package moves the package's version", () => {
  // Patchwork loads a package at its folder's heads, and every module in it at
  // those same heads. Editing a file changes only the file's document, so
  // without this the package URL never moved and a rewritten executor kept
  // loading as the first version, through reloads and new tabs.
  async function installed() {
    const repo = fakeRepo()
    await fsWrite.execute(
      { files: { "lm-eval/package.json": "{}", "lm-eval/index.js": "a", "lm-eval/agent.js": "stub", "lm-eval/src/util.js": "u" } },
      ctx(repo)
    )
    const url = entry(repo, "automerge:root", "lm-eval").url
    return { repo, url, version: () => repo.docs.get(url).contentVersion }
  }

  it("bumps the package folder when a file in it is rewritten in place", async () => {
    const { repo, url, version } = await installed()
    const before = version()
    const out = await fsWrite.execute({ path: "lm-eval/agent.js", content: "real" }, ctx(repo))
    expect(version()).not.toBe(before)
    expect(out.text).toContain(`Package version moved: /lm-eval (${url})`)
  })

  it("bumps the package, not just the subfolder, for a file deeper inside it", async () => {
    const { repo, version } = await installed()
    const before = version()
    await fsWrite.execute({ path: "lm-eval/src/util.js", content: "v2" }, ctx(repo))
    expect(version()).not.toBe(before)
    const src = repo.docs.get(entry(repo, entry(repo, "automerge:root", "lm-eval").url, "src").url)
    expect(src.contentVersion).toBeUndefined()
  })

  it("bumps on fs_edit and fs_delete by path", async () => {
    const { repo, version } = await installed()
    let before = version()
    const edited = await fsEdit.execute({ path: "lm-eval/agent.js", old: "stub", new: "real" }, ctx(repo))
    expect(version()).not.toBe(before)
    expect(edited.text).toMatch(/Package version moved/)

    before = version()
    const removed = await fsDelete.execute({ path: "lm-eval/src/util.js" }, ctx(repo))
    expect(version()).not.toBe(before)
    expect(removed).toMatch(/Package version moved/)
  })

  it("bumps when the root itself is the package", async () => {
    const { repo, url, version } = await installed()
    const before = version()
    await fsWrite.execute({ root: url, path: "agent.js", content: "real" }, { repo })
    expect(version()).not.toBe(before)
  })

  it("leaves folders that are not packages alone, and says nothing about it", async () => {
    const repo = fakeRepo()
    await fsWrite.execute({ path: "notes/a.md", content: "one" }, ctx(repo))
    const out = await fsWrite.execute({ path: "notes/a.md", content: "two" }, ctx(repo))
    expect(repo.docs.get(entry(repo, "automerge:root", "notes").url).contentVersion).toBeUndefined()
    expect(repo.docs.get("automerge:root").contentVersion).toBeUndefined()
    expect(out.text).not.toMatch(/Package version/)
  })

  it("does not bump for a write that changed nothing", async () => {
    const { repo, version } = await installed()
    const before = version()
    await fsWrite.execute({ path: "lm-eval/agent.js", content: "stub" }, ctx(repo))
    expect(version()).toBe(before)
  })

  it("says, when writing by URL, that the package was not marked as changed", async () => {
    // By URL there is no folder to walk up, so the agent has to hear that the
    // running version will not move, rather than find out by calling it.
    const { repo, url } = await installed()
    const agentUrl = entry(repo, url, "agent.js").url
    const written = await fsWrite.execute({ url: agentUrl, content: "real" }, ctx(repo))
    expect(written.text).toMatch(/write by `path` instead/)
    const edited = await fsEdit.execute({ url: agentUrl, old: "real", new: "realer" }, ctx(repo))
    expect(edited.text).toMatch(/write by `path` instead/)
  })
})
