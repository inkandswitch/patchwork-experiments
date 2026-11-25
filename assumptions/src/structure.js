/**
 * The register's structure, as a person and the agent both see it.
 *
 *   groupMap     the groups (an id's first word) and how many entries each one
 *                reads from the others, in flow order: a group comes after what
 *                it reads
 *   groupGraph   one group's entries between the groups they read and the
 *                groups that read them
 *   entryIO      one entry's inputs and outputs
 *   layered      the layered layout all three are drawn with
 *   placeLayered where the boxes and lines of a layered layout go
 *
 * The Structure lens draws these and assumptions_read with `structure` writes
 * them as text (text.js, structureText), so both describe the same graph.
 * "Reads" is the evaluation's: `readers` maps an id to the entries whose
 * formula, check or model reads it.
 */

import { groupOf } from "./register.js"

const sorted = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/** Each entry's inputs: the inverse of `evaluation.readers`, entries only. */
export function inputsOf(doc, evaluation) {
  const entries = doc.entries ?? {}
  const out = new Map(Object.keys(entries).map((id) => [id, new Set()]))
  for (const [input, readers] of evaluation.readers) {
    if (!entries[input]) continue
    for (const r of readers) if (r !== input && entries[r]) out.get(r).add(input)
  }
  return out
}

/** Every reader pair `input>reader` along which a result went stale. */
export function staleLinks(evaluation) {
  const out = new Set()
  for (const [id, ev] of evaluation.byId) for (const s of ev.stale ?? []) if (s.input) out.add(`${s.input}>${id}`)
  return out
}

/** Inputs that moved under a result since it ran: the start of every stale path. */
export function movedInputs(evaluation) {
  const out = new Set()
  for (const [, ev] of evaluation.byId) for (const s of ev.stale ?? []) if (s.reason === "moved") out.add(s.input)
  return out
}

/** Every reader pair of entries in the register, once each. */
function readerPairs(doc, evaluation) {
  const entries = doc.entries ?? {}
  const pairs = []
  for (const [input, readers] of evaluation.readers) {
    if (!entries[input]) continue
    for (const r of readers) if (r !== input && entries[r]) pairs.push([input, r])
  }
  return pairs
}

/**
 * The groups and the links between them.
 *
 * Every reader pair is counted once: inside its group when both ends share
 * one, else on the link from the input's group to the reader's. Two groups
 * that read each other are laid out in the direction most of their links
 * take (ties by name), so the other direction is drawn against the flow.
 *
 * @returns {{ groups: Map<string, { name, ids, basis, stale, inside }>, links: Array<{ from, to, n, stale }>,
 *   total: number, linked: string[], loose: string[], order: string[], layout, edges }}
 *   `edges[i]` is the edge `layout.chains[i]` draws: `{ u, v, link, flipped }`, where
 *   `flipped` means u is the reader.
 */
export function groupMap(doc, evaluation) {
  const entries = doc.entries ?? {}
  const groups = new Map()
  for (const id of sorted(Object.keys(entries))) {
    const name = groupOf(id)
    if (!groups.has(name)) groups.set(name, { name, ids: [], basis: {}, stale: 0, inside: 0 })
    const g = groups.get(name)
    g.ids.push(id)
    g.basis[entries[id].basis] = (g.basis[entries[id].basis] ?? 0) + 1
    if (evaluation.byId.get(id)?.stale) g.stale++
  }
  const hot = staleLinks(evaluation)
  const byKey = new Map()
  const pairs = readerPairs(doc, evaluation)
  for (const [input, r] of pairs) {
    const a = groupOf(input), b = groupOf(r)
    if (a === b) {
      groups.get(a).inside++
      continue
    }
    const key = `${a}>${b}`
    if (!byKey.has(key)) byKey.set(key, { from: a, to: b, n: 0, stale: false })
    const link = byKey.get(key)
    link.n++
    if (hot.has(`${input}>${r}`)) link.stale = true
  }
  const links = sorted(byKey.keys()).map((k) => byKey.get(k))
  const flipped = (l) => {
    const rev = byKey.get(`${l.to}>${l.from}`)?.n ?? 0
    return rev > l.n || (rev === l.n && l.from > l.to)
  }
  const touched = new Set(links.flatMap((l) => [l.from, l.to]))
  const linked = [...groups.keys()].filter((g) => touched.has(g))
  const loose = [...groups.keys()].filter((g) => !touched.has(g))
  const edges = links.map((l) => (flipped(l) ? { u: l.to, v: l.from, link: l, flipped: true } : { u: l.from, v: l.to, link: l, flipped: false }))
  const layout = layered(linked, edges)
  const order = layout.layers.flatMap((col) => col.filter((i) => !i.virtual).map((i) => i.key))
  return { groups, links, total: pairs.length, linked, loose, order, layout, edges }
}

