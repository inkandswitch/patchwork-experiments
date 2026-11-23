// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { AssumptionsDatatype } from "./datatype.js"
import { evaluate, materialize } from "./register.js"
import { entryParts, sheetOrder } from "./text.js"
import { AssumptionsView } from "./view.js"

await initSubduction()

let repo, handle, element, dispose

const claim = (key, stated, extra = {}) => ({ key, stated, sourceKind: "datasheet", verified: true, quote: "q", reading: "r", ...extra })

function fixture(d) {
  AssumptionsDatatype.init(d)
  d.title = "Battery"
  Object.assign(d.entries, {
    cell_R_ac_mOhm: { kind: "fact", unit: "mΩ", basis: "claims", claims: [claim("c1", { max: 0.25, dp: 2 })] },
    cell_V_nom: { kind: "fact", unit: "V", basis: "claims", claims: [claim("c1", { nominal: 3.2, typ: true, dp: 1 }), claim("c2", { nominal: 3.2, dp: 1 }, { sourceKind: "retailer", origin: "shop" })] },
    busbar_R_mOhm: { kind: "fact", unit: "mΩ", basis: "estimate", estimate: { value: { nominal: 0.2, min: 0.1, max: 0.4, dp: 1 }, reasoning: "M6 lugs" } },
    bilge_vol_m3: { kind: "fact", unit: "m³", basis: "unknown", unknown: { range: null, settle: "measure the CAD" } },
    bms_part: { kind: "decision", basis: "choice", choice: { value: "REC 2Q", alternatives: [] } },
    pack_V_max: { kind: "decision", unit: "V", basis: "choice", choice: { value: { nominal: 58.4, dp: 1 } } },
    pack_R_mOhm: { kind: "result", unit: "mΩ", basis: "formula", formula: "16 * cell_R_ac_mOhm + busbar_R_mOhm" },
    pack_I_kA: { kind: "result", unit: "kA", basis: "formula", formula: "pack_V_max / pack_R_mOhm" },
    fuse_kA: { kind: "fact", unit: "kA", basis: "estimate", estimate: { value: { nominal: 20, min: 20, max: 20 }, reasoning: "rating" } },
    fuse_ok: { kind: "requirement", basis: "check", check: "pack_I_kA <= fuse_kA" },
    temp_ok: { kind: "requirement", basis: "check", check: "pack_V_max < 50" },
  })
}

beforeEach(() => {
  repo = new Repo({ network: [] })
  handle = repo.create()
  handle.change(fixture)
  element = document.createElement("div")
  document.body.append(element)
  dispose = AssumptionsView(handle, element, { repo })
})

afterEach(() => {
  dispose?.()
  element.remove()
})

const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true }))
const lens = (name) => click(element.querySelector(`[data-lens="${name}"]`))
const key = (k, target = element.querySelector(".asm")) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }))
const norm = (s) => s.replace(/\s+/g, " ").trim()
/** The Entries lens with every group open (sound groups start collapsed). */
function entriesOpen() {
  lens("entries")
  for (const button of element.querySelectorAll('tr.group button[aria-expanded="false"]')) click(button)
}

