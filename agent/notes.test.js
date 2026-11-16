import { describe, it, expect } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { noteWrite, noteRead, noteDelete, notesSection, notesFolder, noteFileName, looksLikeCredential, NOTES_FOLDER_NAME } from "./tools/notes.js"
import { run } from "./loop.js"
import { memoryStore } from "./store.js"
import { makeMock } from "./providers/mock.js"
import { initSession, claimLease, makeTurn, textBlock, _resetIds } from "./session.js"

await initSubduction()

/** An account with a root folder holding one unrelated folder, as a real one would. */
async function account() {
  const repo = new Repo({ network: [] })
  const other = repo.create({ title: "Recipes", docs: [], "@patchwork": { type: "folder" } })
  const root = repo.create({ title: "Root", docs: [{ name: "Recipes", type: "folder", url: other.url }], "@patchwork": { type: "folder" } })
  const ctx = () => ({ repo, rootFolderUrl: root.url })
  return { repo, root, ctx }
}

const NOTE = "# Automerge counters\nPlain numbers lose concurrent increments; use Counter.\n\nMeasured: two += 1 merged to 1.\n"

describe("note_write", () => {
  it("makes the notes folder in the user's root on first use, with a README saying what it is", async () => {
    const { repo, root, ctx } = await account()
    await noteWrite.execute({ name: "Automerge counters", content: NOTE }, ctx())

    const entry = root.doc().docs.find((d) => d.name === NOTES_FOLDER_NAME)
    expect(entry?.type).toBe("folder")
    const folder = (await repo.find(entry.url)).doc()
    expect(folder.docs.map((d) => d.name).sort()).toEqual(["README.md", "automerge-counters.md"])
  })

  it("writes into the same folder every time, from any session", async () => {
    const { root, ctx } = await account()
    await noteWrite.execute({ name: "one", content: "# One\nfirst" }, ctx())
    await noteWrite.execute({ name: "two", content: "# Two\nsecond" }, ctx()) // a fresh ctx: nothing memoized
    expect(root.doc().docs.filter((d) => d.name === NOTES_FOLDER_NAME)).toHaveLength(1)
  })

  it("finds the folder after the user renames it", async () => {
    const { root, ctx } = await account()
    await noteWrite.execute({ name: "one", content: "# One\nfirst" }, ctx())
    root.change((d) => { d.docs.find((e) => e.name === NOTES_FOLDER_NAME).name = "What the robot knows" })
    await noteWrite.execute({ name: "two", content: "# Two\nsecond" }, ctx())
    expect(root.doc().docs).toHaveLength(2) // Recipes and the renamed folder, no new one
    expect(await noteRead.execute({}, ctx())).toMatch(/one[\s\S]*two/)
  })

  it("updates a note in place", async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "counters", content: "# Counters\nold" }, ctx())
    await noteWrite.execute({ name: "Counters", content: "# Counters\nnew" }, ctx())
    expect(await noteRead.execute({}, ctx())).toBe("- counters — Counters: new")
  })

  it.each([
    ["an OpenRouter key", "my key is sk-or-v1-0123456789abcdef0123456789abcdef"],
    ["a GitHub token", "token ghp_0123456789abcdefghijABCDEFGHIJ"],
    ["a private key", "-----BEGIN RSA PRIVATE KEY-----\nMII..."],
  ])("refuses %s", async (_name, content) => {
    const { ctx } = await account()
    await expect(noteWrite.execute({ name: "keys", content: `# Keys\n${content}` }, ctx())).rejects.toThrow(/credential/)
    expect(await notesFolder(ctx())).toBeNull() // nothing was created on the way to refusing
  })

  it("but not ordinary prose about keys", () => {
    expect(looksLikeCredential("The API key goes in the account's LLM settings, never in a session.")).toBe(false)
  })
})

describe("note_read and note_delete", () => {
  it("reads by name or by title", async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "automerge counters", content: NOTE }, ctx())
    expect(await noteRead.execute({ name: "automerge counters" }, ctx())).toBe(NOTE)
    expect(await noteRead.execute({ name: "Automerge Counters" }, ctx())).toBe(NOTE)
    expect(await noteRead.execute({ name: "nope" }, ctx())).toMatch(/You have: automerge-counters/)
  })

  it("deletes, and the deleted note no longer reads", async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "wrong", content: "# Wrong\nthis was wrong" }, ctx())
    await noteDelete.execute({ name: "wrong" }, ctx())
    expect(await noteRead.execute({}, ctx())).toMatch(/no notes yet/)
  })
})

describe("the prompt", () => {
  it("lists every note with its first line, and says to read and write them", async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "automerge counters", content: NOTE }, ctx())
    const section = await notesSection(ctx())
    expect(section).toContain("- automerge-counters — Automerge counters: Plain numbers lose concurrent increments; use Counter.")
    expect(section).toMatch(/note_read any that bear on the task/)
    expect(section).toMatch(/note_write it/)
    expect(section).not.toContain("README")
  })

  it("says there are none yet, without creating anything", async () => {
    const { root, ctx } = await account()
    expect(await notesSection(ctx())).toMatch(/none yet/)
    expect(root.doc().docs).toHaveLength(1)
  })

  it("is left out where there is no account", async () => {
    expect(await notesSection({ repo: null, rootFolderUrl: null })).toBeNull()
  })

  it("reaches the model: the loop adds it to the system prompt", async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "automerge counters", content: NOTE }, ctx())
    _resetIds()
    const doc = {}
    initSession(doc, { title: "T", subject: "automerge:subject" })
    doc.turns = [makeTurn("user", [textBlock("hi")])]
    claimLease(doc, "local", Date.now())
    const provider = makeMock([[{ type: "text", delta: "hello" }]])
    const toolset = { tools: [], schemas: [], get: () => null }
    await run({ store: memoryStore(doc), provider, toolset, ctx: ctx(), canRun: () => true, flushMs: 0, system: "BASE" })
    expect(provider.requests[0].system).toMatch(/^BASE\n\n## Your notes/)
    expect(provider.requests[0].system).toContain("automerge-counters")
  })
})

describe("noteFileName", () => {
  it.each([
    ["Automerge counters!", "automerge-counters.md"],
    ["  spaces   and/slashes ", "spaces-and-slashes.md"],
    ["already.md", "already.md"],
  ])("%s -> %s", (name, file) => expect(noteFileName(name)).toBe(file))

  it("refuses a name with nothing in it", () => {
    expect(() => noteFileName("!!!")).toThrow(/name/)
  })
})
