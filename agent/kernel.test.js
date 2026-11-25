/**
 * No agent tool can rewrite a session or a plan, or make one.
 *
 * A research step's confinement is written in its session (`scope`) and its
 * plan (`sources`, `steps`), so a full-access session that could edit either
 * could undo it: drop a step's scope, give it tools, grant it things, or add
 * a document of the person's to the ledger. One that could make either could
 * do the same from scratch: a plan whose ledger lists the person's notes, run
 * by the driver as if it were real. Every session's tools get a repo
 * (kernel/scope.js kernelRepo) whose handles refuse both, however the document is
 * named; the two modules that write them legitimately are handed explicit
 * capabilities instead, and nothing else is.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import * as A from "@automerge/automerge"
import { Repo, initSubduction, parseAutomergeUrl } from "@automerge/automerge-repo"
import { initSession, makeTurn, textBlock } from "./session/session.js"
import { initPlan, WORKFLOW_TOOL_IDS } from "./workflow/plan.js"
import { runTool, buildToolset, BUILTIN_TOOLS } from "./tools/index.js"
import { SessionRunner, fullContext } from "./kernel/runner.js"
import { memoryStore } from "./kernel/store.js"
import { makeMock } from "./providers/mock.js"
import { kernelRepo, webScope, KERNEL_REFUSAL, KERNEL_TYPES } from "./kernel/scope.js"

await initSubduction()

const FIELDS = ["scope", "tools", "grants", "workflow", "sources"]
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v)
const isKernel = (doc) => KERNEL_TYPES.includes(doc?.["@patchwork"]?.type)

function spellings(url) {
  const { documentId, binaryDocumentId } = parseAutomergeUrl(url)
  const hex = [...binaryDocumentId].map((b) => b.toString(16).padStart(2, "0")).join("")
  return {
    url,
    path: `${url}/part`,
    bare: documentId,
    uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  }
}

/**
 * A research step's session and its plan, in a repo, and an ordinary file.
 *
 * The session and the plan are shaped so that every call below would change
 * them if nothing stopped it: each is a file (it has `content`), a folder (it
 * has `docs`), and has every field as a map — at its root and again inside
 * `part`, which the `path` spelling names. The control runs prove it.
 */
function world() {
  const repo = new Repo({ network: [] })
  const plain = repo.create({ "@patchwork": { type: "file" }, name: "notes.md", content: "web", meta: { note: "" } })
  const plan = repo.create({})
  plan.change((d) => initPlan(d, { title: "P", goal: "G", steps: [{ id: "r", title: "R", prompt: "p", why: "w", where: "worker", tier: "fast", access: "web" }] }))
  const session = repo.create({})
  session.change((d) => {
    initSession(d, {})
    d.scope = webScope(plan.url, "r")
    d.workflow = { planUrl: plan.url, stepId: "r" }
  })
  for (const handle of [plan, session]) {
    handle.change((d) => {
      d.content = "web"
      d.docs = [{ name: "x", type: "file", url: plain.url }]
      for (const field of FIELDS) if (!isMap(d[field])) d[field] = {}
      d.part = { content: "web", docs: [{ name: "x", type: "file", url: plain.url }], ...Object.fromEntries(FIELDS.map((f) => [f, {}])) }
    })
  }
  return { repo, plan, session, plain }
}

/** A folder that links `url`, spelled however it is, by the name "target". */
const folderLinking = (repo, url) => repo.create({ "@patchwork": { type: "folder" }, title: "dir", docs: [{ name: "target", type: "file", url }] })

const tool = (id) => BUILTIN_TOOLS.find((t) => t.id === id)

