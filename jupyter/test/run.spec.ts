import * as Automerge from "@automerge/automerge"
import { beforeAll, describe, expect, test } from "vitest"
import { automergeStandIn, setAutomerge } from "../shared/automerge"
import { CellRunner } from "../shared/cells"
import { outputsFingerprint, readHash, runOf } from "../shared/imports"
import { notebookDoc } from "../shared/notebook-doc"
import { NotebookWriter } from "../shared/notebook-writer"
import { forDocument, runHooks } from "../shared/run"
import { syncedWithServer, syncNote } from "../shared/sync"
import type { KernelClient } from "../native/src/kernel/types"
import { linkImports, pickCells, registerIds, report, staleLine } from "../src/notebook-run"

/** A DocHandle over an Automerge document, as far as the writer needs one. */
function handleOf(doc: any) {
  let current = Automerge.from(doc)
  return {
    url: "automerge:notebook",
    doc: () => current,
    heads: () => Automerge.getHeads(current),
    change: (fn: (d: any) => void) => {
      current = Automerge.change(current, fn)
    },
  }
}

const code = (id: string, source: string) => ({ id, cell_type: "code", source, metadata: {}, outputs: [], execution_count: null })

/**
 * A kernel that runs a tiny language: each line `print X` prints X, `raise X`
 * fails with X, and anything else is ok. Silent code is recorded.
 */
function fakeKernel(): KernelClient & { silent: string[]; restartCount: number; loaded: unknown[] } {
  let count = 0
  const kernel = {
    loaded: [] as unknown[],
    async capture(source: string) {
      return source.includes("reads()") ? JSON.stringify(kernel.loaded) : ""
    },
    status: "idle" as const,
    generation: 1,
    silent: [] as string[],
    restartCount: 0,
    onStatus: () => () => {},
    async execute(source: string, onIOPub: (m: any) => void) {
      count++
      for (const line of source.split("\n")) {
        const [verb, ...rest] = line.split(" ")
        if (verb === "print") onIOPub({ header: { msg_type: "stream" }, content: { name: "stdout", text: `${rest.join(" ")}\n` } })
        if (verb === "raise") {
          const traceback = ["\x1b[31mTraceback (most recent call last)\x1b[0m", `  File "<cell>", line 1`, `ValueError: ${rest.join(" ")}`]
          onIOPub({ header: { msg_type: "error" }, content: { ename: "ValueError", evalue: rest.join(" "), traceback } })
          return { status: "error", execution_count: count, ename: "ValueError", evalue: rest.join(" "), traceback } as any
        }
      }
      return { status: "ok", execution_count: count } as any
    },
    async executeSilent(source: string) {
      kernel.silent.push(source)
      return source.includes("FAIL_SETUP") ? ({ status: "error", ename: "ImportError", evalue: "rename the import json: it would hide a module Python already has" } as any) : ({ status: "ok" } as any)
    },
    complete: async () => ({}) as any,
    inspect: async () => ({}) as any,
    async restart() {
      kernel.restartCount++
      kernel.generation++
    },
    dispose() {},
  }
  return kernel
}

beforeAll(() => setAutomerge(Automerge))

function setup(cells: any[], metadata: any = {}) {
  const handle = handleOf({ ...notebookDoc({ nbformat: 4, nbformat_minor: 5, metadata, cells } as any, "Model 2") })
  const writer = new NotebookWriter(handle as any)
  const kernel = fakeKernel()
  const docs: Record<string, any> = {
    "automerge:reg": { doc: () => ({ "@patchwork": { type: "assumptions" }, title: "Nootka assumptions", entries: { boat_mass_kg: { value: { nominal: 8330 } }, boat_speed_kn: { value: { nominal: 8 } } } }), heads: () => ["regA", "regB"] },
    "automerge:4NMNnkMhL8jXrdJ9jamS7Z": { doc: () => ({ "@patchwork": { type: "datagrid" }, title: "Loads", data: [[1, 2]] }), heads: () => ["grid"] },
    "automerge:m1": { doc: () => ({ "@patchwork": { type: "jupyter-notebook" }, title: "Model 1", cells: [code("x", "def f(): pass")] }), heads: () => ["m1"] },
  }
  let clock = Date.parse("2026-11-22T10:00:00Z")
  const hooks = runHooks({
    writer,
    kernel,
    find: async url => docs[url] ?? Promise.reject(new Error("unavailable")),
    datatype: async type => (type === "assumptions" ? { asSource: (_doc: unknown, ext: string) => (ext === "py" ? "boat_mass_kg = 8330\n" : ext === "json" ? '{"boat_mass_kg": 8330}' : null) } : null),
    by: "agent",
    now: () => new Date((clock += 1000)),
  })
  return { handle, writer, kernel, hooks, docs, runner: new CellRunner(writer, kernel, hooks) }
}