/**
 * One group's entries between the groups they read (`in:<group>`, first
 * column) and the groups that read them (`out:<group>`, last column). Entries
 * nothing reads and that read nothing are left out of the graph, as `unread`.
 *
 * @returns {null | { name, ids, nodes, edges, layout, unread, ins, outs, given, computed, moved }}
 *   `edges[i]` is the edge `layout.chains[i]` draws: `{ u, v, stale, n }`, n the
 *   reader pairs it stands for (more than one only for a group end).
 */
export function groupGraph(doc, evaluation, name) {
  const entries = doc.entries ?? {}
  const ids = sorted(Object.keys(entries).filter((id) => groupOf(id) === name))
  if (!ids.length) return null
  const mine = new Set(ids)
  const hot = staleLinks(evaluation)
  const byKey = new Map()
  const add = (u, v, stale) => {
    const key = `${u}>${v}`
    if (!byKey.has(key)) byKey.set(key, { u, v, stale: false, n: 0 })
    const e = byKey.get(key)
    e.n++
    if (stale) e.stale = true
  }
  const inputs = inputsOf(doc, evaluation)
  for (const [input, r] of readerPairs(doc, evaluation)) {
    const a = mine.has(input), b = mine.has(r)
    const stale = hot.has(`${input}>${r}`)
    if (a && b) add(input, r, stale)
    else if (b) add(`in:${groupOf(input)}`, r, stale)
    else if (a) add(input, `out:${groupOf(r)}`, stale)
  }
  const edges = sorted(byKey.keys()).map((k) => byKey.get(k))
  const touched = new Set(edges.flatMap((e) => [e.u, e.v]))
  const members = ids.filter((id) => touched.has(id))
  const unread = ids.filter((id) => !touched.has(id))
  const ins = sorted(new Set(edges.map((e) => e.u).filter((k) => k.startsWith("in:"))))
  const outs = sorted(new Set(edges.map((e) => e.v).filter((k) => k.startsWith("out:"))))
  const nodes = [...ins, ...members, ...outs]
  // Group ends sit in the outer columns, the group's own entries between them.
  const first = layered(nodes, edges, { minLayer: (k) => (mine.has(k) ? 1 : 0) })
  const layerOf = new Map()
  first.layers.forEach((col, l) => col.forEach((i) => layerOf.set(i.key, l)))
  const last = Math.max(1, ...members.map((m) => layerOf.get(m))) + 1
  const layout = layered(nodes, edges, { minLayer: (k) => (mine.has(k) ? 1 : k.startsWith("out:") ? last : 0) })
  const moved = movedInputs(evaluation)
  return {
    name,
    ids,
    nodes,
    edges,
    layout,
    unread,
    ins,
    outs,
    given: members.filter((id) => !inputs.get(id).size),
    computed: members.filter((id) => inputs.get(id).size),
    moved: new Set(members.filter((id) => moved.has(id))),
  }
}

/**
 * One entry's inputs and outputs: what it reads (with the value a model ran
 * with, and why it is stale if it is), what reads it, and what reads those.
 */
export function entryIO(doc, evaluation, id, inputs = inputsOf(doc, evaluation)) {
  const entries = doc.entries ?? {}
  const entry = entries[id]
  const ev = evaluation.byId.get(id)
  if (!entry || !ev) return null
  const recorded = entry.basis === "model" ? entry.model?.inputs ?? {} : null
  const why = new Map((ev.stale ?? []).filter((s) => s.input).map((s) => [s.input, s.reason]))
  const readersOf = (n) => [...(evaluation.readers.get(n) ?? [])].filter((r) => r !== n && entries[r])
  const direct = sorted(readersOf(id))
  const seen = new Set([id, ...direct])
  const further = []
  const todo = [...direct]
  while (todo.length) for (const r of readersOf(todo.shift())) if (!seen.has(r)) seen.add(r), further.push(r), todo.push(r)
  return {
    inputs: sorted(inputs.get(id) ?? []).map((input) => ({ id: input, ranWith: recorded ? recorded[input] ?? null : null, stale: why.get(input) ?? null })),
    outputs: direct.map((r) => ({ id: r, stale: evaluation.byId.get(r)?.stale ?? null })),
    further,
  }
}