describe("from a full session, no tool changes a session or a plan", () => {
  // [tool, how, takes a field?, input for (spelling, field, a folder linking it)]
  // — each the way that tool names a document and a place in it.
  const CALLS = [
    ["doc_edit", "setting the field", true, (s, field) => ({ url: s, ops: [{ op: "set", path: [field], value: { kind: "full" } }] })],
    ["doc_edit", "inside the field", true, (s, field) => ({ url: s, ops: [{ op: "set", path: [field, "x"], value: 1 }] })],
    ["fs_write", "by url", false, (s) => ({ url: s, content: "written" })],
    ["fs_write", "by path, over it", false, (_s, _f, dir) => ({ root: dir, path: "target", content: "written" })],
    ["fs_write", "by path, into it", false, (_s, _f, dir) => ({ root: dir, path: "target/new.md", content: "written" })],
    ["fs_edit", "by url", false, (s) => ({ url: s, edits: [{ op: "replace", find: "web", text: "full" }] })],
    ["fs_edit", "by path", false, (_s, _f, dir) => ({ root: dir, path: "target", edits: [{ op: "replace", find: "web", text: "full" }] })],
    ["fs_delete", "by path, inside it", false, (_s, _f, dir) => ({ root: dir, path: "target/x" })],
  ]

  // Each row runs twice on a fresh world: through a full session's context,
  // where it must be refused by the kernel rule; and, as a control, through
  // the raw repo, where it must succeed and change the document — so a row
  // that fails for some other reason cannot pass here.
  for (const which of ["session", "plan"]) {
    for (const [id, how, takesField, inputFor] of CALLS) {
      it(`${id} ${how}, on the ${which}, by every spelling${takesField ? ", at every field" : ""}`, async () => {
        for (const form of ["url", "path", "bare", "uuid"]) {
          for (const field of takesField ? FIELDS : [null]) {
            for (const guarded of [true, false]) {
              const w = world()
              const target = w[which]
              const spelling = spellings(target.url)[form]
              const input = inputFor(spelling, field, folderLinking(w.repo, spelling).url)
              const ctx = guarded ? fullContext({ repo: w.repo }, memoryStore({})) : { repo: w.repo }
              const before = target.heads()
              const outcome = await runTool(tool(id), input, ctx)
              const label = `${id} ${form} ${field ?? ""} ${guarded ? "guarded" : "raw"}: ${outcome.output}`
              if (guarded) {
                expect(outcome.output, label).toContain(KERNEL_REFUSAL)
                expect(target.heads(), label).toEqual(before)
              } else {
                expect(outcome.isError, label).toBe(false)
                expect(target.heads(), label).not.toEqual(before)
              }
            }
          }
        }
      })
    }
  }

  it("an ordinary document is edited as before", async () => {
    const w = world()
    const ctx = fullContext({ repo: w.repo }, memoryStore({}))
    const ok = await runTool(tool("doc_edit"), { url: w.plain.url, ops: [{ op: "set", path: ["title"], value: "renamed" }] }, ctx)
    expect(ok.isError).toBe(false)
    expect(w.plain.doc().title).toBe("renamed")
  })
})

