/**
 * A checker's tests of promise E's own-edit filter (tools/watch.js) when the
 * agent's edits are made in another Repo (a pool's run worker) and reach the
 * page by sync: a person's edit and the agent's own can arrive in one change
 * event, which the page judges by the heads that event added.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { handleStore } from "../kernel/store.js"
import { createEvents } from "../kernel/events.js"
import { rememberOwn } from "../kernel/own-changes.js"
import { restoreWatches } from "./watch.js"

await initSubduction()

beforeEach(() => _resetIds())

const copyIn = (handle) => new Repo({ network: [] }).import(A.save(handle.doc()), { docId: handle.documentId })

/** The page: a session watching `target` from its heads now, its events, and what woke it. */
async function page() {
  const repo = new Repo({ network: [] })
  const target = repo.create()
  target.change((d) => {
    d.a = 0
    d.b = 0
  })
  const session = repo.create()
  session.change((d) => {
    initSession(d, {})
    d.turns.push(makeTurn("user", [textBlock("watch it")]), makeTurn("assistant", [textBlock("watching")]))
    d.burst = null
    d.watches = { w1: { url: target.url, path: [], match: null, label: null, heads: [...target.heads()], at: 1 } }
  })
  const store = handleStore(session)
  const woke = []
  const events = createEvents(store, { policy: { settleMs: 5, maxDelayMs: 20, minGapMs: 0 }, onWake: () => woke.push(JSON.stringify(session.doc().turns.at(-1).blocks)) })
  const restored = await restoreWatches({ repo, events, store })
  expect(restored.map((r) => r.ok)).toEqual([true])
  return { repo, target, session, events, woke }
}

describe("a person's edit and the agent's own, reaching the page together", () => {
  // Found by the step 4 checker (an event was judged own by the heads it
  // added alone); fixed: every change the event brought is judged.
  it("the person's edit, which the agent's write was made on top of, still wakes the session", async () => {
    const { target, session, events, woke } = await page()
    // The pool's copy hears a person's edit first, and the agent edits on top of it.
    const person = copyIn(target)
    person.change((d) => (d.a = 1))
    const worker = copyIn(target)
    worker.merge(person)
    const before = A.getHeads(worker.doc())
    worker.change((d) => (d.b = 1))
    const own = A.getHeads(worker.doc()).filter((h) => !before.includes(h))
    // The run reports its hash (progress), and the page has it before the edits arrive.
    rememberOwn(session.url, own)
    // Both arrive in one sync.
    target.merge(worker)
    await new Promise((r) => setTimeout(r, 150))
    expect(woke.some((text) => text.includes("/a"))).toBe(true)
    events.stop()
  })

  // Found by the step 4 checker (a mixed event was reported whole); fixed:
  // only the edits of the changes that are not the session's own.
  it("the agent's own edit, arriving with a person's that was made beside it, is not reported back to it", async () => {
    const { target, session, events, woke } = await page()
    const person = copyIn(target)
    person.change((d) => (d.a = 1))
    const worker = copyIn(target)
    const before = A.getHeads(worker.doc())
    worker.change((d) => (d.b = 1))
    rememberOwn(session.url, A.getHeads(worker.doc()).filter((h) => !before.includes(h)))
    const both = copyIn(target)
    both.merge(person)
    both.merge(worker)
    target.merge(both)
    await vi.waitFor(() => expect(woke.length).toBeGreaterThan(0), { timeout: 2000 })
    expect(woke.join("")).toContain("/a")
    expect(woke.join("")).not.toContain("/b")
    events.stop()
  })
})
