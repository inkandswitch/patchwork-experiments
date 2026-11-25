import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { generateAutomergeUrl, encodeHeads } from "@automerge/automerge-repo"
import { guardedFetch, Refused, pageOriginFetch } from "../net/guard.js"

/**
 * plugin_source reads a package's code. A package the page serves is a
 * document, and is read as one; anything else is fetched through the guard,
 * from the package's own origin only. The platform's fetch is never used: a
 * request to the page's origin is how a document would be read past every
 * check.
 */

let plugins = []
vi.mock("../host/import.js", () => ({
  hostImport: async () => ({
    getRegistry: () => ({ all: () => plugins }),
    getAllRegistries: () => new Map([["patchwork:tool", { all: () => plugins }]]),
  }),
}))
const { pluginSource, registryList, packageDocOf } = await import("./environment.js")

const PAGE = "https://patchwork.example.org"
const HEAD = encodeHeads(["ab".repeat(32)])[0]

describe("which package document an import URL names", () => {
  const pkg = generateAutomergeUrl()
  const id = pkg.slice("automerge:".length)
  it.each([
    [pkg, pkg],
    [`${pkg}#${HEAD}`, pkg],
    [`${PAGE}/automerge%3A${id}/dist/index.js`, pkg],
    [`${PAGE}/automerge%3A${id}%23${HEAD}/dist/index.js`, pkg],
    [`https://elsewhere.example/automerge%3A${id}/index.js`, pkg],
    ["https://cdn.example.com/pkg/index.js", null],
    [`${PAGE}/plugins/index.js`, null],
    [`${PAGE}/%E9/index.js`, null],
    ["not a url", null],
  ])("%s → %s", (importUrl, expected) => {
    expect(packageDocOf(importUrl)).toBe(expected)
  })
})

