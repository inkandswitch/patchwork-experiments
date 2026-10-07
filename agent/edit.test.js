import { describe, it, expect } from "vitest"
import { applyOp, locate, lineOf, minimalSplice, OpError } from "./tools/ops.js"
import { fsEdit, fsWrite, fsRead } from "./tools/folders.js"
import { docEdit } from "./tools/docs.js"

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

/** A stand-in for automerge's text splice that records what it was asked to do. */
function fakeSplice(log) {
  return (draft, path, index, del, text) => {
    const parent = path.slice(0, -1).reduce((node, key) => node[key], draft)
    const key = path.at(-1)
    parent[key] = parent[key].slice(0, index) + text + parent[key].slice(index + del)
    log.push({ index, del, text })
  }
}

const ctx = (repo, splice = null) => ({ repo, rootFolderUrl: "automerge:root", splice })
const fileUrl = (repo, name) => repo.docs.get("automerge:root").docs.find((d) => d.name === name).url

const TOOL = [
  "export default {",
  "  render(handle, element) {",
  '    const canvas = document.createElement("svg");',
  '    canvas.setAttribute("width", "800");',
  "    element.append(canvas);",
  "  },",
  "};",
  "",
].join("\n")

// ---------------------------------------------------------------- the primitive

describe("minimalSplice", () => {
  it("finds the smallest change between two strings", () => {
    expect(minimalSplice("hello world", "hello there world")).toEqual({ from: 6, to: 6, inserted: "there " })
    expect(minimalSplice("abcdef", "abXYef")).toEqual({ from: 2, to: 4, inserted: "XY" })
    expect(minimalSplice("same", "same")).toEqual({ from: 4, to: 4, inserted: "" })
  })

  it("does not let the prefix and suffix overlap", () => {
    // "aaa" -> "aa": the common prefix would claim all of "aa" and so would the suffix.
    expect(minimalSplice("aaa", "aa")).toEqual({ from: 2, to: 3, inserted: "" })
    expect(minimalSplice("aa", "aaa")).toEqual({ from: 2, to: 2, inserted: "a" })
  })
})

describe("locate", () => {
  it("returns the offset of a unique anchor", () => {
    expect(locate("one two three", "two")).toBe(4)
    expect(lineOf("a\nb\nc", 4)).toBe(3)
  })

  it("refuses an anchor that occurs more than once, and says where", () => {
    expect(() => locate("x = 1\ny = 1\nz = 1", "= 1")).toThrow(/occurs 3 times \(lines 1, 2, 3\)/)
  })

  it("helps when the first line matches but the rest does not", () => {
    expect(() => locate("const a = 1\nconst b = 2", "const a = 1\nconst b = 3")).toThrow(
      /first line does appear \(around line 1\)/
    )
  })

  it("is an OpError, so the message reaches the model unadorned", () => {
    expect(() => locate("abc", "zzz")).toThrow(OpError)
  })
})

// ---------------------------------------------------------------- doc_edit find

describe("doc_edit with find", () => {
  it("replaces text by anchor, computing the splice itself", () => {
    const log = []
    const doc = { body: TOOL }
    const said = applyOp(
      doc,
      { path: ["body"], find: 'document.createElement("svg")', value: 'document.createElementNS(SVG, "svg")' },
      { spliceText: fakeSplice(log) }
    )
    expect(doc.body).toContain('createElementNS(SVG, "svg")')
    expect(doc.body).not.toContain('createElement("svg")')
    expect(said).toMatch(/replaced 29 chars at line 3/)
    // Only the characters that differ went through the splice: the shared
    // prefix `document.createElement` and suffix `"svg")` were left alone, so
    // the change is one deleted `(` and eight inserted characters.
    expect(log).toEqual([{ index: TOOL.indexOf('("svg")'), del: 1, text: "NS(SVG, " }])
  })

  it("deletes the anchored text when no value is given", () => {
    const doc = { body: "keep this, drop this" }
    applyOp(doc, { path: ["body"], find: ", drop this" })
    expect(doc.body).toBe("keep this")
  })

  it("rejects find on something that is not a string, and find with a range", () => {
    expect(() => applyOp({ items: [1] }, { path: ["items"], find: "1", value: "2" })).toThrow(/not a string/)
    expect(() => applyOp({ b: "x" }, { path: ["b"], find: "x", range: [0, 1], value: "y" })).toThrow(/not both/)
  })

  it("works through the tool, all-or-nothing", async () => {
    const repo = fakeRepo()
    repo.docs.set("automerge:note", { body: "the quick brown fox" })
    const out = await docEdit.execute(
      { url: "automerge:note", ops: [{ path: ["body"], find: "quick", value: "slow" }] },
      ctx(repo)
    )
    expect(out).toMatch(/replaced 5 chars at line 1/)
    expect(repo.docs.get("automerge:note").body).toBe("the slow brown fox")

    await expect(
      docEdit.execute(
        { url: "automerge:note", ops: [{ path: ["body"], find: "o", value: "0" }] },
        ctx(repo)
      )
    ).rejects.toThrow(/occurs 3 times/)
    expect(repo.docs.get("automerge:note").body).toBe("the slow brown fox") // nothing half-applied
  })
})

