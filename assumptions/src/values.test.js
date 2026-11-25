import { describe, expect, it } from "vitest"
import { citeString, formatBounds, formatValue, moved, parseValue, readFigures, sameValue, soundInterval, statedInterval, unstatedSides } from "./values.js"
import { proseDisagreements } from "./prose.js"

const shapes = {
  exact: { nominal: 1000, exact: true },
  tolerance: { nominal: 5.42, min: 5.12, max: 5.72, dp: 2 },
  upper: { max: 0.25, dp: 2 },
  lower: { min: 6000, dp: 0 },
  typical: { nominal: 3.2, typ: true, dp: 1 },
  range: { min: 0.4, max: 1.4, dp: 1 },
  rangeNominal: { nominal: 0.9, min: 0.4, max: 1.4, dp: 1 },
  bare: { nominal: 0.5, dp: 1 },
  nominalLower: { nominal: 5, min: 4, dp: 0 },
}

describe("reading figures", () => {
  it.each([
    ["Battery weight  5.42± 0.3 kg", { nominal: 5.42, min: 5.12, max: 5.72 }],
    ["AC Impedance  ≤0.25 mΩ", { max: 0.25 }],
    ["max 60 V", { max: 60 }],
    ["0.25 mΩ max", { max: 0.25 }],
    ["Cycle life ≥6000 cycle", { min: 6000 }],
    ["at least 6,000 cycles", { min: 6000 }],
    ["Typical 3.2 V", { nominal: 3.2, typ: true }],
    ["0.4–1.4 L/Ah", { min: 0.4, max: 1.4 }],
    ["0.4 to 1.4 (0.9)", { min: 0.4, max: 1.4, nominal: 0.9 }],
    ["Charge time 30 min", { nominal: 30 }],
  ])("%s", (text, want) => {
    const last = readFigures(text).at(-1).value
    for (const [k, v] of Object.entries(want)) expect(last[k]).toBe(v)
    for (const k of ["nominal", "min", "max"]) if (!(k in want)) expect(last[k]).toBeUndefined()
  })
})

describe("values", () => {
  it("a bare nominal has an unstated spread, never treated as exact", () => {
    expect(unstatedSides(shapes.bare)).toBe("both")
    expect(soundInterval(shapes.bare)).toEqual([-Infinity, Infinity])
    expect(statedInterval(shapes.bare)).toEqual([0.5, 0.5])
    expect(unstatedSides(shapes.exact)).toBeNull()
    expect(soundInterval(shapes.exact)).toEqual([1000, 1000])
  })

  it("a one-sided bound is unbounded on the other side, in both intervals", () => {
    expect(soundInterval(shapes.upper)).toEqual([-Infinity, 0.25])
    expect(statedInterval(shapes.upper)).toEqual([-Infinity, 0.25])
  })

  // Every shape but a nominal with one bound, which is written in words ("no upper bound").
  it.each(Object.entries(shapes).filter(([name]) => name !== "nominalLower"))("the qualifier survives rendering: %s", (_, value) => {
    const bounds = formatBounds(value)
    const written = `${formatValue(value)}${bounds ? ` ${bounds}` : ""}`
    expect(sameValue(parseValue(written).value, value), written).toBe(true)
  })

  it.each(Object.entries(shapes))("the cite string passes the prose check, and fails without its qualifier: %s", (_, value) => {
    const cite = citeString("x_y", value, "u")
    expect(proseDisagreements(`as given, ${cite}.`, [{ id: "x_y", value }])).toEqual([])
    const bare = cite.replace(/[≤≥]\s?/, "").replace(/(\d)–(\d)/, "$1 or $2")
    if (bare !== cite) expect(proseDisagreements(`as given, ${bare}.`, [{ id: "x_y", value }])).toHaveLength(1)
  })

  it("moved: relative tolerance either side of the edge", () => {
    expect(moved({ nominal: 100 }, { nominal: 102 }, 0.02)).toBe(false)
    expect(moved({ nominal: 100 }, { nominal: 102.1 }, 0.02)).toBe(true)
    expect(moved({ nominal: 100 }, { nominal: 100 }, 0)).toBe(false)
    expect(moved({ nominal: 100 }, { nominal: 100, max: 101 }, 0.5)).toBe(true)
  })

  it("parses tolerances, ranges and refuses nonsense", () => {
    expect(parseValue({ nominal: 5.42, tol: 0.3 }).value).toEqual({ nominal: 5.42, min: 5.12, max: 5.72, dp: 2 })
    expect(parseValue("0.4..1.4").value).toMatchObject({ min: 0.4, max: 1.4 })
    expect(parseValue("REC 2Q").value).toBe("REC 2Q")
    expect(parseValue({ min: 2, max: 1 }).problem).toMatch(/upside down/)
    expect(parseValue({ nominal: 9, max: 1 }).problem).toMatch(/outside/)
  })
})

describe("the prose check", () => {
  const isc = { nominal: 9.59, dp: 2 }
  it.each([
    ["9.59 kA (`pack_Isc_kA`)", true],
    ["about 9.6 kA (`pack_Isc_kA`)", true],
    ["10 kA (`pack_Isc_kA`)", true],
    ["8.9 kA (`pack_Isc_kA`)", false],
    ["| `pack_Isc_kA` | – |", false],
  ])("%s", (line, ok) => {
    expect(proseDisagreements(line, [{ id: "pack_Isc_kA", value: isc }]).length === 0).toBe(ok)
  })

  it("a line with two ids needs a number for each; one with none is not checked", () => {
    const cites = [
      { id: "pack_Isc_kA", value: isc },
      { id: "pack_V_max", value: { nominal: 58.4 } },
    ]
    expect(proseDisagreements("58.4 V over 6.09 mΩ gives 9.59 kA (`pack_V_max`, `pack_Isc_kA`)", cites)).toEqual([])
    expect(proseDisagreements("58.4 V gives 8.9 kA (`pack_V_max`, `pack_Isc_kA`)", cites).map((d) => d.id)).toEqual(["pack_Isc_kA"])
    expect(proseDisagreements("no ids here, 8.9 kA", [])).toEqual([])
  })

  it("digits inside an id are not a figure", () => {
    expect(proseDisagreements("see `h2_LFL_frac` and h2_LFL_frac", [{ id: "h2_LFL_frac", value: { nominal: 0.04 } }])).toHaveLength(1)
  })
})
