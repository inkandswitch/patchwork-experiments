import { beforeEach, describe, expect, it } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { check, create, exportTool, read, set, where } from "./agent-tools.js"
import { outOfDate } from "./consistency.js"

await initSubduction()

let repo, ctx, folder

function makeDoc(value) {
  const handle = repo.create()
  handle.change((d) => Object.assign(d, value))
  return handle
}

function file(name, doc) {
  const handle = makeDoc(doc)
  folder.change((d) => d.docs.push({ name, type: doc["@patchwork"]?.type ?? "file", url: handle.url }))
  return handle
}

beforeEach(() => {
  repo = new Repo({ network: [] })
  ctx = { repo, sessionUrl: "automerge:session" }
  folder = makeDoc({ "@patchwork": { type: "folder" }, title: "Task", docs: [] })
})

async function newRegister() {
  const made = await create.execute({ folder: folder.url, title: "Battery assumptions" }, ctx)
  return made.doc.url
}

const sheet = () =>
  makeDoc({
    "@patchwork": { type: "file" },
    name: "EVE LF280K Ver B.md",
    content: "# Item  Parameter  Remark\n3 AC Impedance Resistance(1KHz)  ≤0.25 mΩ\nBattery weight  5.42± 0.3 kg\nNominal capacity 280Ah\nTypical Voltage 3.2V\n",
  })