describe("the view", () => {
  it("writes results back when it loads, so consumers can read them", () => {
    expect(handle.doc().entries.pack_I_kA.derived?.how).toBe("pack_V_max / pack_R_mOhm")
    expect(handle.doc().entries.cell_R_ac_mOhm.support).toMatchObject({ level: "supported" })
  })

  it("opens on what needs a person: problems with fixes, and the weak leaves that matter", () => {
    const text = element.querySelector("main").textContent
    expect(element.querySelector(".summary").textContent).toMatch(/^11 entries · \d+ needs? attention · requirements: 1 fail, 1 depend · 1 unknown · not yet scanned Check the folder$/)
    expect(text).toMatch(/FAILS\s*temp_ok/)
    expect(text).toMatch(/DEPENDS\s*fuse_ok/)
    expect(text).toMatch(/Weak leaves that matter/)
    expect(text).toMatch(/cell_R_ac_mOhm.*would settle fuse_ok: it has no lower bound|busbar_R_mOhm/)
  })

  it("each row's cells read exactly as the agent's figure parts, for every entry shape", () => {
    entriesOpen()
    const doc = handle.doc()
    const evaluation = evaluate(doc)
    for (const id of Object.keys(doc.entries)) {
      const tr = element.querySelector(`tr[data-id="${id}"]`)
      expect(tr, id).toBeTruthy()
      const parts = entryParts(id, doc.entries[id], evaluation, { scan: doc.scan, problems: [] }).filter((p) => p.part !== "cite")
      const cells = [...tr.cells].map((td) => norm(td.textContent))
      expect(cells.slice(0, -1), id).toEqual(parts.slice(0, -1).map((p) => norm(p.text)))
    }
  })

  it("carries no meaning by colour alone: every chip and glyph has a word", () => {
    lens("entries")
    for (const node of element.querySelectorAll(".chip")) expect(node.textContent.trim()).toMatch(/^[A-Z?]+$/)
    for (const node of element.querySelectorAll(".glyph")) expect(node.getAttribute("aria-label")).toBeTruthy()
    for (const node of element.querySelectorAll("td.status")) expect(node.textContent).toMatch(/corroborated|supported|weak|none|chosen|formula|holds|fails|depends|n\/a/)
  })

  it("puts requirements on one scale, worst first, and says each in words", () => {
    lens("requirements")
    const rows = [...element.querySelectorAll("table.requirements tbody tr")]
    expect(rows.map((r) => r.dataset.id)).toEqual(["temp_ok", "fuse_ok"])
    expect(rows[1].textContent).toMatch(/depends on cell_R_ac_mOhm, which has no lower bound/)
    expect(rows[0].querySelector("svg line.limit")).toBeTruthy()
    expect(rows[0].textContent).toMatch(/worst 117% of its limit, 117% at nominal/)
  })

  it("opens an entry's panel from any id, keeps the line of inquiry, and goes back", () => {
    entriesOpen()
    click(element.querySelector('[data-open="pack_I_kA"]'))
    const panel = () => element.querySelector("aside.panel")
    expect([...panel().querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Value", "Basis", "Inputs", "Outputs", "Used in", "Judgements and history"])
    expect(panel().querySelector(".sheet").textContent).toMatch(/pack_I_kA = pack_V_max \/ pack_R_mOhm= 58.4 V \/ ≤ 4.4 mΩ/)
    click(panel().querySelector('[data-open="pack_R_mOhm"]'))
    click(panel().querySelector('[data-open="cell_R_ac_mOhm"]'))
    expect(panel().querySelector(".crumbs").textContent).toMatch(/pack_I_kA › pack_R_mOhm › cell_R_ac_mOhm/)
    key("[")
    expect(panel().querySelector("h2").textContent).toMatch(/pack_R_mOhm/)
    key("]")
    expect(panel().querySelector("h2").textContent).toMatch(/cell_R_ac_mOhm/)
    key("Escape")
    expect(panel().classList.contains("empty")).toBe(true)
  })

  it("moves with j and k and opens with Enter", () => {
    key("j")
    const first = element.querySelector("main .cursor")?.dataset.id
    expect(first).toBeTruthy()
    key("j")
    key("Enter")
    expect(element.querySelector("aside.panel h2")).toBeTruthy()
  })

  it("adds a person's judgement, which conflicts and goes to the agent", async () => {
    entriesOpen()
    click(element.querySelector('[data-open="busbar_R_mOhm"]'))
    key("d")
    const form = element.querySelector('form[data-submit="judgement"]')
    form.querySelector('[name="verdict"]').value = "value"
    form.querySelector('[name="value"]').value = "0.6–0.9"
    form.querySelector('[name="says"]').value = "corroded lugs measure far higher"
    form.querySelector('[name="who"]').value = "Ana"
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 0))
    const entry = handle.doc().entries.busbar_R_mOhm
    expect(entry.judgements[0]).toMatchObject({ key: "j1", by: { kind: "person", who: "Ana" }, verdict: "value", value: { min: 0.6, max: 0.9 }, path: "busbar_R_mOhm" })
    expect(entry.support).toMatchObject({ level: "weak", conflicting: true })
    expect(handle.metadata().message).toBe("Ana: judge busbar_R_mOhm: value")
    expect(element.querySelector("aside.panel").textContent).toMatch(/CONFLICT/)
  })

  it("a claim replaces an estimate, and is checked against its quote first", async () => {
    const sheet = repo.create()
    sheet.change((d) => Object.assign(d, { content: "Contact resistance ≤0.15 mΩ per joint" }))
    entriesOpen()
    click(element.querySelector('[data-open="busbar_R_mOhm"]'))
    key("a")
    const fill = (values) => {
      const form = element.querySelector('form[data-submit="claim"]')
      for (const [k, v] of Object.entries(values)) form.querySelector(`[name="${k}"]`).value = v
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    }
    fill({ source: sheet.url, quote: "Contact resistance ≤0.15 mΩ", stated: "0.25" })
    await new Promise((r) => setTimeout(r, 10))
    expect(element.querySelector("form .error").textContent).toMatch(/stated 0.25 is not in the quote/)
    fill({ source: sheet.url, quote: "Contact resistance ≤0.15 mΩ", stated: "0.15" })
    await new Promise((r) => setTimeout(r, 10))
    const entry = handle.doc().entries.busbar_R_mOhm
    expect(entry.basis).toBe("claims")
    expect(entry.value).toMatchObject({ max: 0.15 })
    expect(entry.claims[0]).toMatchObject({ verified: true, by: { kind: "person" } })
  })

  it("shows what an edit would change before saving it", () => {
    entriesOpen()
    click(element.querySelector('[data-open="pack_V_max"]'))
    click(element.querySelector('[data-form="edit"]'))
    element.querySelector('form [name="value"]').value = "40"
    click(element.querySelector("[data-preview]"))
    expect(element.querySelector(".preview").textContent).toBe("Changes 0 other results; temp_ok goes from fails to holds.")
  })
})

