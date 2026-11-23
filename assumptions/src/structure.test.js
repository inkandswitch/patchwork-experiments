import { describe, expect, it } from "vitest"
import { entryIO, groupGraph, groupMap, layered, placeLayered } from "./structure.js"

// Every directed graph on four entries in three groups (12 possible reader
// pairs, 4096 graphs), cycles included, checked against invariants rather
// than sampled.
const IDS = ["a_1", "a_2", "b_1", "c_1"]
const PAIRS = IDS.flatMap((u) => IDS.filter((v) => v !== u).map((v) => [u, v]))
function* graphs() {
  for (let mask = 0; mask < 1 << PAIRS.length; mask++) {
    const pairs = PAIRS.filter((_, i) => mask & (1 << i))
    const readers = new Map(IDS.map((id) => [id, new Set()]))
    for (const [u, v] of pairs) readers.get(u).add(v)
    const doc = { entries: Object.fromEntries(IDS.map((id) => [id, { basis: "estimate" }])) }
    const evaluation = { readers, byId: new Map(IDS.map((id) => [id, {}])) }
    yield { mask, pairs, doc, evaluation }
  }
}
const group = (id) => id.split("_")[0]
const layerOf = (layout) => {
  const out = new Map()
  layout.layers.forEach((col, l) => col.forEach((i) => out.set(i.key, l)))
  return out
}

describe("the map of groups", () => {
  it("counts every reader pair exactly once, inside its group or on one link, and lays out every linked group once", () => {
    for (const { pairs, doc, evaluation } of graphs()) {
      const map = groupMap(doc, evaluation)
      const inside = [...map.groups.values()].reduce((s, g) => s + g.inside, 0)
      expect(map.total).toBe(pairs.length)
      expect(inside + map.links.reduce((s, l) => s + l.n, 0)).toBe(pairs.length)
      for (const l of map.links) {
        expect(l.from).not.toBe(l.to)
        expect(l.n).toBe(pairs.filter(([u, v]) => group(u) === l.from && group(v) === l.to).length)
      }
      expect(new Set(map.order)).toEqual(new Set(map.linked))
      expect(map.order.length).toBe(map.linked.length)
      expect(new Set([...map.linked, ...map.loose])).toEqual(new Set(["a", "b", "c"]))
      // A pair of groups that read each other is laid out the way most links go.
      for (const e of map.edges) {
        const rev = map.links.find((l) => l.from === e.link.to && l.to === e.link.from)?.n ?? 0
        expect(e.flipped).toBe(rev > e.link.n || (rev === e.link.n && e.link.from > e.link.to))
        expect([e.u, e.v]).toEqual(e.flipped ? [e.link.to, e.link.from] : [e.link.from, e.link.to])
      }
    }
  })
})

describe("one group's graph", () => {
  it("shows each of the group's entries once, in the graph or as unread, with outside groups only at the edges", () => {
    for (const { pairs, doc, evaluation } of graphs()) {
      const g = groupGraph(doc, evaluation, "a")
      const members = g.nodes.filter((k) => !k.includes(":"))
      expect([...members, ...g.unread].sort()).toEqual(["a_1", "a_2"])
      expect([...g.given, ...g.computed].sort()).toEqual([...members].sort())
      for (const id of g.unread) expect(pairs.some(([u, v]) => u === id || v === id)).toBe(false)
      const nodes = new Set(g.nodes)
      for (const e of g.edges) {
        expect(nodes.has(e.u) && nodes.has(e.v)).toBe(true)
        expect(e.v.startsWith("in:")).toBe(false)
        expect(e.u.startsWith("out:")).toBe(false)
      }
      // Every pair touching the group is drawn, and only those.
      const touching = pairs.filter(([u, v]) => group(u) === "a" || group(v) === "a")
      expect(g.edges.reduce((s, e) => s + e.n, 0)).toBe(touching.length)
      const at = layerOf(g.layout)
      const memberLayers = members.map((m) => at.get(m))
      for (const k of g.ins) expect(at.get(k)).toBe(0)
      for (const l of memberLayers) expect(l).toBeGreaterThanOrEqual(1)
      const outLayers = new Set(g.outs.map((k) => at.get(k)))
      expect(outLayers.size).toBeLessThanOrEqual(1)
      for (const l of outLayers) expect(l).toBeGreaterThan(Math.max(0, ...memberLayers))
    }
  })
})