describe("set", () => {
  it("verifies quotes, reads their qualifiers, and computes support", async () => {
    const register = await newRegister()
    const source = sheet().url
    const out = await set.execute(
      {
        register,
        entries: [
          { id: "cell_R_ac_mOhm", unit: "mΩ", claims: [{ source, quote: "AC Impedance Resistance(1KHz)  ≤0.25 mΩ", stated: 0.25, sourceKind: "datasheet", subject: "EVE LF280K Ver B" }] },
          { id: "cell_mass_kg", unit: "kg", claims: [{ source, quote: "Battery weight  5.42± 0.3 kg", stated: "5.42 ± 0.3", sourceKind: "datasheet" }] },
        ],
      },
      ctx,
    )
    expect(out).toMatch(/Wrote 2 entries/)
    expect(out).toContain("cell_R_ac_mOhm ≤ 0.25 mΩ · fact, supported")
    expect(out).toContain("cite: ≤ 0.25 mΩ (`cell_R_ac_mOhm`)")
    const doc = (await repo.find(register)).doc()
    expect(doc.entries.cell_R_ac_mOhm.value).toEqual({ max: 0.25, dp: 2 })
    expect(doc.entries.cell_R_ac_mOhm.claims[0]).toMatchObject({ key: "c1", verified: true, reading: "upper bound 0.25 mΩ", section: "Item  Parameter  Remark", by: { kind: "agent", session: "automerge:session" } })
    expect(doc.entries.cell_mass_kg.support).toMatchObject({ level: "supported", conflicting: false })
  })

  it("refuses what the register can't stand behind, and says how to fix it", async () => {
    const register = await newRegister()
    const source = sheet().url
    const refused = async (entry) => (await set.execute({ register, entries: [entry] }, ctx)).split("\n").slice(1).join("\n")
    expect(await refused({ id: "cell_mass_kg", claims: [{ source, quote: "Battery weight 5.49 kg", stated: 5.49 }] })).toMatch(/quote is not in/)
    expect(await refused({ id: "cell_mass_kg", claims: [{ source, quote: "Battery weight  5.42± 0.3 kg", stated: 5.49 }] })).toMatch(/stated 5.49 is not in the quote/)
    expect(await refused({ id: "cell_R_mOhm", claims: [{ source, quote: "≤0.25 mΩ", stated: { min: 0.25 } }] })).toMatch(/reads as upper bound/)
    expect(await refused({ id: "cell_mass_kg", value: 5.4 })).toMatch(/no free-standing/)
    expect(await refused({ id: "cell_mass_kg", estimate: { value: 5.4 } })).toMatch(/reasoning/)
    expect(await refused({ id: "a_x", formula: "b_x * 2" })).toMatch(/b_x, which isn't in the register/)
    expect(await refused({ id: "hull_drag_N", model: { name: "CFD", inputs: [] }, value: 40 })).toMatch(/model.inputs/)
    expect(await refused({ id: "cell_spare_n", estimate: { value: 2, reasoning: "r" }, use: "unused" })).toMatch(/says why/)
    expect(await refused({ id: "cell_mass_kg", claims: [{ stated: 5.42, quote: "5.42 kg" }, { stated: 5.49, quote: "5.49 kg" }] })).toMatch(/none is picked/)
    expect(await refused({ id: "cell_mass_kg", claims: [{ stated: 5.42, quote: "5.42" }], estimate: { value: 1, reasoning: "r" } })).toMatch(/one basis/)
  })

  it("refuses a formula cycle, and only the entries on it", async () => {
    const register = await newRegister()
    const out = await set.execute(
      {
        register,
        entries: [
          { id: "a_x", choice: { value: 2 } },
          { id: "b_x", formula: "a_x + c_x" },
          { id: "c_x", formula: "b_x * 2" },
          { id: "d_x", formula: "a_x * 3" },
        ],
      },
      ctx,
    )
    expect(out).toMatch(/cycle/)
    const doc = (await repo.find(register)).doc()
    expect(Object.keys(doc.entries).sort()).toEqual(["a_x", "d_x"])
    expect(doc.entries.d_x.value).toMatchObject({ nominal: 6 })
  })

  it("records a model's inputs itself, pins its document, and marks it stale when one moves", async () => {
    const register = await newRegister()
    const cfd = makeDoc({ "@patchwork": { type: "file" }, name: "case" })
    await set.execute({ register, entries: [{ id: "boat_mass_kg", estimate: { value: { nominal: 1500, min: 1400, max: 1600 }, reasoning: "hull + rig" } }] }, ctx)
    await set.execute({ register, entries: [{ id: "boat_drag_N", model: { url: cfd.url, name: "CFD", inputs: ["boat_mass_kg"], tolerance: 0.02 }, value: { nominal: 40, min: 38, max: 42 } }] }, ctx)
    let doc = (await repo.find(register)).doc()
    expect(doc.entries.boat_drag_N.model.inputs.boat_mass_kg).toMatchObject({ nominal: 1500, min: 1400, max: 1600 })
    expect(doc.entries.boat_drag_N.model.url).toContain("#")
    await set.execute({ register, entries: [{ id: "boat_mass_kg", estimate: { value: { nominal: 1520, min: 1420, max: 1620 }, reasoning: "hull + rig" } }] }, ctx)
    expect((await repo.find(register)).doc().entries.boat_drag_N.stale ?? null).toBeNull()
    await set.execute({ register, entries: [{ id: "boat_mass_kg", estimate: { value: { nominal: 1600, min: 1500, max: 1700 }, reasoning: "battery added" } }] }, ctx)
    doc = (await repo.find(register)).doc()
    expect(doc.entries.boat_drag_N.stale).toEqual([{ input: "boat_mass_kg", reason: "moved" }])
    expect(await read.execute({ register }, ctx)).toMatch(/STALE\s+boat_drag_N: boat_mass_kg moved since the model ran/)
  })

  it("writes results back in the same change, with the why as the change's message", async () => {
    const register = await newRegister()
    await set.execute(
      {
        register,
        entries: [
          { id: "pack_cells_n", kind: "decision", value: 16 },
          { id: "cell_V_nom", unit: "V", estimate: { value: { nominal: 3.2, min: 3.1, max: 3.3 }, reasoning: "LFP nominal" } },
          { id: "pack_V_nom", unit: "V", formula: "pack_cells_n * cell_V_nom" },
        ],
        why: "first pass at the pack",
      },
      ctx,
    )
    const handle = await repo.find(register)
    const doc = handle.doc()
    expect(doc.entries.pack_V_nom.value).toMatchObject({ nominal: 51.2, min: 49.6, max: 52.8 })
    expect(doc.entries.pack_V_nom.derived.inputs).toMatchObject({ pack_cells_n: { nominal: 16, exact: true } })
    expect(outOfDate(doc).size).toBe(0)
    expect(handle.metadata().message).toBe("agent automerge:session: first pass at the pack")
  })

  it("keeps a person's claims and judgements unless told why, and answers judgements", async () => {
    const register = await newRegister()
    await set.execute({ register, entries: [{ id: "vent_H2_frac", estimate: { value: { nominal: 0.3, min: 0.2, max: 0.4 }, reasoning: "literature" } }] }, ctx)
    const handle = await repo.find(register)
    handle.change((d) => {
      d.entries.vent_H2_frac.judgements = [{ key: "j1", by: { kind: "person", who: "Ana" }, at: [], on: null, verdict: "disagrees", says: "this figure is for NMC cells" }]
    })
    let out = await read.execute({ register }, ctx)
    expect(out).toMatch(/JUDGEMENTS TO ANSWER\n {2}vent_H2_frac = 0.3 · CONFLICT, judgement by Ana: "this figure is for NMC cells"/)
    expect(out).toMatch(/CONFLICT vent_H2_frac/)
    out = await set.execute({ register, answers: [{ id: "vent_H2_frac", judgement: "j1", says: "looking for an LFP measurement; kept as weak meanwhile" }] }, ctx)
    expect(out).toMatch(/answered 1 judgement/)
    out = await read.execute({ register }, ctx)
    expect(out).not.toMatch(/JUDGEMENTS TO ANSWER/)
    // Still conflicting: an answer doesn't overrule a person.
    expect((await repo.find(register)).doc().entries.vent_H2_frac.support).toMatchObject({ level: "weak", conflicting: true })

    handle.change((d) => {
      d.entries.vent_H2_frac.basis = "claims"
      d.entries.vent_H2_frac.claims = [{ key: "c1", stated: { nominal: 0.3 }, by: { kind: "person", who: "Ana" } }]
    })
    out = await set.execute({ register, entries: [{ id: "vent_H2_frac", claims: [{ stated: 0.25, quote: "H2 0.25" }] }] }, ctx)
    expect(out).toMatch(/drops a person's claim \(c1\)/)
    out = await set.execute({ register, entries: [{ id: "vent_H2_frac", claims: [{ key: "c1" }, { stated: 0.3, quote: "H2 0.3 by volume" }] }] }, ctx)
    expect(out).toMatch(/Wrote 1 entry/)
  })
})

describe("check and where", () => {
  it("scans the folder, saves the scan with each document's heads, and rereads only what changed", async () => {
    const register = await newRegister()
    await set.execute(
      {
        register,
        entries: [
          { id: "pack_V_max", unit: "V", kind: "decision", value: 58.4 },
          { id: "pack_R_min_mOhm", unit: "mΩ", estimate: { value: { nominal: 6.09, min: 5.5, max: 7 }, reasoning: "busbars + cells" } },
          { id: "pack_Isc_kA", unit: "kA", formula: "pack_V_max / pack_R_min_mOhm" },
          { id: "cell_storage_soc_frac", estimate: { value: { min: 0.3, max: 0.5 }, reasoning: "manufacturer advice" } },
        ],
      },
      ctx,
    )
    const report = file("report.md", { "@patchwork": { type: "file" }, name: "report.md", extension: "md", content: "Short-circuit current 8.9 kA (`pack_Isc_kA`).\n" })
    file("model.py", { "@patchwork": { type: "file" }, name: "model.py", extension: "py", content: "V = pack_V_max\nI = V / pack_R_min_mOhm\nR_contact = 0.05e-3  # from memory\n" })

    let out = await check.execute({ register }, ctx)
    expect(out).toMatch(/PROSE\s+pack_Isc_kA = 9.59 kA: "report.md" line 1 says 8.9/)
    expect(out).toMatch(/fix: write the figure there as 9.59 kA \(`pack_Isc_kA`\)/)
    expect(out).toMatch(/UNUSED\?\s+cell_storage_soc_frac 0.3–0.5: unused/)
    expect(out).toMatch(/CONSTANTS IN MODEL CODE \(1\)[\s\S]*R_contact = 0.00005\s+# from memory/)
    expect(out).toMatch(/Link the register as it stood: automerge:.+#/)
    let doc = (await repo.find(register)).doc()
    expect(doc.scan.read).toBe(2)
    expect(Object.values(doc.scan.docs).every((d) => d.heads.length > 0)).toBe(true)

    report.change((d) => (d.content = "Short-circuit current 9.59 kA (`pack_Isc_kA`).\n"))
    out = await check.execute({ register }, ctx)
    doc = (await repo.find(register)).doc()
    expect([doc.scan.read, doc.scan.reused]).toEqual([1, 1])
    expect(out).not.toMatch(/PROSE/)

    out = await where.execute({ register, id: "pack_R_min_mOhm" }, ctx)
    expect(out).toMatch(/register: pack_Isc_kA/)
    expect(out).toMatch(/model: 1\n {4}model.py:2 {2}I = V \/ pack_R_min_mOhm/)
  })

  it("exports nominals and stated bounds only, at full precision", async () => {
    const register = await newRegister()
    const source = sheet().url
    await set.execute(
      {
        register,
        entries: [
          { id: "cell_R_ac_mOhm", claims: [{ source, quote: "≤0.25 mΩ", stated: 0.25, sourceKind: "datasheet" }] },
          { id: "pack_third_x", formula: "1 / 3" },
          { id: "bilge_vol_m3", unknown: { settle: "measure the CAD" } },
          { id: "bms_part", kind: "decision", value: "REC 2Q" },
        ],
      },
      ctx,
    )
    await exportTool.execute({ register, format: "python" }, ctx)
    const exported = (await repo.find(folder.doc().docs.find((d) => d.name.endsWith(".py")).url)).doc().content
    expect(exported).toMatch(/^cell_R_ac_mOhm_max = 0\.25/m)
    expect(exported).not.toMatch(/^cell_R_ac_mOhm = /m)
    expect(exported).toMatch(/^pack_third_x = 0\.3333333333333333/m)
    expect(exported).toMatch(/No value yet \(unknowns\): bilge_vol_m3/)
    expect(exported).toMatch(/^bms_part = "REC 2Q"/m)
  })
})

describe("read with structure", () => {
  async function wired() {
    const register = await newRegister()
    await set.execute(
      {
        register,
        entries: [
          { id: "cell_V", unit: "V", estimate: { value: { nominal: 3.2, min: 3.1, max: 3.3 }, reasoning: "LFP" } },
          { id: "cell_n", kind: "decision", choice: { value: 16 } },
          { id: "pack_V", unit: "V", formula: "cell_V * cell_n" },
          { id: "pack_A", unit: "A", estimate: { value: { nominal: 100, min: 90, max: 110 }, reasoning: "motor" } },
          { id: "fuse_ok", check: "pack_V <= 60" },
          { id: "bms_note", estimate: { value: 1, reasoning: "spare" } },
        ],
      },
      ctx,
    )
    return register
  }

  it("gives the map of groups in flow order, with what each reads, and the groups linked to nothing", async () => {
    const out = await read.execute({ register: await wired(), structure: "all" }, ctx)
    expect(out).toMatch(/^STRUCTURE: 4 groups \(an id's first word\), 3 links between entries, 0 of them inside a group/)
    const lines = out.split("\n")
    const at = (g) => lines.findIndex((l) => l.startsWith(`  ${g} `))
    expect(at("cell")).toBeLessThan(at("pack"))
    expect(at("pack")).toBeLessThan(at("fuse"))
    expect(lines[at("pack")]).toBe("  pack 2 (1 estimated, 1 calculated) · reads cell 2")
    expect(out).toMatch(/NOT LINKED TO ANY OTHER GROUP: bms 1/)
  })

  it("gives one group's entries, given and computed, and one entry's inputs and outputs", async () => {
    const register = await wired()
    const group = await read.execute({ register, structure: "pack" }, ctx)
    expect(group).toMatch(/^STRUCTURE OF GROUP pack: 2 entries · reads cell 2 · read by fuse 1/)
    expect(group).toMatch(/COMPUTED \(1\)[^\n]*\n  pack_V = [^\n]* · reads cell_V, cell_n · and by fuse 1/)
    expect(group).toMatch(/READ BY NOTHING AND READING NOTHING \(1\): pack_A/)
    const entry = await read.execute({ register, structure: "cell_V" }, ctx)
    expect(entry).toMatch(/inputs: none: an estimate reads no other entry/)
    expect(entry).toMatch(/outputs \(1 direct, 1 further\):\n\s+pack_V = [^\n]*\n\s+further: fuse_ok/)
    expect(await read.execute({ register, structure: "nope" }, ctx)).toMatch(/No group or entry "nope". Groups: bms, cell, fuse, pack/)
  })
})
