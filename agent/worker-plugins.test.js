/**
 * The SharedWorker's plugin catalogue (runners/worker-plugins.js): what the page's
 * registry holds, loaded in the worker where it can be, listed for a tab
 * where it cannot, following re-registration.
 */
import { describe, it, expect } from "vitest"
import { createPluginCatalogue, importPluginHere, createRegistryMirror } from "./runners/worker-plugins.js"
import { describePlugin, pluginDescriptions } from "./tools/index.js"

const entry = (id, more = {}) => ({ id, name: id, description: `${id}.`, where: "worker", risk: "read", importUrl: `https://p.example/${id}@1/index.js`, ...more })

function counting(behaviour = {}) {
  const loads = []
  const importPlugin = async (d) => {
    loads.push(`${d.id} ${d.importUrl}`)
    const b = behaviour[d.importUrl]
    if (b === "throw") throw new Error("Failed to resolve module specifier")
    if (b === "no-execute") return {}
    return { execute: (input) => `${d.id}@${d.importUrl.match(/@(\d+)/)[1]} ${JSON.stringify(input)}`, summarize: () => `did ${d.id}` }
  }
  return { loads, importPlugin }
}

describe("the worker's plugin catalogue", () => {
  it("lists what the page described, loads it once, and runs it here", async () => {
    const { loads, importPlugin } = counting()
    const catalogue = createPluginCatalogue({ importPlugin })
    catalogue.set([entry("a"), entry("b", { where: "host" })])
    const tools = await catalogue.tools()
    expect(tools.map((t) => [t.id, t.where, t.declared])).toEqual([["a", "worker", "worker"], ["b", "host", "host"]])
    expect(await tools[0].execute({ x: 1 }, {})).toBe('a@1 {"x":1}')
    expect(tools[0].summarize()).toBe("did a")
    await catalogue.tools()
    // A page-only plugin is never loaded in the worker.
    expect(loads).toEqual(["a https://p.example/a@1/index.js"])
  })

  it("lists a plugin that will not load here as host-tier, and tries it again next run", async () => {
    const url = entry("a").importUrl
    const behaviour = { [url]: "throw" }
    const { loads, importPlugin } = counting(behaviour)
    const errors = []
    const catalogue = createPluginCatalogue({ importPlugin, onError: (id, err) => errors.push([id, err.message]) })
    catalogue.set([entry("a")])
    expect((await catalogue.tools()).map((t) => [t.where, t.declared])).toEqual([["host", "worker"]])
    expect(errors).toEqual([["a", "Failed to resolve module specifier"]])
    delete behaviour[url]
    expect((await catalogue.tools())[0].where).toBe("worker")
    expect(loads.length).toBe(2)
  })

  it("a module without execute is no tool to run here", async () => {
    const { importPlugin } = counting({ [entry("a").importUrl]: "no-execute" })
    const catalogue = createPluginCatalogue({ importPlugin })
    catalogue.set([entry("a")])
    expect((await catalogue.tools())[0].where).toBe("host")
  })

  it("runs the version registered when the call is made, not when the toolset was built", async () => {
    const { importPlugin } = counting()
    const catalogue = createPluginCatalogue({ importPlugin })
    catalogue.set([entry("a")])
    const [tool] = await catalogue.tools()
    catalogue.set([entry("a", { importUrl: "https://p.example/a@2/index.js" })])
    expect(await tool.execute({}, {})).toBe("a@2 {}")
    // Removed mid-run: the call says so, rather than running what was there.
    catalogue.set([])
    await expect(tool.execute({}, {})).rejects.toThrow(/no longer installed/)
  })

  it("refuses a plugin that takes a built-in's name, and ignores what is not an entry", async () => {
    const errors = []
    const catalogue = createPluginCatalogue({ importPlugin: counting().importPlugin, onError: (id) => errors.push(id) })
    catalogue.set([entry("web_fetch"), entry("a"), entry("a", { description: "second" }), null, { name: "no id" }])
    expect((await catalogue.tools()).map((t) => [t.id, t.description])).toEqual([["a", "a."]])
    expect(errors).toEqual(["web_fetch"])
  })
})

describe("loading a plugin in the worker as the page does", () => {
  it("a package document goes through Patchwork's own loader", async () => {
    const asked = []
    const filesystem = async () => ({ importPluginFromFolderDocUrl: async (...args) => (asked.push(args), { execute: () => "ok" }) })
    const impl = await importPluginHere({ id: "assumptions_set", importUrl: "automerge:abc#heads" }, { filesystem })
    expect(asked).toEqual([["automerge:abc#heads", "agent:tool", "assumptions_set"]])
    expect(impl.execute()).toBe("ok")
  })

  it("any other URL is a module exporting `plugins`, whose entry's load() gives the code", async () => {
    const modules = {
      "https://p.example/pkg/index.js": { plugins: [{ type: "patchwork:tool", id: "t" }, { type: "agent:tool", id: "t", load: async () => ({ execute: () => "loaded" }) }] },
      "https://p.example/pkg2/index.js": { plugins: [{ type: "agent:tool", id: "u", import: "https://p.example/pkg2/u.js" }] },
      "https://p.example/pkg2/u.js": { execute: () => "imported" },
    }
    const importModule = async (url) => modules[url]
    expect((await importPluginHere({ id: "t", importUrl: "https://p.example/pkg/index.js" }, { importModule })).execute()).toBe("loaded")
    expect((await importPluginHere({ id: "u", importUrl: "https://p.example/pkg2/index.js" }, { importModule })).execute()).toBe("imported")
    await expect(importPluginHere({ id: "v", importUrl: "https://p.example/pkg/index.js" }, { importModule })).rejects.toThrow(/exports no agent:tool called v/)
    await expect(importPluginHere({ id: "w" }, { importModule })).rejects.toThrow(/without the URL/)
  })
})

