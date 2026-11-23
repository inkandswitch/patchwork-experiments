import { describe, it, expect } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { splice } from "@automerge/automerge/slim"
import { noteWrite, noteEdit, noteRead, noteDelete, looksLikePlaceholder, notesSection, notesFolder, noteFileName, looksLikeCredential, NOTES_FOLDER_NAME } from "./tools/notes.js"
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

  it("rewrites a note in place only when told to overwrite it", async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "counters", content: "# Counters\nold news" }, ctx())
    const out = await noteWrite.execute({ name: "Counters", content: "# Counters\nnew news", overwrite: true }, ctx())
    expect(out).toMatch(/Replaced counters\.md .*: \d+ characters before, \d+ now\. The earlier text is in the note's history/)
    expect(await noteRead.execute({}, ctx())).toBe("- counters — Counters: new news")
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

describe("an accidental overwrite is hard to do", () => {
  const LONG = `# Counters\nPlain numbers lose concurrent increments.\n\n${"Measured: two += 1 merged to 1.\n".repeat(12)}`

  it("refuses to write a note that exists, and says what to do instead; the note is untouched", async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "counters", content: LONG }, ctx())
    await expect(noteWrite.execute({ name: "counters", content: "# Counters\nsomething else entirely" }, ctx())).rejects.toThrow(
      /already exists \(\d+ characters; it starts "# Counters Plain numbers[^"]*"\).*note_edit \{ name, append \}.*note_edit \{ name, find, replace \}.*overwrite: true/s
    )
    expect(await noteRead.execute({ name: "counters" }, ctx())).toBe(LONG)
  })

  it("refuses placeholder content, for a new note and an old one, even with overwrite", async () => {
    const { ctx } = await account()
    for (const content of ["", "# Counters", "# Counters\n...", "# Counters\nTODO", "# Counters\nplaceholder", "…", "# Counters\ncontent here"]) {
      await expect(noteWrite.execute({ name: "counters", content }, ctx())).rejects.toThrow(/not a note/)
    }
    await noteWrite.execute({ name: "counters", content: LONG }, ctx())
    await expect(noteWrite.execute({ name: "counters", content: "# Counters\n...", overwrite: true }, ctx())).rejects.toThrow(/not a note/)
    expect(await noteRead.execute({ name: "counters" }, ctx())).toBe(LONG)
  })

  it.each([
    ["# T\nPlain numbers lose concurrent increments.", false],
    ["# T\nok", true],
    ["# T\nbrief", false],
    ["# T\n TBD ", true],
    ["# T\nTBD: how counters merge", false],
  ])("looksLikePlaceholder(%j) is %s", (content, expected) => expect(looksLikePlaceholder(content)).toBe(expected))

  it("refuses an overwrite that drops most of a long note, and the note stays; delete-then-write is the way", async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "counters", content: LONG }, ctx())
    await expect(noteWrite.execute({ name: "counters", content: "# Counters\nOnly this line is left of it.", overwrite: true }, ctx())).rejects.toThrow(/dropping most of it.*note_delete counters\.md first/s)
    expect(await noteRead.execute({ name: "counters" }, ctx())).toBe(LONG)
    await noteDelete.execute({ name: "counters" }, ctx())
    await noteWrite.execute({ name: "counters", content: "# Counters\nOnly this line is left of it." }, ctx())
    expect(await noteRead.execute({ name: "counters" }, ctx())).toBe("# Counters\nOnly this line is left of it.\n")
  })

  it("lets a short note be rewritten with overwrite: nothing much to lose", async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "small", content: "# Small\nthis is a short note" }, ctx())
    await noteWrite.execute({ name: "small", content: "# Small\nbrief", overwrite: true }, ctx())
    expect(await noteRead.execute({ name: "small" }, ctx())).toBe("# Small\nbrief\n")
  })
})

