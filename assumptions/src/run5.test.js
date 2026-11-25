/**
 * The acceptance test: Run 5 audited Run 3's report against its sources by
 * hand and found twelve discrepancies. Nine are mechanical, and the register
 * must report each one; the other three must be visible where a person looks.
 * The register here is built through the agent's own tools from Run 5's quotes.
 */

import { beforeAll, describe, expect, it } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { check, create, read, set } from "./agent-tools.js"
import { plugins } from "../index.js"

await initSubduction()

let repo, ctx, folder, register, problems, checked

const doc = (value) => {
  const handle = repo.create()
  handle.change((d) => Object.assign(d, value))
  return handle
}
const file = (name, value) => {
  const handle = doc(value)
  folder.change((d) => d.docs.push({ name, type: value["@patchwork"]?.type ?? "file", url: handle.url }))
  return handle
}

beforeAll(async () => {
  repo = new Repo({ network: [] })
  ctx = { repo, session: { url: "automerge:run", doc: () => ({}) } }
  folder = doc({ "@patchwork": { type: "folder" }, docs: [] })
  register = (await create.execute({ folder: folder.url, title: "Run 3, as Run 5 found it" }, ctx)).doc.url

  const eveB = doc({ "@patchwork": { type: "file" }, content: "# Item  Parameter  Remark\n3 AC Impedance Resistance(1KHz)  ≤0.25 mΩ\nBattery weight  5.42± 0.3 kg\nCharge temperature 0~55℃\nMaximum operating temperature 55 ℃\n" }).url
  const eveA = doc({ "@patchwork": { type: "file" }, content: "Battery weight 5.49±0.3 kg\n" }).url
  const recMaster = doc({ "@patchwork": { type: "file" }, content: "REC BMS master unit. Maximum pack voltage 60 V.\n" }).url
  const rec2q = doc({ "@patchwork": { type: "file" }, content: "REC Q 2Q BMS. Default cell under-voltage switch-off 2.80 V.\n" }).url
  const cerbo = doc({ "@patchwork": { type: "file" }, content: "Cerbo GX: pre-disconnect warning 30 s before the BMS opens.\n" }).url
  const shop = doc({ "@patchwork": { type: "file" }, content: "Rated current 600 A — buy now\n" }).url

  const out = await set.execute(
    {
      register,
      entries: [
        { id: "bms_part", kind: "decision", choice: { value: "REC 2Q", alternatives: [{ value: "Orion" }, { value: "Batrium" }] } },
        // 1: the 60 V limit is from the REC master unit's manual
        { id: "bms_V_pack_max", unit: "V", kind: "requirement", about: "bms_part", claims: [{ source: recMaster, quote: "Maximum pack voltage 60 V", stated: "≤ 60", subject: "REC BMS master unit", sourceKind: "datasheet" }] },
        // 2: the 2Q's under-voltage switch-off is 2.80 V; the report shows "–"
        { id: "bms_V_cell_min", unit: "V", about: "bms_part", claims: [{ source: rec2q, quote: "Default cell under-voltage switch-off 2.80 V", stated: 2.8, subject: "REC 2Q", sourceKind: "datasheet" }] },
        // 3: the trip temperature equals the cell maximum
        { id: "cell_T_max_C", unit: "°C", claims: [{ source: eveB, quote: "Maximum operating temperature 55 ℃", stated: { nominal: 55, exact: true }, sourceKind: "datasheet" }] },
        { id: "bms_T_trip_C", unit: "°C", kind: "decision", value: 55 },
        { id: "bms_T_margin_ok", check: "bms_T_trip_C < cell_T_max_C" },
        // 5: the pre-disconnect warning is the Cerbo's, not the BMS's
        { id: "bms_warn_s", unit: "s", about: "bms_part", claims: [{ source: cerbo, quote: "pre-disconnect warning 30 s", stated: 30, subject: "Cerbo GX", sourceKind: "datasheet" }] },
        // 6: 58.4 V / 6.09 mΩ is 9.59 kA, not 8.9; the notebook's 54.4 V is unsourced
        { id: "pack_V_max", unit: "V", kind: "decision", value: 58.4 },
        { id: "busbar_R_contact_mOhm", unit: "mΩ", estimate: { value: { nominal: 0.2, min: 0.1, max: 0.4 }, reasoning: "typical for M6 torqued lugs" } },
        { id: "cell_R_ac_mOhm", unit: "mΩ", claims: [{ source: eveB, quote: "AC Impedance Resistance(1KHz)  ≤0.25 mΩ", stated: 0.25, sourceKind: "datasheet", subject: "EVE LF280K Ver B" }] },
        { id: "pack_R_min_mOhm", unit: "mΩ", estimate: { value: { nominal: 6.09, min: 5.5, max: 7 }, reasoning: "cells + busbars + contacts" } },
        { id: "pack_Isc_kA", unit: "kA", formula: "pack_V_max / pack_R_min_mOhm", use: "reference" },
        { id: "notebook_V_fault", unit: "V", estimate: { value: 54.4, reasoning: "used in the notebook, no source" }, use: "reference" },
        // 7: "≤ 0.25 mΩ" is a maximum, so the worst-case fault current has no upper bound
        { id: "pack_R_worst_mOhm", unit: "mΩ", formula: "16 * cell_R_ac_mOhm + busbar_R_contact_mOhm" },
        { id: "pack_I_fault_kA", unit: "kA", formula: "pack_V_max / pack_R_worst_mOhm" },
        { id: "fuse_I_break_kA", unit: "kA", estimate: { value: { nominal: 20, min: 20, max: 20 }, reasoning: "JLLN class T rating" } },
        { id: "fuse_I_interrupt_ok", check: "pack_I_fault_kA <= fuse_I_break_kA" },
        // 9: the rated current came from a shop's page
        { id: "fuse_I_rated_A", unit: "A", claims: [{ source: shop, quote: "Rated current 600 A", stated: 600, sourceKind: "retailer" }], use: "reference" },
        // 10: the disconnect rule applies only above 800 A CCA, and not under 8 m
        { id: "pack_cca_A", unit: "A", estimate: { value: { nominal: 1000, min: 900, max: 1100 }, reasoning: "starter-class discharge" } },
        { id: "boat_len_m", unit: "m", kind: "decision", value: 6.1 },
        { id: "tp1332_disconnect_ok", check: "pack_cca_A <= 800", appliesIf: "pack_cca_A > 800 and boat_len_m >= 8" },
        // 12: busbar and contact resistances inside a total
        { id: "pack_R_total_mOhm", unit: "mΩ", formula: "16 * 0.25 + busbar_R_contact_mOhm + pack_R_min_mOhm" },
      ],
    },
    ctx,
  )
  expect(out, out).not.toMatch(/Not written/)
  // 8: EVE A and B disagree; the register won't mix them without a pick
  const mixed = await set.execute({ register, entries: [{ id: "cell_mass_kg", unit: "kg", claims: [{ source: eveB, quote: "Battery weight  5.42± 0.3 kg", stated: "5.42 ± 0.3", sourceKind: "datasheet", origin: "EVE" }, { source: eveA, quote: "Battery weight 5.49±0.3 kg", stated: "5.49 ± 0.3", sourceKind: "datasheet", origin: "EVE" }] }] }, ctx)
  expect(mixed).toMatch(/Nothing written[\s\S]*claims disagree and none is picked/)

  file("report.md", {
    "@patchwork": { type: "file" },
    extension: "md",
    content: [
      "| BMS under-voltage switch-off (`bms_V_cell_min`) | – |",
      "Prospective short-circuit current 8.9 kA (`pack_Isc_kA`), from 58.4 V (`pack_V_max`).",
      "Rated current 600 A (`fuse_I_rated_A`).",
      "Notebook fault voltage 54.4 V (`notebook_V_fault`).",
      "Pack voltage limit ≤ 60 V (`bms_V_pack_max`), warning 30 s (`bms_warn_s`), resistance (`pack_R_total_mOhm`) 10.3 mΩ.",
    ].join("\n"),
  })
  file("electrical.py", { "@patchwork": { type: "file" }, extension: "py", content: "I = pack_V_max / pack_R_worst_mOhm\nAMPACITY = 400  # unsourced\nSHEAR_kN = 20  # A4-70 shear, from memory\nx = fuse_I_break_kA + cell_T_max_C + bms_T_trip_C + pack_cca_A + boat_len_m\n" })
  checked = await check.execute({ register }, ctx)
  problems = checked.split("\n")
})

