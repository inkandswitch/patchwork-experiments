import { describe, it, expect } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { applyOp, applyOps, editText, splitLines, textDiff, plain, OpError } from "./tools/ops.js"
import { docEdit } from "./tools/docs.js"

await initSubduction()

// Every op, on every kind of target, against a real automerge document. Each
// cell of the table says what the target holds afterwards, or the error.

const TEXT = "one two\nthree\n"

const fixture = () =>
  A.from({
    s: TEXT,
    im: new A.ImmutableString(TEXT),
    lines: ["one two\n", "three\n"],
    list: [1, 2],
    map: { a: 1 },
  })

/** What a target holds, with its form: text forms are told apart. */
function held(doc, key) {
  const value = doc[key]
  if (value === undefined) return { gone: true }
  if (A.isImmutableString(value)) return { immutable: String(value) }
  return { value: JSON.parse(JSON.stringify(value)) }
}

const TARGETS = ["s", "im", "lines", "list", "map", "none"]

// One row per op: [name, op for a target key, outcome per target].
// An outcome is { value }, { immutable }, { gone }, or a RegExp the error matches.
const notText = (kind) => new RegExp(`/\\w+ is ${kind}, not text`)
const ROWS = [
  [
    "set value",
    (key) => ({ op: "set", path: [key], value: "X" }),
    { s: { value: "X" }, im: { value: "X" }, lines: { value: "X" }, list: { value: "X" }, map: { value: "X" }, none: { value: "X" } },
  ],
  [
    "set text",
    (key) => ({ op: "set", path: [key], text: "X\n" }),
    {
      s: { value: "X\n" },
      im: { immutable: "X\n" },
      lines: { value: ["X\n"] },
      list: notText("a list of 2 items"),
      map: notText("a map"),
      none: { value: "X\n" },
    },
  ],
  [
    "delete",
    (key) => ({ op: "delete", path: [key] }),
    { s: { gone: true }, im: { gone: true }, lines: { gone: true }, list: { gone: true }, map: { gone: true }, none: /\/none does not exist.*Nothing to delete/ },
  ],
  [
    "insert value",
    (key) => ({ op: "insert", path: [key, 0], value: 0 }),
    {
      s: /\/s is text, so it has no 0/,
      im: /\/im is text \(an ImmutableString\), so it has no 0/,
      lines: { value: [0, "one two\n", "three\n"] },
      list: { value: [0, 1, 2] },
      map: /\/map is a map, not a list/,
      none: /\/none does not exist/,
    },
  ],
  [
    "insert text after",
    (key) => ({ op: "insert", path: [key], after: "two", text: "!" }),
    {
      s: { value: "one two!\nthree\n" },
      im: { immutable: "one two!\nthree\n" },
      lines: { value: ["one two!\n", "three\n"] },
      list: notText("a list of 2 items"),
      map: notText("a map"),
      none: /\/none does not exist/,
    },
  ],
  [
    "insert text before",
    (key) => ({ op: "insert", path: [key], before: "three", text: "2.5\n" }),
    {
      s: { value: "one two\n2.5\nthree\n" },
      im: { immutable: "one two\n2.5\nthree\n" },
      lines: { value: ["one two\n", "2.5\n", "three\n"] },
      list: notText("a list of 2 items"),
      map: notText("a map"),
      none: /\/none does not exist/,
    },
  ],
  [
    "append value",
    (key) => ({ op: "append", path: [key], value: 3 }),
    {
      s: /\/s is text, not a list\. To add text to it, give `text`/,
      im: /\/im is text \(an ImmutableString\), not a list\. To add text/,
      lines: { value: ["one two\n", "three\n", 3] },
      list: { value: [1, 2, 3] },
      map: /\/map is a map, not a list\.$/,
      none: { value: [3] },
    },
  ],
  [
    "append text",
    (key) => ({ op: "append", path: [key], text: "four\n" }),
    {
      s: { value: `${TEXT}four\n` },
      im: { immutable: `${TEXT}four\n` },
      lines: { value: ["one two\n", "three\n", "four\n"] },
      list: /a list of 2 items, not text\. To add an item to a list, give `value`/,
      map: notText("a map"),
      none: { value: "four\n" },
    },
  ],
  [
    "prepend value",
    (key) => ({ op: "prepend", path: [key], value: 0 }),
    {
      s: /not a list/,
      im: /not a list/,
      lines: { value: [0, "one two\n", "three\n"] },
      list: { value: [0, 1, 2] },
      map: /not a list/,
      none: { value: [0] },
    },
  ],
  [
    "prepend text",
    (key) => ({ op: "prepend", path: [key], text: "zero\n" }),
    {
      s: { value: `zero\n${TEXT}` },
      im: { immutable: `zero\n${TEXT}` },
      lines: { value: ["zero\n", "one two\n", "three\n"] },
      list: notText("a list of 2 items"),
      map: notText("a map"),
      none: { value: "zero\n" },
    },
  ],
  [
    "replace",
    (key) => ({ op: "replace", path: [key], find: "two", text: "2" }),
    {
      s: { value: "one 2\nthree\n" },
      im: { immutable: "one 2\nthree\n" },
      lines: { value: ["one 2\n", "three\n"] },
      list: notText("a list of 2 items"),
      map: notText("a map"),
      none: /\/none does not exist/,
    },
  ],
  [
    "replace all",
    (key) => ({ op: "replace", path: [key], find: "e", text: "E", all: true }),
    {
      s: { value: "onE two\nthrEE\n" },
      im: { immutable: "onE two\nthrEE\n" },
      lines: { value: ["onE two\n", "thrEE\n"] },
      list: notText("a list of 2 items"),
      map: notText("a map"),
      none: /\/none does not exist/,
    },
  ],
  [
    "test what is there",
    (key) => ({ op: "test", path: [key], value: { s: TEXT, im: TEXT, lines: ["one two\n", "three\n"], list: [1, 2], map: { a: 1 } }[key] ?? "anything" }),
    {
      s: { value: TEXT },
      im: { immutable: TEXT },
      lines: { value: ["one two\n", "three\n"] },
      list: { value: [1, 2] },
      map: { value: { a: 1 } },
      none: /test failed: \/none does not exist/,
    },
  ],
]

