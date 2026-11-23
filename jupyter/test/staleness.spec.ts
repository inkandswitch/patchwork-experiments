import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { docToJson, moduleHash, moduleSource, readHash, type RunRecord, sourceOf } from "../shared/imports"
import { AutoRerun } from "../shared/rerun"
import { documentFiles, type Opened, openDocuments, readsRecord } from "../shared/run"
import { decide, staleText } from "../shared/staleness"

const registerHook = { asSource: (doc: any, ext: string) => (ext === "json" ? JSON.stringify(Object.fromEntries(Object.entries(doc.entries).map(([id, e]: any) => [id, e.value.nominal]))) : ext === "py" ? Object.entries(doc.entries).map(([id, e]: any) => `${id} = ${e.value.nominal}`).join("\n") : null) }
const register = (entries: Record<string, number>, title = "Nootka assumptions") => ({
  "@patchwork": { type: "assumptions" },
  title,
  entries: Object.fromEntries(Object.entries(entries).map(([id, nominal]) => [id, { value: { nominal } }])),
})
const opened = (url: string, doc: any, heads: string[]): Opened => ({ url, doc, heads, type: doc["@patchwork"]?.type ?? null, title: doc.title, hook: doc["@patchwork"]?.type === "assumptions" ? registerHook : null })

const before = register({ boat_mass_kg: 8330, boat_speed_kn: 8 })

/** A run that read `paths` of the register (raw, or its JSON view) and imported it as `reg`. */
function runThatRead(paths: Array<{ path: Array<string | number>; keys?: boolean }>, view: "raw" | "json" = "raw", withImport = false): RunRecord {
  const data = view === "json" ? JSON.parse(registerHook.asSource(before, "json")!) : docToJson(before)
  const module = moduleSource({ name: "reg", docUrl: "automerge:reg" }, { ...sourceOf(before, registerHook), title: before.title })
  return {
    at: "2026-11-22T10:00:00Z",
    finished: "2026-11-22T10:00:05Z",
    status: "ok",
    by: "person",
    cells: ["a"],
    kernel: "fresh",
    code: "t:x",
    outputs: "r:x",
    startHeads: ["n1"],
    finishHeads: ["n2"],
    imports: withImport ? [{ name: "reg", docUrl: "automerge:reg", title: before.title, heads: ["h1"], as: "hook", type: "assumptions", hash: moduleHash(module) }] : [],
    reads: paths.length ? [{ docUrl: "automerge:reg", title: before.title, heads: ["h1"], as: view, paths: paths.map(p => ({ ...p, hash: readHash(data, p.path, !!p.keys) })) }] : [],
  }
}
const now = (doc: any, heads = ["h2"]) => new Map([["automerge:reg", opened("automerge:reg", doc, heads)]])
const gone = () => new Map<string, Opened>([["automerge:reg", { url: "automerge:reg", problem: "unavailable" }]])
const mass = { path: ["entries", "boat_mass_kg", "value", "nominal"] }

