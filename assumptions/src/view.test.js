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
    expect(element.querySelector(".summary").textContent).toMatch(/^11 entries · \d+ needs? attention · requirements: 1 fail, 1 depend · 1 unknown · not yet scanned$/)
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
    expect([...panel().querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Value", "Basis", "Rests on and feeds", "Used in", "Judgements and history"])
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