describe("every op on every kind of target", () => {
  for (const [name, opFor, outcomes] of ROWS) {
    describe(name, () => {
      it.each(TARGETS)("on %s", (key) => {
        const outcome = outcomes[key]
        const attempt = () => A.change(fixture(), (d) => { applyOp(d, opFor(key), { spliceText: A.splice }) })
        if (outcome instanceof RegExp) {
          expect(attempt).toThrow(OpError)
          expect(attempt).toThrow(outcome)
        } else {
          expect(held(attempt(), key)).toEqual(outcome)
        }
      })
    })
  }

  it("covers every op and every target", () => {
    const covered = new Set(ROWS.map(([, opFor]) => opFor("s").op))
    expect([...covered].sort()).toEqual(["append", "delete", "insert", "prepend", "replace", "set", "test"])
    for (const [, , outcomes] of ROWS) expect(Object.keys(outcomes).sort()).toEqual([...TARGETS].sort())
  })
})

// ---------------------------------------------------------------- errors

describe("each error says what to do", () => {
  const attempt = (op, doc = fixture()) => () => A.change(doc, (d) => { applyOp(d, op, { spliceText: A.splice }) })

  it.each([
    ["not an object", "set", /each op must be an object/],
    ["no op", { path: ["s"], value: 1 }, /missing `op`: say which, one of set, delete, insert, append, prepend, replace, test/],
    ["an unknown op", { op: "move", path: ["s"] }, /unknown op "move"/],
    ["a path that is not a list", { op: "set", path: "title", value: 1 }, /`path` must be a list of keys and indices/],
    ["a path step that is neither key nor index", { op: "set", path: [{}], value: 1 }, /path steps are keys \(strings\) or indices \(numbers\)/],
    ["the old range", { op: "set", path: [], range: "title", value: 1 }, /set takes no `range`\. There is no range: `path` names the thing itself/],
    ["old/new on replace", { op: "replace", path: ["s"], old: "a", new: "b" }, /replace takes no `old`\. Use replace with `find` and `text`/],
    ["value on replace", { op: "replace", path: ["s"], find: "two", value: "2" }, /replace takes no `value`\. This op works on text: give `text`/],
    ["text on test", { op: "test", path: ["s"], text: "x" }, /test takes no `text`/],
    ["set with neither", { op: "set", path: ["s"] }, /set takes `value` \(any value\) or `text`/],
    ["set with both", { op: "set", path: ["s"], value: "a", text: "b" }, /set takes `value` \(any value\) or `text`/],
    ["text that is not a string", { op: "append", path: ["s"], text: 3 }, /`text` must be a string; for any other value use `value`/],
    ["text and from", { op: "append", path: ["s"], text: "a", from: { path: ["s"] } }, /give `text` or `from`, not both/],
    ["a from without a path", { op: "append", path: ["s"], from: { url: "automerge:x" } }, /`from` must be \{ path, url\? \}/],
    ["replacing the root", { op: "set", path: [], value: {} }, /refusing to replace the whole document/],
    ["deleting the root", { op: "delete", path: [] }, /refusing to delete the whole document/],
    ["inserting text with no anchor", { op: "insert", path: ["s"], text: "x" }, /inserting text takes `before` or `after`/],
    ["inserting text with two anchors", { op: "insert", path: ["s"], text: "x", before: "a", after: "b" }, /inserting text takes `before` or `after` \(one of them\)/],
    ["an anchor with a value", { op: "insert", path: ["list", 0], value: 1, after: "x" }, /`after` anchors text: give `text`, not `value`/],
    ["insert with nothing", { op: "insert", path: ["list", 0] }, /insert takes `value`/],
    ["append with both", { op: "append", path: ["list"], value: 1, text: "x" }, /append takes `value` \(an item, for a list\) or `text`/],
    ["replace without find", { op: "replace", path: ["s"], text: "x" }, /replace takes `find`/],
    ["all that is not a boolean", { op: "replace", path: ["s"], find: "e", text: "E", all: "yes" }, /`all` is true or false/],
    ["test without value", { op: "test", path: ["s"] }, /test takes `value`/],
    ["find not there", { op: "replace", path: ["s"], find: "four", text: "4" }, /`find` text not found\. Read the text again and copy the anchor exactly/],
    ["find whose first line is there", { op: "replace", path: ["s"], find: "three\nfour", text: "x" }, /first line does appear \(line 2\), so the rest differs/],
    ["find more than once", { op: "replace", path: ["s"], find: "e", text: "E" }, /`find` text occurs 3 times \(lines 1, 2\)\. Include more of the text around it so it matches one place, or pass all: true\./],
    ["find the same as text", { op: "replace", path: ["s"], find: "two", text: "two" }, /`find` and `text` are the same/],
    ["an anchor more than once", { op: "insert", path: ["s"], after: "e", text: "x" }, /`after` text occurs 3 times \(lines 1, 2\)\. Include more of the text around it so it matches one place\.$/],
    ["a test that fails", { op: "test", path: ["list", 0], value: 5 }, /test failed: \/list\/0 is 1, not 5\. It changed since you read it: read it again and decide afresh\./],
    ["a path through a missing key", { op: "set", path: ["nope", "x"], value: 1 }, /\/nope does not exist: the document root has im, lines, list, map, s\./],
    ["a path through text", { op: "set", path: ["s", "x"], value: 1 }, /\/s is text, so it has no "x"/],
    ["a list index that is not a number", { op: "set", path: ["list", "first"], value: 1 }, /\/list\/first: a list takes a whole-number index, not "first"/],
    ["setting past the end of a list", { op: "set", path: ["list", 2], value: 3 }, /\/list\/2 is past the end of \/list, which has 2 items\. To add one, append, or insert at index 2\./],
    ["inserting past the end of a list", { op: "insert", path: ["list", 3], value: 3 }, /index 3 is past the end of \/list, which has 2 items: insert at 0–2, or append\./],
    ["text ops on the root", { op: "append", path: [], text: "x" }, /the document root is a map, not text/],
    ["list ops on the root", { op: "append", path: [], value: 1 }, /the document root is a map, not a list/],
    ["inserting into the root", { op: "insert", path: [], value: 1 }, /insert's path ends at a list index/],
    ["text from something that is not text", { op: "set", path: ["s"], from: { path: ["map"] } }, /from \/map: it is a map, not text/],
    ["text from a missing path", { op: "set", path: ["s"], from: { path: ["nope"] } }, /from \/nope: \/nope does not exist/],
    ["text from another document, without a reader", { op: "set", path: ["s"], from: { url: "automerge:x", path: ["s"] } }, /this edit cannot read other documents/],
  ])("%s", (_name, op, message) => {
    expect(attempt(op)).toThrow(OpError)
    expect(attempt(op)).toThrow(message)
  })

  it("takes text from bytes only when they are UTF-8", () => {
    const doc = () => A.from({ s: "", ok: new Uint8Array([104, 105]), bad: new Uint8Array([0xff, 0xfe]) })
    expect(held(A.change(doc(), (d) => { applyOp(d, { op: "set", path: ["s"], from: { path: ["ok"] } }) }), "s")).toEqual({ value: "hi" })
    expect(attempt({ op: "set", path: ["s"], from: { path: ["bad"] } }, doc())).toThrow(/from \/bad: those bytes are not UTF-8 text/)
  })

  it("names the op that failed, by its place and path", () => {
    expect(() => applyOps({ s: "x" }, [{ op: "set", path: ["t"], value: 1 }, { op: "replace", path: ["s"], find: "y", text: "z" }])).toThrow(
      /^op 2 \(replace \/s\): `find` text not found/
    )
  })

  it("treats null in an unused field as absent, as models send it", () => {
    const doc = { s: "one two" }
    applyOp(doc, { op: "replace", path: ["s"], find: "two", text: "2", all: null, before: null, after: null, from: null, value: null })
    expect(doc.s).toBe("one 2")
    applyOp(doc, { op: "delete", path: ["s"], value: null, text: null })
    expect(doc).toEqual({})
  })

  it("still sets null when null is the value", () => {
    const doc = { a: 1 }
    applyOp(doc, { op: "set", path: ["a"], value: null })
    expect(doc).toEqual({ a: null })
  })
})

// ---------------------------------------------------------------- all or nothing

/** A real document handle, which keeps its state across changes as a session's does. */
async function handleOf(initial) {
  const repo = new Repo({ network: [] })
  const handle = repo.create(initial)
  return { repo, handle, ctx: { repo, splice: A.splice } }
}

describe("all the ops of one call, or none", () => {
  it("leaves the document exactly as it was when any op fails", async () => {
    const { handle, ctx } = await handleOf({ s: TEXT, list: [1, 2], map: { a: 1 } })
    const heads = A.getHeads(handle.doc())
    const ops = [
      { op: "set", path: ["map", "a"], value: 2 },
      { op: "append", path: ["s"], text: "four\n" },
      { op: "delete", path: ["list", 0] },
      { op: "replace", path: ["s"], find: "not there", text: "x" },
    ]
    await expect(docEdit.execute({ url: handle.url, ops }, ctx)).rejects.toThrow(
      /^op 4 \(replace \/s\): `find` text not found\. .* Nothing was changed: the ops apply together or not at all\.$/
    )
    expect(A.getHeads(handle.doc())).toEqual(heads)
    expect(JSON.parse(JSON.stringify(handle.doc()))).toEqual({ s: TEXT, list: [1, 2], map: { a: 1 } })
  })

  it("makes one change when they all succeed, and says what each did", async () => {
    const { handle, ctx } = await handleOf({ title: "Soup", list: [1, 2], map: { a: 1 } })
    const before = A.getAllChanges(handle.doc()).length
    const out = await docEdit.execute(
      {
        url: handle.url,
        ops: [
          { op: "test", path: ["map", "a"], value: 1 },
          { op: "set", path: ["map", "a"], value: 2 },
          { op: "append", path: ["list"], value: 3 },
        ],
      },
      ctx
    )
    expect(A.getAllChanges(handle.doc())).toHaveLength(before + 1)
    expect(out).toBe(`Edited "Soup" (${handle.url}) in one change:\ntest /map/a: ok\nset /map/a: 1 → 2\nappend /list/2: 3; the list now has 3 items`)
  })

  it("lets a test guard what follows it", async () => {
    const { handle, ctx } = await handleOf({ list: [1, 2] })
    const ops = [{ op: "test", path: ["list", 0], value: 9 }, { op: "delete", path: ["list", 0] }]
    await expect(docEdit.execute({ url: handle.url, ops }, ctx)).rejects.toThrow(/op 1 \(test \/list\/0\): test failed/)
    expect(JSON.parse(JSON.stringify(handle.doc().list))).toEqual([1, 2])
  })

  it("runs ops in order, each seeing what the ones before it did", () => {
    const doc = A.change(fixture(), (d) => {
      applyOps(d, [
        { op: "set", path: ["notes"], text: "first\n" },
        { op: "append", path: ["notes"], text: "second\n" },
        { op: "replace", path: ["notes"], find: "first", text: "1st" },
        { op: "set", path: ["copy"], from: { path: ["notes"] } },
      ], { spliceText: A.splice })
    })
    expect(doc.notes).toBe("1st\nsecond\n")
    expect(doc.copy).toBe("1st\nsecond\n")
  })
})

// ---------------------------------------------------------------- from

describe("text from another document", () => {
  it("copies a file's text into a notebook cell, in the cell's form", async () => {
    const { repo, handle, ctx } = await handleOf({ cells: [{ source: ["# generated\n", "old = 1\n"] }] })
    const exported = repo.create({ "@patchwork": { type: "file" }, name: "assumptions.py", content: "a = 1\nb = 2\n" })
    const out = await docEdit.execute({ url: handle.url, ops: [{ op: "set", path: ["cells", 0, "source"], from: { url: exported.url, path: ["content"] } }] }, ctx)
    expect(JSON.parse(JSON.stringify(handle.doc().cells[0].source))).toEqual(["a = 1\n", "b = 2\n"])
    expect(out).toContain("set /cells/0/source (a list of lines):")
  })

  it("restores text from an earlier version, writing only what differs", async () => {
    const { handle, ctx } = await handleOf({ body: "the cat sat on the mat" })
    const { stringifyAutomergeUrl, encodeHeads } = await import("@automerge/automerge-repo")
    const version = stringifyAutomergeUrl({ documentId: handle.documentId, heads: encodeHeads(A.getHeads(handle.doc())) })
    handle.change((d) => { A.splice(d, ["body"], 4, 3, "dog") })
    await docEdit.execute({ url: handle.url, ops: [{ op: "set", path: ["body"], from: { url: version, path: ["body"] } }] }, ctx)
    expect(handle.doc().body).toBe("the cat sat on the mat")
  })

  it("says which document it could not read, and changes nothing", async () => {
    const { handle, ctx } = await handleOf({ body: "x" })
    const missing = { ...ctx, repo: { find: async (url) => (url === handle.url ? handle : { doc: () => undefined }) } }
    await expect(
      docEdit.execute({ url: handle.url, ops: [{ op: "append", path: ["body"], from: { url: "automerge:gone", path: ["content"] } }] }, missing)
    ).rejects.toThrow(/op 1 \(append \/body\): from automerge:gone: Document automerge:gone could not be loaded\. Nothing was changed\./)
  })
})

// ---------------------------------------------------------------- mergeable

describe("text edits stay small, so they merge", () => {
  it("a replace in a string splices only the characters that differ", () => {
    const base = A.from({ s: "the cat sat on the mat" })
    const ours = A.change(A.clone(base), (d) => { applyOp(d, { op: "replace", path: ["s"], find: "cat sat", text: "dog sat" }, { spliceText: A.splice }) })
    const theirs = A.change(A.clone(base), (d) => { A.splice(d, ["s"], 22, 0, ", happily") })
    expect(A.merge(ours, theirs).s).toBe("the dog sat on the mat, happily")
    // A whole rewrite would delete and insert all 22 characters.
    expect(A.decodeChange(A.getAllChanges(ours).at(-1)).ops.length).toBeLessThan(12)
  })

  it("an edit to a list of lines changes only the lines that differ", () => {
    const base = A.from({ source: ["a = 1\n", "b = 2\n", "c = 3\n"] })
    const ours = A.change(A.clone(base), (d) => { applyOp(d, { op: "replace", path: ["source"], find: "b = 2", text: "b = 20" }, { spliceText: A.splice }) })
    const theirs = A.change(A.clone(base), (d) => { A.splice(d, ["source", 2], 4, 1, "30") })
    expect(JSON.parse(JSON.stringify(A.merge(ours, theirs).source))).toEqual(["a = 1\n", "b = 20\n", "c = 30\n"])
  })

  it("appending pieces of a long text adds to it, never rewrites it", () => {
    const pieces = Array.from({ length: 5 }, (_, i) => `piece ${i}\n`.repeat(200))
    let doc = A.from({ cells: [{ source: "" }] })
    for (const piece of pieces) {
      doc = A.change(doc, (d) => { applyOp(d, { op: "append", path: ["cells", 0, "source"], text: piece }, { spliceText: A.splice }) })
    }
    expect(doc.cells[0].source).toBe(pieces.join(""))
    // Each piece inserted its own characters and deleted none.
    for (const change of A.getAllChanges(doc).slice(1)) {
      expect(A.decodeChange(change).ops.every((op) => op.action !== "del")).toBe(true)
    }
  })
})

// ---------------------------------------------------------------- copies

describe("values are written as fresh copies", () => {
  it("an object read from the same document can be set somewhere else", () => {
    const doc = A.change(fixture(), (d) => {
      applyOp(d, { op: "set", path: ["copy"], value: d.map })
      applyOp(d, { op: "append", path: ["list"], value: d.map })
      applyOp(d, { op: "insert", path: ["lines", 0], value: d.list })
    })
    expect(held(doc, "copy")).toEqual({ value: { a: 1 } })
    expect(held(doc, "list")).toEqual({ value: [1, 2, { a: 1 }] })
    expect(held(doc, "lines").value[0]).toEqual([1, 2, { a: 1 }])
  })

  it("an object read from another document can be set here", () => {
    const other = A.from({ entry: { name: "x", tags: ["a"], count: new A.Counter(2), note: new A.ImmutableString("n") } })
    const doc = A.change(fixture(), (d) => { applyOp(d, { op: "set", path: ["entry"], value: other.entry }) })
    expect(JSON.parse(JSON.stringify(doc.entry))).toEqual({ name: "x", tags: ["a"], count: 2, note: "n" })
    expect(doc.entry.count).toBeInstanceOf(A.Counter)
    expect(A.isImmutableString(doc.entry.note)).toBe(true)
  })

  it("plain() leaves nothing of the document behind", () => {
    const doc = A.from({ m: { list: [1, { d: new Date(5) }], bytes: new Uint8Array([1, 2]) } })
    const copy = plain(doc.m)
    expect(copy).toEqual({ list: [1, { d: new Date(5) }], bytes: new Uint8Array([1, 2]) })
    expect(copy.bytes).not.toBe(doc.m.bytes)
  })
})

// ---------------------------------------------------------------- what it says

describe("each op says what it did", () => {
  const report = (op, doc = fixture()) => {
    let said
    A.change(doc, (d) => { said = applyOp(d, op, { spliceText: A.splice }) })
    return said
  }

  it.each([
    ["a value set", { op: "set", path: ["map", "a"], value: 2 }, "set /map/a: 1 → 2"],
    ["a new field", { op: "set", path: ["map", "b"], value: [1] }, "set /map/b: [1] (new)"],
    ["a set that changes nothing", { op: "set", path: ["map", "a"], value: 1 }, "set /map/a: already 1, nothing written"],
    ["a text set", { op: "set", path: ["s"], value: "one 2\nthree\n" }, "set /s:\n  line 1:\n  - one two\n  + one 2"],
    ["a delete", { op: "delete", path: ["map"] }, 'delete /map (was {"a":1})'],
    ["an insert", { op: "insert", path: ["list", 1], value: 9 }, "insert /list/1: 9; the list now has 3 items"],
    ["an append", { op: "append", path: ["list"], value: { b: 2 } }, 'append /list/2: {"b":2}; the list now has 3 items'],
    ["a prepend", { op: "prepend", path: ["list"], value: 0 }, "prepend /list/0: 0; the list now has 3 items"],
    ["a test", { op: "test", path: ["list"], value: [1, 2] }, "test /list: ok"],
    ["a replace", { op: "replace", path: ["s"], find: "two", text: "2" }, "replace /s:\n  line 1:\n  - one two\n  + one 2"],
    [
      "a replace in many places",
      { op: "replace", path: ["s"], find: "e", text: "E", all: true },
      "replace /s: 3 places (lines 1, 2)\n  line 1:\n  - one two\n  + onE two\n  line 2:\n  - three\n  + thrEE",
    ],
    ["a line inserted", { op: "insert", path: ["lines"], before: "three", text: "2.5\n" }, "insert /lines (a list of lines):\n  line 2:\n  + 2.5"],
    ["an ImmutableString edit", { op: "append", path: ["im"], text: "four\n" }, "append /im (an ImmutableString, written anew): +5 chars; now 3 lines, 19 chars\n  line 3:\n  + four"],
    ["new text", { op: "append", path: ["notes"], text: "a\nb" }, "append /notes: new text, 3 chars in 2 lines"],
    ["text already so", { op: "set", path: ["s"], text: TEXT }, "set /s: the text is already so, nothing written"],
  ])("%s", (_name, op, expected) => {
    expect(report(op)).toBe(expected)
  })

  it("keeps the start and the end of a long change", () => {
    const piece = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n") + "\n"
    expect(report({ op: "append", path: ["s"], text: piece })).toBe(
      [
        `append /s: +${piece.length} chars; now 52 lines, ${TEXT.length + piece.length} chars`,
        "  line 3:",
        "  + line 0",
        "  + line 1",
        "  + line 2",
        "  + line 3",
        "  + … 45 more lines",
        "  + line 49",
      ].join("\n")
    )
  })
})

// ---------------------------------------------------------------- the text primitives

describe("editText and its parts", () => {
  it("splits text into lines that join back exactly", () => {
    for (const text of ["", "a", "a\n", "a\nb", "a\nb\n", "\n\n", "x\n\ny"]) expect(splitLines(text).join("")).toBe(text)
    expect(splitLines("a\nb")).toEqual(["a\n", "b"])
    expect(splitLines("")).toEqual([])
  })

  it("works out each text op as splices", () => {
    expect(editText("a b a", { op: "replace", find: "a", text: "c", all: true })).toEqual({
      after: "c b c",
      splices: [{ from: 0, to: 1, inserted: "c" }, { from: 4, to: 5, inserted: "c" }],
    })
    expect(editText("ab", { op: "insert", after: "a", text: "-" }).after).toBe("a-b")
    expect(editText("ab", { op: "insert", before: "a", text: "-" }).after).toBe("-ab")
    expect(editText("ab", { op: "append", text: "c" }).after).toBe("abc")
    expect(editText("ab", { op: "prepend", text: "c" }).after).toBe("cab")
    expect(() => editText("ab", { op: "set", text: "c" })).toThrow(/set is not a text edit/)
  })

  it("does not let replace-all match overlapping text twice", () => {
    expect(editText("aaaa", { op: "replace", find: "aa", text: "b", all: true }).after).toBe("bb")
  })

  it("diffs a change into the lines it touched", () => {
    const before = "a\nb\nc\n"
    const { after, splices } = editText(before, { op: "replace", find: "b\n", text: "" })
    expect(textDiff(before, after, splices)).toEqual(["  line 2:", "  - b"])
  })
})