describe("rows follow the calculation", () => {
  // Within a group, every input renders above everything derived from it, over every DAG on 4 nodes.
  it("over every DAG on 4 nodes", () => {
    const nodes = ["g_a", "g_b", "g_c", "g_d"]
    const pairs = nodes.flatMap((a, i) => nodes.slice(i + 1).map((b) => [a, b])) // edges point down the list: always a DAG
    for (let mask = 0; mask < 1 << pairs.length; mask++) {
      for (const perm of [nodes, [...nodes].reverse()]) {
        const edges = pairs.filter((_, i) => mask & (1 << i)).map(([a, b]) => (perm === nodes ? [a, b] : [b, a]))
        const entries = Object.fromEntries(nodes.map((n) => {
          const deps = edges.filter(([from]) => from === n).map(([, to]) => to)
          return [n, deps.length ? { kind: "result", basis: "formula", formula: deps.join(" + ") } : { kind: "fact", basis: "estimate", estimate: { value: { nominal: 1 }, reasoning: "r" } }]
        }))
        const order = sheetOrder(evaluate({ entries }), entries, nodes)
        for (const [from, to] of edges) expect(order.indexOf(to), `${mask} ${from}←${to}`).toBeLessThan(order.indexOf(from))
      }
    }
  })
})

describe("materialize on load", () => {
  it("repairs a stored value a hand edit broke", () => {
    dispose()
    handle.change((d) => (d.entries.pack_R_mOhm.value = { nominal: 1 }))
    dispose = AssumptionsView(handle, element, { repo })
    expect(handle.doc().entries.pack_R_mOhm.value).toMatchObject({ max: 4.4 })
    expect(handle.metadata().message).toBe("register: repair stored results")
    const copy = JSON.parse(JSON.stringify(handle.doc()))
    expect(materialize(copy, evaluate(copy))).toEqual([])
  })
})

