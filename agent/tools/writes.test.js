import { describe, it, expect } from "vitest"
import * as A from "@automerge/automerge"
import { applyOp, writeValue, OpError } from "../documents/ops.js"
import { docEdit } from "./docs.js"

const splice = A.splice
const set = (doc, path, key, value) => A.change(doc, (d) => { applyOp(d, { op: "set", path: [...path, key], value }, { spliceText: splice }) })
const plain = (doc) => JSON.parse(JSON.stringify(doc))
const changeCount = (doc) => A.getAllChanges(doc).length

/** How many ops the last change made: the size of the write. */
const lastOps = (doc) => A.decodeChange(A.getAllChanges(doc).at(-1)).ops.length

// Every pair of (what is there, what is asked for). The invariant under test is
// only that the result equals what was asked for — whatever the shapes.
const CASES = [
  ["same string", "hello", "hello"],
  ["string edit", "the cat sat", "the dog sat"],
  ["string to empty", "abc", ""],
  ["number", 1, 2],
  ["string to number", "1", 1],
  ["map to list", { a: 1 }, [1]],
  ["list to map", [1], { a: 1 }],
  ["null to map", null, { a: 1 }],
  ["map field changed", { a: 1, b: "x" }, { a: 2, b: "x" }],
  ["map field removed", { a: 1, b: 2 }, { a: 1 }],
  ["map field added", { a: 1 }, { a: 1, b: { c: [1] } }],
  ["nested text", { body: { text: "hello world" } }, { body: { text: "hello there world" } }],
  ["list append", [1, 2], [1, 2, 3]],
  ["list prepend", [1, 2], [0, 1, 2]],
  ["list insert middle", ["a", "c"], ["a", "b", "c"]],
  ["list delete middle", ["a", "b", "c"], ["a", "c"]],
  ["list emptied", [1, 2, 3], []],
  ["list from empty", [], [{ x: 1 }]],
  ["list reversed", [1, 2, 3], [3, 2, 1]],
  ["list of objects, one field", [{ id: 1, done: false }, { id: 2, done: false }], [{ id: 1, done: false }, { id: 2, done: true }]],
  ["list grows and changes", [{ n: "a" }, { n: "b" }], [{ n: "A" }, { n: "b" }, { n: "c" }]],
  ["list shrinks and changes", [{ n: "a" }, { n: "b" }, { n: "c" }], [{ n: "A" }]],
  ["nested lists", [[1, 2], [3]], [[1], [3, 4], []]],
  ["mixed list", [1, "two", { three: 3 }, [4]], ["two", { three: 33 }, [4, 5], null]],
]

describe("a set writes exactly the value asked for", () => {
  it.each(CASES)("%s", (_name, before, after) => {
    const doc = set(A.from({ v: before }), [], "v", after)
    expect(plain(doc).v).toEqual(after)
  })

  it.each(CASES)("%s — inside a list", (_name, before, after) => {
    const doc = A.change(A.from({ v: [before] }), (d) => { applyOp(d, { op: "set", path: ["v", 0], value: after }, { spliceText: splice }) })
    expect(plain(doc).v).toEqual([after])
  })

  it("writes nothing at all when nothing changed", () => {
    const doc = A.from({ v: { a: [1, { b: "c" }] } })
    const after = set(doc, [], "v", { a: [1, { b: "c" }] })
    expect(A.getHeads(after)).toEqual(A.getHeads(doc))
  })
})

describe("and writes only the difference", () => {
  it("one changed field of a big object is one op", () => {
    const big = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, `value ${i}`]))
    const doc = set(A.from({ v: big }), [], "v", { ...big, k7: "changed" })
    expect(lastOps(doc)).toBeLessThan(20) // a few chars spliced, not 50 keys rewritten
  })

  it("a counter is incremented, not overwritten", () => {
    const doc = set(A.from({ c: new A.Counter(3) }), [], "c", 5)
    expect(doc.c).toBeInstanceOf(A.Counter)
    expect(doc.c.value).toBe(5)
  })
})

