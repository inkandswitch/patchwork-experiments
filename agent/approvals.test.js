import { describe, it, expect } from "vitest"
import { generateAutomergeUrl, parseAutomergeUrl, encodeHeads } from "@automerge/automerge-repo"
import { initSession, needsApproval, documentIdOf, isSensitive } from "./session/session.js"
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

// Real document URLs: the sensitive-document check uses the repo's own parser,
// and treats an automerge: reference it rejects as sensitive.
const SETTINGS = generateAutomergeUrl()
const ACCOUNT = generateAutomergeUrl()
const HEAD = encodeHeads(["ab".repeat(32)])[0]

describe("edits to documents run without asking", () => {
  it.each([
    ["doc_edit", { ops: [{ path: [], range: "title", value: "x" }] }],
    ["doc_edit", { url: "automerge:other", ops: [] }],
    ["doc_create", { datatype: "folder", title: "Notes" }],
    ["fs_write", { path: "notes/today.md", content: "hi" }],
    ["fs_write", { files: { "a.md": "a", "data/b.csv": "1,2" } }],
    ["fs_edit", { path: "notes/today.md", edits: [{ op: "replace", find: "hi", text: "hello" }] }],
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
    ["fs_edit", { path: "tally/tool.tsx", edits: [{ op: "replace", find: "a", text: "b" }] }],
    ["fs_edit", { url: "automerge:someFile", edits: [{ op: "replace", find: "a", text: "b" }] }],
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
    expect(asks("doc_edit", { url: `${SETTINGS}#${HEAD}`, ops: [] }, { sensitive })).toBe(true)
    expect(asks("doc_edit", { url: `${SETTINGS}/modules/0`, ops: [] }, { sensitive })).toBe(true)
  })

  it("whatever has been granted", () => {
    const doc = fresh()
    doc.grants = { "doc_edit@*": "session" }
    expect(asks("doc_edit", { url: SETTINGS, ops: [] }, { sensitive, doc })).toBe(true)
  })

  it("but not a different document", () => {
    expect(isSensitive(generateAutomergeUrl(), sensitive)).toBe(false)
  })
})

/**
 * What the check makes of a reference, against one sensitive document. The
 * rule: a reference the repo's parser accepts is sensitive iff it names that
 * document, after trimming as the tools do; an automerge: reference it
 * rejects is sensitive, because what it opens depends on each tool; anything
 * else names no document; and with no sensitive documents nothing is.
 */
describe("sensitive or not, by rule", () => {
  const settings = generateAutomergeUrl()
  const other = generateAutomergeUrl()
  it.each([
    ["the document", settings, true],
    ["the document, padded with spaces", `  ${settings} `, true],
    ["the document, after a newline", `\n${settings}`, true],
    ["another document", other, false],
    ["another document, padded", ` ${other}`, false],
    ["an id that merely starts the same way", `${settings}X`, true],
    ["a made-up id", "automerge:settingsDoc", true],
    ["a made-up id, padded", " automerge:settingsDoc", true],
    ["an empty reference", "automerge:", true],
    ["upper case", "AUTOMERGE:settingsDoc", true],
    ["a web address", "https://example.com/", false],
    ["a path", "notes/today.md", false],
    ["nothing", null, false],
  ])("%s → %s", (_, target, expected) => {
    expect(isSensitive(target, [settings])).toBe(expected)
    expect(isSensitive(target, [])).toBe(false)
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
  const url = generateAutomergeUrl()
  const id = parseAutomergeUrl(url).documentId
  it.each([
    [` ${url}\n`, id],
    [`automerge:abc`, null], // the repo's parser rejects it, so it names no document
    [`automerge:`, null],
    ["https://example.com/", null],
    ["notes/today.md", null],
    ["  ", null],
    ["", null],
    [null, null],
  ])("%j -> %s", (url, id) => expect(documentIdOf(url)).toBe(id))
})

/**
 * Every way the repo will accept a name for one document. The repo opens any
 * of these, so the sensitive-document check has to see through all of them.
 */
function spellingsOf(url) {
  const { documentId, binaryDocumentId } = parseAutomergeUrl(url)
  const hex = [...binaryDocumentId].map((b) => b.toString(16).padStart(2, "0")).join("")
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  const head = encodeHeads(["ab".repeat(32)])[0]
  return {
    url,
    heads: `${url}#${head}`,
    path: `${url}/modules/0`,
    "path and heads": `${url}/modules/0#${head}`,
    "bare id": documentId,
    "legacy UUID": uuid,
  }
}

describe("a real document, however it is named", () => {
  const settings = generateAutomergeUrl()
  const account = generateAutomergeUrl()
  const unrelated = generateAutomergeUrl()

  for (const [form, spelling] of Object.entries(spellingsOf(settings))) {
    it(`canonicalises the ${form} to one id`, () => {
      expect(documentIdOf(spelling)).toBe(parseAutomergeUrl(settings).documentId)
    })

    it(`always asks about the ${form} of a sensitive document`, () => {
      expect(isSensitive(spelling, [settings, account])).toBe(true)
      expect(asks("doc_edit", { url: spelling, ops: [] }, { sensitive: [settings, account] })).toBe(true)
    })
  }

  it("does not ask about a different document in any spelling", () => {
    for (const spelling of Object.values(spellingsOf(unrelated))) {
      expect(isSensitive(spelling, [settings, account])).toBe(false)
    }
  })
})

describe("isCodePath", () => {
  it.each([
    ["tool/index.js", true], ["a/b/c.TSX", true], ["package.json", true], ["styles.css", true],
    ["notes.md", false], ["data.csv", false], ["README", false], [".env", false], ["folder/", false],
  ])("%s -> %s", (path, code) => expect(isCodePath(path)).toBe(code))
})
