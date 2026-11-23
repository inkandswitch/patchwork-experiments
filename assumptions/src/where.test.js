import { describe, expect, it } from "vitest"
import { codeOf, outputsOf, runKeyOf, sourceFingerprint } from "./where.js"

// Every combination of five edits to a notebook: the fingerprint moves
// exactly when one of them touches code.
const EDITS = {
  output: { code: false, apply: (nb) => nb.cells[1].outputs.push({ text: "60" }) },
  prose: { code: false, apply: (nb) => (nb.cells[0].source = "# Thermal model") },
  comment: { code: true, apply: (nb) => (nb.cells[1].source += "  # I²R") },
  reorder: { code: true, apply: (nb) => nb.cells.splice(1, 2, nb.cells[2], nb.cells[1]) },
  cell: { code: true, apply: (nb) => nb.cells.push({ cell_type: "code", source: "print(P)", outputs: [] }) },
}
const notebook = () => ({
  "@patchwork": { type: "jupyter-notebook" },
  cells: [
    { cell_type: "markdown", source: "# Thermal" },
    { cell_type: "code", source: "P = I ** 2 * R", outputs: [] },
    { cell_type: "code", source: "Q = P * t", outputs: [] },
  ],
})

describe("a model document's code fingerprint", () => {
  it("moves exactly when an edit touches code: outputs and prose cells never count, comments always do", () => {
    const names = Object.keys(EDITS)
    const before = codeOf(notebook())
    for (let mask = 0; mask < 1 << names.length; mask++) {
      const nb = notebook()
      const chosen = names.filter((_, i) => mask & (1 << i))
      for (const name of chosen) EDITS[name].apply(nb)
      expect(codeOf(nb) !== before, chosen.join("+") || "nothing").toBe(chosen.some((n) => EDITS[n].code))
    }
  })

  it("falls back to all the text, then to the heads, when there is no code", () => {
    const table = { "@patchwork": { type: "file" }, name: "case.json", content: '{"U": 2.5}' }
    expect(codeOf(table)).toMatch(/^t:/)
    expect(codeOf({ ...table, content: '{"U": 2.6}' })).not.toBe(codeOf(table))
    expect(codeOf({ "@patchwork": { type: "foam-case" }, mesh: {} }, ["b", "a"])).toBe("h:a,b")
  })

  it("fingerprints a kept source by all its text", () => {
    const sheet = { "@patchwork": { type: "file" }, name: "sheet.md", content: "AC impedance ≤0.25 mΩ" }
    expect(sourceFingerprint(sheet)).toBe(sourceFingerprint({ ...sheet }))
    expect(sourceFingerprint({ ...sheet, content: "AC impedance ≤0.22 mΩ" })).not.toBe(sourceFingerprint(sheet))
  })
})

import { limiter, openWithin, scanFolder } from "./where.js"

// A folder tree served by a fake repo whose documents arrive after a given delay.
function fakeRepo(tree, delayOf = () => 0) {
  const docs = new Map()
  let n = 0
  const add = (doc) => {
    const url = `automerge:doc${n++}`
    docs.set(url, doc)
    return url
  }
  const build = (node) => (Array.isArray(node.children) ? add({ "@patchwork": { type: "folder" }, docs: node.children.map((c) => ({ name: c.name, url: build(c) })) }) : add({ "@patchwork": { type: "file" }, name: node.name, extension: "md", content: node.content ?? "" }))
  const root = build(tree)
  let active = 0
  let most = 0
  const find = async (url) => {
    active++
    most = Math.max(most, active)
    await new Promise((r) => setTimeout(r, delayOf(url)))
    active--
    if (!docs.has(url)) throw new Error("unavailable")
    if (delayOf(url) === Infinity) await new Promise(() => {})
    return { doc: () => docs.get(url), heads: () => [url] }
  }
  return { root, find, most: () => most, docs }
}
const tree = { children: Array.from({ length: 3 }, (_, f) => ({ name: `f${f}`, children: Array.from({ length: 4 }, (_, i) => ({ name: `n${i}.md`, content: `x_${f}_${i}` })) })) }

