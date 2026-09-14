/**
 * A test harness small enough to inject, familiar enough to write against.
 *
 * The agent can write tests; without something to run them it never learns
 * whether they pass, which is the same blindness `tool_check` fixed for tools.
 * vitest and jest are node programs, so neither can run here — but their
 * *surface* is what everyone writes tests against, so this implements that
 * surface: describe, it, expect, and the hooks.
 *
 * Deliberately not a reimplementation of vitest. It is the subset that carries
 * almost all real assertions, and it says clearly when a test uses something it
 * does not have, rather than silently passing.
 */

/** Readable rendering of a value in a failure message. */
function show(value, depth = 0) {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`
  if (typeof value !== "object") return String(value)
  if (depth > 2) return Array.isArray(value) ? "[…]" : "{…}"
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (Array.isArray(value)) return `[${value.map((v) => show(v, depth + 1)).join(", ")}]`
  const entries = Object.entries(value).map(([k, v]) => `${k}: ${show(v, depth + 1)}`)
  return `{ ${entries.join(", ")} }`
}

/** Structural equality, the `toEqual` kind. */
export function deepEqual(a, b) {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false

  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false
    for (const [key, value] of a) if (!b.has(key) || !deepEqual(value, b.get(key))) return false
    return true
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false
    for (const value of a) if (!b.has(value)) return false
    return true
  }

  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
}

class AssertionError extends Error {
  constructor(message) {
    super(message)
    this.name = "AssertionError"
  }
}

/** `expect(actual)`, with `.not` and the matchers people actually use. */
export function makeExpect() {
  const build = (actual, negated) => {
    const check = (passed, message, inverseMessage) => {
      if (passed === !negated) return
      throw new AssertionError(negated ? inverseMessage : message)
    }

    const matchers = {
      toBe: (expected) =>
        check(Object.is(actual, expected), `expected ${show(actual)} to be ${show(expected)}`, `expected ${show(actual)} not to be ${show(expected)}`),

      toEqual: (expected) =>
        check(deepEqual(actual, expected), `expected ${show(actual)} to equal ${show(expected)}`, `expected ${show(actual)} not to equal ${show(expected)}`),

      toBeTruthy: () => check(!!actual, `expected ${show(actual)} to be truthy`, `expected ${show(actual)} to be falsy`),
      toBeFalsy: () => check(!actual, `expected ${show(actual)} to be falsy`, `expected ${show(actual)} to be truthy`),
      toBeNull: () => check(actual === null, `expected ${show(actual)} to be null`, `expected ${show(actual)} not to be null`),
      toBeUndefined: () => check(actual === undefined, `expected ${show(actual)} to be undefined`, `expected ${show(actual)} not to be undefined`),
      toBeDefined: () => check(actual !== undefined, `expected value to be defined`, `expected value to be undefined`),
      toBeNaN: () => check(Number.isNaN(actual), `expected ${show(actual)} to be NaN`, `expected ${show(actual)} not to be NaN`),

      toContain: (needle) => {
        const has =
          typeof actual === "string"
            ? actual.includes(needle)
            : Array.isArray(actual) || actual instanceof Set
              ? [...actual].some((item) => Object.is(item, needle))
              : false
        check(has, `expected ${show(actual)} to contain ${show(needle)}`, `expected ${show(actual)} not to contain ${show(needle)}`)
      },

      toContainEqual: (needle) =>
        check(
          Array.isArray(actual) && actual.some((item) => deepEqual(item, needle)),
          `expected ${show(actual)} to contain an item equal to ${show(needle)}`,
          `expected ${show(actual)} not to contain an item equal to ${show(needle)}`
        ),

      toHaveLength: (length) =>
        check(actual?.length === length, `expected length ${show(actual?.length)} to be ${length}`, `expected length not to be ${length}`),

      // `...rest` rather than a second parameter: an arrow function has no
      // `arguments`, and the matcher has to tell "no expected value given"
      // apart from "expected undefined".
      toHaveProperty: (key, ...rest) => {
        let node = actual
        for (const part of String(key).split(".")) node = node?.[part]
        const present = node !== undefined
        check(
          rest.length ? present && deepEqual(node, rest[0]) : present,
          `expected ${show(actual)} to have property ${key}`,
          `expected ${show(actual)} not to have property ${key}`
        )
      },

      toMatch: (pattern) => {
        const matched = pattern instanceof RegExp ? pattern.test(String(actual)) : String(actual).includes(pattern)
        check(matched, `expected ${show(actual)} to match ${pattern}`, `expected ${show(actual)} not to match ${pattern}`)
      },

      toMatchObject: (expected) => {
        const subset = Object.entries(expected).every(([key, value]) =>
          typeof value === "object" && value !== null ? deepEqual(actual?.[key], value) : Object.is(actual?.[key], value)
        )
        check(subset, `expected ${show(actual)} to match ${show(expected)}`, `expected ${show(actual)} not to match ${show(expected)}`)
      },

      toBeGreaterThan: (n) => check(actual > n, `expected ${show(actual)} to be greater than ${n}`, `expected ${show(actual)} not to be greater than ${n}`),
      toBeGreaterThanOrEqual: (n) => check(actual >= n, `expected ${show(actual)} to be >= ${n}`, `expected ${show(actual)} not to be >= ${n}`),
      toBeLessThan: (n) => check(actual < n, `expected ${show(actual)} to be less than ${n}`, `expected ${show(actual)} not to be less than ${n}`),
      toBeLessThanOrEqual: (n) => check(actual <= n, `expected ${show(actual)} to be <= ${n}`, `expected ${show(actual)} not to be <= ${n}`),
      toBeCloseTo: (n, digits = 2) =>
        check(Math.abs(actual - n) < 10 ** -digits / 2, `expected ${show(actual)} to be close to ${n}`, `expected ${show(actual)} not to be close to ${n}`),

      toBeInstanceOf: (constructor) =>
        check(actual instanceof constructor, `expected ${show(actual)} to be an instance of ${constructor?.name}`, `expected ${show(actual)} not to be an instance of ${constructor?.name}`),

      toThrow: (expected) => {
        if (typeof actual !== "function") throw new AssertionError("expect(…).toThrow needs a function")
        let thrown = null
        try {
          actual()
        } catch (err) {
          thrown = err
        }
        if (!thrown) {
          check(false, "expected the function to throw", "expected the function not to throw")
          return
        }
        const message = String(thrown?.message ?? thrown)
        const matched =
          expected === undefined ||
          (expected instanceof RegExp ? expected.test(message) : message.includes(String(expected)))
        check(matched, `expected the error ${show(message)} to match ${expected}`, `expected the error not to match ${expected}`)
      },
    }

    // Async variants, so `await expect(p).rejects.toThrow(...)` works.
    matchers.resolves = {
      async toBe(expected) {
        build(await actual, negated).toBe(expected)
      },
      async toEqual(expected) {
        build(await actual, negated).toEqual(expected)
      },
    }
    matchers.rejects = {
      async toThrow(expected) {
        let thrown = null
        try {
          await actual
        } catch (err) {
          thrown = err
        }
        if (!thrown) {
          check(false, "expected the promise to reject", "expected the promise not to reject")
          return
        }
        const message = String(thrown?.message ?? thrown)
        const matched =
          expected === undefined ||
          (expected instanceof RegExp ? expected.test(message) : message.includes(String(expected)))
        check(matched, `expected the rejection ${show(message)} to match ${expected}`, `expected the rejection not to match ${expected}`)
      },
    }

    if (!negated) {
      Object.defineProperty(matchers, "not", { get: () => build(actual, true) })
    }

    return new Proxy(matchers, {
      get(target, property) {
        if (property in target) return target[property]
        if (typeof property !== "string") return undefined
        // Say what is missing rather than failing as `undefined is not a function`.
        return () => {
          throw new AssertionError(
            `This harness has no '${property}' matcher. Available: ${Object.keys(target).filter((k) => k !== "not").join(", ")}`
          )
        }
      },
    })
  }

  return (actual) => build(actual, false)
}

/**
 * A harness instance: the API a test file imports, and a runner for what it
 * registered. One per test file, so files cannot see each other's state.
 */
export function createHarness({ timeoutMs = 5000 } = {}) {
  const tests = []
  const suite = []
  const hooks = { beforeEach: [], afterEach: [], beforeAll: [], afterAll: [] }

  const describe = (name, fn) => {
    suite.push(name)
    try {
      fn()
    } finally {
      suite.pop()
    }
  }

  const it = (name, fn) => {
    tests.push({ name, suite: [...suite], fn, skipped: !fn })
  }
  it.skip = (name) => tests.push({ name, suite: [...suite], fn: null, skipped: true })
  it.only = (name, fn) => tests.push({ name, suite: [...suite], fn, only: true })
  describe.skip = () => {}

  const api = {
    describe,
    it,
    test: it,
    expect: makeExpect(),
    beforeEach: (fn) => hooks.beforeEach.push(fn),
    afterEach: (fn) => hooks.afterEach.push(fn),
    beforeAll: (fn) => hooks.beforeAll.push(fn),
    afterAll: (fn) => hooks.afterAll.push(fn),
  }

  async function run() {
    const results = []
    const focused = tests.filter((t) => t.only)
    const chosen = focused.length ? focused : tests

    for (const hook of hooks.beforeAll) await hook()

    for (const test of chosen) {
      const label = [...test.suite, test.name].join(" › ")
      if (test.skipped) {
        results.push({ label, status: "skipped" })
        continue
      }

      const started = Date.now()
      try {
        for (const hook of hooks.beforeEach) await hook()
        await Promise.race([
          test.fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
          ),
        ])
        for (const hook of hooks.afterEach) await hook()
        results.push({ label, status: "passed", ms: Date.now() - started })
      } catch (err) {
        // Run afterEach even on failure, so one bad test does not poison the rest.
        for (const hook of hooks.afterEach) {
          try {
            await hook()
          } catch {
            /* a failing cleanup is not the interesting failure */
          }
        }
        results.push({
          label,
          status: "failed",
          ms: Date.now() - started,
          error: String(err?.message ?? err),
          stack: String(err?.stack ?? "").split("\n").slice(1, 4).join("\n"),
        })
      }
    }

    for (const hook of hooks.afterAll) await hook()
    return results
  }

  return { api, run, get registered() { return tests.length } }
}