describe("from a full session, nothing becomes a session or a plan", () => {
  // A plan made by a tool would pass for a real one: the driver would run its
  // research steps against a ledger the tool wrote. So the rule is judged on
  // what a document is after a write as well as before it.
  const EDITS = {
    "@patchwork set whole": (type) => ({ url: null, ops: [{ op: "set", path: ["@patchwork"], value: { type } }] }),
    "its type set": (type) => ({ url: null, ops: [{ op: "set", path: ["@patchwork", "type"], value: type }] }),
  }

  for (const type of KERNEL_TYPES) {
    for (const [how, inputFor] of Object.entries(EDITS)) {
      it(`doc_edit: ${how} to ${type} is refused, where the raw repo would allow it`, async () => {
        for (const guarded of [true, false]) {
          const w = world()
          const { url, ops } = inputFor(type)
          const ctx = guarded ? fullContext({ repo: w.repo }, memoryStore({})) : { repo: w.repo }
          const outcome = await runTool(tool("doc_edit"), { url: `${w.plain.url}${url ?? ""}`, ops }, ctx)
          if (guarded) {
            expect(outcome.output).toContain(KERNEL_REFUSAL)
            expect(w.plain.doc()["@patchwork"].type).toBe("file")
          } else {
            expect(outcome.isError, outcome.output).toBe(false)
            expect(w.plain.doc()["@patchwork"].type).toBe(type)
          }
        }
      })
    }
  }

  // The file tools write `content` and a folder's `docs`, never `@patchwork`,
  // so they have no way to say what a document is; the rows above and below
  // cover every write a handle has.

  for (const type of KERNEL_TYPES) {
    // Every way a handle writes a document it was handed.
    const HANDLE = {
      change: (h) => h.change((d) => { d["@patchwork"] = { type } }),
      "change through a sub-handle": (h) => h.sub("@patchwork").change((d) => { d.type = type }),
      "change, replacing a sub-handle's value": (h) => h.sub("@patchwork").change({ type }),
      changeAt: (h) => h.changeAt(h.heads(), (d) => { d["@patchwork"].type = type }),
      update: (h) => h.update((doc) => A.change(doc, (d) => { d["@patchwork"].type = type })),
      merge: (h, w) => {
        const other = w.repo.clone(w.plain)
        other.change((d) => { d["@patchwork"].type = type })
        return h.merge(other)
      },
    }
    for (const [how, write] of Object.entries(HANDLE)) {
      it(`a handle's ${how} that would make it a ${type} is refused, and leaves it usable`, async () => {
        const w = world()
        const handle = await kernelRepo(w.repo).find(w.plain.url)
        expect(() => write(handle, w)).toThrow(KERNEL_REFUSAL)
        expect(w.plain.doc()["@patchwork"].type).toBe("file")
        // Refused, not broken: the next ordinary write goes through.
        handle.change((d) => { d.name = "still.md" })
        expect(w.plain.doc().name).toBe("still.md")
      })
    }

    // Every way a repo makes a document.
    const REPO = {
      create: (k) => k.create({ "@patchwork": { type } }),
      create2: (k) => k.create2({ "@patchwork": { type } }),
      "clone of a session": (k, w) => k.clone(w.session),
      "clone of a plan": (k, w) => k.clone(w.plan),
      import: (k, w) => k.import(A.save(A.change(A.clone(w.plain.doc()), (d) => { d["@patchwork"].type = type }))),
    }
    for (const [how, make] of Object.entries(REPO)) {
      it(`the repo's ${how} of a ${type} is refused`, async () => {
        const w = world()
        const kernels = () => Object.values(w.repo.handles).filter((h) => isKernel(h.doc())).length
        const before = kernels()
        await expect((async () => make(kernelRepo(w.repo), w))()).rejects.toThrow(KERNEL_REFUSAL)
        expect(kernels()).toBe(before)
      })
    }
  }

  it("a sub-handle inside @patchwork cannot write at all: what it writes is what the document is", async () => {
    const w = world()
    const handle = await kernelRepo(w.repo).find(w.plain.url)
    expect(() => handle.sub("@patchwork").change((d) => { d.note = "harmless" })).toThrow(KERNEL_REFUSAL)
    expect(w.plain.doc()["@patchwork"].note).toBeUndefined()
  })

  it("the same writes of an ordinary document go through", async () => {
    const w = world()
    const k = kernelRepo(w.repo)
    const handle = await k.find(w.plain.url)
    handle.changeAt(handle.heads(), (d) => { d.name = "a.md" })
    handle.update((doc) => A.change(doc, (d) => { d.title = "b" }))
    const other = w.repo.clone(w.plain)
    other.change((d) => { d.extension = "md" })
    handle.merge(other)
    handle.sub("meta").change((d) => { d.note = "c" })
    expect(JSON.parse(JSON.stringify(w.plain.doc()))).toMatchObject({ name: "a.md", title: "b", extension: "md", meta: { note: "c" }, "@patchwork": { type: "file" } })
    expect((await k.create2({ "@patchwork": { type: "file" } })).doc()["@patchwork"].type).toBe("file")
    expect(k.import(A.save(w.plain.doc())).doc().name).toBe("a.md")
    expect(k.clone(w.plain).doc().name).toBe("a.md")
  })
})

