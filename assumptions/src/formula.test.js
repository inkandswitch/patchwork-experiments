import { describe, expect, it } from "vitest"
import { checkInterval, evalInterval, evalNominal, parse } from "./formula.js"

const INF = Infinity
// Every interval shape: point, closed, half-open each way, unbounded — across zero and not.
const shapes = [
  [2, 2],
  [0, 0],
  [-3, -1],
  [1, 4],
  [-2, 3],
  [0, 5],
  [-5, 0],
  [1, INF],
  [-INF, 2],
  [-INF, -1],
  [0, INF],
  [-INF, INF],
]

/** Finite points inside an interval: its finite ends, a middle, and far points on open sides. */
function samples([lo, hi]) {
  const pts = new Set()
  if (Number.isFinite(lo)) pts.add(lo)
  if (Number.isFinite(hi)) pts.add(hi)
  const a = Number.isFinite(lo) ? lo : Number.isFinite(hi) ? hi - 1e6 : -1e6
  const b = Number.isFinite(hi) ? hi : Number.isFinite(lo) ? lo + 1e6 : 1e6
  pts.add((a + b) / 2)
  pts.add(a)
  pts.add(b)
  if (a < 0 && b > 0) pts.add(0)
  return [...pts]
}

const within = (x, [lo, hi]) => x >= lo - 1e-9 * Math.max(1, Math.abs(lo)) && x <= hi + 1e-9 * Math.max(1, Math.abs(hi))

describe("parsing", () => {
  it("reads arithmetic and checks, and says what's wrong", () => {
    expect(parse("a_b / c_d * 1000").ids).toEqual(["a_b", "c_d"])
    expect(parse("x_y <= 0.25 * z_w and not (p_q > 1)").kind).toBe("boolean")
    expect(parse("x_y × 2 − z_w ÷ 3").kind).toBe("number")
    expect(() => parse("a_b +")).toThrow(/ends too soon/)
    expect(() => parse("exp(a_b)")).toThrow(/not a function/)
    expect(() => parse("a_b < c_d < e_f")).toThrow(/and/)
    expect(() => parse("a_b and c_d")).toThrow(/compare/)
  })
})

describe("interval arithmetic is sound", () => {
  const ops = ["a + b", "a - b", "a * b", "a / b", "min(a, b)", "max(a, b)", "abs(a)", "sqrt(abs(a))", "pow(a, 2)", "pow(a, 3)", "a ^ -1", "pow(abs(a) + 1, b)"]
  for (const op of ops) {
    it(op, () => {
      const { ast } = parse(op.replace(/\ba\b/g, "a_x").replace(/\bb\b/g, "b_x"))
      for (const A of shapes) {
        for (const B of shapes) {
          const box = evalInterval(ast, (id) => (id === "a_x" ? A : B))
          for (const a of samples(A)) {
            for (const b of samples(B)) {
              const v = evalNominal(ast, (id) => (id === "a_x" ? a : b))
              if (v === undefined || Math.abs(v) > 1e15) continue
              expect(within(v, box), `${op} at a=${a} b=${b} in ${A}×${B} → [${box}]`).toBe(true)
            }
          }
        }
      }
    })
  }
})

describe("checks over intervals", () => {
  // holds over bounds implies the check holds at every point of the box, and so does fails.
  for (const op of ["<", "<=", ">", ">=", "==", "!="]) {
    it(`a ${op} b`, () => {
      const { ast } = parse(`a_x ${op} b_x`)
      for (const A of shapes) {
        for (const B of shapes) {
          const outcome = checkInterval(ast, (id) => (id === "a_x" ? A : B))
          if (outcome === "depends") continue
          for (const a of samples(A)) {
            for (const b of samples(B)) {
              const truth = op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : op === ">=" ? a >= b : op === "==" ? a === b : a !== b
              expect(truth, `${A} ${op} ${B} said ${outcome}, but a=${a} b=${b}`).toBe(outcome === "holds")
            }
          }
        }
      }
    })
  }

  it("decides what it can: disjoint intervals hold or fail outright", () => {
    const { ast } = parse("a_x <= b_x")
    expect(checkInterval(ast, (id) => (id === "a_x" ? [1, 2] : [3, 4]))).toBe("holds")
    expect(checkInterval(ast, (id) => (id === "a_x" ? [5, 6] : [3, 4]))).toBe("fails")
    expect(checkInterval(ast, (id) => (id === "a_x" ? [-INF, 2] : [3, 4]))).toBe("holds")
    expect(checkInterval(ast, (id) => (id === "a_x" ? [1, INF] : [3, 4]))).toBe("depends")
  })

  it("three-valued and / or / not", () => {
    const get = (id) => ({ h_x: [1, 1], f_x: [5, 5], d_x: [0, 9] })[id]
    const holds = "h_x < 2"
    const fails = "f_x < 2"
    const depends = "d_x < 2"
    const outcome = (text) => checkInterval(parse(text).ast, get)
    expect(outcome(`${holds} and ${depends}`)).toBe("depends")
    expect(outcome(`${fails} and ${depends}`)).toBe("fails")
    expect(outcome(`${holds} or ${depends}`)).toBe("holds")
    expect(outcome(`${fails} or ${depends}`)).toBe("depends")
    expect(outcome(`not ${depends}`)).toBe("depends")
    expect(outcome(`not ${holds}`)).toBe("fails")
  })
})
