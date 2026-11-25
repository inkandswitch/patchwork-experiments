/**
 * The `vitest` a test file imports when package_test runs it.
 *
 * Everything that decides what a test means is vitest's own, from the engine
 * in ./vendor/vitest-engine.js: @vitest/runner collects and runs suites
 * (describe, it, each, hooks, timeouts, only, skip, todo, concurrent),
 * @vitest/expect puts the matchers on chai the way vitest assembles them, and
 * @vitest/spy is vi.fn and vi.spyOn. What is ours is a host: how a file is
 * imported, and the shape of the report. So a test file means the same thing
 * under `vitest run`, in a page and in a worker.
 *
 * Not here: vi.mock (vite rewrites the file to hoist it), fake timers,
 * snapshots and coverage. Environments are the host's: a page has a real DOM
 * and a worker has none.
 *
 * Runs anywhere — page, worker, Node — so nothing in this file may assume a
 * DOM.
 */

const installed = new WeakSet()

/** "outer › inner › test", from a task up to its file. */
export function labelOf(task) {
  const names = []
  for (let t = task; t && t.type !== "file" && t.name; t = t.suite) names.unshift(t.name)
  return names.join(" › ")
}

const FRESH_STATE = {
  assertionCalls: 0,
  isExpectingAssertions: false,
  isExpectingAssertionsError: null,
  expectedAssertionsNumber: null,
  expectedAssertionsNumberErrorGen: null,
}

/**
 * The test API over one engine module, and a way to run one file with it.
 *
 * @param {typeof import("./vendor/vitest-engine.js")} engine
 */
export function createRuntime(engine) {
  const { chai, expect: lib, spy, runner } = engine
  if (!installed.has(chai)) {
    chai.use(lib.JestExtend)
    chai.use(lib.JestChaiExpect)
    chai.use(lib.JestAsymmetricMatchers)
    installed.add(chai)
  }

  /** vitest's createExpect, minus polling, snapshots and environments. */
  function createExpect(task) {
    const expect = (value, message) => {
      const { assertionCalls } = lib.getState(expect)
      lib.setState({ assertionCalls: assertionCalls + 1 }, expect)
      const assertion = chai.expect(value, message)
      const current = task || runner.getCurrentTest()
      return current && assertion.withTest ? assertion.withTest(current) : assertion
    }
    Object.assign(expect, chai.expect)
    Object.assign(expect, globalThis[lib.ASYMMETRIC_MATCHERS_OBJECT])
    expect.getState = () => lib.getState(expect)
    expect.setState = (state) => lib.setState(state, expect)
    lib.setState({ ...FRESH_STATE, currentTestName: task ? labelOf(task) : undefined }, expect)
    expect.extend = (matchers) => chai.expect.extend(expect, matchers)
    expect.addEqualityTesters = (testers) => lib.addCustomEqualityTesters(testers)
    expect.soft = (...args) => expect(...args).withContext({ soft: true })
    expect.unreachable = (message) =>
      chai.assert.fail(`expected${message ? ` "${message}" ` : " "}not to be reached`)
    chai.util.addMethod(expect, "assertions", (n) =>
      expect.setState({
        expectedAssertionsNumber: n,
        expectedAssertionsNumberErrorGen: () =>
          new Error(`expected number of assertions to be ${n}, but got ${expect.getState().assertionCalls}`),
      })
    )
    chai.util.addMethod(expect, "hasAssertions", () =>
      expect.setState({
        isExpectingAssertions: true,
        isExpectingAssertionsError: new Error("expected any number of assertion, but got none"),
      })
    )
    expect.extend(lib.customMatchers)
    return expect
  }

  const expect = createExpect()

  const unsupported = (name) => () => {
    throw new Error(`vi.${name} isn't available in package_test: it needs vitest's CLI, which only runs in Node`)
  }
  const vi = new Proxy(
    {
      fn: spy.fn,
      spyOn: spy.spyOn,
      isMockFunction: spy.isMockFunction,
      mocked: (value) => value,
      clearAllMocks() {
        spy.mocks.forEach((m) => m.mockClear())
        return vi
      },
      resetAllMocks() {
        spy.mocks.forEach((m) => m.mockReset())
        return vi
      },
      restoreAllMocks() {
        spy.mocks.forEach((m) => m.mockRestore())
        return vi
      },
    },
    { get: (target, key) => (key in target || typeof key !== "string" ? target[key] : unsupported(key)) }
  )

  const api = {
    describe: runner.describe,
    suite: runner.suite,
    it: runner.it,
    test: runner.test,
    beforeAll: runner.beforeAll,
    afterAll: runner.afterAll,
    beforeEach: runner.beforeEach,
    afterEach: runner.afterEach,
    onTestFailed: runner.onTestFailed,
    onTestFinished: runner.onTestFinished,
    expect,
    assert: chai.assert,
    chai,
    vi,
    vitest: vi,
  }

  /**
   * Run one test file. `load()` imports it — the runner calls it while
   * collecting, so the file's describe/it land in this run.
   *
   * @returns {Promise<{ results: Array<{label, status, ms, error?, diff?, stack?}>, error?: string, unhandled: string[] }>}
   */
  async function runFile(path, load, { testTimeout = 5000, hookTimeout = 10000, filter = null } = {}) {
    const config = {
      root: "/",
      setupFiles: [],
      passWithNoTests: true,
      allowOnly: true,
      testNamePattern: filter ? new RegExp(filter) : undefined,
      sequence: { seed: Date.now(), hooks: "stack", setupFiles: "list" },
      maxConcurrency: 5,
      testTimeout,
      hookTimeout,
      retry: 0,
      includeTaskLocation: false,
      diffOptions: { truncateThreshold: 40 },
    }
    const host = {
      config,
      importFile: () => load(),
      onBeforeTryTask(task) {
        expect.setState({ ...FRESH_STATE, currentTestName: labelOf(task) })
      },
      onAfterTryTask() {
        const state = expect.getState()
        if (state.expectedAssertionsNumber !== null && state.assertionCalls !== state.expectedAssertionsNumber) {
          throw state.expectedAssertionsNumberErrorGen()
        }
        if (state.isExpectingAssertions && state.assertionCalls === 0) throw state.isExpectingAssertionsError
      },
      extendTaskContext(context) {
        context.expect = createExpect(context.task)
        return context
      },
    }

    // The matchers find the current expect through this global. It's
    // restored afterwards so a run nested in another vitest (this package's
    // own tests) leaves the outer one's alone.
    const GLOBAL = lib.GLOBAL_EXPECT
    const previous = Object.getOwnPropertyDescriptor(globalThis, GLOBAL)
    Object.defineProperty(globalThis, GLOBAL, { value: expect, writable: true, configurable: true })
    const unhandled = []
    const stopListening = listenForUnhandled(unhandled)
    try {
      const [file] = await runner.startTests([path], host)
      // Errors from a test's leftovers — a timer, a promise nobody awaited —
      // arrive after it finishes, and Chrome delivers unhandledrejection later
      // than the next task (measured: a 0 ms wait misses it, in a page and a
      // worker).
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
      return { ...reportOf(file), unhandled }
    } finally {
      stopListening()
      if (previous) Object.defineProperty(globalThis, GLOBAL, previous)
      else delete globalThis[GLOBAL]
    }
  }

  return { api, runFile, versions: engine.versions }
}

