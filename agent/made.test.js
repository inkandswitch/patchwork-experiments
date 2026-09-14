import { describe, it, expect } from "vitest"
import { renderMade, iconFor, isPackage } from "./ui/made.js"
import { installState, moduleUrlFor, splitModuleUrl, applyInstall, applyUninstall, shortHeads, pinIsBehind } from "./ui/install.js"
import { initSession, recordArtifact, artifacts, MAX_ARTIFACTS } from "./session.js"

describe("recording what a session made", () => {
  const fresh = () => { const d = {}; initSession(d, {}); return d }

  it("keeps the newest first, because that is what you want", () => {
    const doc = fresh()
    recordArtifact(doc, { url: "automerge:a", name: "first" })
    recordArtifact(doc, { url: "automerge:b", name: "second" })
    expect(artifacts(doc).map((a) => a.name)).toEqual(["second", "first"])
  })

  it("updates in place rather than stacking duplicates", () => {
    // Writing a file twice is one artifact written twice, not two artifacts.
    const doc = fresh()
    recordArtifact(doc, { url: "automerge:a", name: "tally", bytes: 10 })
    expect(recordArtifact(doc, { url: "automerge:a", name: "tally", bytes: 20 })).toBe(false)
    expect(artifacts(doc)).toHaveLength(1)
    expect(artifacts(doc)[0].bytes).toBe(20)
  })

  it("does not grow without bound", () => {
    const doc = fresh()
    for (let i = 0; i < MAX_ARTIFACTS + 10; i++) recordArtifact(doc, { url: `automerge:${i}`, name: `x${i}` })
    expect(artifacts(doc)).toHaveLength(MAX_ARTIFACTS)
    expect(artifacts(doc)[0].name).toBe(`x${MAX_ARTIFACTS + 9}`)
  })

  it("ignores a reference with no document", () => {
    const doc = fresh()
    expect(recordArtifact(doc, null)).toBe(false)
    expect(recordArtifact(doc, { name: "no url" })).toBe(false)
    expect(artifacts(doc)).toEqual([])
  })

  it("stores no undefined, because automerge cannot hold it", () => {
    const doc = fresh()
    recordArtifact(doc, { url: "automerge:a" })
    for (const value of Object.values(artifacts(doc)[0])) expect(value).not.toBeUndefined()
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

describe("the strip of what was made", () => {
  const state = (over = {}) => ({ madeOpen: true, settings: null, ...over })

  function render(made, over = {}, handlers = {}) {
    const doc = {}
    initSession(doc, {})
    doc.made = made
    const container = document.createElement("div")
    renderMade(container, doc, state(over), handlers)
    return container
  }

  it("stays out of the way when nothing has been made", () => {
    const container = render([])
    expect(container.hidden).toBe(true)
    expect(container.children).toHaveLength(0)
  })

  it("names the newest thing even when the list is closed", () => {
    const container = render(
      [{ url: "automerge:a", name: "tally", kind: "package" }, { url: "automerge:b", name: "notes.md", kind: "file" }],
      { madeOpen: false }
    )
    expect(container.querySelector(".agent-made-latest").textContent).toBe("tally")
    expect(container.querySelector(".agent-made-list")).toBeNull()
    expect(container.querySelector(".agent-made-toggle").textContent).toContain("2 things made here")
  })

  it("opens a document when its row is clicked", () => {
    const opened = []
    const container = render([{ url: "automerge:a", name: "tally", kind: "package" }], {}, { openDoc: (u) => opened.push(u) })
    container.querySelector(".agent-made-open").click()
    expect(opened).toEqual(["automerge:a"])
  })

  it("offers install and pin for a package that is not installed", () => {
    const container = render([{ url: "automerge:a", name: "tally", kind: "package" }], { settings: { modules: [] } })
    expect([...container.querySelectorAll(".agent-made-actions button")].map((b) => b.textContent)).toEqual([
      "Install",
      "Pin this version",
    ])
  })

  it("shows the installed version and how to change it", () => {
    const container = render([{ url: "automerge:a", name: "tally", kind: "package" }], {
      settings: { modules: ["automerge:a#abcdefghij"] },
    })
    expect(container.querySelector(".agent-made-state").textContent).toBe("installed @ abcdefg")
    expect([...container.querySelectorAll(".agent-made-actions button")].map((b) => b.textContent)).toEqual([
      "Follow edits",
      "Remove",
    ])
  })

  it("says live when it is not pinned", () => {
    const container = render([{ url: "automerge:a", name: "tally", kind: "package" }], {
      settings: { modules: ["automerge:a"] },
    })
    expect(container.querySelector(".agent-made-state").textContent).toBe("installed · live")
    expect([...container.querySelectorAll(".agent-made-actions button")].map((b) => b.textContent)).toEqual([
      "Pin this version",
      "Remove",
    ])
  })

  it("asks to pin at the version current when you click, not when it was made", () => {
    const asked = []
    const container = render(
      [{ url: "automerge:a", name: "tally", kind: "package" }],
      { settings: { modules: [] } },
      { install: (a, opts) => asked.push([a.url, opts]) }
    )
    container.querySelectorAll(".agent-made-actions button")[1].click()
    expect(asked).toEqual([["automerge:a", { heads: "current" }]])
  })

  it("offers nothing to install for an ordinary document", () => {
    const container = render([{ url: "automerge:a", name: "notes.md", kind: "file" }], { settings: { modules: [] } })
    expect(container.querySelector(".agent-made-actions")).toBeNull()
    expect(isPackage({ kind: "file" })).toBe(false)
  })

  it("hides the install controls when the settings document is unreadable", () => {
    const container = render([{ url: "automerge:a", name: "tally", kind: "package" }], { settings: null })
    expect(container.querySelector(".agent-made-actions")).toBeNull()
  })

  it("has an icon for every kind, including ones it has not heard of", () => {
    expect(iconFor("package")).toBe("📦")
    expect(iconFor("nonsense")).toBe("📄")
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
    const doc = {}
    initSession(doc, {})
    doc.made = [{ url: "automerge:a", name: "tally", kind: "package" }]
    const container = document.createElement("div")
    renderMade(
      container,
      doc,
      { madeOpen: true, settings: { modules: ["automerge:a#oldhead"] }, heads: { "automerge:a": ["newhead"] } },
      {}
    )

    expect(container.querySelector(".agent-made-state").textContent).toContain("behind")
    expect([...container.querySelectorAll(".agent-made-actions button")].map((b) => b.textContent)).toEqual([
      "Update to current",
      "Follow edits",
      "Remove",
    ])
  })

  it("stays quiet when the pin is current", () => {
    const doc = {}
    initSession(doc, {})
    doc.made = [{ url: "automerge:a", name: "tally", kind: "package" }]
    const container = document.createElement("div")
    renderMade(
      container,
      doc,
      { madeOpen: true, settings: { modules: ["automerge:a#h1"] }, heads: { "automerge:a": ["h1"] } },
      {}
    )
    expect(container.querySelector(".agent-made-state").textContent).not.toContain("behind")
    expect(container.querySelector('[data-variant="primary"]')).toBeNull()
  })
})
