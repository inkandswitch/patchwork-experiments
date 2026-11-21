import { describe, expect, it } from "vitest"
import {
  driftIn,
  formatValue,
  idProblem,
  nameIndex,
  parseValue,
  renderExport,
  resolveAll,
  resolveEntry,
  staleness,
  statusFor,
  trustBase,
  unboundIn,
  usesIn,
} from "./model.js"

const fact = (value, extra = {}) => ({ kind: "fact", status: "estimated", value, ...extra })
const result = (value, inputs) => ({ kind: "result", status: "derived", value, inputs })

describe("ids", () => {
  it.each([
    ["cell_capacity_Ah", null],
    ["barrier_k_W_mK", null],
    ["cell", "not a usable id"],
    ["2cell_x", "not a usable id"],
    ["cell-mass", "not a usable id"],
    ["cell_mass_max", "_min or _max"],
    ["cell_mass_min", "_min or _max"],
    ["", "required"],
  ])("%s", (id, problem) => {
    if (problem === null) expect(idProblem(id)).toBeNull()
    else expect(idProblem(id)).toContain(problem)
  })
})

describe("values", () => {
  it.each([
    [3.2, { value: 3.2 }],
    ["3.2", { value: 3.2 }],
    ["1e-3", { value: 0.001 }],
    ["0.4..1.4", { value: { min: 0.4, max: 1.4 } }],
    ["0.4 – 1.4 (0.9)", { value: { min: 0.4, max: 1.4, nominal: 0.9 } }],
    [{ min: 1, max: 2, nominal: 1.5 }, { value: { min: 1, max: 2, nominal: 1.5 } }],
    ["EVE LF280K", { value: "EVE LF280K" }],
  ])("parses %j", (raw, out) => expect(parseValue(raw)).toEqual(out))

  it.each([[null], [""], [NaN], [{ min: 2, max: 1 }], [{ min: 1, max: 2, nominal: 3 }]])("refuses %j", (raw) => {
    expect(parseValue(raw).problem).toBeTruthy()
  })

  it("formats", () => {
    expect(formatValue({ min: 0.4, max: 1.4, nominal: 0.9 }, "L/Ah")).toBe("0.4–1.4 (0.9) L/Ah")
    expect(formatValue(0.00051, "Ω")).toBe("5.1e-4 Ω")
  })
})

describe("status is decided from what an entry carries", () => {
  // Every combination: kind × source × quote × quoteFound.
  const cases = []
  for (const kind of ["fact", "decision", "requirement", "result"])
    for (const source of [null, "automerge:x"])
      for (const quote of [null, "words"])
        for (const quoteFound of [false, true]) cases.push([kind, source, quote, quoteFound])

  it.each(cases)("%s source=%s quote=%s found=%s", (kind, source, quote, quoteFound) => {
    const status = statusFor({ kind, source, quote }, { quoteFound })
    if (kind === "result") expect(status).toBe("derived")
    else if (source && quote && quoteFound) expect(status).toBe("verified")
    else if (source) expect(status).toBe("cited")
    else expect(status).toBe(kind === "decision" ? "chosen" : "estimated")
    // A claim of a found quote never verifies an entry without a source.
    if (!source) expect(status).not.toBe("verified")
  })
})

describe("variants", () => {
  const doc = {
    entries: { amb_T_C: fact(25), cell_cap_Ah: fact(280) },
    variants: { cold: { note: "", entries: { amb_T_C: { value: -10 }, cold_only_x: fact(1) } } },
  }
  it("override fields and add entries", () => {
    expect(resolveEntry(doc, "amb_T_C", "cold")).toMatchObject({ value: -10, kind: "fact", overridden: true })
    expect(resolveEntry(doc, "amb_T_C")).toMatchObject({ value: 25, overridden: false })
    expect(resolveAll(doc, "cold").map((e) => e.id)).toEqual(["amb_T_C", "cell_cap_Ah", "cold_only_x"])
    expect(resolveAll(doc).map((e) => e.id)).toEqual(["amb_T_C", "cell_cap_Ah"])
  })
})

