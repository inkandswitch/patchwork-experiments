import { describe, it, expect } from "vitest"
import { applyOp, applyOps, OpError } from "./tools/ops.js"

describe("applyOp — assign and delete by key", () => {
  it("sets a key on the root", () => {
    const doc = { title: "old" }
    applyOp(doc, { path: [], range: "title", value: "new" })
    expect(doc.title).toBe("new")
  })

  it("sets a key on a nested map", () => {
    const doc = { config: { model: "a" } }
    applyOp(doc, { path: ["config"], range: "model", value: "b" })
    expect(doc.config.model).toBe("b")
  })

  it("deletes a key when no value is given", () => {
    const doc = { a: 1, b: 2 }
    applyOp(doc, { path: [], range: "b" })
    expect(doc).toEqual({ a: 1 })
  })

  it("removes a list element by index when no value is given", () => {
    const doc = { items: ["x", "y", "z"] }
    applyOp(doc, { path: ["items"], range: 1 })
    expect(doc.items).toEqual(["x", "z"])
  })

  it("refuses to set a key on a non-container", () => {
    const doc = { title: "hello" }
    expect(() => applyOp(doc, { path: ["title"], range: "x", value: 1 })).toThrow(OpError)
  })
})

describe("applyOp — splice", () => {
  it("splices text in the middle of a string", () => {
    const doc = { body: "hello world" }
    applyOp(doc, { path: ["body"], range: [6, 11], value: "there" })
    expect(doc.body).toBe("hello there")
  })

  it("inserts text without deleting when from === to", () => {
    const doc = { body: "ac" }
    applyOp(doc, { path: ["body"], range: [1, 1], value: "b" })
    expect(doc.body).toBe("abc")
  })

  it("deletes text when value is omitted", () => {
    const doc = { body: "abcdef" }
    applyOp(doc, { path: ["body"], range: [1, 3] })
    expect(doc.body).toBe("adef")
  })

  it("uses the injected splice for text when one is provided", () => {
    const doc = { body: "ac" }
    const calls = []
    applyOp(
      doc,
      { path: ["body"], range: [1, 1], value: "b" },
      {
        spliceText: (draft, path, index, del, ins) => {
          calls.push({ path, index, del, ins })
          draft.body = draft.body.slice(0, index) + ins + draft.body.slice(index + del)
        },
      }
    )
    expect(calls).toEqual([{ path: ["body"], index: 1, del: 0, ins: "b" }])
    expect(doc.body).toBe("abc")
  })

  it("appends to a list", () => {
    const doc = { items: [1, 2] }
    applyOp(doc, { path: ["items"], range: [2, 2], value: 3 })
    expect(doc.items).toEqual([1, 2, 3])
  })

  it("replaces a range of list items", () => {
    const doc = { items: [1, 2, 3, 4] }
    applyOp(doc, { path: ["items"], range: [1, 3], value: ["x"] })
    expect(doc.items).toEqual([1, "x", 4])
  })

  it("explains itself when the target cannot be spliced", () => {
    const doc = { count: 5 }
    expect(() => applyOp(doc, { path: ["count"], range: [0, 1], value: "x" })).toThrow(/not a string or list/)
  })

  it("names the missing path rather than throwing a TypeError", () => {
    const doc = {}
    expect(() => applyOp(doc, { path: ["nope"], range: [0, 0], value: "x" })).toThrow(/missing/)
  })
})

describe("applyOp — assign a whole node", () => {
  it("replaces the node at a path", () => {
    const doc = { a: { b: 1 } }
    applyOp(doc, { path: ["a"], value: { c: 2 } })
    expect(doc.a).toEqual({ c: 2 })
  })

  it("refuses to replace the document root", () => {
    expect(() => applyOp({}, { path: [], value: { a: 1 } })).toThrow(/document root/)
  })
})

describe("validation", () => {
  it("rejects a backwards splice range", () => {
    expect(() => applyOp({ s: "abc" }, { path: ["s"], range: [3, 1], value: "" })).toThrow(/precedes/)
  })

  it("rejects a non-array path", () => {
    expect(() => applyOp({}, { path: "title", value: 1 })).toThrow(/path must be an array/)
  })
})

describe("applyOps", () => {
  it("applies in order and reports each", () => {
    const doc = { items: [], title: "" }
    const done = applyOps(doc, [
      { path: [], range: "title", value: "Shopping" },
      { path: ["items"], range: [0, 0], value: "milk" },
      { path: ["items"], range: [1, 1], value: "eggs" },
    ])
    expect(doc.title).toBe("Shopping")
    expect(doc.items).toEqual(["milk", "eggs"])
    expect(done).toHaveLength(3)
  })

  it("throws on the first bad op, leaving earlier ones applied to the draft", () => {
    const doc = { title: "" }
    expect(() =>
      applyOps(doc, [
        { path: [], range: "title", value: "ok" },
        { path: ["missing"], range: [0, 1], value: "x" },
      ])
    ).toThrow()
    // the caller (doc_edit) runs this inside handle.change and rethrows, which
    // abandons the whole change — so a partial draft never reaches the document
    expect(doc.title).toBe("ok")
  })
})