/**
 * A layered drawing of a directed graph (inputs → readers), left to right.
 * Layers are longest paths from the inputs, never less than `minLayer(node)`;
 * an edge that would close a cycle is reversed for layering and marked `back`.
 * An edge spanning several layers runs through a virtual slot in each, so no
 * edge crosses a box. Within a layer, order follows the mean position of
 * neighbours, swept both ways a few times.
 *
 * @returns {{ layers: Array<Array<{ key, virtual }>>, chains: Array<{ keys, model, back }> }}
 */
export function layered(nodes, edges, { minLayer = null } = {}) {
  const index = new Map(nodes.map((n, i) => [n, i]))
  const inputs = new Map(nodes.map((n) => [n, []]))
  for (const e of edges) inputs.get(e.v)?.push(e)
  // Longest-path layering; an input still on the stack closes a cycle.
  const layer = new Map()
  const onStack = new Set()
  const back = new Set()
  const depth = (n) => {
    if (layer.has(n)) return layer.get(n)
    onStack.add(n)
    let d = minLayer?.(n) ?? 0
    for (const e of inputs.get(n)) {
      if (onStack.has(e.u)) {
        back.add(e)
        continue
      }
      d = Math.max(d, depth(e.u) + 1)
    }
    onStack.delete(n)
    layer.set(n, d)
    return d
  }
  for (const n of nodes) depth(n)
  const count = Math.max(0, ...layer.values()) + 1
  const layers = Array.from({ length: count }, () => [])
  for (const n of nodes) layers[layer.get(n)].push({ key: n, virtual: false })
  const chains = []
  let v = 0
  for (const e of edges) {
    const isBack = back.has(e)
    const [from, to] = isBack ? [e.v, e.u] : [e.u, e.v]
    const keys = [from]
    for (let l = layer.get(from) + 1; l < layer.get(to); l++) {
      const key = `~${v++}`
      layers[l].push({ key, virtual: true })
      keys.push(key)
    }
    keys.push(to)
    chains.push({ keys: isBack ? keys.reverse() : keys, model: Boolean(e.model), back: isBack })
  }
  // Neighbours of each slot, from the chains, for ordering.
  const nbrs = new Map()
  const link = (a, b) => {
    if (!nbrs.has(a)) nbrs.set(a, [])
    nbrs.get(a).push(b)
  }
  for (const c of chains) for (let i = 0; i < c.keys.length - 1; i++) link(c.keys[i], c.keys[i + 1]), link(c.keys[i + 1], c.keys[i])
  const position = new Map()
  const place = () => layers.forEach((col) => col.forEach((item, i) => position.set(item.key, i)))
  for (const col of layers) col.sort((a, b) => a.virtual - b.virtual || (index.get(a.key) ?? 0) - (index.get(b.key) ?? 0) || (a.key < b.key ? -1 : 1))
  place()
  const sweep = (range) => {
    for (const l of range) {
      const prev = new Set(layers[l + (range[0] < range[range.length - 1] ? -1 : 1)]?.map((i) => i.key) ?? [])
      const score = (item) => {
        const ps = (nbrs.get(item.key) ?? []).filter((k) => prev.has(k)).map((k) => position.get(k))
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : position.get(item.key)
      }
      layers[l] = layers[l]
        .map((item) => [item, score(item)])
        .sort((a, b) => a[1] - b[1] || (a[0].key < b[0].key ? -1 : 1))
        .map(([item]) => item)
      layers[l].forEach((item, i) => position.set(item.key, i))
    }
  }
  const forward = [...Array(count).keys()].slice(1)
  const backward = [...Array(count).keys()].reverse().slice(1)
  for (let i = 0; i < 4; i++) {
    sweep(forward)
    sweep(backward)
  }
  return { layers, chains }
}

/**
 * Where a layered layout's boxes and lines go. Each column is as wide as its
 * widest box; boxes are left-aligned and stacked down their column, centred on
 * the tallest column. A line is made of three kinds of piece:
 *
 *   stub    level, inside one column, from a box's port to the column's edge
 *   slot    level, across a column, at a virtual slot's height
 *   curve   between two adjacent columns, in the gap between them
 *
 * Stubs and slots run at a height no other box in their column covers, and
 * curves only in gaps, so no line crosses a box (structure.test checks this).
 *
 * `size(key)` gives a box's `{ w, h, portY?, inX?, outX?, spread? }`: lines
 * leave at `outX` and arrive at `inX` (default its edges), at `portY` (default
 * the middle), or spread down the box when `spread`.
 *
 * @returns {{ width, height, boxes: Map<key, { x, y, w, h, col }>, lines: Array<{ chain, edge, d, pieces }> }}
 */