describe("kernelRepo", () => {
  // Every way a handle writes, through every handle the repo hands out.
  const WRITES = {
    change: (h) => h.change((d) => { d.x = 1 }),
    changeAt: (h) => h.changeAt(h.heads(), (d) => { d.x = 1 }),
    update: (h) => h.update((doc) => doc),
    merge: (h, w, target) => {
      const forged = w.repo.clone(target)
      forged.change((d) => { delete d.scope; d.sources = { evil: { url: w.plain.url, kind: "source", heads: [] } } })
      return h.merge(forged)
    },
    remove: (h) => h.sub("part").remove(),
    delete: (h) => h.delete(),
  }

  for (const which of ["session", "plan"]) {
    for (const form of ["url", "path", "bare", "uuid", "sub"]) {
      for (const [verb, write] of Object.entries(WRITES)) {
        it(`refuses ${verb} on the ${which} found by its ${form}`, async () => {
          const w = world()
          const k = kernelRepo(w.repo)
          const target = w[which]
          const handle = form === "sub" ? (await k.find(target.url)).sub("turns") : await k.find(spellings(target.url)[form])
          const before = target.heads()
          expect(() => write(handle, w, target)).toThrow(KERNEL_REFUSAL)
          expect(target.heads()).toEqual(before)
          expect(target.doc()).toBeTruthy()
        })
      }
    }
  }

  it("lets every write through on an ordinary document", async () => {
    const w = world()
    const handle = await kernelRepo(w.repo).find(w.plain.url)
    handle.change((d) => { d.title = "changed" })
    expect(w.plain.doc().title).toBe("changed")
    expect((await kernelRepo(w.repo).create2()).change).toBeTypeOf("function")
  })

  it("judges by what the document is when it is written, so one that becomes a session is refused from then on", async () => {
    const w = world()
    const handle = await kernelRepo(w.repo).find(w.plain.url)
    w.plain.change((d) => { d["@patchwork"] = { type: "agent-workflow" } })
    expect(() => handle.change((d) => { d.sources = {} })).toThrow(KERNEL_REFUSAL)
  })

  it("closes the repo's own ways around a handle", async () => {
    const w = world()
    const k = kernelRepo(w.repo)
    expect(() => k.delete(w.session.url)).toThrow(KERNEL_REFUSAL)
    expect(() => k.import(new Uint8Array(), { docId: w.plan.documentId })).toThrow(KERNEL_REFUSAL)
    expect(w.session.doc().scope).toBeTruthy()
  })

  // What a mounted view loads its document with (the file tool's
  // useDocHandle, automerge-repo-react-hooks): it was hidden, so the view threw
  // "findWithProgress is not a function". It is the same lookup `find` is, and
  // gives the same guarded handle.
  describe("findWithProgress, the lookup a mounted view makes", () => {
    it("is there, and every handle it gives out refuses what find's refuse", async () => {
      const w = world()
      const k = kernelRepo(w.repo)
      expect(k.findWithProgress).toBeTypeOf("function")
      const progress = k.findWithProgress(w.session.url)
      for (const handle of [await progress.whenReady(), progress.peek().handle, progress.handle]) {
        expect(handle.doc()).toBeTruthy()
        expect(() => handle.change((d) => { d.x = 1 })).toThrow(KERNEL_REFUSAL)
      }
    })

    it("gives a plain document's handle that writes, and tells a subscriber the guarded one", async () => {
      const w = world()
      const k = kernelRepo(w.repo)
      const progress = k.findWithProgress(w.plain.url)
      const seen = []
      progress.subscribe((state) => seen.push(state))
      const handle = await progress.whenReady()
      handle.change((d) => { d.title = "viewed" })
      expect(w.plain.doc().title).toBe("viewed")
      expect(progress.peek().state).toBe("ready")
      w.plain.change((d) => { d["@patchwork"] = { type: "agent-workflow" } })
      expect(() => handle.change((d) => { d.sources = {} })).toThrow(KERNEL_REFUSAL)
    })

    it("hands out nothing of the query that a view could use to fail or redirect it", () => {
      const w = world()
      const progress = kernelRepo(w.repo).findWithProgress(w.plain.url)
      for (const key of ["fail", "sourceReady", "sourceUnavailable", "sourcePending"]) expect(progress[key]).toBeUndefined()
    })

    it("the table of live handles, which the solid hooks read, holds guarded handles", async () => {
      const w = world()
      const k = kernelRepo(w.repo)
      const table = k.handles
      const id = parseAutomergeUrl(w.session.url).documentId
      expect(table[id]).toBeTruthy()
      expect(() => table[id].change((d) => { d.x = 1 })).toThrow(KERNEL_REFUSAL)
      expect(() => k.delete(w.session.url)).toThrow(KERNEL_REFUSAL)
    })
  })

  it("a view handed out is a kernel handle too", async () => {
    const w = world()
    const view = (await kernelRepo(w.repo).find(w.session.url)).view(w.session.heads())
    expect(() => view.change((d) => { d.x = 1 })).toThrow(KERNEL_REFUSAL)
  })

  // The handle's own methods hand back the handle: the chainable listener
  // methods return it, and every event carries it. Each must be the guarded
  // handle, not the one underneath.
  const CHAINS = {
    on: (h) => h.on("noop", () => {}),
    once: (h) => h.once("noop", () => {}),
    addListener: (h) => h.addListener("noop", () => {}),
    off: (h) => h.off("noop"),
    removeListener: (h) => h.removeListener("noop", () => {}),
    removeAllListeners: (h) => h.removeAllListeners("noop"),
  }
  for (const [method, chain] of Object.entries(CHAINS)) {
    it(`${method} returns the guarded handle`, async () => {
      const w = world()
      const handle = await kernelRepo(w.repo).find(w.plan.url)
      const returned = chain(handle)
      expect(returned).toBe(handle)
      expect(() => returned.change((d) => { d.sources.evil = { url: w.plain.url, kind: "source", heads: [] } })).toThrow(KERNEL_REFUSAL)
      expect(w.plan.doc().sources.evil).toBeUndefined()
    })
  }

  for (const event of ["change", "heads-changed", "delete"]) {
    it(`a ${event} listener is handed the guarded handle, and can be removed again`, async () => {
      const w = world()
      const handle = await kernelRepo(w.repo).find(w.session.url)
      const seen = []
      const listener = (payload) => seen.push(payload.handle)
      handle.on(event, listener)
      if (event === "delete") w.session.delete()
      else w.session.change((d) => { d.title = "moved" })
      expect(seen).toHaveLength(1)
      expect(seen[0]).toBe(handle)
      if (event !== "delete") expect(() => seen[0].change((d) => { delete d.scope })).toThrow(KERNEL_REFUSAL)
      handle.off(event, listener)
      if (event !== "delete") w.session.change((d) => { d.title = "again" })
      expect(seen).toHaveLength(1)
    })
  }
})

