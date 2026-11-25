/**
 * What the package registers, and what its modules may reach.
 *
 * The agent reads an `agent:tool` entry's metadata before loading anything,
 * so the entry repeats the tool's description and schema as plain JSON; this
 * holds the copies equal, and the entry free of imports. And the entry says
 * `scoped: true` — that the tool works only through the context it is
 * handed — so the code web_capture runs is held to it here: no globals, no
 * platform fetch, no host module.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { plugins } from "./index.js"
import { webCapture } from "./web-capture.js"
import { WebSnapshotDatatype } from "./snapshot/datatype.js"
import { SnapshotView } from "./snapshot/view.js"

const here = import.meta.dirname
const read = (file) => readFileSync(join(here, file), "utf8")

describe("the plugins", () => {
  it("are these, and only these", () => {
    expect(plugins.map((p) => `${p.type} ${p.id}`)).toEqual(["patchwork:datatype web-snapshot", "patchwork:tool web-snapshot", "agent:tool web_capture"])
  })

  it("have nothing but load() as a function, so they survive the structured clone", () => {
    for (const plugin of plugins) {
      const { load, ...rest } = plugin
      expect(typeof load).toBe("function")
      expect(structuredClone(rest)).toEqual(rest)
    }
  })

  it("come from an entry that imports nothing, statically or by a bare name", () => {
    const code = read("index.js")
    expect(code).not.toMatch(/^\s*import\s/m)
    for (const [, specifier] of code.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) expect(specifier).toMatch(/^\.\//)
  })

  it("web_capture: the entry's description, schema, tier, risk and declaration are the module's", async () => {
    const entry = plugins.find((p) => p.type === "agent:tool" && p.id === "web_capture")
    const fields = (t) => [t.name, t.description, t.input_schema, t.where, t.risk, t.scoped]
    expect(fields(entry)).toEqual(fields(webCapture))
    // Declared at the top level, as plain JSON: the agent reads it before loading anything.
    expect(entry.scoped).toBe(true)
    // What the agent's registry hands back from load(): the module, with an
    // execute and its own summarize.
    const loaded = await entry.load()
    expect(loaded).toBe(webCapture)
    expect(typeof loaded.execute).toBe("function")
    expect(typeof loaded.summarize).toBe("function")
  })

  // The agent's own tools are held to these in its documentation.test.js;
  // this one is not its own, so it is held to them here. The tool
  // description is all the model reads.
  describe("web_capture explains itself to the model", () => {
    const properties = Object.entries(webCapture.input_schema.properties)

    it("has a description with something in it", () => {
      expect(webCapture.description.length).toBeGreaterThan(40)
    })

    it("documents every parameter", () => {
      expect(properties.filter(([, spec]) => !spec?.description?.trim()).map(([name]) => name)).toEqual([])
    })

    it("gives every parameter a type", () => {
      expect(properties.filter(([, spec]) => !spec?.type && !spec?.oneOf).map(([name]) => name)).toEqual([])
    })

    it("names every required parameter among its properties", () => {
      expect(webCapture.input_schema.type).toBe("object")
      for (const name of webCapture.input_schema.required ?? []) expect(Object.keys(webCapture.input_schema.properties)).toContain(name)
    })

    it("declares a tier and a risk the agent knows, and asks like any fetch", () => {
      expect(webCapture.where).toBe("worker")
      expect(webCapture.risk).toBe("external")
    })

    // A research step has neither of these; the description is read there too.
    it("names no tool a research step lacks", () => {
      expect(webCapture.description).not.toMatch(/\b(source_file|doc_read|fs_write|web_import)\b/)
    })
  })

  it("load the datatype and the view", async () => {
    const byKey = Object.fromEntries(plugins.map((p) => [`${p.type} ${p.id}`, p]))
    expect(await byKey["patchwork:datatype web-snapshot"].load()).toBe(WebSnapshotDatatype)
    expect(typeof (await byKey["patchwork:tool web-snapshot"].load())).toBe("function")
    expect(typeof SnapshotView).toBe("function")
  })

  it("the datatype makes an empty snapshot with every field, which nothing has captured into", () => {
    const doc = {}
    WebSnapshotDatatype.init(doc)
    expect(doc).toEqual({
      "@patchwork": { type: "web-snapshot" },
      title: null,
      source: null,
      capture: null,
      html: null,
      base: null,
      resources: {},
      blobs: {},
      budget: null,
      tally: null,
      complete: false,
      text: null,
      textVia: null,
      marks: [],
      pages: null,
      missing: null,
    })
    expect(WebSnapshotDatatype.getTitle(doc)).toBe("Web snapshot")
  })
})

describe("the modules web_capture runs", () => {
  const CAPTURE = readdirSync(join(here, "capture")).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).map((f) => `capture/${f}`)
  const MODULES = ["web-capture.js", "keep.js", "guard.js", "snapshot/datatype.js", ...CAPTURE]
  const ALL = ["index.js", "ui.js", "snapshot/view.js", "snapshot/fetch.js", ...MODULES]

  it("include the whole capture pipeline", () => {
    expect(CAPTURE.sort()).toEqual(["bytes", "charset", "crawl", "css", "freeze", "links", "scan", "sniff", "svg", "text"].map((m) => `capture/${m}.js`))
  })

  it("are every module web-capture.js imports, transitively", () => {
    const seen = new Set()
    const visit = (file) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const [, from] of read(file).matchAll(/^import\s[^"']*["'](\.[^"']+)["']/gm)) visit(new URL(from, `file:///pkg/${file}`).pathname.slice("/pkg/".length))
    }
    visit("web-capture.js")
    expect([...seen].sort()).toEqual([...MODULES].sort())
  })

  // Capture code runs in a tab, a worker and node alike: it imports nothing
  // but its own modules, so no DOM, network or automerge can creep in.
  it.each(CAPTURE)("%s imports only capture modules", (file) => {
    const code = read(file)
    for (const [, from] of code.matchAll(/^import\s[^"']*["']([^"']+)["']/gm)) expect(from, file).toMatch(/^\.\/[\w-]+\.js$/)
    expect(code).not.toMatch(/\bimport\(/)
  })

  it.each(MODULES)("%s uses no globalThis, no bare fetch( and no host import", (file) => {
    const code = read(file)
    expect(code).not.toMatch(/globalThis/)
    expect(code).not.toMatch(/(^|[^.\w])fetch\(/m)
    expect(code).not.toMatch(/@inkandswitch\//)
    expect(code).not.toMatch(/\bimport\(/)
  })

  it("names the platform's fetch in one place only, the view's guarded fetch", () => {
    expect(ALL.filter((file) => /(^|[^.\w])fetch\(/m.test(read(file)))).toEqual(["snapshot/fetch.js"])
  })

  it("never import the agent, or anything outside this package", () => {
    for (const file of ALL) {
      for (const [, from] of read(file).matchAll(/(?:^import\s[^"']*|import\()\s*["']([^"']+)["']/gm)) {
        expect(from, file).not.toMatch(/agent/)
        if (from.startsWith(".")) expect(new URL(from, `file:///pkg/${file}`).pathname, file).toMatch(/^\/pkg\//)
      }
    }
  })
})