describe("the structure lens", () => {
  const nodes = (sel) => [...element.querySelectorAll(`svg.graph ${sel}`)]
  const crumbs = () => element.querySelector(".structure-crumbs").textContent.replace(/\s+/g, " ").trim()

  it("opens on the map of groups, inputs left of outputs, with the groups linked to nothing listed below", () => {
    lens("structure")
    expect(crumbs()).toBe("All groups")
    expect(new Set(nodes("g.gnode").map((g) => g.getAttribute("data-sgroup")))).toEqual(new Set(["cell", "busbar", "pack", "fuse", "temp"]))
    const x = (name) => Number(element.querySelector(`g.gnode[data-sgroup="${name}"] rect`).getAttribute("x"))
    expect(x("cell")).toBeLessThan(x("pack"))
    expect(x("pack")).toBeLessThan(x("fuse"))
    expect(element.querySelector('g.gnode[data-sgroup="pack"]').getAttribute("aria-label")).toBe("pack: 3 entries (1 decided, 2 calculated)")
    const lines = nodes("path.edge").map((p) => `${p.dataset.u}>${p.dataset.v}`)
    expect(new Set(lines)).toEqual(new Set(["cell>pack", "busbar>pack", "pack>fuse", "pack>temp"]))
    expect(element.querySelector(".lens").textContent).toMatch(/Not linked to any other group: bilge 1 · bms 1/)
  })

  it("opens a group into its entries, between the groups they read and the groups that read them", () => {
    lens("structure")
    click(element.querySelector('g.gnode[data-sgroup="pack"]'))
    expect(crumbs()).toBe("All groups › pack")
    expect(new Set(nodes("g.pill").map((g) => g.getAttribute("data-open")))).toEqual(new Set(["pack_R_mOhm", "pack_I_kA", "pack_V_max"]))
    expect(new Set(nodes("g.gnode.end").map((g) => g.dataset.node))).toEqual(new Set(["in:cell", "in:busbar", "out:fuse", "out:temp"]))
    const x = (key) => Number(element.querySelector(`[data-node="${key}"] rect`).getAttribute("x"))
    expect(x("in:cell")).toBeLessThan(x("pack_V_max"))
    expect(x("pack_I_kA")).toBeLessThan(x("out:fuse"))
    expect(x("out:fuse")).toBe(x("out:temp"))
    // An outside group opens that group.
    click(element.querySelector('[data-node="in:cell"]'))
    expect(crumbs()).toBe("All groups › cell")
  })

  it("folds a group's unlinked entries into a line that shows them", () => {
    lens("structure")
    click(element.querySelector('.lens a[data-sgroup="bms"]'))
    expect(element.querySelector(".unread").textContent).toMatch(/1 entry reads nothing and nothing reads it/)
    click(element.querySelector("[data-show-unread]"))
    expect(element.querySelector('.unread a[data-open="bms_part"]')).not.toBeNull()
  })

  it("opens an entry from a group into its inputs and outputs, two steps each way, and the panel", () => {
    lens("structure")
    click(element.querySelector('g.gnode[data-sgroup="pack"]'))
    click(element.querySelector('g.pill[data-open="pack_I_kA"]'))
    expect(crumbs()).toBe("All groups › pack › pack_I_kA")
    expect(element.querySelector(".panel h2").textContent).toMatch(/pack_I_kA/)
    const boxes = nodes("g.node").map((g) => g.getAttribute("data-open"))
    expect(new Set(boxes)).toEqual(new Set(["pack_I_kA", "pack_V_max", "pack_R_mOhm", "cell_R_ac_mOhm", "busbar_R_mOhm", "fuse_ok"]))
    for (const g of nodes("g.node")) {
      expect(g.getAttribute("aria-label")).toMatch(new RegExp(`^${g.getAttribute("data-open")}`))
      expect(g.querySelector("title").textContent).toBe(g.getAttribute("aria-label"))
    }
    expect(element.querySelector('g.node[data-open="pack_I_kA"]').getAttribute("class")).toContain("focus")
    expect(element.querySelector('g.node[data-open="fuse_ok"]').getAttribute("aria-label")).toMatch(/DEPENDS/)
    // Opening another box re-centres on it; the breadcrumb goes back up.
    click(element.querySelector('g.node[data-open="busbar_R_mOhm"]'))
    expect(crumbs()).toBe("All groups › busbar › busbar_R_mOhm")
    click(element.querySelector('[data-structure="group"]'))
    expect(crumbs()).toBe("All groups › busbar")
    click(element.querySelector('[data-structure="map"]'))
    expect(crumbs()).toBe("All groups")
  })

  it("jumps to an entry's structure from the panel's Outputs", () => {
    lens("entries")
    for (const button of element.querySelectorAll('tr.group button[aria-expanded="false"]')) click(button)
    click(element.querySelector('tr[data-id="pack_R_mOhm"]'))
    click(element.querySelector("[data-structure-entry]"))
    expect(element.querySelector('[data-lens="structure"]').getAttribute("aria-selected")).toBe("true")
    expect(crumbs()).toBe("All groups › pack › pack_R_mOhm")
  })

  it("lights a node's lines when it is pointed at", () => {
    lens("structure")
    const pack = element.querySelector('g.gnode[data-sgroup="pack"]')
    pack.dispatchEvent(new Event("pointerover", { bubbles: true }))
    const svg = element.querySelector("svg.graph")
    expect(svg.classList.contains("lit")).toBe(true)
    expect(nodes("path.edge.on").length).toBe(4)
    expect(element.querySelector('g.gnode[data-sgroup="cell"]').classList.contains("on")).toBe(true)
    pack.dispatchEvent(new Event("pointerout", { bubbles: true }))
    expect(svg.classList.contains("lit")).toBe(false)
  })

  it("marks a stale result's group and the link it went stale along", () => {
    handle.change((d) => (d.entries.fuse_model_kA = { kind: "result", unit: "kA", basis: "model", model: { name: "Sim", tolerance: 0, inputs: { pack_V_max: { nominal: 50, dp: 1 } }, value: { nominal: 9, dp: 0 } } }))
    lens("structure")
    expect(element.querySelector('g.gnode[data-sgroup="fuse"]').getAttribute("class")).toContain("warn")
    expect(element.querySelector('g.gnode[data-sgroup="fuse"]').getAttribute("aria-label")).toMatch(/1 stale/)
    expect(element.querySelector('path.edge.hot[data-u="pack"][data-v="fuse"]')).not.toBeNull()
    click(element.querySelector('g.gnode[data-sgroup="pack"]'))
    expect(element.querySelector('g.pill[data-open="pack_V_max"]').getAttribute("class")).toContain("warn")
    expect(element.querySelector('[data-node="out:fuse"]').getAttribute("class")).toContain("warn")
  })
})