describe("note_edit", () => {
  const BASE = "# Counters\nPlain numbers lose concurrent increments.\n\n## Measured\ntwo += 1 merged to 1\n"
  const setup = async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "counters", content: BASE }, ctx())
    return ctx()
  }

  it("appends on a new line and leaves the rest as it was", async () => {
    const ctx = await setup()
    const out = await noteEdit.execute({ name: "counters", append: "## Fix\nUse Counter." }, ctx)
    expect(out).toMatch(/Added 19 characters to the end of counters\.md \(\d+ → \d+ characters\)/)
    expect(await noteRead.execute({ name: "counters" }, ctx)).toBe(`${BASE}## Fix\nUse Counter.\n`)
  })

  it("replaces one passage, or deletes it with an empty replacement", async () => {
    const ctx = await setup()
    await noteEdit.execute({ name: "Counters", find: "two += 1 merged to 1", replace: "two += 1 merged to 1 (Automerge 3.3)" }, ctx)
    expect(await noteRead.execute({ name: "counters" }, ctx)).toBe(BASE.replace("merged to 1\n", "merged to 1 (Automerge 3.3)\n"))
    await noteEdit.execute({ name: "counters", find: "\n## Measured\ntwo += 1 merged to 1 (Automerge 3.3)", replace: "" }, ctx)
    expect(await noteRead.execute({ name: "counters" }, ctx)).toBe("# Counters\nPlain numbers lose concurrent increments.\n\n")
  })

  it("takes the replacement literally: $ patterns are not special", async () => {
    const ctx = await setup()
    await noteEdit.execute({ name: "counters", find: "Plain numbers", replace: "Cost is $& and $1" }, ctx)
    expect(await noteRead.execute({ name: "counters" }, ctx)).toContain("Cost is $& and $1 lose")
  })

  it.each([
    ["a passage that is not there", { find: "absent", replace: "x" }, /`find` is not in counters\.md/],
    ["a passage that occurs twice", { find: "n", replace: "x" }, /occurs \d+ times.*once/],
    ["an empty find", { find: "", replace: "x" }, /`find` is empty/],
    ["find without replace", { find: "Plain" }, /both `find`.*and `replace`/],
    ["replace without find", { replace: "x" }, /both `find`/],
    ["nothing to do", {}, /either `append`, or `find` with `replace`/],
    ["append and replace together", { append: "a", find: "Plain", replace: "x" }, /either `append`/],
    ["an empty append", { append: "  \n" }, /nothing to add/],
    ["a credential", { append: "key sk-or-v1-0123456789abcdef0123456789abcdef" }, /credential/],
  ])("refuses %s and leaves the note as it was", async (_, input, error) => {
    const ctx = await setup()
    await expect(noteEdit.execute({ name: "counters", ...input }, ctx)).rejects.toThrow(error)
    expect(await noteRead.execute({ name: "counters" }, ctx)).toBe(BASE)
  })

  it("will not leave a note empty", async () => {
    const { ctx } = await account()
    await noteWrite.execute({ name: "one line", content: "# One\nsome words here" }, ctx())
    await expect(noteEdit.execute({ name: "one line", find: "# One\nsome words here\n", replace: "" }, ctx())).rejects.toThrow(/empty/)
  })

  it("says what notes there are when the name is wrong", async () => {
    const ctx = await setup()
    await expect(noteEdit.execute({ name: "nope", append: "x" }, ctx)).rejects.toThrow(/No note called 'nope'\. You have: counters/)
  })

  it("writes only what changed: a concurrent edit elsewhere in the note survives", async () => {
    const { repo, root, ctx } = await account()
    const live = { ...ctx(), splice } // the runner gives its tools splice, which is what makes a write a diff
    await noteWrite.execute({ name: "counters", content: BASE }, live)
    const folder = (await repo.find(root.doc().docs.find((d) => d.name === NOTES_FOLDER_NAME).url)).doc()
    const handle = await repo.find(folder.docs.find((d) => d.name === "counters.md").url)
    const before = handle.heads()
    await noteEdit.execute({ name: "counters", append: "## Fix\nUse Counter." }, live)
    // A person edits the first line on the old version and merges it: both survive.
    const fork = repo.clone(handle.view(before))
    fork.change((d) => splice(d, ["content"], String(d.content).indexOf("Plain"), 5, "Bare"))
    handle.merge(fork)
    const merged = String(handle.doc().content)
    expect(merged).toContain("Bare numbers")
    expect(merged).toContain("## Fix\nUse Counter.")
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