describe("scanning a folder in parallel", () => {
  it("never runs more than its limit at once", async () => {
    for (const limit of [1, 2, 3, 8]) {
      const run = limiter(limit)
      let active = 0
      let most = 0
      await Promise.all(Array.from({ length: 20 }, (_, i) => run(async () => {
        active++
        most = Math.max(most, active)
        await new Promise((r) => setTimeout(r, i % 3))
        active--
      })))
      expect(most).toBe(Math.min(limit, 20))
    }
  })

  it("finds the same documents, paths and truncation whatever order they arrive in", async () => {
    let first = null
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const repo = fakeRepo(tree, (url) => (Number(url.slice(13)) * 7 + seed * 3) % 5)
      const scan = await scanFolder(null, { entries: {}, folderUrl: repo.root, find: repo.find, concurrency: 3 })
      expect(repo.most()).toBeLessThanOrEqual(3)
      const shape = Object.entries(scan.docs).map(([url, d]) => `${url} ${d.path}`).sort()
      if (first) expect(shape).toEqual(first)
      else first = shape
    }
    expect(first).toHaveLength(12)
    expect(first).toContain("automerge:doc0 f0/n0.md")
    expect(first).toContain("automerge:doc5 f1/n0.md")
  })

  it("reports progress, lists a document that won't open within the time limit, and stops when asked", async () => {
    const repo = fakeRepo(tree, (url) => (url === "automerge:doc1" ? Infinity : 1))
    const seen = []
    const scan = await scanFolder(null, { entries: {}, folderUrl: repo.root, find: repo.find, timeout: 30, onProgress: (p) => seen.push(p) })
    expect(scan.unopened).toEqual([{ url: "automerge:doc1", path: "f0/n1.md", why: expect.stringMatching(/^didn't open within/) }])
    expect(Object.keys(scan.docs)).toHaveLength(11)
    expect(seen.at(-1)).toMatchObject({ phase: "documents", opened: 11 })
    expect(seen.some((p) => p.current === "f1/n2.md")).toBe(true)

    const stop = new AbortController()
    const slow = fakeRepo(tree, () => 20)
    const run = scanFolder(null, { entries: {}, folderUrl: slow.root, find: slow.find, signal: stop.signal })
    setTimeout(() => stop.abort(), 5)
    await expect(run).rejects.toMatchObject({ name: "AbortError" })
    await expect(openWithin(slow.find, slow.root, { signal: stop.signal })).rejects.toMatchObject({ name: "AbortError" })
  })
})

describe("a notebook's printed results", () => {
  // Automerge may hand strings back as ImmutableString objects; both forms read the same.
  const imm = (val) => ({ val, toString: () => val })
  const nb = (wrap) => ({
    cells: [
      { cell_type: wrap("markdown"), source: "pack_x_W 1" },
      { cell_type: wrap("code"), source: "", outputs: [{ output_type: wrap("stream"), name: "stdout", text: wrap("pack_heat_W   60.25\nnot_an_entry 3\npack_heat_W = 61.5 W\n") }] },
      { cell_type: wrap("code"), source: "", outputs: [{ output_type: wrap("execute_result"), data: { "text/plain": [wrap("pack_R_mOhm: 6 (5–7)")] } }] },
    ],
  })
  it("reads id-value lines from code cells' outputs, last line winning, from plain or immutable strings", () => {
    for (const wrap of [(v) => v, imm]) {
      const out = outputsOf(nb(wrap), new Set(["pack_heat_W", "pack_R_mOhm", "pack_x_W"]))
      expect(out.map((o) => [o.id, o.value.nominal, o.part, o.line])).toEqual([["pack_heat_W", 61.5, "cell 2", 3], ["pack_R_mOhm", 6, "cell 3", 1]])
      expect(out[1].value).toMatchObject({ min: 5, max: 7 })
    }
    expect(runKeyOf(nb((v) => v))).toBe(runKeyOf(nb(imm)))
  })
})
