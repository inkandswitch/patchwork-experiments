import { describe, it, expect } from "vitest"
import { createInlineViews, iconFor, isPackage, wantsInstall } from "./views.js"
import { installState, moduleUrlFor, splitModuleUrl, applyInstall, applyUninstall, shortHeads, pinIsBehind } from "./install.js"
import { initSession } from "../session/schema.js"
import { recordArtifact, MAX_ARTIFACTS } from "../session/made.js"

describe("recording what a session made", () => {
  const fresh = () => { const d = {}; initSession(d, {}); return d }

  it("keeps the newest first, because that is what you want", () => {
    const doc = fresh()
    recordArtifact(doc, { url: "automerge:a", name: "first" })
    recordArtifact(doc, { url: "automerge:b", name: "second" })
    expect((doc.made ?? []).map((a) => a.name)).toEqual(["second", "first"])
  })

  it("updates in place rather than stacking duplicates", () => {
    // Writing a file twice is one artifact written twice, not two artifacts.
    const doc = fresh()
    recordArtifact(doc, { url: "automerge:a", name: "tally", bytes: 10 })
    expect(recordArtifact(doc, { url: "automerge:a", name: "tally", bytes: 20 })).toBe(false)
    expect((doc.made ?? [])).toHaveLength(1)
    expect((doc.made ?? [])[0].bytes).toBe(20)
  })

  it("does not grow without bound", () => {
    const doc = fresh()
    for (let i = 0; i < MAX_ARTIFACTS + 10; i++) recordArtifact(doc, { url: `automerge:${i}`, name: `x${i}` })
    expect((doc.made ?? [])).toHaveLength(MAX_ARTIFACTS)
    expect((doc.made ?? [])[0].name).toBe(`x${MAX_ARTIFACTS + 9}`)
  })

  it("caps the other documents but never drops a kept source, which a web-only step reads through this list", () => {
    const doc = fresh()
    for (let i = 0; i < MAX_ARTIFACTS + 10; i++) {
      recordArtifact(doc, { url: `automerge:s${i}`, name: `s${i}`, kind: "source", source: `https://x.test/${i}`, engine: "raw", chars: 1 })
      recordArtifact(doc, { url: `automerge:f${i}`, name: `f${i}` })
    }
    const sources = (doc.made ?? []).filter((a) => a.source)
    const others = (doc.made ?? []).filter((a) => !a.source)
    expect(sources.map((a) => a.name)).toEqual(Array.from({ length: MAX_ARTIFACTS + 10 }, (_, i) => `s${MAX_ARTIFACTS + 9 - i}`))
    expect(others.map((a) => a.name)).toEqual(Array.from({ length: MAX_ARTIFACTS }, (_, i) => `f${MAX_ARTIFACTS + 9 - i}`))
  })

  it("ignores a reference with no document", () => {
    const doc = fresh()
    expect(recordArtifact(doc, null)).toBe(false)
    expect(recordArtifact(doc, { name: "no url" })).toBe(false)
    expect((doc.made ?? [])).toEqual([])
  })

  it("stores no undefined, because automerge cannot hold it", () => {
    const doc = fresh()
    recordArtifact(doc, { url: "automerge:a" })
    for (const value of Object.values((doc.made ?? [])[0])) expect(value).not.toBeUndefined()
  })
})