describe("staleness, over the finite cases", () => {
  test.each([
    ["the entry read changed", [mass], register({ boat_mass_kg: 8900, boat_speed_kn: 8 }), true, ["entries.boat_mass_kg.value.nominal"]],
    ["an entry not read changed", [mass], register({ boat_mass_kg: 8330, boat_speed_kn: 9 }), false, []],
    ["only the title changed", [mass], register({ boat_mass_kg: 8330, boat_speed_kn: 8 }, "Renamed"), false, []],
    ["the entry read was removed", [mass], register({ boat_speed_kn: 8 }), true, ["entries.boat_mass_kg.value.nominal"]],
    ["an entry was added where the keys were read", [{ path: ["entries"], keys: true }], register({ boat_mass_kg: 8330, boat_speed_kn: 8, pack_V: 48 }), true, ["entries"]],
    ["a value changed where only the keys were read", [{ path: ["entries"], keys: true }], register({ boat_mass_kg: 1, boat_speed_kn: 2 }), false, []],
    ["the whole document was read and anything changed", [{ path: [] }], register({ boat_mass_kg: 8330, boat_speed_kn: 9 }), true, ["the whole document"]],
  ])("%s", (_, paths, doc, stale, changed) => {
    const result = decide(runThatRead(paths), now(doc))
    expect(result.stale).toBe(stale)
    expect(result.reasons.flatMap(r => r.paths)).toEqual(changed)
  })

  test("unchanged heads are fresh without reading anything", () => {
    expect(decide(runThatRead([mass]), now(register({ boat_mass_kg: 1 }), ["h1"])).stale).toBe(false)
  })

  test("a document that can't be opened now is stale", () => {
    expect(decide(runThatRead([mass]), gone())).toEqual({ stale: true, reasons: [{ docUrl: "automerge:reg", title: "Nootka assumptions", why: "missing", paths: [] }] })
  })

  test("the JSON view is compared through the datatype", () => {
    const run = runThatRead([{ path: ["boat_mass_kg"] }], "json")
    expect(decide(run, now(register({ boat_mass_kg: 8330, boat_speed_kn: 9 }))).stale).toBe(false)
    expect(decide(run, now(register({ boat_mass_kg: 9000, boat_speed_kn: 8 }))).reasons[0].paths).toEqual(["boat_mass_kg"])
  })

  test("an import is read whole: any change to its module counts, its title doesn't", () => {
    const run = runThatRead([], "raw", true)
    expect(decide(run, now(register({ boat_mass_kg: 8330, boat_speed_kn: 8 }, "Renamed"))).stale).toBe(false)
    const changed = decide(run, now(register({ boat_mass_kg: 8330, boat_speed_kn: 9 })))
    expect(changed.reasons).toEqual([{ docUrl: "automerge:reg", title: "Nootka assumptions", why: "changed", paths: [], name: "reg" }])
  })

  test("no run, nothing stale", () => {
    expect(decide(null, new Map())).toEqual({ stale: false, reasons: [] })
  })

  test("it reads as names and paths", () => {
    const result = decide(runThatRead([mass, { path: ["entries"], keys: true }]), now(register({ boat_mass_kg: 1, boat_speed_kn: 8, x_y: 2 })))
    expect(staleText(result)).toBe('"Nootka assumptions" changed (entries.boat_mass_kg.value.nominal, entries)')
  })
})

describe("the read record", () => {
  test("hashes what was at each path when it was read, and skips documents the run didn't open", async () => {
    const docs = await openDocuments(["automerge:reg"], { find: async () => ({ doc: () => before, heads: () => ["h1"] }), datatype: async () => registerHook })
    const { snapshots } = documentFiles(docs, [])
    const reads = readsRecord(
      [
        { docUrl: "automerge:reg", as: "json", paths: [{ path: ["boat_mass_kg"] }] },
        { docUrl: "automerge:other", as: "raw", paths: [{ path: [] }] },
      ],
      snapshots,
    )
    expect(reads).toEqual([{ docUrl: "automerge:reg", title: "Nootka assumptions", heads: ["h1"], as: "json", paths: [{ path: ["boat_mass_kg"], hash: readHash({ boat_mass_kg: 8330 }, ["boat_mass_kg"]) }] }])
  })
})