describe("placing a layered layout", () => {
  // Boxes of different shapes, one spreading its ports.
  const SIZES = { a: { w: 60, h: 20 }, b: { w: 120, h: 58, spread: true }, c: { w: 30, h: 40, inX: 6, outX: 24, portY: 12 }, d: { w: 90, h: 22 } }
  const N = Object.keys(SIZES)
  const pairs = N.flatMap((u) => N.filter((v) => v !== u).map((v) => [u, v]))
  it("never runs a line across a box: level pieces only where no other box in their column is, curves only in gaps", () => {
    for (let mask = 0; mask < 1 << pairs.length; mask++) {
      const edges = pairs.filter((_, i) => mask & (1 << i)).map(([u, v]) => ({ u, v }))
      const layout = layered(N, edges)
      const placed = placeLayered(layout, edges, (k) => SIZES[k])
      const real = [...placed.boxes].filter(([, b]) => !b.virtual)
      for (const line of placed.lines) {
        const ends = new Set([line.chain.keys[0], line.chain.keys.at(-1)])
        for (const p of line.pieces) {
          if (p.kind === "curve") {
            for (const [, b] of real) expect(b.x + b.w <= p.x1 + 1e-6 || b.x >= p.x2 - 1e-6).toBe(true)
            continue
          }
          for (const [key, b] of real) {
            if (b.col !== p.col || !(b.y < p.y && p.y < b.y + b.h)) continue
            expect(p.kind === "stub" && ends.has(key)).toBe(true)
          }
        }
        expect(line.d.startsWith("M")).toBe(true)
      }
    }
  })
})

describe("the layered layout", () => {
  // Every directed graph on 4 nodes (12 possible edges, 4096 graphs), cycles included.
  const N = ["a", "b", "c", "d"]
  const pairs = N.flatMap((u) => N.filter((v) => v !== u).map((v) => [u, v]))
  it("puts every box in one layer, and every edge one layer per step, left to right unless it closes a cycle", () => {
    for (let mask = 0; mask < 1 << pairs.length; mask++) {
      const edges = pairs.filter((_, i) => mask & (1 << i)).map(([u, v]) => ({ u, v, model: false }))
      const { layers, chains } = layered(N, edges)
      const at = new Map()
      layers.forEach((col, l) =>
        col.forEach((item) => {
          expect(at.has(item.key)).toBe(false)
          at.set(item.key, l)
        }),
      )
      for (const n of N) expect(at.has(n)).toBe(true)
      expect(chains.length).toBe(edges.length)
      for (const [i, c] of chains.entries()) {
        expect([c.keys[0], c.keys.at(-1)]).toEqual([edges[i].u, edges[i].v])
        const step = c.back ? -1 : 1
        for (let k = 0; k < c.keys.length - 1; k++) expect(at.get(c.keys[k + 1]) - at.get(c.keys[k])).toBe(step)
        for (const key of c.keys.slice(1, -1)) expect(key.startsWith("~")).toBe(true)
      }
      if (!hasCycle(N, edges)) expect(chains.some((c) => c.back)).toBe(false)
    }
  })

  it("keeps a node at or after its minimum layer", () => {
    const { layers } = layered(["x", "y", "z"], [{ u: "x", v: "y" }], { minLayer: (n) => (n === "z" ? 3 : 0) })
    expect(layerOf({ layers }).get("z")).toBe(3)
    expect(layerOf({ layers }).get("y")).toBe(1)
  })

  function hasCycle(nodes, edges) {
    const state = new Map()
    const visit = (n) => {
      state.set(n, 1)
      for (const e of edges) if (e.u === n && (state.get(e.v) === 1 || (!state.has(e.v) && visit(e.v)))) return true
      state.set(n, 2)
      return false
    }
    return nodes.some((n) => !state.has(n) && visit(n))
  }
})

describe("an entry's inputs and outputs", () => {
  it("lists what it reads, with what a model ran with and why it is stale, and what reads it directly and further on", () => {
    const doc = {
      entries: {
        a_x: { basis: "estimate" },
        b_x: { basis: "model", model: { inputs: { a_x: { nominal: 1 } } } },
        c_x: { basis: "formula" },
        d_x: { basis: "formula" },
      },
    }
    const evaluation = {
      readers: new Map([["a_x", new Set(["b_x"])], ["b_x", new Set(["c_x"])], ["c_x", new Set(["d_x"])]]),
      byId: new Map([["a_x", {}], ["b_x", { stale: [{ input: "a_x", reason: "moved" }] }], ["c_x", {}], ["d_x", {}]]),
    }
    expect(entryIO(doc, evaluation, "a_x")).toEqual({ inputs: [], outputs: [{ id: "b_x", stale: [{ input: "a_x", reason: "moved" }] }], further: ["c_x", "d_x"] })
    expect(entryIO(doc, evaluation, "b_x").inputs).toEqual([{ id: "a_x", ranWith: { nominal: 1 }, stale: "moved" }])
    expect(entryIO(doc, evaluation, "d_x")).toMatchObject({ inputs: [{ id: "c_x", ranWith: null, stale: null }], outputs: [], further: [] })
  })
})