describe("the installed module list", () => {
  const settings = (modules) => ({ modules })

  it("splits a pinned entry into document and version", () => {
    expect(splitModuleUrl("automerge:abc#h1|h2")).toEqual({ url: "automerge:abc", heads: "h1|h2" })
    expect(splitModuleUrl("automerge:abc")).toEqual({ url: "automerge:abc", heads: null })
  })

  it("sorts heads, because a version is a set not a sequence", () => {
    // Two peers at the same version can list heads in different orders; an
    // unsorted join would make one version look like two.
    expect(moduleUrlFor("automerge:abc", ["b", "a"])).toBe("automerge:abc#a|b")
    expect(moduleUrlFor("automerge:abc", ["a", "b"])).toBe("automerge:abc#a|b")
    expect(moduleUrlFor("automerge:abc", [])).toBe("automerge:abc")
  })

  it("counts a pinned package as installed", () => {
    const state = installState(settings(["automerge:abc#h1"]), "automerge:abc")
    expect(state).toMatchObject({ installed: true, pinned: "h1", index: 0 })
  })

  it("reports a package that is not there", () => {
    expect(installState(settings(["automerge:other"]), "automerge:abc").installed).toBe(false)
    expect(installState(undefined, "automerge:abc").installed).toBe(false)
  })

  function handle(modules = []) {
    const doc = { modules }
    return { doc: () => doc, change: (fn) => fn(doc), modules: () => doc.modules }
  }

  it("installs live by default", () => {
    const h = handle()
    expect(applyInstall(h, "automerge:abc")).toEqual({ changed: true, entry: "automerge:abc" })
    expect(h.modules()).toEqual(["automerge:abc"])
  })

  it("replaces rather than adding a second entry for one package", () => {
    // Two entries means the same plugins registered twice and load order
    // deciding which wins.
    const h = handle(["automerge:abc"])
    applyInstall(h, "automerge:abc", { heads: ["h2", "h1"] })
    expect(h.modules()).toEqual(["automerge:abc#h1|h2"])

    applyInstall(h, "automerge:abc")
    expect(h.modules()).toEqual(["automerge:abc"])
  })

  it("leaves other packages alone", () => {
    const h = handle(["automerge:one", "automerge:abc#old", "automerge:two"])
    applyInstall(h, "automerge:abc", { heads: ["new"] })
    expect(h.modules()).toEqual(["automerge:one", "automerge:abc#new", "automerge:two"])
  })

  it("reports when nothing changed", () => {
    const h = handle(["automerge:abc"])
    expect(applyInstall(h, "automerge:abc").changed).toBe(false)
  })

  it("uninstalls whichever version is there", () => {
    const h = handle(["automerge:one", "automerge:abc#h1"])
    expect(applyUninstall(h, "automerge:abc")).toBe(true)
    expect(h.modules()).toEqual(["automerge:one"])
    expect(applyUninstall(h, "automerge:abc")).toBe(false)
  })

  it("shortens a version for a label", () => {
    expect(shortHeads("abcdefghijklmn|other")).toBe("abcdefg")
    expect(shortHeads(null)).toBeNull()
  })
})

