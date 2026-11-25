import { describe, expect, it } from "vitest"
import { outOfDate } from "./consistency.js"
import { evaluate, formulaCycles, materialize, pickValue } from "./register.js"
import { supportFor } from "./support.js"
import { observedUse, useFlag } from "./uses.js"
import { AssumptionsDatatype } from "./datatype.js"
import { renderExport } from "./export.js"

const claim = (key, stated, extra = {}) => ({ key, stated, sourceKind: "datasheet", verified: true, ...extra })

describe("formulas form a DAG", () => {
  // Every directed graph on 4 nodes: a node is on a cycle exactly when it can reach itself.
  it("cycles are found exactly, over all 4096 graphs on 4 nodes", () => {
    const nodes = ["n_a", "n_b", "n_c", "n_d"]
    const pairs = nodes.flatMap((a) => nodes.filter((b) => b !== a).map((b) => [a, b]))
    for (let mask = 0; mask < 1 << pairs.length; mask++) {
      const edges = pairs.filter((_, i) => mask & (1 << i))
      const entries = Object.fromEntries(nodes.map((n) => [n, { basis: "formula", formula: ["1", ...edges.filter(([a]) => a === n).map(([, b]) => b)].join(" + ") }]))
      const reach = (from) => {
        const seen = new Set()
        const stack = edges.filter(([a]) => a === from).map(([, b]) => b)
        while (stack.length) {
          const n = stack.pop()
          if (seen.has(n)) continue
          seen.add(n)
          for (const [a, b] of edges) if (a === n) stack.push(b)
        }
        return seen
      }
      const expected = nodes.filter((n) => reach(n).has(n))
      expect([...formulaCycles(entries)].sort(), `mask ${mask}`).toEqual(expected)
      const evaluation = evaluate({ entries })
      // A formula on a cycle has no value, and neither does one that reads it; the rest evaluate.
      const broken = nodes.filter((n) => expected.includes(n) || [...reach(n)].some((m) => expected.includes(m)))
      for (const n of nodes) expect(Boolean(evaluation.byId.get(n).broken), `${n} mask ${mask}`).toBe(broken.includes(n))
    }
  })
})

describe("a cited value comes from its claims and nowhere else", () => {
  const values = [{ nominal: 5, min: 4, max: 6 }, { nominal: 5, min: 4, max: 6 }, { nominal: 7, min: 6.5, max: 7.5 }]
  for (const count of [1, 2, 3]) {
    for (const rule of [null, "one", "lowest", "highest", "envelope"]) {
      it(`${count} claim${count > 1 ? "s" : ""}, pick ${rule ?? "none"}`, () => {
        const claims = values.slice(0, count).map((v, i) => claim(`c${i + 1}`, v, { factor: 2 }))
        const entry = { basis: "claims", claims, pick: rule ? { rule, claim: rule === "one" ? `c${count}` : null, reason: "r" } : null }
        const picked = pickValue(entry)
        const scaled = claims.map((c) => ({ nominal: c.stated.nominal * 2, min: c.stated.min * 2, max: c.stated.max * 2 }))
        const agree = new Set(scaled.map((s) => JSON.stringify(s))).size === 1
        if (!rule) {
          if (agree) expect(picked.value).toMatchObject(scaled[0])
          else expect(picked.problem).toMatch(/none is picked/)
          return
        }
        const want =
          rule === "one" ? scaled[count - 1] : rule === "lowest" ? scaled[0] : rule === "highest" ? scaled.reduce((a, b) => (b.nominal >= a.nominal ? b : a)) : { min: Math.min(...scaled.map((s) => s.min)), max: Math.max(...scaled.map((s) => s.max)) }
        expect(picked.value).toMatchObject(want)
        expect(picked.problem).toBeUndefined()
      })
    }
  }
})