describe("staleness", () => {
  it("a result is stale when an input changed, is gone, or is itself stale", () => {
    const doc = {
      entries: {
        cell_cap_Ah: fact(300),
        cell_gas_L_per_Ah: fact({ min: 0.4, max: 1.4 }),
        gas_cell_L: result({ min: 112, max: 392 }, { cell_cap_Ah: 280, cell_gas_L_per_Ah: { min: 0.4, max: 1.4 } }),
        vent_rate_m3h: result(12, { gas_cell_L: { min: 112, max: 392 } }),
        orphan_x: result(1, { gone_input: 3 }),
        fresh_x: result(2, { cell_cap_Ah: 300 }),
      },
    }
    const stale = staleness(doc)
    expect(stale.get("gas_cell_L")).toEqual([{ input: "cell_cap_Ah", reason: "changed", was: 280, now: 300 }])
    expect(stale.get("vent_rate_m3h")).toEqual([{ input: "gas_cell_L", reason: "stale" }])
    expect(stale.get("orphan_x")).toEqual([{ input: "gone_input", reason: "gone" }])
    expect(stale.has("fresh_x")).toBe(false)
    expect(stale.has("cell_cap_Ah")).toBe(false)
  })

  it("a consistent loop is not stale; an inconsistent one is, all the way round", () => {
    // mass → drag → energy → mass, each recorded against the others' current values.
    const loop = (massSeen) => ({
      entries: {
        boat_mass_kg: result(900, { batt_energy_kWh: 100 }),
        hull_drag_N: result(400, { boat_mass_kg: massSeen }),
        batt_energy_kWh: result(100, { hull_drag_N: 400 }),
      },
    })
    expect(staleness(loop(900)).size).toBe(0)
    const stale = staleness(loop(850))
    expect([...stale.keys()].sort()).toEqual(["batt_energy_kWh", "boat_mass_kg", "hull_drag_N"])
  })

  it("follows a variant's own inputs", () => {
    const doc = {
      entries: { amb_T_C: fact(25), cell_T_C: result(40, { amb_T_C: 25 }) },
      variants: { cold: { entries: { amb_T_C: { value: -10 } } } },
    }
    expect(staleness(doc).size).toBe(0)
    expect(staleness(doc, "cold").has("cell_T_C")).toBe(true)
  })

  it("trust base is the non-result leaves", () => {
    const doc = {
      entries: {
        a_x: fact(1),
        b_x: fact(2),
        c_x: result(3, { a_x: 1, b_x: 2 }),
        d_x: result(4, { c_x: 3, a_x: 1 }),
      },
    }
    expect(trustBase(doc, "d_x")).toEqual(["a_x", "b_x"])
  })
})

describe("export", () => {
  const doc = {
    entries: {
      cell_cap_Ah: fact(280, { unit: "Ah", label: "capacity" }),
      cell_gas_L_per_Ah: fact({ min: 0.4, max: 1.4 }),
      cell_part_no: fact("LF280K"),
      barrier_mm: fact({ min: 2, max: 4, nominal: 3 }),
    },
  }
  it("a range without a nominal exports only its ends", () => {
    const json = JSON.parse(renderExport(doc, { format: "json" }))
    expect(json.cell_gas_L_per_Ah).toBeUndefined()
    expect(json.cell_gas_L_per_Ah_min).toBe(0.4)
    expect(json.cell_gas_L_per_Ah_max).toBe(1.4)
    expect(json.barrier_mm).toBe(3)
    expect(json.cell_part_no).toBe("LF280K")
  })
  it("python and scad are assignments with the generated mark", () => {
    const py = renderExport(doc, { format: "python", registerUrl: "automerge:R" })
    expect(py).toContain("GENERATED from assumptions register automerge:R")
    expect(py).toMatch(/^cell_cap_Ah = 280  # capacity \[Ah\] estimated$/m)
    expect(renderExport(doc, { format: "scad" })).toMatch(/^barrier_mm = 3;/m)
  })
})

describe("uses and unbound constants", () => {
  const doc = { entries: { cell_mass_kg: fact(5.42), cell_gas_L_per_Ah: fact({ min: 0.4, max: 1.4 }) } }
  const index = nameIndex(doc)

  it("finds ids as whole words, ranges by their ends", () => {
    const text = "m = 16*cell_mass_kg\ncell_mass_kg_total = 3\nV = cell_gas_L_per_Ah_max * cap"
    const uses = usesIn(text, index)
    expect(uses.get("cell_mass_kg")).toEqual([{ line: 1, text: "m = 16*cell_mass_kg" }])
    expect(uses.get("cell_gas_L_per_Ah")).toEqual([{ line: 3, text: "V = cell_gas_L_per_Ah_max * cap" }])
  })

  it("flags the constants Run 3's notebook wrote down itself", () => {
    const code = [
      "R_DC25    = 0.50e-3    # ohm DC incl. polarisation at 25C  # ASSUMED (2x AC)",
      "CP_CELL   = 1050.0     # J/kg/K",
      "barrier = 3;",
      "cell_mass_kg = 5.42",
      "S = 16*3.2",
      "for i in range(3):",
      "n = 8",
      "on = 1",
    ].join("\n")
    const found = unboundIn(code, index).map((u) => u.name)
    expect(found).toEqual(["R_DC25", "CP_CELL", "barrier"])
  })

  it("and the ones Run 1's model kept in a constants dict", () => {
    const code = ['    "barrier_rho_kg_m3": 200.0,', '    "barrier_cp_J_kgK": 1000.0,  # aerogel', '    "cell_mass_kg": 5.42,', '    "enabled": 1,', "opts = {maxWorkers: 2}"].join("\n")
    expect(unboundIn(code, index).map((u) => [u.name, u.value])).toEqual([
      ["barrier_rho_kg_m3", 200],
      ["barrier_cp_J_kgK", 1000],
    ])
  })

  it("sees a pasted copy that disagrees with the register", () => {
    expect(driftIn("cell_mass_kg = 5.49\ncell_gas_L_per_Ah_max = 1.4", doc)).toEqual([
      { line: 1, name: "cell_mass_kg", id: "cell_mass_kg", written: 5.49, register: 5.42 },
    ])
  })
})