describe("the legitimate writers", () => {
  // Plans and sessions are written by the runtime: the loop through its store,
  // the driver with its own repo. Among the tools, these two capabilities are
  // the only way, each is used by one module, and each is handed to that
  // module's built-in tools and to no other tool — not to a plugin, whatever
  // it is called.
  // Every directory that defines tools.
  const root = process.cwd()
  const tools = ["tools", "knowledge", "workflow"].flatMap((dir) =>
    readdirSync(join(root, dir))
      .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
      .map((f) => `${dir}/${f}`),
  )
  const using = (pattern) => tools.filter((f) => pattern.test(readFileSync(join(root, f), "utf8")))

  it("only workflow/tools.js reaches for ctx.workflows", () => {
    expect(using(/ctx\.workflows/)).toEqual(["workflow/tools.js"])
  })

  it("only tools/naming.js writes through ctx.session", () => {
    expect(using(/ctx\.session\??\.change/)).toEqual(["tools/naming.js"])
  })

  it("only tools/watch.js reaches for ctx.watches", () => {
    expect(using(/ctx\.watches/)).toEqual(["tools/watch.js"])
  })

  /** A full session with Workflows on, a plugin of its own, and a runner over it. */
  function fullSession(execute = () => "plugin ran") {
    const w = world()
    const doc = {}
    initSession(doc, { config: { workflows: { enabled: true } } })
    const store = memoryStore(doc)
    const startStepSession = () => null
    const registry = {
      all: () => [{ id: "extra_tool", name: "extra_tool", description: "", where: "worker", risk: "read" }],
      load: async (id) => ({ id, module: { execute } }),
    }
    const runner = new SessionRunner({
      store,
      runnerUrl: "runner-test",
      ctx: { repo: w.repo, startStepSession, element: "a" },
      buildToolset: (d) => buildToolset(d, { registry }),
      getProvider: async () => null,
      canRun: () => true,
    })
    return { w, store, runner, startStepSession }
  }

  it("a full session's shared context has neither, a guarded repo, and no starter of step sessions", async () => {
    const { w, runner } = fullSession()
    const { ctx } = await runner.prepare(runner.store.doc())
    expect(ctx.workflows).toBeUndefined()
    expect("workflows" in ctx).toBe(false)
    expect(ctx.startStepSession).toBeUndefined()
    expect(ctx.session.change).toBeUndefined()
    expect(ctx.repo).not.toBe(w.repo)
    await expect((async () => (await ctx.repo.find(w.plan.url)).change((d) => { d.sources = {} }))()).rejects.toThrow(KERNEL_REFUSAL)
  })

  it("each capability goes to its own built-in tools, and to nothing else in the toolset", async () => {
    const { w, runner, startStepSession } = fullSession()
    const { toolset, privileged } = await runner.prepare(runner.store.doc())
    expect(toolset.get("extra_tool")).toBeTruthy()
    for (const t of toolset.tools) {
      const given = privileged(t)
      if (WORKFLOW_TOOL_IDS.includes(t.id)) {
        expect(Object.keys(given), t.id).toEqual(["workflows"])
        expect(given.workflows).toEqual({ repo: w.repo, startSession: startStepSession })
      } else if (t.id === "session_title") {
        expect(Object.keys(given), t.id).toEqual(["session"])
        expect(given.session.change).toBeTypeOf("function")
      } else if (t.id === "doc_watch") {
        expect(Object.keys(given), t.id).toEqual(["watches"])
        expect(given.watches.change).toBeTypeOf("function")
      } else {
        expect(given, t.id).toBeNull()
      }
    }
    // By identity, not by name: a copy of a built-in is not the built-in.
    expect(privileged({ ...tool("workflow_start") })).toBeNull()
    expect(privileged({ ...tool("session_title") })).toBeNull()
    expect(privileged({ ...tool("doc_watch") })).toBeNull()
  })

  it("doc_watch's capability writes the session's watches and nothing else", async () => {
    const { runner, store } = fullSession()
    const { privileged } = await runner.prepare(runner.store.doc())
    const { watches } = privileged(tool("doc_watch"))
    watches.change((all) => {
      all.w1 = { url: "automerge:x", path: [], match: null, label: null, heads: [], at: 0 }
    })
    expect(store.doc().watches.w1.url).toBe("automerge:x")
    // What it is handed is the watches map, not the session: there is no way
    // from it to the title, the grants or the turns.
    let handed = null
    watches.change((all) => { handed = Object.keys(all) })
    expect(handed).toEqual(["w1"])
  })

  it("through the loop, a plugin gets neither, while session_title still names the session", async () => {
    let seen = null
    const { runner, store } = fullSession((_input, ctx) => {
      seen = ctx
      return "plugin ran"
    })
    runner.getProvider = async () =>
      makeMock([
        [{ type: "call", id: "c1", name: "extra_tool", input: {} }, { type: "call", id: "c2", name: "session_title", input: { title: "Named" } }],
        [{ type: "text", delta: "done" }],
      ])
    store.change((d) => { d.turns.push(makeTurn("user", [textBlock("go")])) })
    await runner.tick()
    expect(seen).not.toBeNull()
    expect(seen.workflows).toBeUndefined()
    expect(seen.startStepSession).toBeUndefined()
    expect(seen.session?.change).toBeUndefined()
    expect(seen.watches).toBeUndefined()
    expect(store.doc().title).toBe("Named")
  })

  it("the host's own context is read live beneath them", () => {
    const w = world()
    const base = { repo: w.repo, element: "a" }
    const ctx = fullContext(base, memoryStore({}))
    // Read live: a view swapping the element mid-run is seen by the next call.
    base.element = "b"
    expect({ ...ctx }.element).toBe("b")
  })
})
