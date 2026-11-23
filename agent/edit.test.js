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
      /first line does appear \(line 1\)/
    )
  })

  it("is an OpError, so the message reaches the model unadorned", () => {
    expect(() => locate("abc", "zzz")).toThrow(OpError)
  })
})

// ---------------------------------------------------------------- doc_edit replace

describe("doc_edit replace", () => {
  it("replaces text by anchor, computing the splice itself", () => {
    const log = []
    const doc = { body: TOOL }
    const said = applyOp(
      doc,
      { op: "replace", path: ["body"], find: 'document.createElement("svg")', text: 'document.createElementNS(SVG, "svg")' },
      { spliceText: fakeSplice(log) }
    )
    expect(doc.body).toContain('createElementNS(SVG, "svg")')
    expect(doc.body).not.toContain('createElement("svg")')
    expect(said).toBe(
      ["replace /body:", "  line 3:", '  -     const canvas = document.createElement("svg");', '  +     const canvas = document.createElementNS(SVG, "svg");'].join("\n")
    )
    // Only the characters that differ went through the splice: the shared
    // prefix `document.createElement` and suffix `"svg")` were left alone, so
    // the change is one deleted `(` and eight inserted characters.
    expect(log).toEqual([{ index: TOOL.indexOf('("svg")'), del: 1, text: "NS(SVG, " }])
  })

  it("deletes the anchored text when text is empty", () => {
    const doc = { body: "keep this, drop this" }
    applyOp(doc, { op: "replace", path: ["body"], find: ", drop this", text: "" })
    expect(doc.body).toBe("keep this")
  })

  it("rejects replace on something that is not text, and a range", () => {
    expect(() => applyOp({ items: [1] }, { op: "replace", path: ["items"], find: "1", text: "2" })).toThrow(/a list of 1 item, not text/)
    expect(() => applyOp({ b: "x" }, { op: "replace", path: ["b"], find: "x", range: [0, 1], text: "y" })).toThrow(/There is no range/)
  })

  it("works through the tool, all-or-nothing", async () => {
    const repo = fakeRepo()
    repo.docs.set("automerge:note", { body: "the quick brown fox" })
    const out = await docEdit.execute(
      { url: "automerge:note", ops: [{ op: "replace", path: ["body"], find: "quick", text: "slow" }] },
      ctx(repo)
    )
    expect(out).toBe('Edited automerge:note in one change:\nreplace /body:\n  line 1:\n  - the quick brown fox\n  + the slow brown fox')
    expect(repo.docs.get("automerge:note").body).toBe("the slow brown fox")

    await expect(
      docEdit.execute({ url: "automerge:note", ops: [{ op: "replace", path: ["body"], find: "o", text: "0" }] }, ctx(repo))
    ).rejects.toThrow(/op 1 \(replace \/body\): `find` text occurs 3 times.*Nothing was changed/)
    expect(repo.docs.get("automerge:note").body).toBe("the slow brown fox")
  })
})

// ---------------------------------------------------------------- fs_edit