describe("what the page hands the worker", () => {
  it("the metadata fields, as plain data, and nothing else", () => {
    const described = describePlugin({
      type: "agent:tool",
      id: "a",
      name: "A",
      description: "d",
      input_schema: { type: "object", properties: { x: { type: "string" } } },
      where: "worker",
      risk: "edit",
      scoped: true,
      target: { fields: ["register"] },
      importUrl: "automerge:abc#h",
      load: async () => ({}),
      module: { execute() {} },
      extra: "not a field",
    })
    expect(described).toEqual({
      id: "a",
      name: "A",
      description: "d",
      input_schema: { type: "object", properties: { x: { type: "string" } } },
      where: "worker",
      risk: "edit",
      scoped: true,
      target: { fields: ["register"] },
      importUrl: "automerge:abc#h",
    })
    expect(structuredClone(described)).toEqual(described)
    expect(describePlugin({ name: "no id" })).toBeNull()
  })

  it("every entry of the registry, without loading any", async () => {
    let loaded = 0
    const registry = { all: () => [{ id: "a", where: "host", load: () => loaded++ }, { name: "x" }], load: () => loaded++ }
    expect(await pluginDescriptions({ registry })).toEqual([{ id: "a", where: "host" }])
    expect(loaded).toBe(0)
    // Outside Patchwork there is no registry: no plugins.
    expect(await pluginDescriptions()).toEqual([])
  })
})

/** As much of @inkandswitch/patchwork-plugins as the mirror and a tool use. */
function pluginsModule() {
  const registries = new Map()
  return {
    getRegistry(type) {
      if (!registries.has(type)) {
        const entries = new Map()
        registries.set(type, {
          all: () => [...entries.values()],
          has: (id) => entries.has(id),
          register: (entry, importUrl) => entries.set(entry.id, { ...entry, importUrl }),
          remove: (id) => entries.delete(id),
          async load(id) {
            const e = entries.get(id)
            return e && { ...e, module: await e.load() }
          },
        })
      }
      return registries.get(type)
    },
  }
}

describe("the worker's registry, mirrored from the page's (ctx.plugins)", () => {
  const index = (v = 1) => [
    { type: "agent:tool", id: "pkg_do", name: "Do", importUrl: `https://p.example/pkg@${v}/index.js` },
    { type: "patchwork:datatype", id: "notes", name: "Notes", importUrl: `https://p.example/pkg@${v}/index.js` },
    { type: "patchwork:tool", id: "notes-view", name: "Notes view", importUrl: `https://p.example/pkg@${v}/index.js` },
  ]

  it("registers the page's views and datatypes, loading each from where the page did", async () => {
    const plugins = pluginsModule()
    const loads = []
    const mirror = createRegistryMirror(plugins, { importPlugin: async (d) => (loads.push(`${d.type} ${d.id} ${d.importUrl}`), { asSource: () => `source v${d.importUrl.match(/@(\d)/)[1]}` }) })
    mirror.set(index())
    // Agent tools are the catalogue's; the registry gets the rest.
    expect(plugins.getRegistry("agent:tool").all()).toEqual([])
    expect(plugins.getRegistry("patchwork:tool").all().map((p) => p.id)).toEqual(["notes-view"])
    const loaded = await plugins.getRegistry("patchwork:datatype").load("notes")
    expect(loaded.module.asSource()).toBe("source v1")
    expect(loads).toEqual(["patchwork:datatype notes https://p.example/pkg@1/index.js"])

    // A new version is registered under its new URL; one the page dropped goes.
    mirror.set(index(2).filter((p) => p.id !== "notes-view"))
    expect((await plugins.getRegistry("patchwork:datatype").load("notes")).module.asSource()).toBe("source v2")
    expect(plugins.getRegistry("patchwork:tool").all()).toEqual([])
  })

  it("leaves alone what something else registered here, and does nothing with no registry or no index", () => {
    const plugins = pluginsModule()
    plugins.getRegistry("patchwork:datatype").register({ id: "notes", name: "Mine", load: async () => ({}) }, "https://own.example/x.js")
    const mirror = createRegistryMirror(plugins)
    mirror.set(index())
    expect(plugins.getRegistry("patchwork:datatype").all().map((p) => p.name)).toEqual(["Mine"])
    mirror.set([])
    expect(plugins.getRegistry("patchwork:datatype").all().map((p) => p.name)).toEqual(["Mine"])
    expect(() => createRegistryMirror(null).set(index())).not.toThrow()
    expect(() => createRegistryMirror(plugins).set(undefined)).not.toThrow()
  })

  it("importPluginHere loads a plugin of any type, not only agent tools", async () => {
    const mod = { plugins: [{ type: "patchwork:datatype", id: "notes", load: async () => ({ asSource: () => "s" }) }] }
    const impl = await importPluginHere({ type: "patchwork:datatype", id: "notes", importUrl: "https://p.example/x.js" }, { importModule: async () => mod })
    expect(impl.asSource()).toBe("s")
  })
})
