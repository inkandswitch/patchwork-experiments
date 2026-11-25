import { describe, it, expect, vi } from "vitest"
import * as A from "@automerge/automerge"
import { editsBetween, editsOfChange, headsAt } from "./documents/history.js"

// The host's automerge and repo, supplied from node_modules instead of the importmap.
vi.mock("./host/import.js", () => ({
  hostImport: (name) =>
    name === "automerge" ? import("@automerge/automerge")
    : name === "repo" ? import("@automerge/automerge-repo")
    : Promise.reject(new Error(`no host module ${name} in tests`)),
}))

const { Repo, initSubduction } = await import("@automerge/automerge-repo")
await initSubduction()
const { docHistory } = await import("./tools/docs.js")

/** The edits made by the last change to `doc`. */
function lastEdits(doc) {
  const changes = A.getAllChanges(doc)
  return editsOfChange(A, doc, A.decodeChange(changes.at(-1)))
}

describe("editsOfChange: every edit carries the value it replaced", () => {
  it("overwriting a key", () => {
    let doc = A.from({ title: "Soup" })
    doc = A.change(doc, (d) => { d.title = "Leek Soup" })
    expect(lastEdits(doc)).toEqual([{ op: "set", path: ["title"], value: "Leek Soup", was: "Soup" }])
  })

  it("adding a key has no old value", () => {
    let doc = A.from({})
    doc = A.change(doc, (d) => { d.serves = 4 })
    expect(lastEdits(doc)).toEqual([{ op: "set", path: ["serves"], value: 4 }])
  })

  it("deleting a key keeps the whole subtree it removed", () => {
    let doc = A.from({ notes: { secret: "the combination is 1234", tags: ["a", "b"] } })
    doc = A.change(doc, (d) => { delete d.notes })
    const [edit] = lastEdits(doc)
    expect(edit.op).toBe("delete")
    expect(edit.path).toEqual(["notes"])
    expect(JSON.parse(JSON.stringify(edit.was))).toEqual({ secret: "the combination is 1234", tags: ["a", "b"] })
  })

  it("deleted text comes back as the characters that went", () => {
    let doc = A.from({ content: "remember the milk and the leeks" })
    doc = A.change(doc, (d) => { A.splice(d, ["content"], 13, 9) })
    expect(lastEdits(doc)).toEqual([{ op: "delete", path: ["content", 13], count: 9, was: "milk and " }])
  })

  // The case that rules out reading old values from the earlier version: in
  // one change, each patch's index is relative to the patches before it.
  it("several deletes in one change each report their own item, not a shifted one", () => {
    let doc = A.from({ items: ["a", "b", "c", "d", "e"] })
    doc = A.change(doc, (d) => { d.items.deleteAt(0); d.items.deleteAt(2) }) // a, then d
    const removed = lastEdits(doc).filter((e) => e.op === "delete").flatMap((e) => [e.was].flat())
    expect(removed.sort()).toEqual(["a", "d"])
    expect(doc.items).toEqual(["b", "c", "e"])
  })

  it("text edited in two places in one change", () => {
    let doc = A.from({ content: "one two three" })
    doc = A.change(doc, (d) => { A.splice(d, ["content"], 0, 4, ""); A.splice(d, ["content"], 4, 6, "") }) // "one ", then "three"
    const removed = lastEdits(doc).filter((e) => e.op === "delete").map((e) => e.was)
    expect(removed.sort()).toEqual(["one ", "three"])
  })

  it("an edit inside an inserted-then-shifted list item lands on the right item", () => {
    let doc = A.from({ items: [{ name: "x", n: 1 }] })
    doc = A.change(doc, (d) => { d.items.insertAt(0, { name: "new", n: 0 }); d.items[1].n = 2 })
    const set = lastEdits(doc).find((e) => e.op === "set" && e.path.at(-1) === "n" && e.value === 2)
    expect(set.was).toBe(1)
  })
})

describe("string assignments read as one edit", () => {
  it("pushing several strings at once", () => {
    let doc = A.from({ items: [] })
    doc = A.change(doc, (d) => { d.items.push("bread", "eggs") })
    expect(lastEdits(doc)).toEqual([{ op: "insert", path: ["items", 0], value: ["bread", "eggs"] }])
  })

  it("a new list item with several strings in it", () => {
    let doc = A.from({ items: [] })
    doc = A.change(doc, (d) => { d.items.push({ name: "Saffron rice", notes: "a pinch" }) })
    const edits = lastEdits(doc)
    expect(edits).toContainEqual({ op: "set", path: ["items", 0, "name"], value: "Saffron rice" })
    expect(edits).toContainEqual({ op: "set", path: ["items", 0, "notes"], value: "a pinch" })
    expect(edits.some((e) => e.op === "insert" && typeof e.value === "string")).toBe(false)
  })

  it("a new object with a string in it", () => {
    let doc = A.from({})
    doc = A.change(doc, (d) => { d.note = { text: "hi" } })
    const edits = lastEdits(doc)
    expect(edits).toContainEqual({ op: "set", path: ["note", "text"], value: "hi" })
    expect(edits.every((e) => e.value !== "")).toBe(true)
  })
})

