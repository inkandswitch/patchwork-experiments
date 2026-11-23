import { describe, it, expect } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { guideRead, guideChanges, guidePin, guideWrite, guidesSection, surfaceGuides, guideFor, guideState, guidesOverview, listGuides, packageRef, lineDiff, describeState } from "./tools/guides.js"
import { noteRead, notesSection } from "./tools/notes.js"

await initSubduction()

/** An account, plus a package: a folder document holding two file documents. */
async function world() {
  const repo = new Repo({ network: [] })
  const root = repo.create({ title: "Root", docs: [], "@patchwork": { type: "folder" } })
  const file = (text) => repo.create({ content: text, name: "f" })
  const index = file("export const plugins = []\n")
  const readme = file("# pkg\n")
  const pkg = repo.create({
    title: "Pkg",
    docs: [
      { name: "index.js", type: "file", url: index.url },
      { name: "README.md", type: "file", url: readme.url },
    ],
    "@patchwork": { type: "folder" },
  })
  const registry = new Map([["patchwork:tool:pkgtool", { url: pkg.url, heads: null, name: "Pkg tool" }]])
  const ctx = () => ({
    repo,
    rootFolderUrl: root.url,
    packageOf: async (type, id) => registry.get(`${type}:${id}`) ?? null,
  })
  return { repo, root, pkg, index, readme, ctx }
}

const GUIDE = "# Pkg\nHow to drive the pkg tool.\n\n- pass `thing`.\n"

describe("pin states", () => {
  it("current when nothing changed, stale after a file edit, gone when the package cannot load", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    const guide = await guideFor(w.ctx(), w.pkg.url)
    expect((await guideState(w.ctx(), guide)).state).toBe("current")

    w.index.change((d) => { d.content = "export const plugins = [1]\n" })
    const stale = await guideState(w.ctx(), guide)
    expect(stale.state).toBe("stale")
    expect(stale.changes.changed).toEqual(["index.js"])
    expect(describeState(stale, guide)).toMatch(/May be out of date: 1 file changed/)

    const missing = { ...guide, package: "automerge:2222222222222222222222222222" }
    expect((await guideState({ repo: new Repo({ network: [] }) }, missing)).state).toBe("gone")
  })

  it("an added file makes it stale, and unpinned when no pin was ever made", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    const guide = await guideFor(w.ctx(), w.pkg.url)
    const extra = w.repo.create({ content: "x", name: "x" })
    w.pkg.change((d) => { d.docs.push({ name: "extra.js", type: "file", url: extra.url }) })
    expect((await guideState(w.ctx(), guide)).changes.added).toEqual(["extra.js"])
    expect((await guideState(w.ctx(), { ...guide, pin: null })).state).toBe("unpinned")
  })
})

describe("guide_write", () => {
  it("lives in a Tool guides folder inside the notes, not among the notes", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    expect(await noteRead.execute({}, w.ctx())).not.toMatch(/Pkg/)
    expect((await listGuides(w.ctx())).guides.map((g) => g.name)).toEqual(["Pkg"])
  })

  it("keeps the old pin on a stale guide unless the agent says it reviewed", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    w.index.change((d) => { d.content = "changed\n" })

    const kept = await guideWrite.execute({ package: w.pkg.url, content: GUIDE + "- pitfall\n" }, w.ctx())
    expect(kept).toMatch(/stays flagged/)
    expect((await guideState(w.ctx(), await guideFor(w.ctx(), w.pkg.url))).state).toBe("stale")

    await guideWrite.execute({ package: w.pkg.url, content: GUIDE + "- pitfall\n", reviewed: true }, w.ctx())
    expect((await guideState(w.ctx(), await guideFor(w.ctx(), w.pkg.url))).state).toBe("current")
  })

  it("guide_pin re-pins without rewriting the guide", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    w.readme.change((d) => { d.content = "# pkg v2\n" })
    await guidePin.execute({ package: w.pkg.url }, w.ctx())
    const guide = await guideFor(w.ctx(), w.pkg.url)
    expect((await guideState(w.ctx(), guide)).state).toBe("current")
    expect(guide.body).toContain("pass `thing`")
  })

  it("refuses a credential, and a package it cannot find", async () => {
    const w = await world()
    await expect(guideWrite.execute({ package: w.pkg.url, name: "P", content: "# P\nkey sk-or-v1-0123456789abcdef0123456789abcdef" }, w.ctx())).rejects.toThrow(/credential/)
    await expect(guideWrite.execute({ package: "nonesuch", content: "# P\nx" }, w.ctx())).rejects.toThrow(/Could not find/)
  })

  it("takes a plugin id where the page has a registry", async () => {
    const w = await world()
    await guideWrite.execute({ package: "pkgtool", content: GUIDE }, w.ctx())
    expect(await guideFor(w.ctx(), w.pkg.url)).toBeTruthy()
  })
})

describe("guide_read and guide_changes", () => {
  it("lists guides with where each stands, and reads one with its state", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    expect(await guideRead.execute({}, w.ctx())).toMatch(/Pkg — How to drive[\s\S]*Up to date/)
    w.index.change((d) => { d.content = "export const plugins = [2]\n" })
    const text = await guideRead.execute({ package: w.pkg.url }, w.ctx())
    expect(text).toMatch(/May be out of date/)
    expect(text).toContain("pass `thing`")
  })

  it("shows which files changed and a bounded diff with the replaced lines", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    w.index.change((d) => { d.content = "export const plugins = [\n  1,\n]\n" })
    const text = await guideChanges.execute({ package: w.pkg.url }, w.ctx())
    expect(text).toMatch(/Changed: index.js/)
    expect(text).toContain("- export const plugins = []")
    expect(text).toContain("+ export const plugins = [")
    expect(await guideChanges.execute({ package: w.pkg.url, file: "index.js" }, w.ctx())).toContain("--- index.js")
  })

  it("says so when the package is unchanged", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    expect(await guideChanges.execute({ package: w.pkg.url }, w.ctx())).toMatch(/^Up to date/)
  })
})

