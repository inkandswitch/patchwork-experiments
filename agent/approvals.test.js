import { describe, it, expect } from "vitest"
import { initSession, needsApproval, documentIdOf, isSensitive } from "./session.js"
import { BUILTIN_TOOLS } from "./tools/index.js"
import { isCodePath } from "./tools/folders.js"

const tool = (id) => {
  const found = BUILTIN_TOOLS.find((t) => t.id === id)
  if (!found) throw new Error(`no builtin ${id}`)
  return found
}
const fresh = () => { const d = {}; initSession(d, {}); return d }
const asks = (id, input, { subject = "automerge:subject", sensitive = [], doc = fresh() } = {}) =>
  needsApproval(doc, tool(id), { input }, subject, sensitive)

const SETTINGS = "automerge:settingsDoc"
const ACCOUNT = "automerge:accountDoc"

describe("edits to documents run without asking", () => {
  it.each([
    ["doc_edit", { ops: [{ path: [], range: "title", value: "x" }] }],
    ["doc_edit", { url: "automerge:other", ops: [] }],
    ["doc_create", { datatype: "folder", title: "Notes" }],
    ["fs_write", { path: "notes/today.md", content: "hi" }],
    ["fs_write", { files: { "a.md": "a", "data/b.csv": "1,2" } }],
    ["fs_edit", { path: "notes/today.md", old: "hi", new: "hello" }],
    ["fs_delete", { path: "notes/old.md" }],
  ])("%s %j", (id, input) => {
    expect(asks(id, input)).toBe(false)
  })
})

describe("writing source code still needs a grant", () => {
  it.each([
    ["fs_write", { path: "tally/index.js", content: "" }],
    ["fs_write", { files: { "README.md": "", "tally/package.json": "{}" } }], // one code file is enough
    ["fs_write", { url: "automerge:someFile", content: "" }], // by url alone: could be anything
    ["fs_edit", { path: "tally/tool.tsx", old: "a", new: "b" }],
    ["fs_edit", { url: "automerge:someFile", old: "a", new: "b" }],
    ["fs_delete", { path: "tally/styles.css" }],
    ["fs_delete", { path: "tally" }], // no extension: may be a whole package
  ])("%s %j", (id, input) => {
    expect(asks(id, input)).toBe(true)
  })

  it("and a grant answers for it, as before", () => {
    const doc = fresh()
    doc.grants = { "files@*": "session" }
    expect(asks("fs_write", { path: "tally/index.js", content: "" }, { doc })).toBe(false)
  })
})

describe("sensitive documents always ask", () => {
  const sensitive = [SETTINGS, ACCOUNT]

  it("by url, by subject, and however the url is spelled", () => {
    expect(asks("doc_edit", { url: SETTINGS, ops: [] }, { sensitive })).toBe(true)
    expect(asks("doc_edit", { ops: [] }, { subject: ACCOUNT, sensitive })).toBe(true)
    // Heads or a path in the url name the same document. A string comparison let these through.
    expect(asks("doc_edit", { url: `${SETTINGS}#abc|def`, ops: [] }, { sensitive })).toBe(true)
    expect(asks("doc_edit", { url: `${SETTINGS}/modules/0`, ops: [] }, { sensitive })).toBe(true)
  })

  it("whatever has been granted", () => {
    const doc = fresh()
    doc.grants = { "doc_edit@*": "session" }
    expect(asks("doc_edit", { url: SETTINGS, ops: [] }, { sensitive, doc })).toBe(true)
  })

  it("but not a document whose id merely starts the same way", () => {
    expect(isSensitive("automerge:settingsDocX", sensitive)).toBe(false)
  })
})

describe("closing what the conversation opened", () => {
  it("does not ask", () => {
    expect(asks("view_unmount", { mountId: "m1" })).toBe(false)
  })
})

describe("what still asks is unchanged", () => {
  it("running code and reaching the web", () => {
    expect(asks("view_mount", { url: "automerge:x", toolId: "t" })).toBe(true)
    expect(asks("package_test", { root: "automerge:pkg" })).toBe(true)
    expect(asks("web_fetch", { url: "https://example.com/" })).toBe(true)
  })
})

describe("documentIdOf", () => {
  it.each([
    ["automerge:abc", "abc"],
    ["automerge:abc#h1|h2", "abc"],
    ["automerge:abc/a/b", "abc"],
    ["https://example.com/", null],
    [null, null],
  ])("%s -> %s", (url, id) => expect(documentIdOf(url)).toBe(id))
})

describe("isCodePath", () => {
  it.each([
    ["tool/index.js", true], ["a/b/c.TSX", true], ["package.json", true], ["styles.css", true],
    ["notes.md", false], ["data.csv", false], ["README", false], [".env", false], ["folder/", false],
  ])("%s -> %s", (path, code) => expect(isCodePath(path)).toBe(code))
})