describe("editsBetween: comparing two versions", () => {
  it("gives the net difference across many small changes", () => {
    let doc = A.from({ content: "" })
    const start = A.getHeads(doc)
    for (const ch of "hello") doc = A.change(doc, (d) => { A.splice(d, ["content"], d.content.length, 0, ch) })
    doc = A.change(doc, (d) => { d.done = true })
    const edits = editsBetween(A, doc, start, A.getHeads(doc))
    expect(edits.map((e) => e.op)).toEqual(expect.arrayContaining(["insert", "set"]))
    expect(edits.filter((e) => e.op === "insert").map((e) => e.value).join("")).toBe("hello")
  })
})

describe("headsAt", () => {
  it("is the document as of a moment", () => {
    let doc = A.from({ v: 0 }, { time: 1000 })
    doc = A.change(doc, { time: 2000 }, (d) => { d.v = 1 })
    doc = A.change(doc, { time: 3000 }, (d) => { d.v = 2 })
    expect(A.view(doc, headsAt(A, doc, new Date(2500 * 1000))).v).toBe(1)
    expect(A.view(doc, headsAt(A, doc, new Date(500 * 1000)))).toEqual({})
    expect(A.view(doc, headsAt(A, doc, new Date(9999 * 1000))).v).toBe(2)
  })
})

describe("doc_history", () => {
  async function shoppingList() {
    const repo = new Repo({ network: [] }) // no peers: offline, in memory
    const handle = repo.create({ items: ["bread", "eggs"] })
    handle.change((d) => { d.items.push("saffron") })
    handle.change((d) => { d.items.deleteAt(2) }) // the lost data
    for (let i = 0; i < 40; i++) handle.change((d) => { d.items.push(`thing ${i}`) }) // buries it
    const run = (input) => docHistory.execute(input, { repo, subject: handle.url }).then(JSON.parse)
    return { repo, handle, run }
  }

  it("lists recent changes newest first, with their edits", async () => {
    const { run } = await shoppingList()
    const out = await run({ limit: 2 })
    expect(out.totalChanges).toBe(43) // create, push, delete, 40 pushes
    expect(out.changes[0].edits[0]).toMatchObject({ op: "insert", value: "thing 39" })
    expect(out.skip).toBe(2)
  })

  it("finds when something was deleted, far past the default limit, with what it was", async () => {
    const { repo, run } = await shoppingList()
    const out = await run({ query: "saffron" })
    expect(out.changes).toHaveLength(2) // added, then removed
    const [removal, addition] = out.changes
    expect(removal.edits).toEqual([{ op: "delete", path: ["items", 2], count: 1, was: "saffron" }]) // short: no snippet
    expect(addition.edits[0]).toMatchObject({ op: "insert", value: "saffron" })
    // ...and the snapshot just before the deletion still has it.
    expect((await repo.find(removal.before)).doc().items).toContain("saffron")
  })

  it("quotes the match when the value is too long to show whole", async () => {
    const { handle, run } = await shoppingList()
    handle.change((d) => { d.essay = `${"filler ".repeat(100)}the needle${" filler".repeat(100)}` })
    handle.change((d) => { delete d.essay })
    const out = await run({ query: "needle", limit: 1 })
    expect(out.changes[0].edits[0].match).toMatch(/^was: …filler.*the needle.*…$/)
  })

  it("says where to continue when the scan budget runs out", async () => {
    const { run } = await shoppingList()
    const out = await run({ query: "saffron", scan: 10 })
    expect(out.changes).toHaveLength(0)
    expect(out.skip).toBe(10)
    const next = await run({ query: "saffron", skip: out.skip })
    expect(next.changes).toHaveLength(2)
  })

  it("compares a version from an earlier result against now", async () => {
    const { run } = await shoppingList()
    const { changes } = await run({ query: "saffron" })
    const out = await run({ from: changes[0].before, query: "saffron" })
    expect(out.changes).toEqual([expect.objectContaining({ op: "delete", was: "saffron" })])
  })

  it("rejects a document URL that names no version", async () => {
    const { handle, run } = await shoppingList()
    await expect(run({ from: handle.url })).rejects.toThrow(/no version/)
  })
})
