import { beforeEach, describe, expect, it } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { check, create, exportTool, read, set, where } from "./agent-tools.js"
import { registerReads } from "./check.js"
import { runKeyOf } from "./where.js"
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

  it("records a model's inputs itself, the version of the document it read, and marks it stale when an input moves", async () => {
    const register = await newRegister()
    const cfd = makeDoc({ "@patchwork": { type: "file" }, name: "case" })
    await set.execute({ register, entries: [{ id: "boat_mass_kg", estimate: { value: { nominal: 1500, min: 1400, max: 1600 }, reasoning: "hull + rig" } }] }, ctx)
    await set.execute({ register, entries: [{ id: "boat_drag_N", model: { url: cfd.url, name: "CFD", inputs: ["boat_mass_kg"], tolerance: 0.02 }, value: { nominal: 40, min: 38, max: 42 } }] }, ctx)
    let doc = (await repo.find(register)).doc()
    expect(doc.entries.boat_drag_N.model.inputs.boat_mass_kg).toMatchObject({ nominal: 1500, min: 1400, max: 1600 })
    expect(doc.entries.boat_drag_N.model.url).toBe(cfd.url)
    expect(doc.entries.boat_drag_N.model.ran[cfd.url]).toMatchObject({ heads: [...cfd.heads()], code: expect.stringMatching(/^[th]:/) })
    expect(doc.entries.boat_drag_N.model.by).toEqual({ kind: "agent", session: "automerge:session" })
    await set.execute({ register, entries: [{ id: "boat_mass_kg", estimate: { value: { nominal: 1520, min: 1420, max: 1620 }, reasoning: "hull + rig" } }] }, ctx)
    expect((await repo.find(register)).doc().entries.boat_drag_N.stale ?? null).toBeNull()
    await set.execute({ register, entries: [{ id: "boat_mass_kg", estimate: { value: { nominal: 1600, min: 1500, max: 1700 }, reasoning: "battery added" } }] }, ctx)
    doc = (await repo.find(register)).doc()
    expect(doc.entries.boat_drag_N.stale).toEqual([{ input: "boat_mass_kg", reason: "moved" }])
    expect(await read.execute({ register }, ctx)).toMatch(/STALE\s+boat_drag_N: boat_mass_kg moved since the model ran/)
    // A label is not a new run: it leaves what the run recorded, and so its staleness, alone.
    await set.execute({ register, entries: [{ id: "boat_drag_N", label: "Drag at 6 kn" }] }, ctx)
    doc = (await repo.find(register)).doc()
    expect(doc.entries.boat_drag_N.stale).toEqual([{ input: "boat_mass_kg", reason: "moved" }])
    expect(doc.entries.boat_drag_N.model.inputs.boat_mass_kg.nominal).toBe(1500)
    // A new output is a new run: inputs and documents are recorded again.
    await set.execute({ register, entries: [{ id: "boat_drag_N", value: { nominal: 42, min: 40, max: 44 } }] }, ctx)
    doc = (await repo.find(register)).doc()
    expect(doc.entries.boat_drag_N.stale ?? null).toBeNull()
    expect(Object.keys(doc.entries.boat_drag_N.model.ran)).toEqual([cfd.url])
  })

  it("marks a run stale when the code of a document it read changes, outputs and prose cells aside", async () => {
    const register = await newRegister()
    const notebook = file("thermal.ipynb", {
      "@patchwork": { type: "jupyter-notebook" },
      cells: [
        { cell_type: "markdown", source: "# Thermal" },
        { cell_type: "code", source: "P = pack_I_cont_A ** 2 * pack_R_mOhm / 1000", outputs: [] },
      ],
    })
    const cad = makeDoc({ "@patchwork": { type: "openscad" }, title: "Bay", source: "cube([400, 300, 250]);" })
    await set.execute(
      {
        register,
        entries: [
          { id: "pack_I_cont_A", unit: "A", estimate: { value: { nominal: 100, min: 90, max: 110 }, reasoning: "design day" } },
          { id: "pack_R_mOhm", unit: "mΩ", estimate: { value: { nominal: 6, min: 5, max: 7 }, reasoning: "cells + busbars" } },
          { id: "pack_heat_W", unit: "W", model: { url: notebook.url, name: "thermal", inputs: ["pack_I_cont_A", "pack_R_mOhm"], ran: [notebook.url, cad.url] }, value: 60 },
        ],
      },
      ctx,
    )
    let out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/STALE/)
    // The CAD file is outside the folder; the check reads it anyway, and names it by its title.
    expect((await repo.find(register)).doc().scan.docs[cad.url]).toMatchObject({ path: "Bay" })

    // Running the notebook rewrites its outputs; editing its prose is not a change to the model.
    notebook.change((d) => {
      d.cells[1].outputs.push({ text: "60.0" })
      d.cells[0].source = "# Thermal model"
    })
    out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/STALE/)

    // A comment is a change to the code: conservative.
    notebook.change((d) => (d.cells[1].source += "  # I²R"))
    cad.change((d) => (d.source = "cube([400, 300, 260]);"))
    out = await check.execute({ register }, ctx)
    // Reasons come in document order, which is random here: check each.
    expect(out).toMatch(/STALE\s+pack_heat_W: the code in "(thermal.ipynb|Bay)" changed, the code in "(thermal.ipynb|Bay)" changed since the model ran/)
    expect(out).toContain('"thermal.ipynb" changed')
    expect(out).toContain('"Bay" changed')
    expect(out).toMatch(/fix: re-run thermal and record its output/)
    expect((await repo.find(register)).doc().entries.pack_heat_W.stale).toEqual([
      { doc: cad.url, path: "Bay", reason: "changed" },
      { doc: notebook.url, path: "thermal.ipynb", reason: "changed" },
    ].sort((a, b) => (a.doc < b.doc ? -1 : 1)))

    // Recording a new run clears it, and the next check agrees.
    await set.execute({ register, entries: [{ id: "pack_heat_W", value: 61 }] }, ctx)
    expect((await repo.find(register)).doc().entries.pack_heat_W.stale ?? null).toBeNull()
    out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/STALE/)
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

  it("reads model results from the document's new outputs: a run is recorded without anyone copying a value", async () => {
    const register = await newRegister()
    const cell = (source, printed) => ({ cell_type: "code", source, outputs: printed ? [{ output_type: "stream", name: "stdout", text: printed }] : [] })
    const notebook = file("Model 1.ipynb", {
      "@patchwork": { type: "jupyter-notebook" },
      cells: [
        { cell_type: "markdown", source: "# Hull resistance" },
        cell("boat_mass_kg = 8330  # from the register\nboat_speed_kn = 8", ""),
        cell("print(f'boat_drag_N {drag:.1f}')\nprint(f'prop_P_kW = {P:.2f} kW')", "boat_drag_N 1020.4\nprop_P_kW = 46.10 kW\n"),
      ],
    })
    await set.execute(
      {
        register,
        entries: [
          { id: "boat_mass_kg", unit: "kg", estimate: { value: { nominal: 8330, min: 8100, max: 8600 }, reasoning: "weighed hull + pack" } },
          { id: "boat_speed_kn", unit: "kn", kind: "decision", value: 8 },
          { id: "boat_drag_N", unit: "N", model: { url: notebook.url, name: "Model 1", inputs: ["boat_mass_kg", "boat_speed_kn"] }, value: 1000 },
          { id: "prop_P_kW", unit: "kW", model: { url: notebook.url, name: "Model 1", inputs: ["boat_drag_N"] }, value: 45 },
        ],
      },
      ctx,
    )
    // The first check reads what the notebook printed.
    let out = await check.execute({ register }, ctx)
    expect(out).toMatch(/READ FROM MODEL DOCUMENTS \(2\)/)
    expect(out).toMatch(/boat_drag_N = 1020.4 N \(was 1000 N\) · "Model 1.ipynb" cell 3:1/)
    let doc = (await repo.find(register)).doc()
    expect(doc.entries.prop_P_kW.value.nominal).toBe(46.1)
    expect(doc.entries.boat_drag_N.model.by).toEqual({ kind: "document", url: notebook.url, line: "cell 3:1" })
    // Inputs are what the notebook's own code assigns: 8330, not the register's bounds-only change.
    expect(doc.entries.boat_drag_N.model.inputs.boat_mass_kg.nominal).toBe(8330)
    expect(out).not.toMatch(/STALE/)

    // Nothing ran: nothing is read again.
    out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/READ FROM MODEL DOCUMENTS/)

    // The register's mass moves; the notebook still has the old copy, so the result is stale until it is updated and re-run.
    await set.execute({ register, entries: [{ id: "boat_mass_kg", estimate: { value: { nominal: 8900, min: 8700, max: 9100 }, reasoning: "pack added" } }] }, ctx)
    out = await check.execute({ register }, ctx)
    expect(out).toMatch(/STALE\s+boat_drag_N: boat_mass_kg moved since the model ran/)
    expect(out).toMatch(/DRIFTED COPIES[\s\S]*boat_mass_kg = 8330, register says 8900/)

    // Code edited, not run: outputs unchanged, so nothing is read and the code change shows.
    notebook.change((d) => (d.cells[1].source = "boat_mass_kg = 8900  # from the register\nboat_speed_kn = 8"))
    out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/READ FROM MODEL DOCUMENTS/)
    expect(out).toMatch(/STALE\s+boat_drag_N: [^\n]*the code in "Model 1.ipynb" changed/)

    // Run: new outputs. Both results are read, with the inputs the code now assigns, and nothing is stale.
    notebook.change((d) => (d.cells[2].outputs[0].text = "boat_drag_N 1089.7\nprop_P_kW = 49.32 kW\n"))
    out = await check.execute({ register }, ctx)
    expect(out).toMatch(/READ FROM MODEL DOCUMENTS \(2\)/)
    expect(out).not.toMatch(/STALE/)
    doc = (await repo.find(register)).doc()
    expect(doc.entries.boat_drag_N.value.nominal).toBe(1089.7)
    expect(doc.entries.boat_drag_N.model.inputs.boat_mass_kg.nominal).toBe(8900)
  })

  it("reads an OpenSCAD model's results from the run it keeps, and goes stale when its source changes without a render", async () => {
    const register = await newRegister()
    const scad = file("Battery bay.scad", { "@patchwork": { type: "openscad" }, title: "Battery bay", source: "v = 400*300*250/1e6; echo(cad_pack_volume_L = v); cube([400,300,250]);" })
    // What the OpenSCAD editor does after a render: keep the run, with the heads it rendered.
    const render = (logs) => {
      const heads = [...scad.heads()]
      scad.change((d) => (d.lastRun = { at: new Date().toISOString(), heads, ok: true, logs, elapsedMillis: 120, input: String(Math.random()) }))
    }
    render(["ECHO: cad_pack_volume_L = 30"])
    await set.execute({ register, entries: [{ id: "pack_cells_n", kind: "decision", value: 16 }, { id: "cad_pack_volume_L", unit: "L", model: { url: scad.url, name: "Battery bay", inputs: ["pack_cells_n"] }, value: 29 }] }, ctx)
    let out = await check.execute({ register }, ctx)
    expect(out).toMatch(/READ FROM MODEL DOCUMENTS \(1\)[^\n]*\n  cad_pack_volume_L = 30 L \(was 29 L\) · "Battery bay.scad" console:1/)
    expect(out).not.toMatch(/STALE/)

    // The source is edited and nobody renders: the kept run is from the old code.
    scad.change((d) => (d.source = d.source.replace("250", "260")))
    out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/READ FROM MODEL DOCUMENTS/)
    expect(out).toMatch(/STALE\s+cad_pack_volume_L: the code in "Battery bay.scad" changed since the model ran/)

    // Rendered: the new run is read, and nothing is stale.
    render(["ECHO: cad_pack_volume_L = 31.2"])
    out = await check.execute({ register }, ctx)
    expect(out).toMatch(/cad_pack_volume_L = 31.2 L \(was 30 L\)/)
    expect(out).not.toMatch(/STALE/)
  })

  it("takes a linked notebook's inputs from its run record: the register as the run read it, not as it is now", async () => {
    const register = await newRegister()
    await set.execute(
      {
        register,
        entries: [
          { id: "boat_mass_kg", unit: "kg", estimate: { value: { nominal: 8330, min: 8100, max: 8600 }, reasoning: "weighed" } },
          { id: "boat_drag_N", unit: "N", model: { name: "Model 1", inputs: ["boat_mass_kg"] }, value: 1000 },
        ],
      },
      ctx,
    )
    const regHandle = await repo.find(register)
    const notebook = file("Model 1.ipynb", { "@patchwork": { type: "jupyter-notebook" }, cells: [{ cell_type: "code", source: "m = patchwork.load(register)['boat_mass_kg']", outputs: [] }], metadata: { patchwork: {} } })
    await set.execute({ register, entries: [{ id: "boat_drag_N", model: { url: notebook.url, name: "Model 1", inputs: ["boat_mass_kg"] }, value: 1000 }] }, ctx)
    // A run, as jupyter-linked records it: it read boat_mass_kg from the register's json view at these heads.
    const run = (status, text, over = {}) => {
      const startHeads = [...notebook.heads()]
      const readAt = [...regHandle.heads()]
      notebook.change((d) => {
        d.cells[0].outputs = text == null ? [] : [{ output_type: "stream", name: "stdout", text }]
      })
      const finishHeads = [...notebook.heads()]
      const outputs = runKeyOf(notebook.doc())
      notebook.change((d) => {
        d.metadata.patchwork.run = { at: "t", finished: status === "running" ? null : "t", status, by: "agent", cells: ["c1"], kernel: "fresh", code: "x", outputs: status === "running" ? null : outputs, startHeads, finishHeads: status === "running" ? null : finishHeads, imports: [], reads: [{ docUrl: register, title: "r", heads: readAt, as: "json", paths: [{ path: ["boat_mass_kg"], hash: "h" }] }], ...over }
      })
    }
    run("ok", "boat_drag_N 1020.4\n")
    // The register's mass moves after the run read it, before anyone checks.
    await set.execute({ register, entries: [{ id: "boat_mass_kg", estimate: { value: { nominal: 8900, min: 8700, max: 9100 }, reasoning: "pack added" } }] }, ctx)
    let out = await check.execute({ register }, ctx)
    expect(out).toMatch(/boat_drag_N = 1020.4 N/)
    let doc = (await repo.find(register)).doc()
    expect(doc.entries.boat_drag_N.model.inputs.boat_mass_kg.nominal).toBe(8330)
    expect(doc.entries.boat_drag_N.model.by).toMatchObject({ kind: "document", runBy: "agent" })
    expect(out).toMatch(/STALE\s+boat_drag_N: boat_mass_kg moved since the model ran/)

    // A run that failed, or one still running, gives nothing.
    run("error", "boat_drag_N 999\n")
    out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/READ FROM MODEL DOCUMENTS/)
    run("running", "boat_drag_N 998\n")
    out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/READ FROM MODEL DOCUMENTS/)

    // A good run at the register's new heads: read, with the new mass, and nothing is stale.
    run("ok", "boat_drag_N 1089.7\n")
    out = await check.execute({ register }, ctx)
    doc = (await repo.find(register)).doc()
    expect(doc.entries.boat_drag_N.value.nominal).toBe(1089.7)
    expect(doc.entries.boat_drag_N.model.inputs.boat_mass_kg.nominal).toBe(8900)
    expect(out).not.toMatch(/STALE/)
  })

  it("knows which entries a run read: a module import or the whole document reads all; paths name entries by view", () => {
    const R = "automerge:reg"
    const at = (h) => [h]
    const run = (imports, reads) => ({ imports, reads })
    expect([...registerReads(run([{ docUrl: R, heads: at("a"), as: "hook" }], []), R)]).toEqual([["*", ["a"]]])
    expect([...registerReads(run([{ docUrl: R, heads: at("a"), as: "missing" }], []), R)]).toEqual([])
    expect([...registerReads(run([], [{ docUrl: `${R}#x`, heads: at("b"), as: "raw", paths: [["entries", "x_y", "value"], ["title"]] }]), R)]).toEqual([["x_y", ["b"]]])
    expect([...registerReads(run([], [{ docUrl: R, heads: at("c"), as: "json", paths: [["x_y"], ["z_w"]] }]), R)]).toEqual([["x_y", ["c"]], ["z_w", ["c"]]])
    expect([...registerReads(run([], [{ docUrl: R, heads: at("d"), as: "raw", paths: [[]] }]), R)]).toEqual([["*", ["d"]]])
    // The first access to read an entry wins; other documents don't count.
    expect([...registerReads(run([], [{ docUrl: "automerge:other", heads: at("e"), as: "json", paths: [["x_y"]] }, { docUrl: R, heads: at("f"), as: "json", paths: [["x_y"]] }, { docUrl: R, heads: at("g"), as: "json", paths: [["x_y"]] }]), R)]).toEqual([["x_y", ["f"]]])
  })

  it("looks for a quote again when its source changes: still there, nothing to do; gone, the claim is no longer verified", async () => {
    const register = await newRegister()
    const datasheet = sheet()
    await set.execute({ register, entries: [{ id: "cell_R_ac_mOhm", unit: "mΩ", claims: [{ source: datasheet.url, quote: "AC Impedance Resistance(1KHz)  ≤0.25 mΩ", stated: 0.25, sourceKind: "datasheet" }] }] }, ctx)
    let claim = (await repo.find(register)).doc().entries.cell_R_ac_mOhm.claims[0]
    expect(claim).toMatchObject({ verified: true, lost: null, seen: { heads: [...datasheet.heads()], text: expect.stringMatching(/^t:/) } })
    let out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/SOURCE/)

    // Edited elsewhere, the quote still there: checked against the new version.
    datasheet.change((d) => (d.content += "Cycle life 6000\n"))
    out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/SOURCE/)
    claim = (await repo.find(register)).doc().entries.cell_R_ac_mOhm.claims[0]
    expect(claim).toMatchObject({ verified: true, lost: null, seen: { heads: [...datasheet.heads()] } })

    // The quoted line changes: the claim is no longer verified, and the check says why.
    datasheet.change((d) => (d.content = d.content.replace("≤0.25 mΩ", "≤0.22 mΩ")))
    out = await check.execute({ register }, ctx)
    expect(out).toMatch(/SOURCE\s+cell_R_ac_mOhm: claim c1's quote is no longer in "EVE LF280K Ver B.md", which changed since the quote was found/)
    let doc = (await repo.find(register)).doc()
    expect(doc.entries.cell_R_ac_mOhm.claims[0]).toMatchObject({ verified: false, lost: "missing" })
    expect(doc.entries.cell_R_ac_mOhm.support.level).toBe("weak")

    // Back again, it recovers.
    datasheet.change((d) => (d.content = d.content.replace("≤0.22 mΩ", "≤0.25 mΩ")))
    out = await check.execute({ register }, ctx)
    expect(out).not.toMatch(/SOURCE/)
    doc = (await repo.find(register)).doc()
    expect(doc.entries.cell_R_ac_mOhm.claims[0]).toMatchObject({ verified: true, lost: null })
    expect(doc.entries.cell_R_ac_mOhm.support.level).toBe("supported")
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