// The reason for all this: a whole-value write loses other people's edits.
describe("concurrent edits survive a whole-value set", () => {
  it("someone else's push survives the agent rewriting one item", () => {
    const base = A.from({ items: [{ id: 1, done: false }, { id: 2, done: false }] })
    const theirs = A.change(A.clone(base), (d) => { d.items.push({ id: 3, done: false }) })
    const ours = set(A.clone(base), [], "items", [{ id: 1, done: true }, { id: 2, done: false }])
    expect(plain(A.merge(ours, theirs)).items).toEqual([{ id: 1, done: true }, { id: 2, done: false }, { id: 3, done: false }])
  })

  it("someone else's typing survives the agent setting the whole text", () => {
    const base = A.from({ body: "the cat sat on the mat" })
    const theirs = A.change(A.clone(base), (d) => { A.splice(d, ["body"], 22, 0, ", happily") })
    const ours = set(A.clone(base), [], "body", "the dog sat on the mat")
    expect(A.merge(ours, theirs).body).toBe("the dog sat on the mat, happily")
  })

  it("someone else's field survives the agent setting the whole object", () => {
    const base = A.from({ card: { title: "a", notes: "" } })
    const theirs = A.change(A.clone(base), (d) => { d.card.owner = "sam" })
    const ours = set(A.clone(base), [], "card", { title: "b", notes: "" })
    expect(plain(A.merge(ours, theirs)).card).toEqual({ title: "b", notes: "", owner: "sam" })
  })

  it("concurrent counter updates add up", () => {
    const base = A.from({ c: new A.Counter(0) })
    const theirs = A.change(A.clone(base), (d) => { d.c.increment(1) })
    const ours = set(A.clone(base), [], "c", 1)
    expect(A.merge(ours, theirs).c.value).toBe(2)
  })
})

describe("out-of-range edits say how big the thing is", () => {
  const doc = () => A.from({ items: ["a", "b"], body: "abc" })
  const attempt = (op) => () => A.change(doc(), (d) => { applyOp(d, op, { spliceText: splice }) })

  it("setting past the end of a list", () => {
    expect(attempt({ op: "set", path: ["items", 5], value: "x" })).toThrow(/\/items\/5 is past the end of \/items, which has 2 items\. To add one, append, or insert at index 2\./)
  })
  it("inserting past the end of a list", () => {
    expect(attempt({ op: "insert", path: ["items", 3], value: "x" })).toThrow(/index 3 is past the end of \/items, which has 2 items: insert at 0–2, or append\./)
  })
  it("deleting what is not there", () => {
    expect(attempt({ op: "delete", path: ["items", 2] })).toThrow(/\/items\/2 does not exist: \/items has 2 items \(0–1\)\. Nothing to delete\./)
  })
})

describe("doc_edit and source code", () => {
  const ctxFor = (doc) => ({
    repo: { async find(url) { return { url, doc: () => doc, change: (fn) => fn(doc) } } },
    subject: "automerge:x",
  })

  it.each([
    ["a code file", { name: "index.js", content: "export {}" }, /source file index\.js.*fs_edit/],
    ["a package folder", { docs: [{ name: "package.json", type: "file", url: "automerge:p" }] }, /package folder/],
    ["a pushwork package", { "@patchwork": { type: "directory" }, "package.json": "automerge:p" }, /a package/],
  ])("refuses %s and points at the file tools", async (_name, doc, message) => {
    await expect(docEdit.execute({ ops: [{ op: "set", path: ["x"], value: 1 }] }, ctxFor(doc))).rejects.toThrow(message)
  })

  it("edits prose and data files", async () => {
    const doc = { name: "notes.md", content: "hi" }
    await docEdit.execute({ ops: [{ op: "set", path: ["content"], value: "hello" }] }, ctxFor(doc))
    expect(doc.content).toBe("hello")
  })
})