describe("lineDiff", () => {
  it("is bounded and says how much more", () => {
    const before = Array.from({ length: 200 }, (_, i) => `a${i}`).join("\n")
    const after = Array.from({ length: 200 }, (_, i) => `b${i}`).join("\n")
    const diff = lineDiff(before, after, 10)
    expect(diff.lines).toHaveLength(10)
    expect(diff.more).toBe(390)
  })
})

describe("surfacing", () => {
  const call = (tool, input = {}) => ({ id: "c", tool, input })

  it("a plugin tool call brings its package's guide, once", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    const ctx = w.ctx()
    const tool = { id: "pkg_do", name: "Pkg do", source: w.pkg.url }
    const first = await surfaceGuides(ctx, call("pkg_do"), tool, "ok")
    expect(first).toMatch(/Usage guide for Pkg[\s\S]*Up to date[\s\S]*pass `thing`/)
    expect(await surfaceGuides(ctx, call("pkg_do"), tool, "ok")).toBeNull()
  })

  it("flags a stale guide on surfacing, and says what to do", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    w.index.change((d) => { d.content = "new\n" })
    const text = await surfaceGuides(w.ctx(), call("pkg_do"), { id: "pkg_do", source: w.pkg.url }, "ok")
    expect(text).toMatch(/May be out of date/)
    expect(text).toMatch(/guide_changes/)
  })

  it.each([
    ["view_mount of its tool", call("view_mount", { toolId: "pkgtool", docUrl: "automerge:x" })],
    ["plugin_source of its id", call("plugin_source", { id: "pkgtool" })],
    ["view_mount of its package folder", null],
  ])("%s", async (name, c) => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    const given = c ?? call("view_mount", { url: w.pkg.url })
    expect(await surfaceGuides(w.ctx(), given, null, "ok")).toMatch(/Usage guide for Pkg/)
  })

  it("doc_create of its datatype", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    const ctx = { ...w.ctx(), packageOf: async (type, id) => (type === "patchwork:datatype" && id === "pkgdata" ? { url: w.pkg.url, heads: null } : null) }
    expect(await surfaceGuides(ctx, call("doc_create", { datatype: "pkgdata" }), null, "ok")).toMatch(/Usage guide for/)
  })

  it("a registry listing points to guides without their text", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    const out = "1 plugin:\n\npatchwork:tool (1)\n  pkgtool — Pkg tool\n"
    const text = await surfaceGuides(w.ctx(), call("registry_list"), null, out)
    expect(text).toMatch(/Usage guide for Pkg/)
    expect(text).not.toContain("pass `thing`")
  })

  it("with no guide, a use says so and offers to write one; a listing says nothing", async () => {
    const w = await world()
    const ctx = w.ctx()
    expect(await surfaceGuides(ctx, call("plugin_source", { id: "pkgtool" }), null, "ok")).toMatch(/No usage guide for Pkg tool yet[\s\S]*guide_write/)
    const again = w.ctx()
    expect(await surfaceGuides(again, call("registry_list"), null, "x\npatchwork:tool (1)\n  pkgtool\n")).toBeNull()
  })

  it("a call about no package, or an account with no notes place, surfaces nothing", async () => {
    const w = await world()
    expect(await surfaceGuides(w.ctx(), call("doc_read", { url: "automerge:x" }), { id: "doc_read" }, "ok")).toBeNull()
    expect(await surfaceGuides({ repo: w.repo }, call("plugin_source", { id: "pkgtool" }), null, "ok")).toBeNull()
  })
})

describe("the prompt and people", () => {
  it("lists guides in the prompt without reading packages, and tells the habit", async () => {
    const w = await world()
    expect(await guidesSection(w.ctx())).toMatch(/You have none yet/)
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    const section = await guidesSection(w.ctx())
    expect(section).toMatch(/- Pkg — How to drive/)
    expect(section).toMatch(/not in a loose note/)
    expect(await guidesSection({ repo: w.repo })).toBeNull()
  })

  it("the notes prompt sends package knowledge to guides", async () => {
    const w = await world()
    expect(await notesSection(w.ctx())).toMatch(/guide_write/)
  })

  it("an overview says each guide's state in words, never hashes", async () => {
    const w = await world()
    await guideWrite.execute({ package: w.pkg.url, name: "Pkg", content: GUIDE }, w.ctx())
    w.index.change((d) => { d.content = "z\n" })
    const [row] = await guidesOverview(w.ctx())
    expect(row).toMatchObject({ name: "Pkg", state: "stale" })
    expect(row.words).toMatch(/^May be out of date: 1 file changed in the package since this guide was checked on /)
    expect(row.words).not.toMatch(/automerge:|[0-9a-f]{20}/)
  })
})

describe("packageRef", () => {
  it("reads bare, pinned and service-worker spellings", () => {
    expect(packageRef("automerge:abc")).toEqual({ url: "automerge:abc", heads: null })
    expect(packageRef("automerge:abc#h1|h2")).toEqual({ url: "automerge:abc", heads: ["h1", "h2"] })
    expect(packageRef("https://x.test/automerge%3Aabc/index.js")).toEqual({ url: "automerge:abc", heads: null })
    expect(packageRef("https://cdn.test/pkg.js")).toBeNull()
  })
})
