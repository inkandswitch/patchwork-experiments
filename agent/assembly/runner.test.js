import { describe, it, expect } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { SessionRunner, needsWork } from "../kernel/runner.js"
import { memoryStore, handleStore } from "../kernel/store.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { initSession, STATUS, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, contextBlock } from "../session/blocks.js"
import { initPlan } from "../workflow/plan.js"
import { buildToolset } from "./toolset.js"
import { NOTES_FOLDER_NAME } from "../knowledge/notes.js"
import { webScope } from "../kernel/scope.js"
import { withLedger } from "../fixtures/ledger.js"
import { AGENT } from "./agent.js"
import { statusOf } from "../session/status.js"

await initSubduction()

/**
 * A store that notifies on every change, the way a live automerge handle does.
 *
 * Views used to own the document subscription; now the runner does, so a write
 * from inside `tick()` comes straight back as a call to `tick()`. That
 * re-entrancy is the whole point of these tests.
 */
function notifyingStore(doc, onChange) {
  const inner = memoryStore(doc)
  return {
    ...inner,
    doc: () => inner.doc(),
    change: (fn, options) => {
      const result = inner.change(fn, options)
      onChange()
      return result
    },
    appendText: (path, delta) => {
      const result = inner.appendText(path, delta)
      onChange()
      return result
    },
  }
}

function pending() {
  _resetIds()
  const doc = {}
  initSession(doc, { title: "Re-entrancy", subject: "automerge:subject" })
  doc.turns = [makeTurn("user", [textBlock("hello")])]
  return doc
}

function runnerOver(store, extra = {}) {
  return new SessionRunner({
    store,
    runnerUrl: "runner-test",
    buildToolset: async () => ({ tools: [], schemas: [], get: () => null }),
    getProvider: async () => makeMock([[{ type: "text", delta: "hi" }]]),
    canRun: () => true,
    ...extra,
  })
}

describe("a runner whose own writes call it back", () => {
  it("does not re-enter itself when it claims the lease", async () => {
    // Before the guard moved ahead of the lease write, this blew the stack:
    // claim -> change -> handler -> tick -> claim -> ...
    let ticks = 0
    let store
    store = notifyingStore(pending(), () => {
      ticks++
      store && runner.tick()
    })
    const runner = runnerOver(store)

    await runner.tick()

    expect(ticks).toBeGreaterThan(0)
    expect(store.doc().turns.length).toBe(2)
  })

  it("finishes the turn rather than looping on its own changes", async () => {
    let store
    const seen = []
    store = notifyingStore(pending(), () => {
      seen.push(store.doc().turns.length)
      runner.tick()
    })
    const runner = runnerOver(store)

    await runner.tick()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(needsWork(store.doc(), () => true)).toBe(false)
    expect(runner.running).toBe(false)
    // One assistant turn, not one per change notification.
    expect(store.doc().turns.filter((t) => t.role === "assistant").length).toBe(1)
  })

  it("clears the busy flag when the lease write itself throws", async () => {
    const doc = pending()
    const store = {
      doc: () => doc,
      change: () => {
        throw new Error("document is gone")
      },
    }
    const runner = runnerOver(store)

    const result = await runner.tick()

    expect(runner.running).toBe(false)
    expect(result?.reason).toMatch(/document is gone/)
  })
})

// ------------------------------------------------------------ what a research step is told

/**
 * An account with everything a prompt could pick up — notes in the root
 * folder, a skills folder, a subject, the account itself — every one marked,
 * and a workflow whose research step runs against it on a stub model.
 */
async function account() {
  const repo = new Repo({ network: [] })
  const make = (value) => {
    const handle = repo.create({})
    handle.change((d) => Object.assign(d, value))
    return handle
  }
  const note = make({ "@patchwork": { type: "file" }, name: "packs.md", content: "# SENTINEL packs\nSENTINEL what was learned" })
  const notes = make({ "@patchwork": { type: "folder" }, title: NOTES_FOLDER_NAME, docs: [{ name: "packs.md", type: "file", url: note.url }] })
  const root = make({ "@patchwork": { type: "folder" }, title: "SENTINEL root", docs: [{ name: NOTES_FOLDER_NAME, type: "folder", url: notes.url }] })
  const skills = make({ "@patchwork": { type: "folder" }, title: "SENTINEL skills", docs: [] })
  const subject = make({ title: "SENTINEL subject" })
  const accountDoc = make({ title: "SENTINEL account", rootFolderUrl: root.url })
  const plan = make({})
  plan.change((d) => initPlan(d, { title: "P", goal: "find packs", subject: subject.url, steps: [{ id: "r", title: "R", prompt: "p", why: "w", where: "worker", tier: "fast", access: "web" }] }))
  const ledger = withLedger(repo, plan)
  const userIds = [note, notes, root, skills, subject, accountDoc].map((h) => h.documentId)
  const ctx = {
    repo,
    subject: subject.url,
    rootFolderUrl: root.url,
    skillsFolderUrl: skills.url,
    accountDocHandle: accountDoc,
    contactUrl: accountDoc.url,
    moduleSettingsUrl: accountDoc.url,
    sensitiveDocs: [accountDoc.url],
  }
  return { repo, plan, ledger, subject, ctx, userIds }
}