describe("a pinned version that has fallen behind", () => {
  it("knows when the package has moved on", () => {
    expect(pinIsBehind("a|b", ["a", "b"])).toBe(false)
    // Order is not identity: heads are a set.
    expect(pinIsBehind("a|b", ["b", "a"])).toBe(false)
    expect(pinIsBehind("a|b", ["a", "c"])).toBe(true)
    expect(pinIsBehind("a", ["a", "b"])).toBe(true)
  })

  it("says nothing when it cannot tell", () => {
    expect(pinIsBehind(null, ["a"])).toBe(false) // a live install is never behind
    expect(pinIsBehind("a", [])).toBe(false) // heads not looked up yet
    expect(pinIsBehind("a", undefined)).toBe(false)
  })

  it("offers to update, and says so, when the pin is stale", () => {
    const views = createInlineViews({})
    const state = { open: new Set(), settings: { modules: ["automerge:a#oldhead"] }, heads: { "automerge:a": ["newhead"] } }
    const node = views.elementFor({ id: "c1" }, { doc: { url: "automerge:a", name: "tally", kind: "package" } }, state)
    expect(node.querySelector(".agent-view-state").textContent).toContain("behind")
    expect([...node.querySelectorAll(".agent-view-actions button")].map((b) => b.textContent)).toEqual([
      "Try it",
      "Update to current",
      "Follow edits",
      "Remove",
    ])
  })

  it("stays quiet when the pin is current", () => {
    const views = createInlineViews({})
    const state = { open: new Set(), settings: { modules: ["automerge:a#h1"] }, heads: { "automerge:a": ["h1"] } }
    const node = views.elementFor({ id: "c1" }, { doc: { url: "automerge:a", name: "tally", kind: "package" } }, state)
    expect(node.querySelector(".agent-view-state").textContent).not.toContain("behind")
    expect([...node.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Update to current")
  })
})

describe("sessions written before any of this existed", () => {
  // These documents are already out there. Nothing may assume `made` exists.
  const legacy = () => ({ schemaVersion: 1, title: "old", turns: [], status: "idle", grants: {} })

  it("reads as having made nothing", () => {
    expect((legacy().made ?? [])).toEqual([])
  })

  it("starts recording without a migration", () => {
    const doc = legacy()
    expect(recordArtifact(doc, { url: "automerge:a", name: "tally", kind: "package" })).toBe(true)
    expect((doc.made ?? [])).toHaveLength(1)
  })

  it("wants nothing installed", () => {
    expect(wantsInstall((legacy().made ?? []), { modules: [] })).toBe(false)
  })
})

describe("a call's document, package or mount, inline in the transcript", () => {
  const ref = { url: "automerge:a", name: "tally", kind: "package" }
  const state = (over = {}) => ({ open: new Set(), settings: null, heads: {}, ...over })

  it("shows nothing for a call that made nothing", () => {
    const views = createInlineViews({})
    expect(views.elementFor({ id: "c1" }, { output: "ok" }, state())).toBeNull()
    expect(views.elementFor({ id: "c1" }, null, state())).toBeNull()
  })

  it("names the thing, opens it on click, and offers to try a package rather than running it unasked", () => {
    const opened = []
    const views = createInlineViews({ openDoc: (u) => opened.push(u) })
    const node = views.elementFor({ id: "c1" }, { doc: ref }, state())
    expect(node.dataset.kind).toBe("package")
    expect(node.dataset.expanded).toBe("no") // nothing runs until a person clicks
    expect(node.querySelector(".agent-view-title").textContent).toBe("tally")
    node.querySelector(".agent-view-name").click()
    expect(opened).toEqual(["automerge:a"])
    expect([...node.querySelectorAll(".agent-view-actions button")].map((b) => b.textContent)).toEqual(["Try it"])
  })

  it("says Show for a document and Try it for a package", () => {
    const views = createInlineViews({})
    const doc = views.elementFor({ id: "c1" }, { doc: { url: "automerge:d", name: "notes.md", kind: "file" } }, state())
    expect(doc.querySelector(".agent-view-actions button").textContent).toBe("Show")
  })

  it("mounts for a person through the same loader, and hides again", async () => {
    const mounted = []
    let cleaned = 0
    const container = document.createElement("div")
    const views = createInlineViews({
      mountForPerson: async (input) => {
        mounted.push(input)
        return { container, cleanup: () => cleaned++ }
      },
    })
    const st = state()
    const node = views.elementFor({ id: "c1" }, { doc: ref }, st)
    node.querySelector(".agent-view-actions button").click()
    await new Promise((r) => setTimeout(r, 0))
    expect(mounted).toEqual([{ url: "automerge:a" }]) // a package mounts as itself

    const again = views.elementFor({ id: "c1" }, { doc: ref }, st)
    expect(again).toBe(node) // persistent: the running tool is not re-created
    expect(again.dataset.expanded).toBe("yes")
    expect(again.querySelector(".agent-view-body").firstElementChild).toBe(container)
    expect([...again.querySelectorAll(".agent-view-actions button")].map((b) => b.textContent)).toEqual(["Hide", "Collapse"])

    again.querySelector(".agent-view-actions button").click()
    expect(cleaned).toBe(1)
    expect(views.elementFor({ id: "c1" }, { doc: ref }, st).dataset.expanded).toBe("no")
  })

  it("a document mounts by docUrl", async () => {
    const mounted = []
    const views = createInlineViews({
      mountForPerson: async (input) => {
        mounted.push(input)
        return { container: document.createElement("div"), cleanup() {} }
      },
    })
    const node = views.elementFor({ id: "c1" }, { doc: { url: "automerge:d", name: "n", kind: "document" } }, state())
    node.querySelector(".agent-view-actions button").click()
    await new Promise((r) => setTimeout(r, 0))
    expect(mounted).toEqual([{ docUrl: "automerge:d" }])
  })

  it("reports a mount that failed instead of leaving a dead button", async () => {
    const views = createInlineViews({ mountForPerson: async () => { throw new Error("PROBLEM mounting threw: boom\nmore") } })
    const st = state()
    const node = views.elementFor({ id: "c1" }, { doc: ref }, st)
    node.querySelector(".agent-view-actions button").click()
    await new Promise((r) => setTimeout(r, 0))
    const after = views.elementFor({ id: "c1" }, { doc: ref }, st)
    expect(after.querySelector(".agent-view-error").textContent).toBe("PROBLEM mounting threw: boom")
    expect(after.querySelector(".agent-view-actions button").textContent).toBe("Try it")
  })

  it("adopts the agent's live mount beside the call that opened it, expanded, and lets it go when it closes", () => {
    const container = document.createElement("div")
    let live = { container, toolId: "tally" }
    const views = createInlineViews({ getMount: (id) => (id === "mount_ab12" ? live : null) })
    const st = state()
    // The mount is the one the result says it opened; its text is not read.
    const result = { output: "Mounted without throwing.", facts: { mountId: "mount_ab12" } }
    const node = views.elementFor({ id: "c1", tool: "view_mount" }, result, st)
    expect(node.dataset.kind).toBe("mount")
    expect(node.dataset.expanded).toBe("yes")
    expect(node.querySelector(".agent-view-body").firstElementChild).toBe(container)
    expect(node.querySelector(".agent-view-title").textContent).toBe("tally · open")
    // Collapsing keeps it running; the agent can still drive and screenshot it.
    node.querySelector(".agent-view-actions button").click()
    expect(views.elementFor({ id: "c1" }, result, st).dataset.expanded).toBe("no")
    expect(container.parentElement).toBe(node.querySelector(".agent-view-body"))

    live = null // view_unmount ran
    const closed = views.elementFor({ id: "c1" }, result, st)
    expect(closed.querySelector(".agent-view-state").textContent).toBe("closed")
    expect(closed.querySelector(".agent-view-body").childElementCount).toBe(0)
  })

  it("parks the agent's mounts and tears down a person's when the view goes away", async () => {
    const parked = []
    let cleaned = 0
    const agents = document.createElement("div")
    const views = createInlineViews({
      getMount: (id) => (id === "mount_x" ? { container: agents } : null),
      parkMount: (c) => parked.push(c),
      mountForPerson: async () => ({ container: document.createElement("div"), cleanup: () => cleaned++ }),
    })
    const st = state()
    views.elementFor({ id: "c1" }, { output: "ok", facts: { mountId: "mount_x" } }, st)
    const person = views.elementFor({ id: "c2" }, { doc: ref }, st)
    person.querySelector(".agent-view-actions button").click()
    await new Promise((r) => setTimeout(r, 0))

    views.dispose()
    expect(parked).toEqual([agents])
    expect(cleaned).toBe(1)
  })

  it("hides the install controls when the settings document is unreadable, and shows them when it is not", () => {
    const views = createInlineViews({})
    const none = views.elementFor({ id: "c1" }, { doc: ref }, state({ settings: null }))
    expect([...none.querySelectorAll(".agent-view-actions button")].map((b) => b.textContent)).toEqual(["Try it"])
    const some = views.elementFor({ id: "c2" }, { doc: ref }, state({ settings: { modules: [] } }))
    expect([...some.querySelectorAll(".agent-view-actions button")].map((b) => b.textContent)).toEqual([
      "Try it",
      "Install",
      "Pin this version",
    ])
    const installed = views.elementFor({ id: "c3" }, { doc: ref }, state({ settings: { modules: ["automerge:a"] } }))
    expect(installed.querySelector(".agent-view-state").textContent).toBe("installed · live")
  })

  it("asks to pin at the version current when you click, not when it was made", () => {
    const asked = []
    const views = createInlineViews({ install: (a, opts) => asked.push([a.url, opts]) })
    const node = views.elementFor({ id: "c1" }, { doc: ref }, state({ settings: { modules: [] } }))
    ;[...node.querySelectorAll(".agent-view-actions button")].find((b) => b.textContent === "Pin this version").click()
    expect(asked).toEqual([["automerge:a", { heads: "current" }]])
  })

  it("has an icon for every kind, including ones it has not heard of", () => {
    expect(iconFor("package")).toBe("📦")
    expect(iconFor("nonsense")).toBe("📄")
    expect(isPackage({ kind: "file" })).toBe(false)
  })
})
