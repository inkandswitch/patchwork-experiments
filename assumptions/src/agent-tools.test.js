import { beforeEach, describe, expect, it } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { create, exportTool, read, set, where } from "./agent-tools.js"

await initSubduction()

let repo, ctx, folder

function makeDoc(value) {
  const handle = repo.create()
  handle.change((d) => Object.assign(d, value))
  return handle
}

function file(folderHandle, name, doc) {
  const handle = makeDoc(doc)
  folderHandle.change((d) => d.docs.push({ name, type: doc["@patchwork"]?.type ?? "file", url: handle.url }))
  return handle
}

beforeEach(() => {
  repo = new Repo({ network: [] })
  ctx = { repo }
  folder = makeDoc({ "@patchwork": { type: "folder" }, title: "Task", docs: [] })
})

async function newRegister() {
  const made = await create.execute({ folder: folder.url, title: "Battery assumptions" }, ctx)
  return made.doc.url
}

describe("create", () => {
  it("files the register in the task folder and scopes it there", async () => {
    const url = await newRegister()
    expect(folder.doc().docs).toEqual([{ name: "Battery assumptions", type: "assumptions", url }])
    expect((await repo.find(url)).doc()).toMatchObject({ "@patchwork": { type: "assumptions" }, scope: folder.url, entries: {} })
  })
})

describe("set", () => {
  it("verifies a quote against the kept source and refuses one that is not there", async () => {
    const register = await newRegister()
    const sheet = makeDoc({ "@patchwork": { type: "file" }, name: "LF280K.md", content: "Nominal Capacity   280Ah\nNominal voltage 3.2V" })
    const out = await set.execute(
      {
        register,
        entries: [
          { id: "cell_cap_Ah", value: 280, unit: "Ah", source: sheet.url, quote: "Nominal Capacity 280Ah" },
          { id: "cell_v_nom", value: 3.2, source: sheet.url, quote: "Nominal voltage 3.3V" },
          { id: "cell_cp_J_kgK", value: 1050, note: "typical prismatic LFP" },
          { id: "barrier_mm", value: 3, kind: "decision" },
          { id: "web_x", value: 1, source: "https://example.com/datasheet" },
        ],
      },
      ctx
    )
    expect(out).toContain("cell_v_nom: the quote is not in")
    const doc = (await repo.find(register)).doc()
    expect(doc.entries.cell_cap_Ah.status).toBe("verified")
    expect(doc.entries.cell_v_nom).toBeUndefined()
    expect(doc.entries.cell_cp_J_kgK.status).toBe("estimated")
    expect(doc.entries.barrier_mm.status).toBe("chosen")
    expect(doc.entries.web_x.status).toBe("cited")
  })

  it("records a result's inputs as they are, and reports it stale when one changes", async () => {
    const register = await newRegister()
    await set.execute({ register, entries: [{ id: "cell_cap_Ah", value: 280 }, { id: "cell_gas_L_per_Ah", value: "0.4..1.4" }] }, ctx)
    await set.execute(
      { register, entries: [{ id: "gas_cell_L", value: "112..392", unit: "L", inputs: ["cell_cap_Ah", "cell_gas_L_per_Ah"], by: { name: "safety notebook" } }] },
      ctx
    )
    let doc = (await repo.find(register)).doc()
    expect(doc.entries.gas_cell_L).toMatchObject({ kind: "result", status: "derived", inputs: { cell_cap_Ah: 280, cell_gas_L_per_Ah: { min: 0.4, max: 1.4 } } })

    const changed = await set.execute({ register, entries: [{ id: "cell_cap_Ah", value: 314 }] }, ctx)
    expect(changed).toContain("Stale results now: gas_cell_L")
    expect(await read.execute({ register }, ctx)).toContain("STALE: cell_cap_Ah changed")
  })

  it("refuses a result whose inputs are not in the register", async () => {
    const register = await newRegister()
    const out = await set.execute({ register, entries: [{ id: "gas_cell_L", value: 3, inputs: ["cell_h2_frac"] }] }, ctx)
    expect(out).toContain("inputs not in the register: cell_h2_frac")
  })

  it("writes into a variant without touching the base", async () => {
    const register = await newRegister()
    await set.execute({ register, entries: [{ id: "amb_T_C", value: 25 }] }, ctx)
    await set.execute({ register, variant: "cold", variantNote: "-10 °C", entries: [{ id: "amb_T_C", value: -10 }] }, ctx)
    const doc = (await repo.find(register)).doc()
    expect(doc.entries.amb_T_C.value).toBe(25)
    expect(doc.variants.cold).toMatchObject({ note: "-10 °C", entries: { amb_T_C: { value: -10 } } })
    expect(await read.execute({ register, variant: "cold" }, ctx)).toContain("amb_T_C = -10 · fact/estimated (variant)")
  })
})

describe("export and where", () => {
  it("exports once, updates in place, and finds uses and unbound constants", async () => {
    const register = await newRegister()
    await set.execute({ register, entries: [{ id: "cell_mass_kg", value: 5.42 }, { id: "barrier_mm", value: 3, kind: "decision" }, { id: "spare_x", value: 9 }] }, ctx)

    const first = await exportTool.execute({ register, format: "python" }, ctx)
    const again = await exportTool.execute({ register, format: "python" }, ctx)
    expect(again.doc.url).toBe(first.doc.url)
    expect(folder.doc().docs.filter((d) => d.name.endsWith(".py"))).toHaveLength(1)
    const exported = (await repo.find(first.doc.url)).doc()
    expect(exported.content).toContain("cell_mass_kg = 5.42")

    file(folder, "Thermal model", {
      "@patchwork": { type: "jupyter-notebook" },
      cells: [
        { cell_type: "markdown", source: "Uses cell_mass_kg from the register." },
        { cell_type: "code", source: ["from assumptions import *\n", "m = 16 * cell_mass_kg\n", "R_DC25 = 0.50e-3  # ASSUMED\n"] },
      ],
    })
    file(folder, "Pack", { "@patchwork": { type: "openscad" }, source: "include <assumptions.scad>\npitch = 71.7 + barrier_mm;\nbarrier_mm = 2;\n" })

    const report = await where.execute({ register }, ctx)
    expect(report).toContain("cell_mass_kg — 2 uses")
    expect(report).toContain("Thermal model cell 2:2")
    expect(report).toContain("barrier_mm — 2 uses")
    expect(report).toContain("Not used anywhere in the folder: spare_x")
    expect(report).toContain("Thermal model cell 2:3  R_DC25 = 0.0005")
    expect(report).toContain("Pack:3  barrier_mm = 2, register says 3")
    expect(report).toContain("Exports of this register")
  })
})
