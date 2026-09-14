import { describe, it, expect, beforeEach } from "vitest"
import { createHarness, makeExpect, deepEqual, loadVitestAssertions, _resetVitest } from "./tools/harness.js"

const run = async (register, options) => {
  const harness = createHarness(options)
  register(harness.api)
  return await harness.run()
}

describe("deepEqual", () => {
  it("compares structures, not identity", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
  })
  it("handles dates, maps and sets", () => {
    expect(deepEqual(new Date(5), new Date(5))).toBe(true)
    expect(deepEqual(new Map([["a", 1]]), new Map([["a", 1]]))).toBe(true)
    expect(deepEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true)
    expect(deepEqual(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false)
  })
})

describe("the injected expect", () => {
  const check = makeExpect()

  it("passes and fails the common matchers", () => {
    check(1).toBe(1)
    check({ a: 1 }).toEqual({ a: 1 })
    check("hello").toContain("ell")
    check([1, 2, 3]).toHaveLength(3)
    check("abc").toMatch(/b/)
    check({ a: 1, b: 2 }).toMatchObject({ a: 1 })
    check(5).toBeGreaterThan(4)
    check(0.1 + 0.2).toBeCloseTo(0.3)
    check(null).toBeNull()
    check([{ a: 1 }]).toContainEqual({ a: 1 })
    check({ a: { b: 2 } }).toHaveProperty("a.b", 2)
  })

  it("reports what was actually wrong", () => {
    let message = ""
    try {
      check(2).toBe(3)
    } catch (err) {
      message = err.message
    }
    expect(message).toBe("expected 2 to be 3")
  })

  it("supports .not", () => {
    check(1).not.toBe(2)
    expect(() => check(1).not.toBe(1)).toThrow(/not to be 1/)
  })

  it("catches thrown errors and matches their message", () => {
    check(() => { throw new Error("boom") }).toThrow(/boom/)
    check(() => {}).not.toThrow()
    expect(() => check(() => {}).toThrow()).toThrow(/expected the function to throw/)
  })

  it("handles rejected promises", async () => {
    await check(Promise.reject(new Error("nope"))).rejects.toThrow(/nope/)
  })

  it("names a matcher it does not have instead of failing obscurely", () => {
    expect(() => check(1).toBeWithinRange(0, 5)).toThrow(/no 'toBeWithinRange' matcher/)
  })
})

describe("the harness runner", () => {
  it("reports passes and failures with suite names", async () => {
    const results = await run(({ describe: d, it: i, expect: e }) => {
      d("math", () => {
        i("adds", () => e(1 + 1).toBe(2))
        i("is wrong", () => e(1 + 1).toBe(3))
      })
    })

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ label: "math › adds", status: "passed" })
    expect(results[1].status).toBe("failed")
    expect(results[1].error).toContain("expected 2 to be 3")
  })

  it("awaits async tests", async () => {
    const results = await run(({ it: i, expect: e }) => {
      i("waits", async () => {
        await new Promise((r) => setTimeout(r, 10))
        e(true).toBe(true)
      })
    })
    expect(results[0].status).toBe("passed")
  })

  it("times out a test that hangs, instead of hanging the run", async () => {
    const results = await run(({ it: i }) => {
      i("hangs", () => new Promise(() => {}))
    }, { timeoutMs: 50 })

    expect(results[0].status).toBe("failed")
    expect(results[0].error).toMatch(/timed out/)
  })

  it("runs beforeEach and afterEach around every test", async () => {
    const order = []
    await run(({ it: i, beforeEach: be, afterEach: ae }) => {
      be(() => order.push("before"))
      ae(() => order.push("after"))
      i("one", () => order.push("one"))
      i("two", () => order.push("two"))
    })
    expect(order).toEqual(["before", "one", "after", "before", "two", "after"])
  })

  it("still runs afterEach when a test fails", async () => {
    const order = []
    await run(({ it: i, afterEach: ae, expect: e }) => {
      ae(() => order.push("cleanup"))
      i("fails", () => e(1).toBe(2))
      i("passes", () => e(1).toBe(1))
    })
    expect(order).toEqual(["cleanup", "cleanup"])
  })

  it("honours skip and only", async () => {
    const skipped = await run(({ it: i }) => { i.skip("nope"); i("yes", () => {}) })
    expect(skipped.find((r) => r.label === "nope").status).toBe("skipped")

    const focused = await run(({ it: i, expect: e }) => {
      i("ignored", () => e(1).toBe(2))
      i.only("focused", () => e(1).toBe(1))
    })
    expect(focused).toHaveLength(1)
    expect(focused[0].label).toBe("focused")
  })

  it("nests describes into the label", async () => {
    const results = await run(({ describe: d, it: i }) => {
      d("outer", () => d("inner", () => i("deep", () => {})))
    })
    expect(results[0].label).toBe("outer › inner › deep")
  })
})

describe("real vitest assertions", () => {
  beforeEach(_resetVitest)

  it("assembles chai with the jest plugins, the way vitest does", async () => {
    const installed = []
    const chai = {
      use: (plugin) => installed.push(plugin.name ?? "plugin"),
      expect: (actual) => ({ toBe: (v) => actual === v }),
    }
    const modules = {
      chai,
      expect: { JestExtend: function JestExtend() {}, JestChaiExpect: function JestChaiExpect() {}, JestAsymmetricMatchers: function JestAsymmetricMatchers() {} },
      spy: { fn: () => {}, spyOn: () => {}, isMockFunction: () => false, mocks: [] },
    }
    const importModule = async (url) =>
      url.includes("chai") ? modules.chai : url.includes("expect") ? modules.expect : modules.spy

    const assertions = await loadVitestAssertions({ importModule })

    expect(installed).toEqual(["JestExtend", "JestChaiExpect", "JestAsymmetricMatchers"])
    expect(assertions.source).toContain("vitest@")
    expect(typeof assertions.vi.fn).toBe("function")
    expect(typeof assertions.vi.spyOn).toBe("function")
  })

  it("falls back rather than failing when the network is unreachable", async () => {
    const assertions = await loadVitestAssertions({
      importModule: async () => { throw new Error("offline") },
    })
    expect(assertions).toBeNull()

    // A harness with no assertions still runs, using the built-in matchers.
    const harness = createHarness({ assertions: null })
    expect(harness.engine).toMatch(/built-in/)
    harness.api.it("still works", () => harness.api.expect(1).toBe(1))
    const results = await harness.run()
    expect(results[0].status).toBe("passed")
  })

  it("reports which engine it used, rather than pretending", async () => {
    const fake = { expect: () => ({}), vi: { fn: () => {} }, source: "vitest@9.9.9" }
    expect(createHarness({ assertions: fake }).engine).toBe("vitest@9.9.9")
    expect(createHarness({ assertions: null }).engine).toMatch(/built-in matchers/)
  })

  it("exposes vi to tests when the real spy library is present", () => {
    const spy = () => {}
    const harness = createHarness({ assertions: { expect: () => ({}), vi: { fn: spy }, source: "vitest@x" } })
    expect(harness.api.vi.fn).toBe(spy)
  })
})