const has = (kind, pattern) => problems.some((line) => line.trim().startsWith(kind) && pattern.test(line))

describe("the nine mechanical catches", () => {
  it("1: a limit cited from another product's manual (subject check)", () => {
    expect(has("SUBJECT", /bms_V_pack_max: its claim c1 is about "REC BMS master unit"; it is about bms_part = "REC 2Q"/)).toBe(true)
  })
  it("2: a figure the report shows as '–' (prose check)", () => {
    expect(has("PROSE", /bms_V_cell_min = 2.80 V: "report.md" line 1 says no number/)).toBe(true)
  })
  it("3: a trip temperature equal to the cell maximum (requirement check)", () => {
    expect(has("FAILS", /bms_T_margin_ok/)).toBe(true)
  })
  it("5: a figure that is the Cerbo's, not the BMS's (subject check)", () => {
    expect(has("SUBJECT", /bms_warn_s: its claim c1 is about "Cerbo GX"/)).toBe(true)
  })
  it("6: the register does the division, and prose saying 8.9 disagrees; 54.4 V shows as an estimate", () => {
    expect(has("PROSE", /pack_Isc_kA = 9.59 kA: "report.md" line 2 says 8.9/)).toBe(true)
  })
  it("7: a maximum used as the lowest resistance: the fuse check depends, naming it", () => {
    expect(has("DEPENDS", /fuse_I_interrupt_ok: .*cell_R_ac_mOhm has no lower bound/)).toBe(true)
  })
  it("8: two datasheet editions that disagree are not mixed without a pick", async () => {
    // Asserted in setup: the write was refused, naming the pick.
    expect(await read.execute({ register, ids: ["cell_mass_kg"] }, ctx)).toMatch(/No entries cell_mass_kg/)
  })
  it("10: a rule that applies only above 800 A CCA and 8 m is n/a for a 6.1 m boat", async () => {
    expect(await read.execute({ register, ids: ["tp1332_disconnect_ok"] }, ctx)).toMatch(/tp1332_disconnect_ok · requirement, n\/a/)
  })
  it("11: constants written into the notebook (constants lint)", () => {
    expect(checked).toMatch(/CONSTANTS IN MODEL CODE \(2\)[\s\S]*AMPACITY = 400[\s\S]*SHEAR_kN = 20/)
  })
})

