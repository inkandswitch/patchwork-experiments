import { spawnSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import {
  codeFingerprint,
  docToJson,
  importName,
  importsOf,
  moduleSource,
  nameProblem,
  notebookCode,
  outputsFingerprint,
  resultLines,
  setupCode,
  sourceOf,
} from "../shared/imports"
import { importsProblem, lookupIn, noRegistry, resolveImports } from "../shared/run"

const register = { "@patchwork": { type: "assumptions" }, title: "Nootka assumptions", entries: { boat_mass_kg: { value: { nominal: 8330 } } } }
const pyFile = { "@patchwork": { type: "file" }, name: "hull.py", extension: "py", content: "def drag(v):\n    return 3 * v\n" }
const notebook = {
  "@patchwork": { type: "jupyter-notebook" },
  title: "Model 1",
  cells: [
    { cell_type: "markdown", source: "# Model 1" },
    { cell_type: "code", source: "%matplotlib inline\ndef drag(v):\n    return 2 * v\nprint('boat_drag_N 1020.4')" },
    { cell_type: "code", source: ["if __name__ == '__main__':\n", "    print('main only')"] },
  ],
}
const table = { "@patchwork": { type: "datagrid" }, title: "Loads", data: [[1, 2]], counter: { value: 3, increment() {} }, blob: new Uint8Array(4) }

const hookFor = (asSource: (doc: any, ext: string) => unknown) => ({ asSource })
const exportHook = hookFor((doc, ext) => (ext === "py" ? `boat_mass_kg = ${doc.entries.boat_mass_kg.value.nominal}\n` : null))

describe("where an import's source comes from, in order", () => {
  // Every document kind against every hook outcome: the first rule that applies wins.
  const hooks = { "a hook giving a string": hookFor(() => "x = 1"), "a hook giving null": hookFor(() => null), "no asSource": {}, "no datatype": null, "no registry": undefined } as const
  const docs = { register, pyFile, notebook, table } as const
  const expected: Record<keyof typeof docs, string> = { register: "json", pyFile: "py-file", notebook: "notebook", table: "json" }
  for (const [docName, doc] of Object.entries(docs) as [keyof typeof docs, any][]) {
    for (const [hookName, hook] of Object.entries(hooks)) {
      test(`${docName} with ${hookName}`, () => {
        const want = hookName === "a hook giving a string" ? "hook" : expected[docName]
        expect(sourceOf(doc, hook as any).kind).toBe(want)
      })
    }
  }

  test("a hook is asked for Python with exactly (doc, 'py')", () => {
    const calls: unknown[][] = []
    sourceOf(register, hookFor((...args) => (calls.push(args), "x = 1")))
    expect(calls).toEqual([[register, "py"]])
  })

  test("a hook that throws is reported, not swallowed into JSON", () => {
    expect(() => sourceOf(register, hookFor(() => { throw new Error("boom") }))).toThrow(/couldn't give Python source \(boom\)/)
  })

  test("a .py file is recognised by its name or its extension", () => {
    expect(sourceOf({ name: "m.py", content: "x = 1" }, null).kind).toBe("py-file")
    expect(sourceOf({ name: "m", extension: ".py", content: "x = 1" }, null).kind).toBe("py-file")
    expect(sourceOf({ name: "m.txt", content: "x = 1" }, null).kind).toBe("json")
  })
})

describe("module text", () => {
  test("a notebook's code cells, joined, with IPython-only lines kept as comments", () => {
    expect(notebookCode(notebook)).toBe("pass  # %matplotlib inline\ndef drag(v):\n    return 2 * v\nprint('boat_drag_N 1020.4')\n\nif __name__ == '__main__':\n    print('main only')")
  })

  test("JSON drops Patchwork's keys and keeps plain values", () => {
    expect(docToJson(table)).toEqual({ title: "Loads", data: [[1, 2]], counter: 3, blob: { bytes: 4 } })
  })

  test("each kind's module names its document", () => {
    for (const kind of ["hook", "py-file", "notebook", "json", "missing"] as const) {
      const text = moduleSource({ name: "reg", docUrl: "automerge:abc" }, { kind, text: "x = 1", title: "Nootka\nassumptions", problem: "gone" })
      expect(text.split("\n")[0]).toBe("# reg: Nootka assumptions (automerge:abc), imported live by the notebook; edit that document, not this file.")
    }
  })

  // The modules run in a real Python where one is installed (they are what Pyodide imports).
  const python = spawnSync("python3", ["--version"]).status === 0
  const runPython = (modules: Record<string, string>, main: string) => {
    const program = [
      "import sys, os, tempfile, json",
      "d = tempfile.mkdtemp(); sys.path.insert(0, d)",
      `for name, text in json.loads(${JSON.stringify(JSON.stringify(modules))}).items():`,
      "    open(os.path.join(d, name + '.py'), 'w', encoding='utf-8').write(text)",
      main,
    ].join("\n")
    const run = spawnSync("python3", ["-I", "-c", program], { encoding: "utf-8" })
    return { out: run.stdout, err: run.stderr, status: run.status }
  }
  const module = (name: string, doc: any, hook: any = null) => moduleSource({ name, docUrl: `automerge:${name}` }, { ...sourceOf(doc, hook), title: doc.title ?? doc.name })

  test.skipIf(!python)("every kind imports in Python and gives what it says", () => {
    const run = runPython(
      { reg: module("reg", register, exportHook), hull: module("hull", pyFile), model_1: module("model_1", notebook), loads: module("loads", { ...table, title: 'Loads "quoted" é\\n' }) },
      "import reg, hull, model_1, loads\nprint(reg.boat_mass_kg, hull.drag(2), model_1.drag(2), loads.data['data'], loads.data['title'])",
    )
    expect(run.err).toBe("")
    // The notebook ran quietly: its own prints and its __main__ block stay out of the importer's output.
    expect(run.out).toBe('8330 6 4 [[1, 2]] Loads "quoted" é\\n\n')
  })

  test.skipIf(!python)("a document that couldn't be opened raises ImportError naming it", () => {
    const text = moduleSource({ name: "gone", docUrl: "automerge:gone" }, { kind: "missing", text: "", title: "Old model", problem: "didn't open within 15 s" })
    const run = runPython({ gone: text }, "import gone")
    expect(run.err).toMatch(/ImportError: couldn't open "Old model" for import gone: didn't open within 15 s/)
  })

  test("the setup writes every module, drops the old ones and puts the directory first", () => {
    const code = setupCode({ reg: "x = 1\n", model_1: "y = 2\n" })
    expect(code).toContain("sys.path.insert(0, root)")
    expect(code).toContain("sys.modules.pop(name, None)")
    expect(code).toContain('/tmp/patchwork_imports')
    expect(code).toContain(JSON.stringify(JSON.stringify({ reg: "x = 1\n", model_1: "y = 2\n" })))
  })
})

describe("names", () => {
  test.each([
    ["Nootka assumptions", [], "nootka_assumptions"],
    ["Model 1.ipynb", [], "model_1"],
    ["2026 loads", [], "_2026_loads"],
    ["", [], "data"],
    ["class", [], "class_"],
    ["Model 1", ["model_1"], "model_1_2"],
    ["Model 1", ["model_1", "model_1_2"], "model_1_3"],
  ])("%s, with %j taken, is %s", (title, taken, name) => {
    expect(importName(title, taken)).toBe(name)
    expect(nameProblem(name, taken)).toBeNull()
  })

  test.each([
    ["1abc", /isn't a Python name/],
    ["a-b", /isn't a Python name/],
    ["import", /keyword/],
    ["__init__", /starts with __/],
  ])("%s is refused", (name, why) => {
    expect(nameProblem(name)).toMatch(why)
  })

  test("two imports may not share a name, and the first problem stops the run", () => {
    expect(importsProblem([{ name: "reg", docUrl: "automerge:a" }, { name: "reg", docUrl: "automerge:b" }])).toMatch(/already called "reg"/)
    expect(importsProblem([{ name: "reg", docUrl: "automerge:a" }])).toBeNull()
  })

  test("imports are read from metadata.patchwork.imports, skipping incomplete entries", () => {
    expect(importsOf({ metadata: { patchwork: { imports: [{ name: "reg", docUrl: "automerge:a" }, { name: "x" }, { docUrl: "automerge:b" }] } } })).toEqual([{ name: "reg", docUrl: "automerge:a" }])
    expect(importsOf({})).toEqual([])
  })
})

describe("resolving imports live", () => {
  const docs: Record<string, any> = { "automerge:reg": register, "automerge:nb": notebook, "automerge:py": pyFile }
  const find = async (url: string) => {
    if (!docs[url]) throw new Error("unavailable")
    return { doc: () => docs[url], heads: () => [`${url.slice(10)}-head`] }
  }
  const registry = (impls: Record<string, unknown>) => ({ getRegistry: (type: string) => (type === "patchwork:datatype" ? { get: (id: string) => impls[id] && { id }, load: async (id: string) => ({ module: impls[id] }) } : null) })

  test("each import's heads are read when it's resolved, and the registry's hook is used", async () => {
    const imports = [
      { name: "reg", docUrl: "automerge:reg" },
      { name: "model_1", docUrl: "automerge:nb" },
      { name: "hull", docUrl: "automerge:py" },
      { name: "gone", docUrl: "automerge:gone" },
    ]
    const { resolved, notes } = await resolveImports(imports, { find, datatype: lookupIn(registry({ assumptions: exportHook, "jupyter-notebook": {} })) })
    expect(resolved.map(r => [r.name, r.kind, r.title, r.heads])).toEqual([
      ["reg", "hook", "Nootka assumptions", ["reg-head"]],
      ["model_1", "notebook", "Model 1", ["nb-head"]],
      ["hull", "py-file", "hull.py", ["py-head"]],
      ["gone", "missing", "gone", []],
    ])
    expect(resolved[0].module).toContain("boat_mass_kg = 8330")
    expect(resolved[3].problem).toBe("unavailable")
    expect(notes).toEqual([])
  })

  test("without a registry, a typed document is bound as JSON and the run says why", async () => {
    const { resolved, notes } = await resolveImports([{ name: "reg", docUrl: "automerge:reg" }], { find, datatype: noRegistry })
    expect(resolved[0].kind).toBe("json")
    expect(notes[0]).toMatch(/reg \("Nootka assumptions", a assumptions\) is bound as JSON: the plugin registry can't be consulted here/)
  })

  test("a document that never opens times out", async () => {
    const { resolved } = await resolveImports([{ name: "slow", docUrl: "automerge:slow" }], { find: () => new Promise(() => {}), datatype: noRegistry, timeoutMs: 20 })
    expect(resolved[0]).toMatchObject({ kind: "missing", problem: "slow didn't open within 0 s" })
  })
})

describe("fingerprints match the assumptions register's", () => {
  // Values from assumptions/src/where.js (codeOf, runKeyOf) on the same documents.
  const doc = {
    cells: [
      { cell_type: "markdown", source: "# Hull" },
      { cell_type: "code", source: "import register as reg\nx = reg.boat_mass_kg * 2", execution_count: 3, outputs: [{ output_type: "stream", name: "stdout", text: "boat_drag_N 1020.4\n" }] },
      { cell_type: "code", source: ["print(", "1)"], execution_count: 4, outputs: [{ output_type: "execute_result", data: { "text/plain": "2" }, execution_count: 4 }] },
    ],
  }
  test("code", () => {
    expect(codeFingerprint(doc, ["h1"])).toBe("t:6440d6797982a")
    expect(codeFingerprint({ cells: [{ cell_type: "markdown", source: "only prose" }] })).toBe("t:1ed7ba6f1564")
    expect(codeFingerprint({ cells: [] }, ["b", "a"])).toBe("h:a,b")
  })
  test("outputs", () => {
    expect(outputsFingerprint(doc)).toBe("r:147f2dab89666")
  })
})

describe("result lines", () => {
  test.each([
    ["boat_drag_N 1020.4", "boat_drag_N"],
    ["prop_P_kW = 46.10 kW", "prop_P_kW"],
    ["pack_V_max: 58.4", "pack_V_max"],
    ["  cell_R_mOhm -0.25", "cell_R_mOhm"],
  ])("%s gives %s", (line, id) => {
    expect(resultLines(line).map(r => r.id)).toEqual([id])
  })
  test.each([["drag 1020"], ["boat_drag_N is high"], ["Total: 5"], [""]])("%j gives none", line => {
    expect(resultLines(line)).toEqual([])
  })
})
