import { describe, it, expect, beforeEach } from "vitest"
import { toolCheck, viewMount, viewInspect, viewInteract, viewUnmount, packageFileUrl, _resetMounts } from "./tools/checking.js"

/** A repo whose documents are plain objects. */
function fakeRepo() {
  let n = 0
  const docs = new Map()
  const handle = (url) => ({
    url,
    doc: () => docs.get(url),
    change(fn) { fn(docs.get(url)) },
    heads: () => ["h1"],
    on() {}, off() {},
  })
  return {
    docs,
    async create2() { const url = `automerge:new${++n}`; docs.set(url, {}); return handle(url) },
    async find(url) { if (!docs.has(url)) throw new Error("missing"); return handle(url) },
    seedPackage(url) { docs.set(url, { docs: [{ name: "package.json", type: "file", url: "automerge:pkg" }] }); return url },
  }
}

/** A package whose tool renders `render(handle, element)` however we like. */
const makeModule = (renderImpl, { datatypeInit, cloneableBreaker = false } = {}) => ({
  plugins: [
    {
      type: "patchwork:datatype", id: "widget", name: "Widget",
      ...(cloneableBreaker ? { onThing: () => {} } : {}),
      async load() {
        return {
          init: datatypeInit ?? ((doc) => { doc.title = "Widget"; doc.count = 0 }),
          getTitle: (doc) => doc.title,
        }
      },
    },
    {
      type: "patchwork:tool", id: "widget", name: "Widget", supportedDatatypes: ["widget"],
      async load() { return renderImpl },
    },
  ],
})

function run(renderImpl, options) {
  const repo = fakeRepo()
  const url = repo.seedPackage("automerge:package")
  return toolCheck.execute(
    { url },
    { repo, importModule: async () => makeModule(renderImpl, options) }
  )
}

beforeEach(() => { _resetMounts(); document.body.replaceChildren() })

describe("packageFileUrl", () => {
  it("pins to heads so a re-check does not import the cached old module", () => {
    expect(packageFileUrl("automerge:abc", ["b", "a"], "index.js")).toBe(
      `/${encodeURIComponent("automerge:abc#a|b")}/index.js`
    )
  })
  it("drops an existing pin before repinning", () => {
    expect(packageFileUrl("automerge:abc#old", ["h"])).toBe(`/${encodeURIComponent("automerge:abc#h")}/index.js`)
  })
})

describe("tool_check on a correct tool", () => {
  const good = (handle, element) => {
    const root = document.createElement("div")
    element.append(root)
    const render = () => {
      root.replaceChildren()
      const button = document.createElement("button")
      button.textContent = `count: ${handle.doc().count ?? 0}`
      button.onclick = () => handle.change((d) => { d.count = (d.count ?? 0) + 1 })
      root.append(button)
    }
    render()
    handle.on("change", render)
    return () => { handle.off("change", render); root.remove() }
  }

  it("reports no problems", async () => {
    const out = await run((handle, element) => {
      // a handle double that actually notifies, like the real one
      const listeners = new Set()
      const live = {
        doc: handle.doc,
        change: (fn) => { handle.change(fn); for (const l of [...listeners]) l() },
        on: (_e, fn) => listeners.add(fn),
        off: (_e, fn) => listeners.delete(fn),
      }
      return good(live, element)
    })
    expect(out).not.toMatch(/^PROBLEM/m)
    expect(out).toMatch(/No problems found/)
    expect(out).toMatch(/Mounted without throwing/)
    expect(out).toMatch(/Cleanup ran without throwing/)
    expect(out).toMatch(/Rendering updated/)
  })
})