describe("support is a function of the evidence alone", () => {
  const value = { nominal: 5, min: 4, max: 6 }
  const near = { min: 4.5, max: 5.5 }
  const far = { min: 7, max: 8 }
  const claimOptions = []
  for (const kind of ["datasheet", "retailer", "measurement"])
    for (const verified of [true, false])
      for (const origin of ["maker", "other", null])
        for (const v of [near, far]) for (const aside of [false, true]) claimOptions.push({ kind, verified, origin, v, aside })
  const judgementOptions = [null, "agrees", "disagrees", "near", "far"]

  /** The rule as the design states it, written out independently. */
  function spec(claims, judgement) {
    const active = claims.filter((c) => !c.aside)
    const agreeing = active.filter((c) => c.v === near)
    const sources = agreeing.map((c) => ({ origin: c.origin, primary: c.kind === "measurement" || (c.kind === "datasheet" && c.verified) }))
    let conflicts = active.length - agreeing.length
    if (judgement === "agrees" || judgement === "near") sources.push({ origin: "person:ana", primary: false })
    if (judgement === "disagrees" || judgement === "far") conflicts++
    const origins = new Set(sources.filter((s) => s.origin).map((s) => s.origin))
    const independent = origins.size + (sources.some((s) => !s.origin) ? 1 : 0)
    const primary = sources.some((s) => s.primary)
    let level = !sources.length ? "none" : primary && independent >= 2 ? "corroborated" : primary ? "supported" : "weak"
    if (conflicts && (level === "supported" || level === "corroborated")) level = "weak"
    return { level, conflicting: conflicts > 0 }
  }

  it("every set of up to two claims and one judgement", () => {
    let n = 0
    for (let count = 0; count <= 2; count++) {
      const combos = count === 0 ? [[]] : count === 1 ? claimOptions.map((c) => [c]) : claimOptions.flatMap((a) => claimOptions.map((b) => [a, b]))
      for (const claims of combos) {
        for (const judgement of judgementOptions) {
          const entry = {
            basis: "claims",
            claims: claims.map((c, i) => ({ key: `c${i + 1}`, stated: c.v, sourceKind: c.kind, verified: c.verified, origin: c.origin })),
            judgements: [
              ...claims.flatMap((c, i) => (c.aside ? [{ key: `a${i}`, on: `c${i + 1}`, verdict: "superseded", by: { kind: "person", who: "ana" } }] : [])),
              ...(judgement ? [{ key: "j1", on: null, verdict: judgement === "near" || judgement === "far" ? "value" : judgement, value: judgement === "near" ? near : judgement === "far" ? far : undefined, by: { kind: "person", who: "ana" } }] : []),
            ],
          }
          const got = supportFor(entry, value, new Map(entry.claims.map((c) => [c.key, c.stated])))
          const want = spec(claims, judgement)
          expect({ level: got.level, conflicting: got.conflicting }, JSON.stringify({ claims, judgement })).toEqual(want)
          n++
        }
      }
    }
    expect(n).toBe(5 * (1 + 72 + 72 * 72))
  })

  it("an estimate is weak however many people agree; an unknown has none; a decision is chosen", () => {
    const agree = [1, 2, 3].map((i) => ({ key: `j${i}`, verdict: "agrees", by: { kind: "person", who: `p${i}` } }))
    expect(supportFor({ basis: "estimate", judgements: agree }, value).level).toBe("weak")
    expect(supportFor({ basis: "unknown" }, null).level).toBe("none")
    expect(supportFor({ basis: "choice" }, "REC 2Q").level).toBe("chosen")
  })

  it("the agent's own judgements are not evidence", () => {
    const entry = { basis: "claims", claims: [claim("c1", near)], judgements: [{ key: "j1", verdict: "agrees", by: { kind: "agent" } }, { key: "j2", verdict: "disagrees", by: { kind: "agent" } }] }
    expect(supportFor(entry, value, new Map([["c1", near]]))).toMatchObject({ level: "supported", conflicting: false })
  })
})

describe("model results go stale when an input moves beyond tolerance", () => {
  const register = (now, tolerance) => ({
    entries: {
      hull_mass_kg: { basis: "estimate", estimate: { value: { nominal: now, min: now - 10, max: now + 10 }, reasoning: "r" } },
      hull_drag_N: { basis: "model", model: { name: "CFD", tolerance, inputs: { hull_mass_kg: { nominal: 100, min: 90, max: 110 } }, value: { nominal: 50 } } },
      hull_power_W: { basis: "formula", formula: "hull_drag_N * 2" },
    },
  })
  it.each([
    [100, 0, false],
    [101, 0, true],
    [101, 0.1, false],
    [100, 0.02, false],
  ])("mass %s with tolerance %s: stale %s", (now, tolerance, stale) => {
    const evaluation = evaluate(register(now, tolerance))
    expect(Boolean(evaluation.byId.get("hull_drag_N").stale)).toBe(stale)
    expect(Boolean(evaluation.byId.get("hull_power_W").stale)).toBe(stale)
  })

  it("a loop of model results is not stale in itself, and all of it is stale when one input moves", () => {
    const loop = (massNow) => ({
      entries: {
        boat_mass_kg: { basis: "model", model: { inputs: { battery_mass_kg: { nominal: 500 } }, value: { nominal: massNow } } },
        boat_drag_N: { basis: "model", model: { inputs: { boat_mass_kg: { nominal: 1500 } }, value: { nominal: 40 } } },
        battery_mass_kg: { basis: "model", model: { inputs: { boat_drag_N: { nominal: 40 } }, value: { nominal: 500 } } },
      },
    })
    expect([...evaluate(loop(1500)).byId.values()].some((e) => e.stale)).toBe(false)
    expect([...evaluate(loop(1600)).byId.values()].every((e) => e.stale)).toBe(true)
  })
})