const imports = [
  { name: "reg", docUrl: "automerge:reg" },
  { name: "model_1", docUrl: "automerge:m1" },
]

describe("a run", () => {
  test("writes outputs and execution counts, and records what it ran with", async () => {
    const { handle, kernel, runner } = setup([code("a", "print boat_drag_N 1020.4"), code("b", "print done")], { patchwork: { imports } })
    const outcome = await runner.run(["a", "b"])
    expect(outcome.results.map(r => [r.id, r.status, r.executionCount])).toEqual([
      ["a", "ok", 1],
      ["b", "ok", 2],
    ])
    const doc = handle.doc() as any
    expect(String(doc.cells[0].outputs[0].text)).toBe("boat_drag_N 1020.4\n")
    expect(doc.cells[1].execution_count).toBe(2)
    // The imports went into the kernel before any cell ran.
    expect(kernel.silent).toHaveLength(1)
    expect(kernel.silent[0]).toContain("boat_mass_kg = 8330")
    expect(runOf(doc)).toEqual({
      at: "2026-11-22T10:00:01.000Z",
      finished: "2026-11-22T10:00:02.000Z",
      status: "ok",
      by: "agent",
      cells: ["a", "b"],
      kernel: "fresh",
      code: expect.stringMatching(/^t:/),
      // The record names the outputs it sits beside.
      outputs: outputsFingerprint(doc),
      startHeads: expect.any(Array),
      finishHeads: expect.any(Array),
      imports: [
        { name: "reg", docUrl: "automerge:reg", title: "Nootka assumptions", heads: ["regA", "regB"], as: "hook", type: "assumptions", hash: expect.any(String) },
        { name: "model_1", docUrl: "automerge:m1", title: "Model 1", heads: ["m1"], as: "notebook", type: "jupyter-notebook", hash: expect.any(String) },
      ],
      reads: [],
    })
  })

  test("the record names the notebook's heads before the run and after its last output", async () => {
    const { handle, runner } = setup([code("a", "print 1"), code("b", "print 2")], { patchwork: { imports } })
    const before = Automerge.getHeads(handle.doc() as any)
    await runner.run(["a", "b"])
    const run = runOf(handle.doc())!
    expect(run.startHeads).toEqual(before)
    // At finishHeads the outputs are exactly what the record describes, and only the record changed after.
    const atFinish = Automerge.view(handle.doc() as any, run.finishHeads!)
    expect(outputsFingerprint(atFinish)).toBe(run.outputs)
    expect(String((atFinish as any).cells[1].outputs[0].text)).toBe("2\n")
    expect((atFinish as any).metadata.patchwork.run.finished).toBeNull()
    const after = Automerge.diff(handle.doc() as any, run.finishHeads!, Automerge.getHeads(handle.doc() as any))
    expect(after.every(p => p.path[0] === "metadata" && p.path[1] === "patchwork" && p.path[2] === "run")).toBe(true)
  })

  test("a later run on the same kernel carries on; after a restart it is fresh again", async () => {
    const { handle, kernel, runner } = setup([code("a", "print 1")])
    await runner.run(["a"])
    await runner.run(["a"])
    expect(runOf(handle.doc())!.kernel).toBe("continued")
    await kernel.restart()
    await runner.run(["a"])
    expect(runOf(handle.doc())!.kernel).toBe("fresh")
  })

  test("a failing cell skips the rest, and the run says so", async () => {
    const { handle, runner } = setup([code("a", "raise bad input"), code("b", "print never")])
    const outcome = await runner.run(["a", "b"])
    expect(outcome.results.map(r => r.status)).toEqual(["error", "skipped"])
    const run = runOf(handle.doc())!
    expect(run.status).toBe("error")
    expect(run.cells).toEqual(["a"])
    expect((handle.doc() as any).cells[1].outputs).toHaveLength(0)
  })

  test("imports that can't be set up stop the run before any cell, and are recorded", async () => {
    const { handle, runner } = setup([code("a", "print 1")], { patchwork: { imports: [{ name: "FAIL_SETUP", docUrl: "automerge:reg" }] } })
    const outcome = await runner.run(["a"])
    expect(outcome.problem).toMatch(/the imports couldn't be set up: ImportError: rename the import json/)
    expect(outcome.results.map(r => r.status)).toEqual(["stopped"])
    expect(runOf(handle.doc())).toMatchObject({ status: "error", cells: [], problem: outcome.problem, finishHeads: expect.any(Array) })
    expect((handle.doc() as any).cells[0].execution_count).toBeNull()
  })

  test("a duplicate import name stops the run without touching the kernel", async () => {
    const { kernel, runner } = setup([code("a", "print 1")], { patchwork: { imports: [imports[0], { ...imports[1], name: "reg" }] } })
    const outcome = await runner.run(["a"])
    expect(outcome.problem).toMatch(/another import is already called "reg"/)
    expect(kernel.silent).toHaveLength(0)
  })

  test("cells queued while a batch runs join it", async () => {
    const { handle, runner } = setup([code("a", "print 1"), code("b", "print 2")])
    const [first, second] = await Promise.all([runner.run(["a"]), runner.run(["b"])])
    expect(first.results[0].status).toBe("ok")
    expect(second.results[0].status).toBe("ok")
    expect(runOf(handle.doc())!.cells).toEqual(["a", "b"])
  })
})

describe("documents a run may load", () => {
  test("every import and every URL in the code is written for patchwork.load, with its JSON view where the datatype has one", async () => {
    const { kernel, runner } = setup([code("a", 'print 1\n# patchwork.load("automerge:4NMNnkMhL8jXrdJ9jamS7Z")')], { patchwork: { imports: [imports[0]] } })
    await runner.run(["a"])
    const setup_ = kernel.silent[0]
    const index = JSON.parse(JSON.parse(setup_.match(/_pw_documents\(__import__\("json"\)\.loads\(("(?:[^"\\]|\\.)*")\)/)![1]))
    expect(index).toEqual({
      names: { reg: "automerge:reg" },
      documents: {
        "automerge:reg": { title: "Nootka assumptions", raw: expect.stringMatching(/raw\.json$/), json: expect.stringMatching(/view\.json$/) },
        "automerge:4NMNnkMhL8jXrdJ9jamS7Z": { title: "Loads", raw: expect.stringMatching(/raw\.json$/) },
      },
    })
  })

  test("what the cells loaded is recorded with the version read and a hash of each path read", async () => {
    const { handle, kernel, runner } = setup([code("a", "print 1")], { patchwork: { imports: [imports[0]] } })
    kernel.loaded = [{ docUrl: "automerge:reg", as: "raw", paths: [{ path: ["entries", "boat_mass_kg", "value", "nominal"] }, { path: ["entries"], keys: true }] }]
    await runner.run(["a"])
    const reads = runOf(handle.doc())!.reads
    expect(reads).toEqual([
      {
        docUrl: "automerge:reg",
        title: "Nootka assumptions",
        heads: ["regA", "regB"],
        as: "raw",
        paths: [
          { path: ["entries", "boat_mass_kg", "value", "nominal"], hash: readHash({ entries: { boat_mass_kg: { value: { nominal: 8330 } } } }, ["entries", "boat_mass_kg", "value", "nominal"]) },
          { path: ["entries"], keys: true, hash: readHash({ entries: { boat_mass_kg: 1, boat_speed_kn: 1 } }, ["entries"], true) },
        ],
      },
    ])
  })
})

describe("the stand-in for Automerge writes the same document", () => {
  test("outputs, streams and metadata", async () => {
    setAutomerge(automergeStandIn())
    try {
      const { handle, runner } = setup([code("a", "print one\nprint two")], { patchwork: { imports } })
      await runner.run(["a"])
      const doc = handle.doc() as any
      expect(String(doc.cells[0].outputs[0].text)).toBe("one\ntwo\n")
      expect(Automerge.isImmutableString(doc.cells[0].outputs[0].output_type)).toBe(true)
      expect(Automerge.isImmutableString(doc.metadata.patchwork.run.status)).toBe(true)
      expect(runOf(doc)!.imports[0].heads).toEqual(["regA", "regB"])
    } finally {
      setAutomerge(Automerge)
    }
  })
})

describe("notebook_run's input", () => {
  const doc = { cells: [{ id: "m", cell_type: "markdown" }, { id: "a", cell_type: "code" }, { id: "b", cell_type: "code" }] }
  test.each([
    [undefined, ["a", "b"]],
    ["all", ["a", "b"]],
    [[3, 2], ["a", "b"]],
    [["b"], ["b"]],
    [["2", "a"], ["a"]],
  ])("cells %j run %j", (cells, ids) => {
    expect(pickCells(doc, cells as any)).toEqual(ids)
  })
  test.each([
    [[1], /cell 1 \(a markdown cell\)/],
    [[9], /9 \(the notebook has 3 cells\)/],
    [["zz"], /"zz"/],
    [[], /"all" or a list/],
  ])("cells %j are refused", (cells, why) => {
    expect(() => pickCells(doc, cells as any)).toThrow(why)
  })

  test("link adds, names from the title and renames; unlink removes", async () => {
    const title = async (url: string) => (url === "automerge:reg" ? "Nootka assumptions" : "Model 1")
    let out = await linkImports([], { link: [{ url: "automerge:reg" }, { url: "automerge:m1#abc" }] }, title)
    expect(out).toEqual([
      { name: "nootka_assumptions", docUrl: "automerge:reg" },
      { name: "model_1", docUrl: "automerge:m1" },
    ])
    out = await linkImports(out, { link: [{ url: "automerge:reg", name: "reg" }], unlink: ["model_1"] }, title)
    expect(out).toEqual([{ name: "reg", docUrl: "automerge:reg" }])
    await expect(linkImports(out, { link: [{ url: "automerge:m1", name: "reg" }] }, title)).rejects.toThrow(/already called "reg"/)
    await expect(linkImports(out, { unlink: ["nope"] }, title)).rejects.toThrow(/no import called nope/)
    await expect(linkImports(out, { link: [{ url: "https://x" }] }, title)).rejects.toThrow(/isn't a document URL/)
  })
})

describe("notebook_run's report", () => {
  test("is compact: a line per cell, the traceback's tail, result lines and a stdout tail", async () => {
    const { handle, runner, hooks, docs } = setup(
      [{ id: "m", cell_type: "markdown", source: "# M", metadata: {} }, code("a", "print boat_drag_N 1020.4\nprint prop_P_kW = 46.1 kW\nprint frac_fwd 0.0: not a result"), code("b", "raise bad input"), code("c", "print never")],
      { patchwork: { imports } },
    )
    const reg = docs["automerge:reg"].doc() as any
    docs["automerge:reg"].doc = () => ({ ...reg, entries: { ...reg.entries, boat_drag_N: { value: { nominal: 1 } }, prop_P_kW: { value: { nominal: 1 } } } })
    const outcome = await runner.run(["a", "b", "c"])
    const text = report({ title: "Model 2", doc: handle.doc(), outcome, last: hooks.last(), elapsedMs: 1234 })
    expect(text).toBe(
      [
        'Ran "Model 2": 1 ok, 1 error, 1 skipped in 1.2 s (fresh kernel).',
        'Imports: reg ← "Nootka assumptions" (Python from its datatype, version regA+regB); model_1 ← "Model 1" (its code cells, version m1)',
        "cell 2 ok [1]",
        "cell 3 error  ValueError: bad input",
        "    Traceback (most recent call last)",
        '      File "<cell>", line 1',
        "    ValueError: bad input",
        "cell 4 skipped (cell 3 failed first)",
        "Result lines (register entry id and value), 2:",
        "  boat_drag_N 1020.4  (cell 2)",
        "  prop_P_kW = 46.1 kW  (cell 2)",
        "Printed output, last 3 of 3 lines:",
        "  boat_drag_N 1020.4\n  prop_P_kW = 46.1 kW\n  frac_fwd 0.0: not a result",
        "Outputs and execution counts are in the notebook, and the run is recorded in its metadata (metadata.patchwork.run).",
      ].join("\n"),
    )
  })

  test("says when a fresh kernel skipped earlier cells, and bounds what was printed", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `print line ${i} ${"x".repeat(80)}`).join("\n")
    const { handle, runner, hooks } = setup([code("a", "print setup"), code("b", lines)])
    const outcome = await runner.run(["b"])
    const text = report({ title: "Model 2", doc: handle.doc(), outcome, last: hooks.last(), elapsedMs: 10 })
    expect(text).toMatch(/the kernel was fresh, so the 1 code cell before cell 2 didn't run in it/)
    expect(text).toMatch(/Printed output, last 20 of 60 lines:/)
    expect(text.length).toBeLessThan(2400)
  })
})

describe("result lines belong to a linked register", () => {
  const LOADED = "automerge:4NMNnkMhL8jXrdJ9jamS7Z"
  const cells = [code("a", "print boat_mass_kg 8330\nprint frac_fwd 0.0: not a result")]
  const textOf = async (metadata: any, loaded: unknown[] = []) => {
    const { handle, kernel, runner, hooks, docs } = setup(loaded.length ? [code("a", `# ${LOADED}\n${cells[0].source}`)] : cells, metadata)
    // the document the code reads by URL is a register
    docs[LOADED].doc = docs["automerge:reg"].doc
    kernel.loaded = loaded
    const outcome = await runner.run(["a"])
    return { text: report({ title: "M", doc: handle.doc(), outcome, last: hooks.last(), elapsedMs: 1 }), last: hooks.last() }
  }
  test("an imported register's entries are listed, other id-value lines are only printed output", async () => {
    const { text, last } = await textOf({ patchwork: { imports: [{ name: "reg", docUrl: "automerge:reg" }] } })
    expect([...registerIds(last)]).toEqual(["boat_mass_kg", "boat_speed_kn"])
    expect(text).toContain("Result lines (register entry id and value), 1:\n  boat_mass_kg 8330  (cell 1)")
    expect(text).not.toMatch(/Result lines[^]*frac_fwd[^]*Printed output/)
    expect(text).toContain("frac_fwd 0.0: not a result")
  })
  test("a register read with patchwork.load counts too", async () => {
    const { text } = await textOf({}, [{ docUrl: LOADED, as: "raw", paths: [{ path: ["entries", "boat_mass_kg"] }] }])
    expect(text).toContain("Result lines (register entry id and value), 1:")
  })
  test("with no register linked none are listed", async () => {
    const { text, last } = await textOf({ patchwork: { imports: [{ name: "model_1", docUrl: "automerge:m1" }] } })
    expect(registerIds(last).size).toBe(0)
    expect(text).not.toContain("Result lines")
    expect(registerIds(null).size).toBe(0)
  })
})

describe("a failed run does not read as up to date", () => {
  const none = { stale: false, reasons: [] }
  const run = (status: string, extra: object = {}) => ({ status, imports: [], reads: [], ...extra }) as any
  test("an error run with no reads is reported as failed, with its problem", () => {
    expect(staleLine(run("error", { problem: "the imports couldn't be set up: ImportError: x" }), none)).toBe("Its last run failed: the imports couldn't be set up: ImportError: x; rerun it.")
    expect(staleLine(run("error"), none)).toBe("Its last run failed: a cell raised an error; rerun it.")
    expect(staleLine(run("stopped"), none)).toBe("Its last run was stopped; rerun it.")
  })
  test("and says so when what it read has changed too", () => {
    const stale = { stale: true, reasons: [{ docUrl: "automerge:reg", title: "Reg", why: "changed", paths: [], name: "reg" }] } as any
    expect(staleLine(run("error"), stale)).toContain('What it read has also changed: "Reg" changed')
  })
  test("a run that completed ok is judged as before", () => {
    expect(staleLine(run("ok"), none)).toBe("It was up to date: its last run read no documents.")
    expect(staleLine(run("ok", { reads: [{ docUrl: "automerge:reg" }] }), none)).toContain("It was up to date: nothing its last run read (1 document)")
  })
  test("a run whose cell failed is recorded as error and reads as failed", async () => {
    const { handle, runner } = setup([code("a", "raise bad")])
    await runner.run(["a"])
    expect(staleLine(runOf(handle.doc()), none)).toMatch(/^Its last run failed: /)
  })
})

describe("the notebook asks on its own behalf", () => {
  test("imports and patchwork.load documents get { for: the notebook's url } from asSource", async () => {
    const calls: unknown[][] = []
    const writer = new NotebookWriter(handleOf({ ...notebookDoc({ nbformat: 4, nbformat_minor: 5, metadata: { patchwork: { imports: [{ name: "reg", docUrl: "automerge:reg" }] } }, cells: [code("a", "print 1")] } as any, "M") }) as any)
    const reg = { "@patchwork": { type: "assumptions" }, title: "R", entries: {} }
    const lookup = async () => ({ asSource: (_d: unknown, ext: string, options?: { for?: string }) => (calls.push([ext, options]), ext === "py" ? "x = 1\n" : "{}") })
    const hooks = runHooks({ writer, kernel: fakeKernel(), find: async () => ({ doc: () => reg, heads: () => ["h"] }), datatype: forDocument(lookup, "automerge:notebook"), by: "agent" })
    await new CellRunner(writer, fakeKernel(), hooks).run(["a"])
    expect(calls).toContainEqual(["py", { for: "automerge:notebook" }])
    expect(calls).toContainEqual(["json", { for: "automerge:notebook" }])
    expect(calls.every(c => (c[1] as any)?.for === "automerge:notebook")).toBe(true)
  })
  test("a datatype without asSource, null and undefined pass through; an older asSource ignores the option", async () => {
    expect(await forDocument(async () => null, "u")("t")).toBeNull()
    expect(await forDocument(async () => undefined, "u")("t")).toBeUndefined()
    const plain = { title: "x" }
    expect(await forDocument(async () => plain as any, "u")("t")).toBe(plain)
    const old = await forDocument(async () => ({ asSource: (_d: unknown, ext: string) => `old ${ext}` }), "u")("t")
    expect(old!.asSource!({}, "py")).toBe("old py")
  })
})

describe("syncing with the server before a run", () => {
  /** A handle that is caught up with each peer once `caught` has it; `advertise` fires the server's heads. */
  function fake(peers: string[], caught: Record<string, boolean | undefined> = {}) {
    const listeners = new Map<string, Set<() => void>>()
    const handle = {
      documentId: "doc1",
      isCaughtUpWith: (p: string) => caught[p],
      on: (e: string, fn: () => void) => (listeners.get(e) ?? listeners.set(e, new Set()).get(e)!).add(fn),
      off: (e: string, fn: () => void) => listeners.get(e)?.delete(fn),
    }
    const resyncs: string[] = []
    const repo = { isSubductionConnected: () => true, connectedSubductionPeerIds: async () => peers, resyncSubduction: (d: string) => void resyncs.push(d) }
    const fire = (e: string) => [...(listeners.get(e) ?? [])].forEach(fn => fn())
    return { handle, repo, caught, resyncs, fire, listeners }
  }
  test("is synced at once when the server's heads are already held", async () => {
    const f = fake(["srv"], { srv: true })
    expect(await syncedWithServer(f.repo, f.handle)).toEqual({ status: "synced" })
    expect(f.resyncs).toEqual([])
  })
  test("waits for the server's heads to arrive, asking for a sync round", async () => {
    const f = fake(["srv"], { srv: undefined })
    const pending = syncedWithServer(f.repo, f.handle, { timeoutMs: 5000 })
    await new Promise(r => setTimeout(r, 5))
    expect(f.resyncs).toEqual(["doc1"])
    f.fire("remote-heads") // advertised, but we lack its commits
    f.caught.srv = false
    f.fire("remote-heads")
    f.caught.srv = true
    f.fire("heads-changed") // the commits arrived
    expect(await pending).toEqual({ status: "synced" })
    expect([...f.listeners.values()].every(set => set.size === 0)).toBe(true)
  })
  test("gives up after the timeout and says so; never throws", async () => {
    const f = fake(["srv"], { srv: false })
    const outcome = await syncedWithServer(f.repo, f.handle, { timeoutMs: 20 })
    expect(outcome).toEqual({ status: "timeout" })
    expect(syncNote(outcome)).toMatch(/hadn't finished syncing/)
    expect([...f.listeners.values()].every(set => set.size === 0)).toBe(true)
  })
  test("without a server connection, or an API for one, the run goes on with what is here", async () => {
    const f = fake([])
    expect(await syncedWithServer(f.repo, f.handle)).toEqual({ status: "unconnected" })
    expect(await syncedWithServer({ ...f.repo, isSubductionConnected: () => false }, f.handle)).toEqual({ status: "unconnected" })
    expect(await syncedWithServer({}, {})).toEqual({ status: "unconnected" })
    expect(await syncedWithServer({ connectedSubductionPeerIds: async () => { throw new Error("x") }, isSubductionConnected: () => true }, f.handle)).toEqual({ status: "unconnected" })
    expect(syncNote({ status: "synced" })).toBeNull()
    expect(syncNote({ status: "unconnected" })).toMatch(/isn't connected to the sync server/)
  })
  test("every connected server must have caught us up", async () => {
    const f = fake(["a", "b"], { a: true, b: false })
    expect(await syncedWithServer(f.repo, f.handle, { timeoutMs: 20 })).toEqual({ status: "timeout" })
  })
})
