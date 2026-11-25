/**
 * What the "automerge" skill (knowledge/builtin-skills.js) tells the agent, checked
 * against the automerge Patchwork actually ships.
 *
 * Each test is one claim in that skill. If an automerge upgrade changes a
 * behaviour, the test fails here instead of the skill quietly teaching
 * something false — change the test and the skill together.
 */
import { describe, it, expect } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"

await initSubduction()
const repo = () => new Repo({ network: [] })
const plain = (value) => JSON.parse(JSON.stringify(value))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Two peers editing the same document at once, then merging. */
function concurrently(initial, left, right) {
  const base = A.from(initial)
  return A.merge(A.change(A.clone(base), left), A.change(A.clone(base), right))
}

describe("writes go through change(), synchronously", () => {
  it("writing to handle.doc() shows the value but never saves it", () => {
    const handle = repo().create({ n: 0 })
    handle.doc().n = 5
    expect(handle.doc().n).toBe(5) // looks like it worked
    expect(A.load(A.save(handle.doc())).n).toBe(0) // it did not
  })

  it("a write after an await inside change() is dropped", async () => {
    const handle = repo().create({})
    handle.change(async (d) => { await null; d.late = 1 })
    await sleep(10)
    expect(handle.doc().late).toBeUndefined()
  })

  it("reassigning d or returning a value does nothing", () => {
    const doc = A.from({ a: 1 })
    expect(plain(A.change(doc, (d) => { d = { b: 2 } }))).toEqual({ a: 1 }) // eslint-disable-line no-param-reassign
    expect(plain(A.change(doc, () => ({ b: 2 })))).toEqual({ a: 1 })
  })

  it("undefined, functions, Maps and Sets throw", () => {
    for (const value of [undefined, () => 1, new Map(), new Set()]) {
      expect(() => A.change(A.from({}), (d) => { d.x = value })).toThrow()
    }
  })

  it("a class instance comes back as a plain object; Dates survive", () => {
    class Point { constructor() { this.x = 1 } }
    const doc = A.change(A.from({}), (d) => { d.point = new Point(); d.when = new Date(0) })
    expect(doc.point).not.toBeInstanceOf(Point)
    expect(plain(doc.point)).toEqual({ x: 1 })
    expect(doc.when).toBeInstanceOf(Date)
  })
})

describe("change the smallest thing", () => {
  it("rebuilding a list of objects with filter throws", () => {
    const doc = A.from({ items: [{ id: 1 }, { id: 2 }] })
    expect(() => A.change(doc, (d) => { d.items = d.items.filter((i) => i.id !== 1) })).toThrow(/existing document object/)
  })

  it("rebuilding a list from a copy loses what someone else added meanwhile", () => {
    const merged = concurrently(
      { items: [{ id: 1 }, { id: 2 }] },
      (d) => { d.items = plain(d.items).filter((i) => i.id !== 1) },
      (d) => { d.items.push({ id: 3 }) }
    )
    expect(plain(merged.items).map((i) => i.id)).not.toContain(3)
  })

  it("editing in place keeps it", () => {
    const merged = concurrently(
      { items: [{ id: 1 }, { id: 2 }] },
      (d) => { d.items.splice(d.items.findIndex((i) => i.id === 1), 1) },
      (d) => { d.items.push({ id: 3 }) }
    )
    expect(plain(merged.items).map((i) => i.id)).toEqual([2, 3])
  })

  it("removing several walking backwards removes the right ones", () => {
    const doc = A.change(A.from({ items: [1, 2, 3, 4, 5] }), (d) => {
      for (let i = d.items.length - 1; i >= 0; i--) if (d.items[i] % 2) d.items.splice(i, 1)
    })
    expect(plain(doc.items)).toEqual([2, 4])
  })

  it("assigning a whole string loses concurrent typing; updateText keeps it", () => {
    const assigned = concurrently({ s: "hello" }, (d) => { d.s = "Hello" }, (d) => { A.splice(d, ["s"], 5, 0, " world") })
    expect(assigned.s).not.toContain("world")
    const updated = concurrently({ s: "hello" }, (d) => { A.updateText(d, ["s"], "Hello") }, (d) => { A.splice(d, ["s"], 5, 0, " world") })
    expect(updated.s).toBe("Hello world")
  })

  it("+= on a plain number loses a concurrent bump; a Counter adds up", () => {
    const plainNumber = concurrently({ n: 0 }, (d) => { d.n += 1 }, (d) => { d.n += 1 })
    expect(plainNumber.n).toBe(1)
    const counter = A.merge(...(() => {
      const base = A.from({ n: new A.Counter(0) })
      return [A.change(A.clone(base), (d) => { d.n.increment(1) }), A.change(A.clone(base), (d) => { d.n.increment(1) })]
    })())
    expect(counter.n.value).toBe(2)
  })

  it("two people setting the same key: one wins, the other is a conflict", () => {
    const merged = concurrently({ k: 0 }, (d) => { d.k = 1 }, (d) => { d.k = 2 })
    expect([1, 2]).toContain(merged.k)
    expect(Object.values(A.getConflicts(merged, "k")).sort()).toEqual([1, 2])
  })
})