describe("the three a person sees where they look", () => {
  it("9: a shop's figure is weak, and says what kind of source it is", async () => {
    expect(await read.execute({ register, ids: ["fuse_I_rated_A"] }, ctx)).toMatch(/fuse_I_rated_A = 600 A, no bounds · fact, weak · retailer/)
  })
  it("12: the total's trace shows which leaves are estimates", async () => {
    const out = await read.execute({ register, ids: ["pack_R_total_mOhm"], detail: true }, ctx)
    expect(out).toMatch(/pack_R_total_mOhm = 16 × 0.25 \+ busbar_R_contact_mOhm \+ pack_R_min_mOhm = 16 × 0.25 \+ 0.2 mΩ \+ 6.09 mΩ = 10.3 mΩ \(9.6–11.4\)/)
    expect(out).toMatch(/rests on 2 weak/)
    expect(out).toMatch(/rests on: busbar_R_contact_mOhm \(weak\), pack_R_min_mOhm \(weak\)/)
  })
  it("4: a claim's quote sits beside the decision it bears on", async () => {
    const out = await read.execute({ register, ids: ["bms_V_cell_min"], detail: true }, ctx)
    expect(out).toMatch(/"Default cell under-voltage switch-off 2.80 V" · read as 2.80 V, spread not stated · found in the kept source/)
  })
})

describe("the presentation", () => {
  it("every fix line names only tools and arguments this package defines", () => {
    const tools = plugins.filter((p) => p.type === "agent:tool")
    const ids = new Set(tools.map((t) => t.id))
    const args = new Set()
    const walk = (schema) => {
      for (const [key, sub] of Object.entries(schema?.properties ?? {})) {
        args.add(key)
        walk(sub)
        walk(sub.items)
      }
    }
    for (const t of tools) walk(t.input_schema)
    const fixes = problems.filter((l) => l.trim().startsWith("fix:") || /answer: /.test(l))
    expect(fixes.length).toBeGreaterThan(5)
    for (const line of fixes) {
      for (const [name] of line.matchAll(/\bassumptions_\w+/g)) expect(ids, line).toContain(name)
      for (const [, arg] of line.matchAll(/`([a-zA-Z]+)`/g)) expect(args, `${arg} in ${line}`).toContain(arg)
    }
  })

  it("a read with no filter stays short however big the register is", async () => {
    const big = (await create.execute({ folder: folder.url, title: "Big" }, ctx)).doc.url
    const groups = ["cell", "pack", "bms", "hull", "vent", "barrier", "fuse", "cable", "motor", "solar"]
    const entries = Array.from({ length: 300 }, (_, i) => ({ id: `${groups[i % 10]}_x${i}_kg`, estimate: { value: { nominal: i + 1, min: i, max: i + 2 }, reasoning: "generated" } }))
    for (let i = 0; i < 300; i += 100) await set.execute({ register: big, entries: entries.slice(i, i + 100) }, ctx)
    const out = await read.execute({ register: big }, ctx)
    expect(out.length).toBeLessThan(3500)
    expect(out).toMatch(/^Big · 300 entries/)
    const page = await read.execute({ register: big, prefix: "cell_" }, ctx)
    expect(page.split("\n").filter((l) => l.startsWith("  cell_")).length).toBe(30)
  })
})