describe("plugin_source", () => {
  let platform
  beforeEach(() => {
    platform = []
    vi.stubGlobal("fetch", async (url) => {
      platform.push(url)
      throw new Error("the platform's fetch was used")
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    plugins = []
  })

  /** A package folder holding one file, and a document outside it. */
  function world() {
    const docs = new Map()
    const add = (doc) => {
      const url = generateAutomergeUrl()
      docs.set(url, doc)
      return url
    }
    const entry = add({ content: "export const plugins = []" })
    const secret = add({ content: "someone's private notes" })
    const pkg = add({ docs: [{ name: "index.js", type: "file", url: entry }] })
    const repo = {
      async find(url) {
        const bare = String(url).split("#")[0]
        if (!docs.has(bare)) throw new Error(`no document ${url}`)
        return { url: bare, doc: () => docs.get(bare) }
      },
    }
    const sent = []
    const fetchImpl = guardedFetch({
      fetch: async (url) => (sent.push(url), { ok: true, status: 200, url, headers: { get: () => null }, text: async () => "// fetched" }),
      deny: [PAGE],
    })
    return { pkg, secret, sent, ctx: { repo, fetchImpl } }
  }

  it("reads a package the page serves from its document, never from the page's origin", async () => {
    const w = world()
    plugins = [{ id: "p", importUrl: `${PAGE}/${encodeURIComponent(w.pkg)}/index.js` }]
    const out = await pluginSource.execute({ id: "p", file: "index.js" }, w.ctx)
    expect(out.text).toContain("export const plugins = []")
    // Whose source it read, said as data.
    expect(out.facts).toEqual({ plugins: [{ type: "patchwork:tool", id: "p" }] })
    expect(w.sent).toEqual([])
    expect(platform).toEqual([])
  })

  it("will not reach another document by a file path that names one", async () => {
    const w = world()
    plugins = [{ id: "p", importUrl: `${PAGE}/${encodeURIComponent(w.pkg)}/index.js` }]
    const file = `/${encodeURIComponent(w.secret)}/x`
    await expect(pluginSource.execute({ id: "p", file }, w.ctx)).rejects.toThrow(/not in package/)
    expect(w.sent).toEqual([])
    expect(platform).toEqual([])
  })

  it("fetches an http-hosted package through the guard", async () => {
    const w = world()
    plugins = [{ id: "p", importUrl: "https://cdn.example.com/pkg/index.js" }]
    expect((await pluginSource.execute({ id: "p", file: "util.js" }, w.ctx)).text).toContain("// fetched")
    expect(w.sent).toEqual(["https://cdn.example.com/pkg/util.js"])
    expect(platform).toEqual([])
  })

  it.each([
    ["an absolute file elsewhere", "https://10.0.0.1/", /is not in the package/],
    ["a protocol-relative file elsewhere", "//192.168.1.1/admin", /is not in the package/],
  ])("refuses %s, sending nothing", async (_, file, error) => {
    const w = world()
    plugins = [{ id: "p", importUrl: "https://cdn.example.com/pkg/index.js" }]
    await expect(pluginSource.execute({ id: "p", file }, w.ctx)).rejects.toThrow(error)
    expect(w.sent).toEqual([])
    expect(platform).toEqual([])
  })

  it("refuses a package hosted on the page's own origin when it has no fetch for that origin", async () => {
    const w = world()
    plugins = [{ id: "p", importUrl: `${PAGE}/plugins/index.js` }]
    await expect(pluginSource.execute({ id: "p" }, w.ctx)).rejects.toBeInstanceOf(Refused)
    expect(w.sent).toEqual([])
    expect(platform).toEqual([])
  })

  describe("a package the page serves itself", () => {
    function withPageFetch() {
      const w = world()
      const pageSent = []
      w.ctx.pageFetch = pageOriginFetch({
        fetch: async (url) => (pageSent.push(url), { ok: true, status: 200, url, headers: { get: () => null }, text: async () => "// from the page" }),
        origin: PAGE,
      })
      return { ...w, pageSent }
    }

    it("is read with the page's own fetch — the way to learn how a built-in tool is written", async () => {
      const w = withPageFetch()
      plugins = [{ id: "p", importUrl: `${PAGE}/plugins/index.js` }]
      expect((await pluginSource.execute({ id: "p", file: "tool.js" }, w.ctx)).text).toContain("// from the page")
      expect(w.pageSent).toEqual([`${PAGE}/plugins/tool.js`])
      expect(w.sent).toEqual([])
    })

    it.each([
      ["/automerge:SECRET/x.js"],
      ["/automerge%3ASECRET/x.js"],
      ["/automerge%253ASECRET/x.js"],
      ["https://cdn.example.com/elsewhere.js"],
    ])("still never reaches %s through it", async (file) => {
      const w = withPageFetch()
      plugins = [{ id: "p", importUrl: `${PAGE}/plugins/index.js` }]
      await expect(pluginSource.execute({ id: "p", file }, w.ctx)).rejects.toThrow()
      expect(w.pageSent).toEqual([])
      expect(platform).toEqual([])
    })
  })

  it("the page's fetch takes nothing but its own origin's non-document paths", async () => {
    const sent = []
    const pageFetch = pageOriginFetch({ fetch: async (url) => (sent.push(url), { ok: true }), origin: PAGE })
    for (const url of [`${PAGE}/x/automerge:abc`, `${PAGE}/x%2Fautomerge%3Aabc`, "https://elsewhere.example/a.js", "not a url"]) {
      await expect(pageFetch(url)).rejects.toBeInstanceOf(Refused)
    }
    await pageFetch(`${PAGE}/plugins/a.js`)
    expect(sent).toEqual([`${PAGE}/plugins/a.js`])
  })

  it("fetches nothing without the runner's guarded fetch", async () => {
    plugins = [{ id: "p", importUrl: "https://cdn.example.com/pkg/index.js" }]
    await expect(pluginSource.execute({ id: "p" }, { repo: null })).rejects.toThrow(/no guarded fetch/)
    expect(platform).toEqual([])
  })
})

describe("registry_list", () => {
  it("says which plugins it listed, as data beside the listing", async () => {
    plugins = [{ id: "tally", name: "Tally", supportedDatatypes: ["count"] }, { id: "grid" }]
    const out = await registryList.execute({ search: "tally|count" }, {})
    expect(out.text).toBe("1 plugin matching /tally|count/:\n\npatchwork:tool (1)\n  tally — Tally (for count)")
    expect(out.facts).toEqual({ listed: [{ type: "patchwork:tool", id: "tally" }] })
    expect((await registryList.execute({ search: "nothing" }, {})).facts).toEqual({ listed: [] })
  })
})
