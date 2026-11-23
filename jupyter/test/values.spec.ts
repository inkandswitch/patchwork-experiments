import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Automerge from "@automerge/automerge"
import { describe, expect, test } from "vitest"
import { docToJson, moduleSource, readHash, sourceOf } from "../shared/imports"
import { documentFiles, type Opened } from "../shared/run"

/**
 * Every non-JSON value Automerge hands back, read from a real Automerge
 * document, at the top level, nested in maps and in lists: what docToJson
 * makes of it, and what arrives in Python through patchwork.load and through
 * an import bound as JSON.
 */
const I = (s: string) => new Automerge.ImmutableString(s)
const when = new Date("2026-11-22T10:00:00.000Z")
const doc = Automerge.from<any>({
  "@patchwork": { type: "kitchen-sink" },
  title: I("Kitchen sink"),
  text: "collaborative text",
  count: new Automerge.Counter(3),
  bytes: new Uint8Array([0, 1, 255]),
  when,
  entries: { boat_mass_kg: { unit: I("kg"), value: { nominal: 8330 }, note: I("weighed") } },
  cells: [
    { cell_type: I("code"), source: [I("import reg\n"), I("print(1)")], outputs: [{ output_type: I("stream"), text: "1\n" }] },
    { cell_type: I("markdown"), source: I("# Title") },
  ],
  list: [I("a"), new Automerge.Counter(7), new Uint8Array([9]), when, [I("nested")]],
  file: { name: I("hull.py"), content: I("x = 1\n") },
})

const expected = {
  title: "Kitchen sink",
  text: "collaborative text",
  count: 3,
  bytes: { $bytes: "AAH/" },
  when: "2026-11-22T10:00:00.000Z",
  entries: { boat_mass_kg: { unit: "kg", value: { nominal: 8330 }, note: "weighed" } },
  cells: [
    { cell_type: "code", source: ["import reg\n", "print(1)"], outputs: [{ output_type: "stream", text: "1\n" }] },
    { cell_type: "markdown", source: "# Title" },
  ],
  list: ["a", 7, { $bytes: "CQ==" }, "2026-11-22T10:00:00.000Z", ["nested"]],
  file: { name: "hull.py", content: "x = 1\n" },
}

describe("Automerge's values as plain data", () => {
  test("the document as read from Automerge really holds them", () => {
    expect(Automerge.isImmutableString(doc.title)).toBe(true)
    expect(Automerge.isImmutableString(doc.cells[0].source[0])).toBe(true)
    expect(Automerge.isCounter(doc.list[1])).toBe(true)
  })

  test("docToJson turns every kind, everywhere, into JSON", () => {
    expect(docToJson(doc)).toEqual(expected)
    expect(JSON.parse(JSON.stringify(docToJson(doc)))).toEqual(expected)
  })

  test("a file whose content is an ImmutableString gives its text", () => {
    const file = Automerge.from<any>({ "@patchwork": { type: "file" }, name: I("hull.py"), extension: I("py"), content: I("def f():\n    return 1\n") })
    expect(sourceOf(file, null)).toEqual({ kind: "py-file", text: "def f():\n    return 1\n" })
  })

  test("a notebook whose cells hold ImmutableStrings gives their code", () => {
    expect(sourceOf({ ...docToJson(doc) as object, cells: doc.cells, "@patchwork": { type: "jupyter-notebook" } }, null)).toEqual({ kind: "notebook", text: "import reg\nprint(1)" })
  })

  test("the read record hashes the converted value, so an ImmutableString and the same str hash alike", () => {
    expect(readHash(docToJson(doc), ["entries", "boat_mass_kg", "unit"])).toBe(readHash({ entries: { boat_mass_kg: { unit: "kg" } } }, ["entries", "boat_mass_kg", "unit"]))
  })

  const python = spawnSync("python3", ["--version"]).status === 0
  test.skipIf(!python)("in Python: str, int and bytes, never an object with .val", () => {
    const dir = mkdtempSync(join(tmpdir(), "pwvalues-"))
    const opened = new Map<string, Opened>([["automerge:sink", { url: "automerge:sink", doc, heads: ["h"], type: "kitchen-sink", title: "Kitchen sink", hook: null }]])
    const { files } = documentFiles(opened, [])
    for (const [name, text] of Object.entries(files.files)) writeFileSync(join(dir, name), text)
    writeFileSync(join(dir, "index.json"), JSON.stringify(files.index))
    writeFileSync(join(dir, "sink_json.py"), moduleSource({ name: "sink_json", docUrl: "automerge:sink" }, { kind: "json", text: JSON.stringify(docToJson(doc)), title: "Kitchen sink" }))
    const program = [
      "import importlib.util, sys",
      `spec = importlib.util.spec_from_file_location("documents", ${JSON.stringify(new URL("../shared/python/patchwork/documents.py", import.meta.url).pathname)})`,
      "d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)",
      `d.ROOT = ${JSON.stringify(dir)}`,
      `sys.path.insert(0, ${JSON.stringify(dir)})`,
      'p = d.load("automerge:sink").plain()',
      "import sink_json",
      "for data in (p, sink_json.data):",
      "    checks = [",
      "        (data['title'], str), (data['text'], str), (data['count'], int), (data['bytes'], bytes), (data['when'], str),",
      "        (data['entries']['boat_mass_kg']['unit'], str), (data['cells'][0]['source'][0], str), (data['cells'][1]['source'], str),",
      "        (data['list'][0], str), (data['list'][1], int), (data['list'][2], bytes), (data['list'][4][0], str), (data['file']['content'], str),",
      "    ]",
      "    print([type(v).__name__ for v, t in checks if type(v) is not t], data['bytes'], data['list'][2], data['cells'][0]['source'][0], data['file']['content'], data['count'])",
      'print(d.load("automerge:sink")["entries"]["boat_mass_kg"]["unit"])',
    ].join("\n")
    const run = spawnSync("python3", ["-I", "-c", program], { encoding: "utf-8" })
    expect(run.stderr).toBe("")
    expect(run.stdout).toBe(
      ["[] b'\\x00\\x01\\xff' b'\\t' import reg\n x = 1\n 3", "[] b'\\x00\\x01\\xff' b'\\t' import reg\n x = 1\n 3", "kg", ""].join("\n"),
    )
  })
})