/** A session in that account: asked something while the person had the subject focused. */
function sessionIn(w, { scope = null, workflow = null } = {}) {
  _resetIds()
  const handle = w.repo.create({})
  handle.change((d) => {
    initSession(d, { config: { workflows: { enabled: false } } })
    if (scope) d.scope = scope
    if (workflow) d.workflow = workflow
    d.turns.push(makeTurn("user", [contextBlock({ focused: { url: w.subject.url, title: "SENTINEL subject" } }), textBlock("research packs")]))
  })
  return handle
}

async function runOnce(w, handle) {
  const provider = makeMock([[{ type: "text", delta: "done" }]])
  const runner = new SessionRunner({
    ...AGENT,
    store: handleStore(handle),
    ctx: w.ctx,
    buildToolset: (doc) => buildToolset(doc, { skipPlugins: true }),
    getProvider: async () => provider,
    canRun: () => true,
  })
  await runner.tick()
  return { provider, doc: handle.doc() }
}

describe("I5: a research step's model is told nothing of the person's", () => {
  it("no notes, no folders, no subject, no workspace note, no document id: only its prompt and the web", async () => {
    const w = await account()
    const { provider } = await runOnce(w, sessionIn(w, { scope: webScope(w.plan.url, "r"), workflow: { planUrl: w.plan.url, stepId: "r" } }))
    const sent = JSON.stringify(provider.requests)
    expect(provider.requests).toHaveLength(1)
    expect(sent).not.toContain("SENTINEL")
    // Nor the plan's or its ledger's: from the plan, everything else is reachable.
    for (const id of [...w.userIds, w.plan.documentId, w.ledger.documentId]) expect(sent).not.toContain(id)
    expect(sent).toContain("research packs")
  })

  it("while the same session unconfined is told all of it, which is how the check above can fail", async () => {
    const w = await account()
    const { provider } = await runOnce(w, sessionIn(w))
    const sent = JSON.stringify(provider.requests)
    expect(sent).toContain("SENTINEL what was learned") // the notes section
    expect(sent).toContain(w.subject.url) // the workspace note
  })
})

describe("I6: a session runs confined exactly when its scope says so, and its plan must agree", () => {
  const refused = (doc, pattern) => {
    expect(statusOf(doc)).toBe(STATUS.error)
    expect(doc.turns.at(-1).role).toBe("assistant")
    expect(doc.turns.at(-1).blocks[0].text).toMatch(pattern)
  }

  it("a malformed scope does not run, and says why", async () => {
    const w = await account()
    const { provider, doc } = await runOnce(w, sessionIn(w, { scope: { kind: "web", planUrl: w.plan.url } }))
    expect(provider.requests).toHaveLength(0)
    refused(doc, /malformed/)
  })

  it("a step its plan calls web-only, with no scope, does not run", async () => {
    const w = await account()
    const { provider, doc } = await runOnce(w, sessionIn(w, { workflow: { planUrl: w.plan.url, stepId: "r" } }))
    expect(provider.requests).toHaveLength(0)
    refused(doc, /web-only research step/)
  })

  it("a scope naming no web-only step of a real plan does not run", async () => {
    const w = await account()
    const { provider, doc } = await runOnce(w, sessionIn(w, { scope: webScope(w.plan.url, "nobody") }))
    expect(provider.requests).toHaveLength(0)
    refused(doc, /names no web-only step/)
  })

  it("a step whose plan has no ledger does not run, and none is made for it", async () => {
    const w = await account()
    w.plan.change((d) => { d.ledgerUrl = null })
    const before = w.plan.heads()
    const { provider, doc } = await runOnce(w, sessionIn(w, { scope: webScope(w.plan.url, "r"), workflow: { planUrl: w.plan.url, stepId: "r" } }))
    expect(provider.requests).toHaveLength(0)
    refused(doc, /no ledger/)
    expect(w.plan.heads()).toEqual(before)
  })

  it("a step whose plan names something else as its ledger does not run", async () => {
    const w = await account()
    w.plan.change((d) => { d.ledgerUrl = w.subject.url })
    const { provider, doc } = await runOnce(w, sessionIn(w, { scope: webScope(w.plan.url, "r"), workflow: { planUrl: w.plan.url, stepId: "r" } }))
    expect(provider.requests).toHaveLength(0)
    refused(doc, /not one/)
  })

  it("and once refused it is not work, so the runner does not try again on every change", async () => {
    const w = await account()
    const { doc } = await runOnce(w, sessionIn(w, { scope: { kind: "web" } }))
    expect(needsWork(doc)).toBe(false)
  })
})