describe("tool_check catches the bugs it exists for", () => {
  it("catches a display that never updates — the handle.doc property bug", async () => {
    const out = await run((handle, element) => {
      const div = document.createElement("div")
      // the real bug: `handle.doc` instead of `handle.doc()`
      div.textContent = `value: ${handle.doc.count ?? "?"}`
      const button = document.createElement("button")
      button.textContent = "add"
      button.onclick = () => handle.change((d) => { d.count = (d.count ?? 0) + 1 })
      element.append(div, button)
      return () => element.replaceChildren()
    })
    expect(out).toMatch(/PROBLEM the document changed but the rendering did NOT update/)
    expect(out).toMatch(/handle\.doc\(\)` is a function/)
  })

  it("catches cleanup that throws — the unsubscribe bug", async () => {
    const out = await run((handle, element) => {
      const button = document.createElement("button")
      button.textContent = "go"
      element.append(button)
      const unsubscribe = handle.on("change", () => {}) // returns undefined
      return () => unsubscribe()
    })
    expect(out).toMatch(/PROBLEM cleanup threw/)
    expect(out).toMatch(/handle\.off/)
  })

  it("catches a missing cleanup function", async () => {
    const out = await run((handle, element) => {
      element.append(document.createElement("button"))
      // returns nothing
    })
    expect(out).toMatch(/PROBLEM render\(\) returned undefined, not a cleanup function/)
  })

  it("catches a tool that renders nothing", async () => {
    const out = await run(() => () => {})
    expect(out).toMatch(/PROBLEM nothing rendered/)
  })

  it("catches a render function that throws on mount", async () => {
    const out = await run(() => { throw new Error("boom") })
    expect(out).toMatch(/PROBLEM mounting threw: boom/)
  })

  it("catches a button that does not write to the document", async () => {
    const out = await run((handle, element) => {
      const button = document.createElement("button")
      button.textContent = "inert"
      element.append(button)
      return () => {}
    })
    expect(out).toMatch(/did NOT change/)
    expect(out).toMatch(/handle\.change\(\)/)
  })

  it("catches a plugin field that cannot cross the worker boundary", async () => {
    const out = await run(
      (handle, element) => { element.append(document.createElement("button")); return () => {} },
      { cloneableBreaker: true }
    )
    expect(out).toMatch(/PROBLEM widget: a top-level field is not cloneable/)
    expect(out).toMatch(/behind `async load\(\)`/)
  })

  it("catches a datatype whose init throws", async () => {
    const out = await run(
      (handle, element) => { element.append(document.createElement("button")); return () => {} },
      { datatypeInit: () => { throw new Error("bad init") } }
    )
    expect(out).toMatch(/PROBLEM datatype init threw: bad init/)
  })

  it("reports an entry module that will not import, and stops there", async () => {
    const repo = fakeRepo()
    const url = repo.seedPackage("automerge:package")
    const out = await toolCheck.execute(
      { url },
      { repo, importModule: async () => { throw new SyntaxError("Unexpected token }") } }
    )
    expect(out).toMatch(/FAILED to import the entry module/)
    expect(out).toMatch(/Unexpected token/)
  })

  it("reports a module that exports no plugins array", async () => {
    const repo = fakeRepo()
    const url = repo.seedPackage("automerge:package")
    const out = await toolCheck.execute({ url }, { repo, importModule: async () => ({}) })
    expect(out).toMatch(/exported no `plugins` array/)
  })

  it("leaves no container behind in the page", async () => {
    await run((handle, element) => { element.append(document.createElement("button")); return () => {} })
    expect(document.body.childElementCount).toBe(0)
  })

  it("refuses a url that is not a package document", async () => {
    const repo = fakeRepo()
    repo.docs.set("automerge:plain", { title: "not a package" })
    await expect(
      toolCheck.execute({ url: "automerge:plain" }, { repo, importModule: async () => ({}) })
    ).rejects.toThrow(/not a package folder/)
  })
})

describe("summarize", () => {
  it("counts problems", () => {
    expect(toolCheck.summarize({}, "PROBLEM a\nPROBLEM b\nok")).toBe("checked · 2 problems")
    expect(toolCheck.summarize({}, "No problems found.")).toBe("checked · ok")
  })
})

describe("driving a view with the granular tools", () => {
  /** A counter tool that behaves correctly, with a live handle. */
  const counter = (handle, element) => {
    const root = document.createElement("div")
    element.append(root)
    const render = () => {
      root.replaceChildren()
      const label = document.createElement("span")
      label.className = "count"
      label.textContent = `count: ${handle.doc().count ?? 0}`
      const button = document.createElement("button")
      button.textContent = "add"
      button.onclick = () => handle.change((d) => { d.count = (d.count ?? 0) + 1 })
      const field = document.createElement("input")
      field.className = "label"
      field.oninput = () => handle.change((d) => { d.label = field.value })
      root.append(label, button, field)
    }
    render()
    handle.on("change", render)
    return () => { handle.off("change", render); root.remove() }
  }

  /** Wrap a handle so change() notifies listeners, as the real one does. */
  const live = (handle) => {
    const listeners = new Set()
    return {
      doc: handle.doc,
      change: (fn) => { handle.change(fn); for (const l of [...listeners]) l() },
      on: (_e, fn) => listeners.add(fn),
      off: (_e, fn) => listeners.delete(fn),
    }
  }

  async function mount(renderImpl = counter) {
    const repo = fakeRepo()
    const url = repo.seedPackage("automerge:package")
    const out = await viewMount.execute(
      { url },
      { repo, importModule: async () => makeModule((h, e) => renderImpl(live(h), e)) }
    )
    const mountId = out.match(/mountId: (\S+)/)[1]
    return { mountId, out, repo }
  }

  it("returns a mountId and leaves the tool running", async () => {
    const { mountId, out } = await mount()
    expect(out).toMatch(/Mounted without throwing/)
    expect(mountId).toMatch(/^mount_/)
    const inspected = await viewInspect.execute({ mountId }, {})
    expect(inspected).toContain("count: 0")
  })

  it("persists between calls, which is the point of it", async () => {
    const { mountId } = await mount()
    await viewInteract.execute({ mountId, action: "click" }, {})
    await viewInteract.execute({ mountId, action: "click" }, {})
    const inspected = await viewInspect.execute({ mountId }, {})
    expect(inspected).toContain("count: 2")
  })

  it("types into a specific field and reports the document change", async () => {
    const { mountId } = await mount()
    const out = await viewInteract.execute(
      { mountId, action: "type", selector: "input.label", value: "hello" },
      {}
    )
    expect(out).toMatch(/document changed/)
    expect(out).toContain("hello")
  })

  it("inspects one part of the view", async () => {
    const { mountId } = await mount()
    const out = await viewInspect.execute({ mountId, selector: ".count" }, {})
    expect(out).toContain("count: 0")
    expect(out).not.toContain("add")
  })

  it("says what is present when a selector matches nothing", async () => {
    const { mountId } = await mount()
    await expect(viewInspect.execute({ mountId, selector: ".nope" }, {})).rejects.toThrow(/Present:/)
  })

  it("reports cleanup health on unmount and forgets the mount", async () => {
    const { mountId } = await mount()
    const out = await viewUnmount.execute({ mountId }, {})
    expect(out).toMatch(/Cleanup ran without throwing/)
    await expect(viewInspect.execute({ mountId }, {})).rejects.toThrow(/No mount/)
  })

  it("still diagnoses a display that does not follow the document", async () => {
    const broken = (handle, element) => {
      const label = document.createElement("span")
      label.textContent = "count: 0" // never re-rendered
      const button = document.createElement("button")
      button.textContent = "add"
      button.onclick = () => handle.change((d) => { d.count = (d.count ?? 0) + 1 })
      element.append(label, button)
      return () => element.replaceChildren()
    }
    const { mountId } = await mount(broken)
    const out = await viewInteract.execute({ mountId, action: "click" }, {})
    expect(out).toMatch(/PROBLEM the document changed but the rendering did NOT update/)
  })

  it("evicts the oldest mount rather than accumulating them forever", async () => {
    const ids = []
    for (let i = 0; i < 5; i++) ids.push((await mount()).mountId)
    await expect(viewInspect.execute({ mountId: ids[0] }, {})).rejects.toThrow(/No mount/)
    const newest = await viewInspect.execute({ mountId: ids.at(-1) }, {})
    expect(newest).toContain("count: 0")
  })

  it("needs to be told what to open", async () => {
    await expect(viewMount.execute({}, { repo: fakeRepo() })).rejects.toThrow(/Pass `docUrl`/)
  })
})