describe("lists are not arrays", () => {
  it("there is no sort, reverse, or length = 0", () => {
    const attempt = (fn) => () => A.change(A.from({ l: [3, 1, 2] }), fn)
    expect(attempt((d) => d.l.sort())).toThrow()
    expect(attempt((d) => d.l.reverse())).toThrow()
    expect(attempt((d) => { d.l.length = 0 })).toThrow()
  })

  it("push, splice, insertAt and deleteAt work; splice empties", () => {
    const doc = A.change(A.from({ l: [1] }), (d) => { d.l.push(2); d.l.insertAt(0, 0); d.l.deleteAt(1); d.l.splice(1, 0, 9) })
    expect(plain(doc.l)).toEqual([0, 9, 2])
    expect(plain(A.change(doc, (d) => { d.l.splice(0, d.l.length) }).l)).toEqual([])
  })

  it("sorting a copy for display works", () => {
    const doc = A.from({ items: [{ p: 2 }, { p: 1 }] })
    expect([...doc.items].sort((a, b) => a.p - b.p).map((i) => i.p)).toEqual([1, 2])
  })

  it("writing past the end throws", () => {
    expect(() => A.change(A.from({ l: [1] }), (d) => { d.l[10] = 1 })).toThrow(/out of bounds/)
  })

  it("inside change(), each read is a new proxy", () => {
    A.change(A.from({ l: [{ id: 1 }] }), (d) => { expect(d.l[0] === d.l[0]).toBe(false) })
  })
})

describe("moving and copying", () => {
  it("placing an existing object elsewhere throws; a JSON copy works", () => {
    const doc = A.from({ a: { x: { y: 1 } } })
    expect(() => A.change(doc, (d) => { d.b = d.a })).toThrow(/existing document object/)
    expect(plain(A.change(doc, (d) => { d.b = JSON.parse(JSON.stringify(d.a)) }).b)).toEqual({ x: { y: 1 } })
  })

  it("a spread copy only works with nothing nested; structuredClone throws", () => {
    expect(plain(A.change(A.from({ a: { x: 1 } }), (d) => { d.b = { ...d.a } }).b)).toEqual({ x: 1 })
    expect(() => A.change(A.from({ a: { x: { y: 1 } } }), (d) => { d.b = { ...d.a } })).toThrow()
    expect(() => A.change(A.from({ a: { x: 1 } }), (d) => { d.b = structuredClone(d.a) })).toThrow()
  })
})

describe("versions", () => {
  it("a url with heads opens the old version, read-only", async () => {
    const r = repo()
    const handle = r.create({ n: 1 })
    const then = `${handle.url}#${handle.heads().join("|")}`
    handle.change((d) => { d.n = 2 })
    const old = await r.find(then)
    expect(old.doc().n).toBe(1)
    expect(() => old.change((d) => { d.n = 3 })).toThrow(/view-only/)
  })
})