describe("fs_edit", () => {
  async function seeded() {
    const repo = fakeRepo()
    await fsWrite.execute({ path: "petri/tool.js", content: TOOL }, ctx(repo))
    return repo
  }
  const replace = (find, text, all) => ({ op: "replace", find, text, ...(all ? { all } : {}) })
  const contentOf = (repo) => repo.docs.get(repo.docs.get(fileUrl(repo, "petri")).docs[0].url).content

  it("replaces the one place the text occurs, and shows the change as a diff", async () => {
    const repo = await seeded()
    const out = await fsEdit.execute(
      { path: "petri/tool.js", edits: [replace('document.createElement("svg")', 'document.createElementNS("http://www.w3.org/2000/svg", "svg")')] },
      ctx(repo)
    )
    expect(out.text).toBe(
      [
        "Edited /petri/tool.js: 1 edit. Now 8 lines, 204 B.",
        "",
        "replace · line 3",
        "  line 3:",
        '  -     const canvas = document.createElement("svg");',
        '  +     const canvas = document.createElementNS("http://www.w3.org/2000/svg", "svg");',
      ].join("\n")
    )
    expect(out.doc).toMatchObject({ kind: "file", name: "tool.js" })
    expect(contentOf(repo)).toContain('createElementNS("http://www.w3.org/2000/svg", "svg")')
  })

  it("splices only the characters that differ when the runner has a text splice", async () => {
    const repo = await seeded()
    const log = []
    await fsEdit.execute({ path: "petri/tool.js", edits: [replace('"width", "800"', '"width", "1200"')] }, ctx(repo, fakeSplice(log)))
    expect(log).toEqual([{ index: TOOL.indexOf('"800"') + 1, del: 1, text: "12" }])
  })

  it("applies several edits in order, in one change, each as its own splice", async () => {
    const repo = await seeded()
    const log = []
    const changes = []
    const find = repo.find
    repo.find = async (u) => {
      const handle = await find(u)
      return { ...handle, change(fn) { changes.push(u); handle.change(fn) } }
    }
    const out = await fsEdit.execute(
      {
        path: "petri/tool.js",
        edits: [
          replace('"800"', '"1200"'),
          { op: "insert", after: "element.append(canvas);\n", text: "    element.dataset.ready = 1;\n" },
          { op: "prepend", text: "// petri\n" },
          { op: "append", text: "// end\n" },
        ],
      },
      ctx(repo, fakeSplice(log))
    )
    expect(contentOf(repo)).toBe(`// petri\n${TOOL.replace('"800"', '"1200"').replace("element.append(canvas);\n", "element.append(canvas);\n    element.dataset.ready = 1;\n")}// end\n`)
    expect(log).toHaveLength(4)
    expect(changes.filter((u) => u !== "automerge:root").length).toBeLessThanOrEqual(2) // the file once (and its folder's pin)
    expect(out.text).toContain("insert · line 6\n  line 6:\n  +     element.dataset.ready = 1;")
    expect(out.text).toContain("append · line 10\n  line 10:\n  + // end")
  })

  it("takes a url instead of a path", async () => {
    const repo = await seeded()
    const url = repo.docs.get(fileUrl(repo, "petri")).docs[0].url
    const out = await fsEdit.execute({ url, edits: [replace("element.append(canvas);", "element.replaceChildren(canvas);")] }, ctx(repo))
    expect(out.text).toMatch(/^Edited tool.js: 1 edit/)
    expect(repo.docs.get(url).content).toContain("replaceChildren")
  })

  it("refuses an ambiguous anchor and says how to fix it", async () => {
    const repo = await seeded()
    await expect(fsEdit.execute({ path: "petri/tool.js", edits: [replace("canvas", "svg")] }, ctx(repo))).rejects.toThrow(
      /edit 1 \(replace\): `find` text occurs 3 times \(lines 3, 4, 5\)\. Include more of the text around it so it matches one place, or pass all: true\. Nothing was changed\./
    )
  })

  it("changes every occurrence with all, in one change", async () => {
    const repo = await seeded()
    const out = await fsEdit.execute({ path: "petri/tool.js", edits: [replace("canvas", "svg", true)] }, ctx(repo))
    expect(out.text).toContain("replace · 3 places")
    expect(contentOf(repo)).not.toContain("canvas")
    expect(contentOf(repo)).toContain('const svg = document.createElement("svg")')
  })

  it("leaves the file alone when any edit fails", async () => {
    const repo = await seeded()
    await expect(
      fsEdit.execute({ path: "petri/tool.js", edits: [replace('"800"', '"1200"'), replace("nothing like this", "x")] }, ctx(repo))
    ).rejects.toThrow(/edit 2 \(replace\): `find` text not found.*Nothing was changed/)
    expect(contentOf(repo)).toBe(TOOL)
  })

  it("explains a malformed call rather than failing blankly", async () => {
    const repo = await seeded()
    const attempt = (input) => fsEdit.execute({ path: "petri/tool.js", ...input }, ctx(repo))
    await expect(attempt({})).rejects.toThrow(/Pass `edits`/)
    await expect(attempt({ edits: [] })).rejects.toThrow(/Pass `edits`/)
    await expect(attempt({ edits: [{ op: "replace", find: "", text: "x" }] })).rejects.toThrow(/replace takes `find`/)
    await expect(attempt({ edits: [replace("a", "a")] })).rejects.toThrow(/`find` and `text` are the same/)
    await expect(attempt({ edits: [{ op: "replace", old: "a", new: "b" }] })).rejects.toThrow(/use `find` for the text to replace and `text`/)
    await expect(attempt({ edits: [{ op: "set", text: "x" }] })).rejects.toThrow(/op one of replace, insert, append, prepend/)
    await expect(attempt({ edits: [{ op: "insert", text: "x" }] })).rejects.toThrow(/insert takes `before` or `after`/)
    await expect(attempt({ edits: [{ op: "append" }] })).rejects.toThrow(/append takes `text`/)
    await expect(fsEdit.execute({ edits: [replace("a", "b")] }, ctx(repo))).rejects.toThrow(/Pass `path`.*or `url`/)
  })

  it("deletes the text when text is empty", async () => {
    const repo = await seeded()
    await fsEdit.execute({ path: "petri/tool.js", edits: [replace('    canvas.setAttribute("width", "800");\n', "")] }, ctx(repo))
    expect(contentOf(repo)).not.toContain("setAttribute")
    expect(contentOf(repo).split("\n")).toHaveLength(TOOL.split("\n").length - 1)
  })

  it("summarizes as the file and the line", () => {
    expect(fsEdit.summarize({ path: "petri/tool.js", edits: [{}] }, "Edited /petri/tool.js: 1 edit.\n\nreplace · line 3")).toBe("edited tool.js · line 3")
    expect(fsEdit.summarize({ url: "automerge:x", edits: [{}, {}] }, "")).toBe("edited file · 2 edits")
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