// ---------------------------------------------------------------- fs_edit

describe("fs_edit", () => {
  async function seeded(splice = null) {
    const repo = fakeRepo()
    await fsWrite.execute({ path: "petri/tool.js", content: TOOL }, ctx(repo))
    return repo
  }

  it("replaces the one place the old text occurs, and shows the result in context", async () => {
    const repo = await seeded()
    const out = await fsEdit.execute(
      {
        path: "petri/tool.js",
        old: 'document.createElement("svg")',
        new: 'document.createElementNS("http://www.w3.org/2000/svg", "svg")',
      },
      ctx(repo)
    )
    expect(out.text).toMatch(/^Edited \/petri\/tool.js: replaced 1 occurrence of 29 chars at line 3/)
    // Numbered like fs_read, with the lines either side, so the next edit can
    // anchor on what is there now.
    expect(out.text).toMatch(/\n2\t {2}render\(handle, element\) \{\n3\t {4}const canvas = document.createElementNS/)
    expect(out.text).toMatch(/\n4\t {4}canvas.setAttribute/)
    expect(out.doc).toMatchObject({ kind: "file", name: "tool.js" })

    const file = repo.docs.get(fileUrl(repo, "petri") && repo.docs.get(fileUrl(repo, "petri")).docs[0].url)
    expect(file.content).toContain('createElementNS("http://www.w3.org/2000/svg", "svg")')
  })

  it("splices only the characters that differ when the runner has a text splice", async () => {
    const repo = await seeded()
    const log = []
    await fsEdit.execute(
      { path: "petri/tool.js", old: '"width", "800"', new: '"width", "1200"' },
      ctx(repo, fakeSplice(log))
    )
    expect(log).toEqual([{ index: TOOL.indexOf('"800"') + 1, del: 1, text: "12" }])
  })

  it("takes a url instead of a path", async () => {
    const repo = await seeded()
    const url = repo.docs.get(fileUrl(repo, "petri")).docs[0].url
    const out = await fsEdit.execute({ url, old: "element.append(canvas);", new: "element.replaceChildren(canvas);" }, ctx(repo))
    expect(out.text).toMatch(/^Edited tool.js: replaced 1 occurrence/)
    expect(repo.docs.get(url).content).toContain("replaceChildren")
  })

  it("refuses an ambiguous anchor and says how to fix it", async () => {
    const repo = await seeded()
    await expect(fsEdit.execute({ path: "petri/tool.js", old: "canvas", new: "svg" }, ctx(repo))).rejects.toThrow(
      /occurs 3 times \(lines 3, 4, 5\).*Include more surrounding text/
    )
  })

  it("changes every occurrence with replaceAll, in one change", async () => {
    const repo = await seeded()
    const changes = []
    const url = repo.docs.get(fileUrl(repo, "petri")).docs[0].url
    repo.find = async (u) => ({ url: u, doc: () => repo.docs.get(u), change(fn) { changes.push(u); fn(repo.docs.get(u)) } })
    const out = await fsEdit.execute({ path: "petri/tool.js", old: "canvas", new: "svg", replaceAll: true }, ctx(repo))
    expect(out.text).toMatch(/replaced 3 occurrences of 6 chars/)
    expect(repo.docs.get(url).content).not.toContain("canvas")
    expect(repo.docs.get(url).content).toContain('const svg = document.createElement("svg")')
    expect(changes.filter((u) => u === url)).toHaveLength(1)
  })

  it("explains a miss rather than failing blankly", async () => {
    const repo = await seeded()
    await expect(fsEdit.execute({ path: "petri/tool.js", old: "nothing like this", new: "x" }, ctx(repo))).rejects.toThrow(
      /not found.*copy the anchor exactly/
    )
    await expect(fsEdit.execute({ path: "petri/tool.js", old: "", new: "x" }, ctx(repo))).rejects.toThrow(/Pass `old`/)
    await expect(fsEdit.execute({ path: "petri/tool.js", old: "a", new: "a" }, ctx(repo))).rejects.toThrow(/identical/)
    await expect(fsEdit.execute({ old: "a", new: "b" }, ctx(repo))).rejects.toThrow(/Pass `path`.*or `url`/)
  })

  it("deletes the old text when new is omitted", async () => {
    const repo = await seeded()
    await fsEdit.execute({ path: "petri/tool.js", old: '    canvas.setAttribute("width", "800");\n' }, ctx(repo))
    const url = repo.docs.get(fileUrl(repo, "petri")).docs[0].url
    expect(repo.docs.get(url).content).not.toContain("setAttribute")
    expect(repo.docs.get(url).content.split("\n")).toHaveLength(TOOL.split("\n").length - 1)
  })

  it("summarizes as the file and the line", () => {
    expect(fsEdit.summarize({ path: "petri/tool.js" }, "Edited /petri/tool.js: replaced 1 occurrence of 3 chars at line 3.")).toBe(
      "edited tool.js · line 3"
    )
    expect(fsEdit.summarize({ url: "automerge:x" }, "Edited tool.js: replaced 3 occurrences of 6 chars.")).toBe(
      "edited file · 3 places"
    )
  })
})

// ---------------------------------------------------------------- fs_write and fs_read

describe("fs_write over an existing file", () => {
  it("splices only what changed rather than reassigning the whole file", async () => {
    const repo = fakeRepo()
    const log = []
    await fsWrite.execute({ path: "petri/tool.js", content: TOOL }, ctx(repo, fakeSplice(log)))
    expect(log).toEqual([]) // creation assigns; there is nothing to splice against

    const fixed = TOOL.replace('createElement("svg")', 'createElementNS(SVG, "svg")')
    const out = await fsWrite.execute({ path: "petri/tool.js", content: fixed }, ctx(repo, fakeSplice(log)))
    expect(log).toEqual([{ index: TOOL.indexOf('("svg")'), del: 1, text: "NS(SVG, " }])
    expect(out.text).toMatch(/updated 8 → 8 lines \(1 chars removed, 8 added\)/)
    const url = repo.docs.get(fileUrl(repo, "petri")).docs[0].url
    expect(repo.docs.get(url).content).toBe(fixed)
  })

  it("says so when the content is identical", async () => {
    const repo = fakeRepo()
    await fsWrite.execute({ path: "a.txt", content: "same" }, ctx(repo))
    const out = await fsWrite.execute({ path: "a.txt", content: "same" }, ctx(repo))
    expect(out.text).toMatch(/\(unchanged\)/)
  })

  it("does the same when overwriting by url", async () => {
    const repo = fakeRepo()
    const log = []
    await fsWrite.execute({ path: "a.txt", content: "one two three" }, ctx(repo))
    const url = fileUrl(repo, "a.txt")
    const out = await fsWrite.execute({ url, content: "one 2 three" }, ctx(repo, fakeSplice(log)))
    expect(log).toEqual([{ index: 4, del: 3, text: "2" }])
    expect(out.text).toMatch(/3 chars removed, 1 added/)
  })

  it("falls back to assignment when the content cannot be spliced", async () => {
    const repo = fakeRepo()
    await fsWrite.execute({ path: "a.txt", content: "one" }, ctx(repo))
    const url = fileUrl(repo, "a.txt")
    const refusing = () => {
      throw new Error("ImmutableString cannot be spliced")
    }
    await fsWrite.execute({ url, content: "two" }, ctx(repo, refusing))
    expect(repo.docs.get(url).content).toBe("two")
  })

  it("tells the model what the package folder URL is for", async () => {
    const repo = fakeRepo()
    const out = await fsWrite.execute({ files: { "tally/index.js": "x", "tally/tool.js": "y" } }, ctx(repo))
    expect(out.text).toMatch(/Package folder: automerge:\S+ — this is the `url` for tool_check/)
    expect(out.text).not.toMatch(/Containing folder/)
  })
})

describe("fs_read", () => {
  it("puts the file's URL in the header when found by path, so it can be edited by URL", async () => {
    const repo = fakeRepo()
    await fsWrite.execute({ path: "petri/tool.js", content: TOOL }, ctx(repo))
    const url = repo.docs.get(fileUrl(repo, "petri")).docs[0].url
    const out = await fsRead.execute({ path: "petri/tool.js" }, ctx(repo))
    expect(out.split("\n")[0]).toBe(`/petri/tool.js · 8 lines · ${TOOL.length} B · ${url}`)
    // Reading by URL does not repeat it.
    expect((await fsRead.execute({ url }, ctx(repo))).split("\n")[0]).toBe(`${url} · 8 lines · ${TOOL.length} B`)
  })
})