/** How long a file's leftovers get to report an error after its last test. */
export const SETTLE_MS = 100

const STATUS = { pass: "passed", fail: "failed", skip: "skipped", todo: "skipped" }

/** Flatten the runner's task tree into what the report prints. */
export function reportOf(file) {
  const results = []
  const walk = (task) => {
    for (const child of task.tasks ?? []) {
      if (child.type === "suite") {
        // A failing beforeAll/afterAll fails the suite, not a test.
        for (const error of child.result?.errors ?? []) {
          results.push({ label: `${labelOf(child)} (hook)`, status: "failed", ...errorOf(error) })
        }
        walk(child)
        continue
      }
      const state = child.result?.state ?? child.mode
      const status = STATUS[state] ?? (child.mode === "skip" || child.mode === "todo" ? "skipped" : "failed")
      const result = { label: labelOf(child), status, ms: Math.round(child.result?.duration ?? 0) }
      const error = child.result?.errors?.[0]
      results.push(error ? { ...result, ...errorOf(error) } : result)
    }
  }
  walk(file)
  const fileErrors = file.result?.errors ?? []
  if (fileErrors.length && !results.length) return { results, error: errorOf(fileErrors[0]).error }
  for (const error of fileErrors) results.push({ label: "(file)", status: "failed", ...errorOf(error) })
  return { results }
}

// vitest colours a diff where it thinks a terminal or devtools will show it
// (a page with window.chrome); a report is read as text, so it never is.
const ANSI = /\x1b\[[0-9;]*m/g

function errorOf(error) {
  const out = { error: String(error?.message ?? error).replace(ANSI, "") }
  if (error?.diff) out.diff = String(error.diff).replace(ANSI, "")
  if (error?.stack) out.stack = String(error.stack).split("\n").slice(1, 4).join("\n")
  return out
}

function describeUnhandled(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  return String(value?.message ?? value)
}

/** Collect errors nothing caught while a file runs, where the host has events for them. */
function listenForUnhandled(into) {
  const target = globalThis
  if (typeof target.addEventListener !== "function") return () => {}
  const onError = (event) => into.push(describeUnhandled(event.error ?? event.message))
  const onRejection = (event) => into.push(describeUnhandled(event.reason))
  target.addEventListener("error", onError)
  target.addEventListener("unhandledrejection", onRejection)
  return () => {
    target.removeEventListener("error", onError)
    target.removeEventListener("unhandledrejection", onRejection)
  }
}

/** Render one console argument as a person reads it in a console. */
function logArgument(value) {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Collect what the console is given until `stop()`, still passing it
 * through. A test that logs was shown nothing: the sailing note's way to see a
 * value was to throw an Error with the JSON in it.
 */
export function captureConsole(target = globalThis.console) {
  const lines = []
  const originals = {}
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    originals[level] = target[level]
    target[level] = (...args) => {
      lines.push(`${level === "log" ? "" : `[${level}] `}${args.map(logArgument).join(" ")}`)
      originals[level]?.apply(target, args)
    }
  }
  return {
    lines,
    stop() {
      Object.assign(target, originals)
    },
  }
}