export function placeLayered(layout, edges, size, { gap = 56, pad = 8, vgap = 12, slot = 12 } = {}) {
  const sizes = new Map()
  for (const col of layout.layers) for (const item of col) sizes.set(item.key, item.virtual ? { w: 0, h: slot, virtual: true } : size(item.key))
  const colW = layout.layers.map((col) => Math.max(16, ...col.filter((i) => !i.virtual).map((i) => sizes.get(i.key).w)))
  const colX = []
  let x = pad
  for (const w of colW) colX.push(x), (x += w + gap)
  const width = x - gap + pad
  const colH = layout.layers.map((col) => col.reduce((s, i, k) => s + sizes.get(i.key).h + (k ? vgap : 0), 0))
  const tallest = Math.max(0, ...colH)
  const boxes = new Map()
  layout.layers.forEach((col, c) => {
    let y = pad + (tallest - colH[c]) / 2
    for (const item of col) {
      const s = sizes.get(item.key)
      boxes.set(item.key, { x: colX[c], y, w: s.w, h: s.h, col: c, virtual: Boolean(s.virtual) })
      y += s.h + vgap
    }
  })
  const height = pad * 2 + tallest

  // Ports: where each piece of each chain meets a box.
  const touches = new Map()
  layout.chains.forEach((chain, ci) => {
    for (let i = 0; i < chain.keys.length - 1; i++) {
      const a = chain.keys[i], b = chain.keys[i + 1]
      for (const [key, other] of [[a, b], [b, a]]) {
        if (!touches.has(key)) touches.set(key, [])
        touches.get(key).push({ ci, i, other })
      }
    }
  })
  const portY = (key, ci, i, other) => {
    const b = boxes.get(key), s = sizes.get(key)
    if (b.virtual) return b.y + b.h / 2
    if (!s.spread) return b.y + (s.portY ?? b.h / 2)
    const side = boxes.get(other).col > b.col
    const list = touches.get(key).filter((t) => boxes.get(t.other).col > b.col === side).sort((p, q) => boxes.get(p.other).y - boxes.get(q.other).y)
    const at = list.findIndex((t) => t.ci === ci && t.i === i && t.other === other)
    return b.y + ((at + 1) * b.h) / (list.length + 1)
  }
  const f = (n) => Math.round(n * 10) / 10
  const lines = layout.chains.map((chain, ci) => {
    const pieces = []
    let d = ""
    let at = null
    const moveTo = (px, py) => {
      if (!at) d += `M${f(px)} ${f(py)}`
      at = [px, py]
    }
    const level = (kind, col, x2) => {
      if (Math.abs(x2 - at[0]) < 0.01) return
      pieces.push({ kind, col, y: at[1], x1: Math.min(at[0], x2), x2: Math.max(at[0], x2) })
      d += `H${f(x2)}`
      at = [x2, at[1]]
    }
    for (let i = 0; i < chain.keys.length - 1; i++) {
      const a = chain.keys[i], b = chain.keys[i + 1]
      const A = boxes.get(a), B = boxes.get(b), sa = sizes.get(a), sb = sizes.get(b)
      const right = B.col > A.col
      const ya = portY(a, ci, i, b), yb = portY(b, ci, i, a)
      const edgeA = right ? colX[A.col] + colW[A.col] : colX[A.col]
      const edgeB = right ? colX[B.col] : colX[B.col] + colW[B.col]
      if (i === 0) {
        moveTo(A.x + (right ? sa.outX ?? sa.w : sa.inX ?? 0), ya)
        level("stub", A.col, edgeA)
      } else if (A.virtual) level("slot", A.col, edgeA)
      // The curve, in the gap.
      pieces.push({ kind: "curve", x1: Math.min(edgeA, edgeB), x2: Math.max(edgeA, edgeB), y1: ya, y2: yb })
      const m = (edgeA + edgeB) / 2
      d += `C${f(m)} ${f(ya)} ${f(m)} ${f(yb)} ${f(edgeB)} ${f(yb)}`
      at = [edgeB, yb]
      if (!B.virtual) level("stub", B.col, B.x + (right ? sb.inX ?? 0 : sb.outX ?? sb.w))
    }
    return { chain, edge: edges[ci], d, pieces }
  })
  return { width, height, boxes, lines }
}