describe("the panel's inputs and outputs", () => {
  it("says an estimate reads nothing, and lists what reads it", () => {
    lens("entries")
    for (const button of element.querySelectorAll('tr.group button[aria-expanded="false"]')) click(button)
    click(element.querySelector('tr[data-id="busbar_R_mOhm"]'))
    const section = (title) => [...element.querySelectorAll(".panel section")].find((s) => s.querySelector("h3").textContent === title)
    expect(section("Inputs").textContent).toMatch(/None: an estimate reads no other entry/)
    expect(section("Outputs").textContent).toMatch(/1 direct · 2 further/)
    expect([...section("Outputs").querySelectorAll("a.id")].map((a) => a.textContent)).toEqual(["pack_R_mOhm", "pack_I_kA", "fuse_ok"])
  })

  it("lists a formula's inputs, and how far upstream it rests", () => {
    lens("entries")
    for (const button of element.querySelectorAll('tr.group button[aria-expanded="false"]')) click(button)
    click(element.querySelector('tr[data-id="pack_I_kA"]'))
    const inputs = [...element.querySelectorAll(".panel section")].find((s) => s.querySelector("h3").textContent === "Inputs")
    expect([...inputs.querySelectorAll("ul.io a.id")].map((a) => a.textContent)).toEqual(["pack_R_mOhm", "pack_V_max"])
    expect(inputs.textContent).toMatch(/At the far end it rests on/)
  })
})