describe("patchwork.load in Python", () => {
  const python = spawnSync("python3", ["--version"]).status === 0
  // The real module, run against the files the notebook writes before a run.
  const run = (main: string) => {
    const dir = mkdtempSync(join(tmpdir(), "pwdocs-"))
    const missing = new Map<string, Opened>([["automerge:gone", { url: "automerge:gone", problem: "unavailable" }]])
    const docs = new Map<string, Opened>([["automerge:reg", opened("automerge:reg", before, ["h1"])], ...missing])
    const { files } = documentFiles(docs, [{ name: "register", docUrl: "automerge:reg" }])
    for (const [name, text] of Object.entries(files.files)) writeFileSync(join(dir, name), text)
    writeFileSync(join(dir, "index.json"), JSON.stringify(files.index))
    const program = [
      "import importlib.util, json, sys",
      `spec = importlib.util.spec_from_file_location("documents", ${JSON.stringify(new URL("../shared/python/patchwork/documents.py", import.meta.url).pathname)})`,
      "d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)",
      `d.ROOT = ${JSON.stringify(dir)}`,
      main,
    ].join("\n")
    const out = spawnSync("python3", ["-I", "-c", program], { encoding: "utf-8" })
    return { out: out.stdout.trim(), err: out.stderr }
  }

  test.skipIf(!python)("loads raw data by URL or import name, and records exactly what was read", () => {
    const { out, err } = run(
      [
        'reg = d.load("automerge:reg#heads")',
        'print(reg["entries"]["boat_mass_kg"]["value"]["nominal"])',
        'print(sorted(d.load("register")["entries"]))',
        "print(json.dumps(d.reads()))",
      ].join("\n"),
    )
    expect(err).toBe("")
    const [value, keys, reads] = out.split("\n")
    expect(value).toBe("8330")
    expect(keys).toBe("['boat_mass_kg', 'boat_speed_kn']")
    expect(JSON.parse(reads)).toEqual([
      {
        docUrl: "automerge:reg",
        as: "raw",
        paths: [
          { path: ["entries"], keys: true },
          { path: ["entries", "boat_mass_kg", "value", "nominal"], keys: false },
        ],
      },
    ])
  })

  test.skipIf(!python)("as_='json' gives the datatype's view; plain() gives ordinary data and reads it all", () => {
    const { out, err } = run(['v = d.load("register", as_="json")', "print(v['boat_speed_kn'], v.plain() == {'boat_mass_kg': 8330, 'boat_speed_kn': 8})", "print(json.dumps(d.reads()))"].join("\n"))
    expect(err).toBe("")
    const [line, reads] = out.split("\n")
    expect(line).toBe("8 True")
    expect(JSON.parse(reads)[0]).toEqual({ docUrl: "automerge:reg", as: "json", paths: [{ path: [], keys: false }, { path: ["boat_speed_kn"], keys: false }] })
  })

  test.skipIf(!python)("a document the run didn't read, or couldn't open, says how to fix it", () => {
    expect(run('d.load("automerge:elsewhere")').err).toMatch(/isn't a document this run read\. Write its URL in a code cell as a literal/)
    expect(run('d.load("automerge:gone")').err).toMatch(/LookupError: couldn't open automerge:gone: unavailable/)
    expect(run('d.load("register")["entries"]["nope"]').err).toMatch(/KeyError: 'nope'/)
  })
})

describe("rerunning when inputs change", () => {
  afterEach(() => void vi.useRealTimers())

  test("waits until the inputs have been quiet, then checks and runs once", async () => {
    vi.useFakeTimers()
    const runs: number[] = []
    const auto = new AutoRerun({ check: () => true, run: () => void runs.push(Date.now()), quietMs: 3000 })
    auto.poke()
    await vi.advanceTimersByTimeAsync(2000)
    auto.poke() // still typing
    await vi.advanceTimersByTimeAsync(2000)
    expect(runs).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(runs).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(runs).toHaveLength(1)
  })

  test("doesn't run when the check says no (off, already running, or not stale)", async () => {
    vi.useFakeTimers()
    let ran = 0
    const auto = new AutoRerun({ check: () => false, run: () => void ran++, quietMs: 100 })
    auto.poke()
    await vi.advanceTimersByTimeAsync(500)
    expect(ran).toBe(0)
  })

  test("a quiet period that ends during a run checks again afterwards", async () => {
    vi.useFakeTimers()
    let ran = 0
    let finish!: () => void
    const auto = new AutoRerun({ check: () => true, run: () => (ran++, new Promise<void>(r => (finish = r))), quietMs: 100 })
    auto.poke()
    await vi.advanceTimersByTimeAsync(100)
    expect(ran).toBe(1)
    auto.poke() // a change while it runs
    await vi.advanceTimersByTimeAsync(100)
    expect(ran).toBe(1)
    finish()
    await vi.advanceTimersByTimeAsync(100)
    expect(ran).toBe(2)
  })

  test("nothing runs after it is disposed", async () => {
    vi.useFakeTimers()
    let ran = 0
    const auto = new AutoRerun({ check: () => true, run: () => void ran++, quietMs: 100 })
    auto.poke()
    auto.dispose()
    await vi.advanceTimersByTimeAsync(500)
    expect(ran).toBe(0)
  })
})