describe("stored results", () => {
  const doc = () => ({
    entries: {
      pack_cells_n: { basis: "choice", choice: { value: { nominal: 16 } } },
      cell_V_nom: { basis: "claims", claims: [claim("c1", { nominal: 3.2, typ: true, dp: 1 })] },
      pack_V_nom: { basis: "formula", formula: "pack_cells_n * cell_V_nom" },
      pack_V_big: { basis: "formula", formula: "pack_V_nom * 2" },
    },
  })

  it("are written with what they were computed from, and a second pass writes nothing", () => {
    const d = doc()
    materialize(d, evaluate(d), { at: ["h1"] })
    expect(d.entries.pack_V_nom.value).toMatchObject({ nominal: 51.2 })
    expect(d.entries.pack_V_nom.derived).toMatchObject({ how: "pack_cells_n * cell_V_nom", inputs: { pack_cells_n: { nominal: 16, exact: true }, cell_V_nom: { nominal: 3.2 } }, at: ["h1"] })
    expect(outOfDate(d).size).toBe(0)
    expect(materialize(d, evaluate(d), { at: ["h2"] })).toEqual([])
  })

  it("a consumer can tell when one is out of date, without the evaluator", () => {
    const d = doc()
    materialize(d, evaluate(d))
    d.entries.cell_V_nom.value = { nominal: 3.3 } // an edit made where the module isn't loaded
    expect([...outOfDate(d).keys()].sort()).toEqual(["pack_V_big", "pack_V_nom"])
    d.entries.pack_V_nom.formula = "pack_cells_n * cell_V_nom + 0"
    expect(outOfDate(d).get("pack_V_nom")).toMatch(/formula changed/)
  })

  it("the register repairs a stored value that doesn't follow from its inputs", () => {
    const d = doc()
    materialize(d, evaluate(d))
    d.entries.pack_V_nom.value = { nominal: 999 } // a hand edit, or an older client's arithmetic
    expect(materialize(d, evaluate(d))).toContain("pack_V_nom")
    expect(d.entries.pack_V_nom.value).toMatchObject({ nominal: 51.2 })
  })

  it("results carry what they rest on and what makes them wide", () => {
    const d = {
      entries: {
        a_mOhm: { basis: "estimate", estimate: { value: { nominal: 1, min: 0.5, max: 1.5 }, reasoning: "r" } },
        b_mOhm: { basis: "claims", claims: [claim("c1", { nominal: 2, min: 1.9, max: 2.1 })] },
        c_mOhm: { basis: "claims", claims: [claim("c1", { nominal: 3, dp: 0 })] },
        sum_mOhm: { basis: "formula", formula: "a_mOhm + b_mOhm" },
        all_mOhm: { basis: "formula", formula: "a_mOhm + b_mOhm + c_mOhm" },
      },
    }
    const e = evaluate(d)
    const sum = e.byId.get("sum_mOhm").confidence
    expect(sum.restsOn).toEqual({ weak: 1, supported: 1 })
    expect(sum.shares.map((s) => s.id)).toEqual(["a_mOhm", "b_mOhm"])
    expect(sum.shares[0].share).toBeCloseTo(1 / 1.2, 3)
    expect(sum.atLeast).toBe(false)
    expect(e.byId.get("sum_mOhm").support.level).toBe("weak")
    expect(e.byId.get("all_mOhm").confidence).toMatchObject({ unstated: ["c_mOhm"], atLeast: true })
  })
})