describe("documents are links by name, never bare URLs", () => {
  it("shows a source, a model run and URLs in reasoning as their documents' titles", async () => {
    const source = repo.create()
    source.change((d) => Object.assign(d, { title: "EVE LF280K datasheet", content: "Nominal capacity 280Ah" }))
    const run = repo.create()
    run.change((d) => Object.assign(d, { title: "CFD run 1" }))
    handle.change((d) => {
      d.entries.cell_Ah = { kind: "fact", unit: "Ah", basis: "claims", claims: [{ key: "c1", source: source.url, quote: "Nominal capacity 280Ah", stated: { nominal: 280, dp: 0 }, verified: true, reading: "280 Ah" }] }
      d.entries.hull_R_N = { kind: "result", unit: "N", basis: "model", model: { url: run.url, name: "CFD", tolerance: 0, inputs: { cell_Ah: { nominal: 280, dp: 0 } }, value: { nominal: 2691, dp: 0 } } }
      d.entries.busbar_R_mOhm.estimate.reasoning = `Cited ${source.url} without a quote; see ${run.url}.`
    })
    for (const id of ["cell_Ah", "hull_R_N", "busbar_R_mOhm"]) {
      click(element.querySelector('[data-close]') ?? element)
      lens("entries")
      for (const button of element.querySelectorAll('tr.group button[aria-expanded="false"]')) click(button)
      click(element.querySelector(`tr[data-id="${id}"]`))
      await new Promise((r) => setTimeout(r, 20))
      expect(element.textContent, id).not.toMatch(/automerge:/)
    }
    const names = [...element.querySelectorAll("a.doc")].map((a) => a.textContent)
    expect(names).toContain("EVE LF280K datasheet")
    expect(names).toContain("CFD run 1")
    for (const a of element.querySelectorAll("a.doc")) expect(a.getAttribute("data-doc")).toMatch(/^automerge:/)
  })

  it("opens a document through Patchwork, not the browser", () => {
    const source = repo.create()
    handle.change((d) => (d.entries.busbar_R_mOhm.estimate.reasoning = `see ${source.url}`))
    lens("entries")
    for (const button of element.querySelectorAll('tr.group button[aria-expanded="false"]')) click(button)
    let opened = null
    element.addEventListener("patchwork:open-document", (e) => (opened = e.detail.url))
    const link = element.querySelector(`tr[data-id="busbar_R_mOhm"] a.doc`)
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(opened).toBe(source.url)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe("checking from the view", () => {
  const until = async (ok, what) => {
    for (let i = 0; i < 400; i++) {
      if (ok()) return
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  const make = (value) => {
    const h = repo.create()
    h.change((d) => Object.assign(d, value))
    return h
  }
  let folder, notebook, register
  beforeEach(() => {
    dispose?.()
    element.replaceChildren()
    notebook = make({ "@patchwork": { type: "jupyter-notebook" }, cells: [{ cell_type: "code", source: "P = pack_I_A ** 2 * pack_R_mOhm / 1000", outputs: [] }] })
    const report = make({ "@patchwork": { type: "file" }, name: "report.md", extension: "md", content: "Pack resistance 7 mΩ (`pack_R_mOhm`).\n" })
    folder = make({ "@patchwork": { type: "folder" }, title: "Task", docs: [{ name: "thermal.ipynb", type: "jupyter-notebook", url: notebook.url }, { name: "report.md", type: "file", url: report.url }] })
    register = repo.create()
    register.change((d) => {
      AssumptionsDatatype.init(d)
      d.title = "Thermal"
      d.scope = folder.url
      Object.assign(d.entries, {
        pack_I_A: { kind: "fact", unit: "A", basis: "estimate", estimate: { value: { nominal: 100, min: 90, max: 110 }, reasoning: "design day" } },
        pack_R_mOhm: { kind: "fact", unit: "mΩ", basis: "estimate", estimate: { value: { nominal: 6, min: 5, max: 7 }, reasoning: "cells + busbars" } },
        pack_heat_W: { kind: "result", unit: "W", basis: "model", model: { url: notebook.url, name: "thermal", tolerance: 0, inputs: { pack_I_A: { nominal: 100, min: 90, max: 110 }, pack_R_mOhm: { nominal: 6, min: 5, max: 7 } }, value: { nominal: 60 }, ran: {}, ranAt: null } },
      })
    })
  })
  const open = () => {
    dispose = AssumptionsView(register, element, { repo })
  }

  it("rescans the folder when it opens, and adds no change when nothing moved", async () => {
    open()
    await until(() => register.doc().scan, "the scan")
    expect(element.querySelector(".lens").textContent).toMatch(/PROSE\s*pack_R_mOhm = 6 mΩ: "report.md" line 1 says 7/)
    const heads = [...register.heads()]
    dispose()
    open()
    await new Promise((r) => setTimeout(r, 50))
    expect([...register.heads()]).toEqual(heads)
  })

  it("reads a model's new results by itself when the model runs while the register is open", async () => {
    notebook.change((d) => d.cells[0].outputs.push({ output_type: "stream", name: "stdout", text: "pack_heat_W 60.0\n" }))
    dispose = AssumptionsView(register, element, { repo, settleMs: 20 })
    await until(() => register.doc().entries.pack_heat_W.model.ranAt, "the first read")
    expect(register.doc().entries.pack_heat_W.model.by).toMatchObject({ kind: "document", url: notebook.url })
    // Someone runs the notebook in another tab.
    notebook.change((d) => (d.cells[0].outputs[0].text = "pack_heat_W 66.5\n"))
    await until(() => register.doc().entries.pack_heat_W.value?.nominal === 66.5, "the new result")
    await until(() => /Read 1 result from thermal.ipynb/.test(element.querySelector(".summary").textContent), "the note")
    expect(register.doc().entries.pack_heat_W.stale ?? null).toBeNull()
  })

  it("doesn't answer a model that re-renders on every change to the register: no write for a document whose version alone moved", async () => {
    open()
    await until(() => register.doc().scan, "the scan")
    await new Promise((r) => setTimeout(r, 50))
    // A model importing the register re-renders on each change to it and touches its own document, saying nothing new.
    let writes = 0
    register.on("change", () => writes++)
    for (let i = 0; i < 3; i++) {
      notebook.change((d) => (d.touched = i))
      dispose()
      open()
      await new Promise((r) => setTimeout(r, 60))
    }
    expect(writes).toBe(0)
  })

  it("shows its progress while it checks, and Stop leaves the last check standing", async () => {
    const slow = { find: async (url) => (await new Promise((r) => setTimeout(r, 30)), repo.find(url)) }
    dispose = AssumptionsView(register, element, { repo: slow })
    await until(() => element.querySelector(".summary .progress"), "progress")
    expect(element.querySelector(".summary").textContent).toMatch(/checking…/)
    await until(() => register.doc().scan, "the first check")
    expect(element.querySelector(".summary").textContent).toMatch(/Check the folder/)
    const heads = [...register.heads()]
    click(element.querySelector("[data-check]"))
    await until(() => /\d+ documents?/.test(element.querySelector(".summary .progress")?.textContent ?? ""), "a count")
    click(element.querySelector("[data-check-stop]"))
    await until(() => /Stopped; the last check stands/.test(element.querySelector(".summary").textContent), "the stop")
    expect([...register.heads()]).toEqual(heads)
  })

  it("records a run from the panel, and Check the folder marks it stale when its code changes", async () => {
    open()
    await until(() => register.doc().scan, "the scan")
    entriesOpen()
    click(element.querySelector('tr[data-id="pack_heat_W"]'))
    expect(element.querySelector(".panel").textContent).toMatch(/No documents are recorded for this run/)
    click(element.querySelector('[data-form="run"]'))
    const form = element.querySelector('form[data-submit="run"]')
    form.querySelector('input[name="value"]').value = "61"
    form.querySelector('input[name="who"]').value = "Sam"
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    await until(() => register.doc().entries.pack_heat_W.model.ranAt, "the run")
    const model = register.doc().entries.pack_heat_W.model
    expect(model).toMatchObject({ value: { nominal: 61 }, by: { kind: "person", who: "Sam" } })
    expect(Object.keys(model.ran)).toEqual([notebook.url])

    notebook.change((d) => (d.cells[0].source += "  # I²R"))
    click(element.querySelector("[data-check]"))
    await until(() => register.doc().entries.pack_heat_W.stale, "staleness")
    expect(register.doc().entries.pack_heat_W.stale).toEqual([{ doc: notebook.url, path: "thermal.ipynb", reason: "changed" }])
    expect(element.querySelector(".panel").textContent).toMatch(/CODE CHANGED/)
    expect(element.querySelector(".panel").textContent).toMatch(/STALE the code in "thermal.ipynb" changed/)
    expect(register.doc().entries.pack_heat_W.value.nominal).toBe(61)
  })
})