describe("requirements", () => {
  it("say what would settle them when they depend, and n/a when they don't apply", () => {
    const d = {
      entries: {
        cell_R_mOhm: { basis: "claims", claims: [claim("c1", { max: 0.25 })] },
        pack_V: { basis: "choice", choice: { value: { nominal: 58.4 } } },
        fault_kA: { basis: "formula", formula: "pack_V / (16 * cell_R_mOhm + 2)" },
        fuse_kA: { basis: "claims", claims: [claim("c1", { min: 50 })] },
        fuse_ok: { basis: "check", check: "fault_kA <= fuse_kA" },
        boat_len_m: { basis: "choice", choice: { value: { nominal: 7 } } },
        rule_ok: { basis: "check", check: "fault_kA <= 1", appliesIf: "boat_len_m >= 8" },
      },
    }
    const e = evaluate(d)
    expect(e.byId.get("fuse_ok").outcome).toMatchObject({ result: "depends", settle: [{ id: "cell_R_mOhm", why: "has no lower bound" }] })
    expect(e.byId.get("rule_ok").outcome.result).toBe("n/a")
  })
})

describe("use", () => {
  it("the flag is a function of (intended, observed): all nine cells", () => {
    const flagged = []
    for (const intended of ["model", "reference", "unused"]) for (const observed of ["model", "prose", "nowhere"]) if (useFlag(intended, observed)) flagged.push(`${intended}/${observed}`)
    expect(flagged).toEqual(["model/prose", "model/nowhere", "reference/nowhere", "unused/model", "unused/prose"])
    expect(useFlag("model", null)).toBeNull()
  })

  it("is observed from the register and the scan", () => {
    const readers = new Map([["a_b", new Set(["c_d"])], ["e_f", new Set()]])
    const scan = { docs: { u: { hits: [{ id: "e_f", use: "prose" }, { id: "g_h", use: "model" }] } } }
    expect(observedUse("a_b", {}, readers, scan)).toBe("model")
    expect(observedUse("e_f", {}, readers, scan)).toBe("prose")
    expect(observedUse("g_h", {}, readers, scan)).toBe("model")
    expect(observedUse("i_j", {}, readers, scan)).toBe("nowhere")
    expect(observedUse("i_j", {}, readers, null)).toBeNull()
  })
})


describe("the register as source for other tools (asSource)", () => {
  const doc = { title: "Nootka", entries: { boat_mass_kg: { basis: "estimate", value: { nominal: 8330, min: 8100 } } } }
  it.each([
    ["py", "python"],
    ["scad", "scad"],
    ["json", "json"],
    [".PY", "python"],
  ])("%s gives the %s export", (ext, format) => {
    expect(AssumptionsDatatype.asSource(doc, ext)).toBe(renderExport(doc.entries, { format, title: "Nootka" }))
  })
  it.each([["md"], [""], [undefined]])("%j gives null", (ext) => {
    expect(AssumptionsDatatype.asSource(doc, ext)).toBeNull()
  })
  it("the JSON is a flat id → value object", () => {
    expect(JSON.parse(AssumptionsDatatype.asSource(doc, "json"))).toMatchObject({ boat_mass_kg: 8330, boat_mass_kg_min: 8100 })
  })
  it("leaves out the results the asking document computes itself, and only those", () => {
    const linked = {
      title: "Nootka",
      entries: {
        boat_mass_kg: { basis: "estimate", value: { nominal: 8330 } },
        cad_pack_volume_L: { basis: "model", model: { url: "automerge:bay#h1" }, value: { nominal: 1690.9 } },
        cad_bay_L: { basis: "model", model: { url: null, ran: { "automerge:bay": {} } }, value: { nominal: 310 } },
        prop_P_kW: { basis: "model", model: { url: "automerge:model1" }, value: { nominal: 47.2 } },
      },
    }
    const ids = (opts) => Object.keys(JSON.parse(AssumptionsDatatype.asSource(linked, "json", opts))).filter((k) => !k.startsWith("_"))
    expect(ids({ for: "automerge:bay" }).sort()).toEqual(["boat_mass_kg", "prop_P_kW"])
    expect(ids({ for: "automerge:model1#x" }).sort()).toEqual(["boat_mass_kg", "cad_bay_L", "cad_pack_volume_L"])
    expect(ids(undefined).sort()).toEqual(["boat_mass_kg", "cad_bay_L", "cad_pack_volume_L", "prop_P_kW"])
  })
})
