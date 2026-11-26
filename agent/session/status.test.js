/**
 * A session's status and its stop are read off the document. Each is a small
 * rule over a few facts, so the cases are written out rather than sampled.
 */

import { describe, it, expect } from "vitest"
import { initSession, STATUS, CALL } from "./schema.js"
import { makeTurn, textBlock, noticeBlock, callBlock, resultBlock, eventBlock, attachmentBlock, summaryBlock } from "./blocks.js"
import { STOP, stopOf, statusOf } from "./status.js"

const session = (turns = [], over = {}) => {
  const doc = {}
  initSession(doc, {})
  doc.turns = turns
  return Object.assign(doc, over)
}

const user = (text = "go") => makeTurn("user", [textBlock(text)])
const said = (text = "done") => makeTurn("assistant", [textBlock(text)])
const stop = (kind, data = null) => makeTurn("assistant", [noticeBlock(kind, `stopped: ${kind}`, data)], { at: 7 })
const call = (status, where = "worker") => makeTurn("assistant", [Object.assign(callBlock("a_tool", {}, { id: "c1", where }), { status })])
const result = () => makeTurn("tool", [resultBlock("c1", "late")])
const news = () => makeTurn("user", [eventBlock("doc_watch", "it changed")])
const BURST = { run: "run-a" }

describe("the stop in force", () => {
  it.each(Object.values(STOP))("a %s notice, with nothing said after it", (kind) => {
    expect(stopOf(session([user(), stop(kind, { n: 1 })]))).toEqual({ kind, text: `stopped: ${kind}`, data: { n: 1 }, at: 7 })
  })

  // What follows the stop → is it still in force?
  it.each([
    ["nothing", [], true],
    ["a tool's result, landing late", [result()], true],
    ["news a tool delivers", [news()], true],
    ["a reply that was already under way", [said("…")], true],
    ["all three", [result(), said("…"), news()], true],
    ["a person speaking", [user("carry on")], false],
    ["a lifted budget", [makeTurn("user", [noticeBlock("budget", "[more]")])], false],
    ["a person speaking, then more results", [user("carry on"), result()], false],
  ])("followed by %s", (_name, after, inForce) => {
    expect(stopOf(session([user(), stop(STOP.halted), ...after])) !== null).toBe(inForce)
  })

  // Every kind of stop × every kind of user-role turn after it → does the
  // stop still hold? Only a turn that says something ends one; what a run
  // writes for itself (a nudge, a summary) and a tool's news do not, so a
  // run that crosses a stop never lifts it.
  const AFTER = [
    ["a person's message", () => user("carry on"), false],
    ["a person's attachment alone", () => makeTurn("user", [attachmentBlock({ url: "automerge:attached", name: "a.png" })]), false],
    ["a reopened step's instructions", () => makeTurn("user", [textBlock("Reopened: something it is built on changed.")]), false],
    ["a lifted budget", () => makeTurn("user", [noticeBlock("budget", "[more]")]), false],
    ["a tool's news", () => news(), true],
    ["the loop's nudge", () => makeTurn("user", [noticeBlock("nudge", "(go on)")]), true],
    ["a compaction's summary", () => makeTurn("user", [summaryBlock("so far", "t0")]), true],
  ]
  const CROSS = Object.values(STOP).flatMap((kind) => AFTER.map(([name, turn, holds]) => [kind, name, turn, holds]))
  it.each(CROSS)("a %s stop, then %s → still in force: %s", (kind, _name, turn, holds) => {
    const doc = session([user(), stop(kind), turn()])
    expect(stopOf(doc)?.kind ?? null).toBe(holds ? kind : null)
  })

  it("none without a notice, and a nudge is not a stop", () => {
    expect(stopOf(session([user(), said()]))).toBeNull()
    expect(stopOf(session([user(), makeTurn("user", [noticeBlock("nudge", "(go on)")])]))).toBeNull()
    expect(stopOf(null)).toBeNull()
  })

  it("the last of two is the one in force", () => {
    expect(stopOf(session([user(), stop(STOP.budget), stop(STOP.halted)])).kind).toBe(STOP.halted)
  })

  // Every kind of stop × every kind after it, with nothing said between (or
  // only what a run writes for itself), and with a person speaking between.
  // A run that had not heard a person's or a workflow's stop can fail or run
  // out after it; its notice never takes that stop's place.
  const OUTSIDE = new Set([STOP.stopped, STOP.halted])
  const RUNS_OWN = new Set([STOP.error, STOP.budget])
  const BETWEEN = [
    ["nothing", () => [], false],
    ["a late result and a nudge", () => [result(), makeTurn("user", [noticeBlock("nudge", "(go on)")])], false],
    ["a person speaking", () => [user("carry on")], true],
  ]
  const PAIRS = Object.values(STOP).flatMap((first) => Object.values(STOP).flatMap((second) => BETWEEN.map(([name, between, spoken]) => [first, name, second, between, spoken])))
  it.each(PAIRS)("a %s stop, then %s, then a %s stop", (first, _name, second, between, spoken) => {
    const earlier = Object.assign(stop(first), { at: 1 })
    const later = Object.assign(stop(second), { at: 2 })
    const kept = !spoken && OUTSIDE.has(first) && RUNS_OWN.has(second)
    expect(stopOf(session([user(), earlier, ...between(), later]))).toMatchObject({ kind: kept ? first : second, at: kept ? 1 : 2 })
  })
})

describe("status", () => {
  // Each fact a status rests on, alone.
  it.each([
    ["nothing happening", session([user(), said()]), STATUS.idle],
    ["a new session", session(), STATUS.idle],
    ["no document", null, STATUS.idle],
    ["a burst is marked on it", session([user()], { burst: BURST }), STATUS.running],
    ["a question to the person", session([user(), call(CALL.asking)]), STATUS.awaitingAnswer],
    ["a call needing a yes", session([user(), call(CALL.pending)]), STATUS.awaitingApproval],
    ["a page call cleared, nobody on it", session([user(), call(CALL.approved, "host")]), STATUS.parked],
    ["a worker call cleared, nobody on it yet", session([user(), call(CALL.approved, "worker")]), STATUS.idle],
    ["waiting for the network", session([user()], { burst: BURST, reconnecting: { reason: "offline", since: 1, attempts: 1 } }), STATUS.reconnecting],
    ["failed", session([user(), stop(STOP.error)]), STATUS.error],
    ["out of budget", session([user(), stop(STOP.budget)]), STATUS.idle],
    ["halted", session([user(), stop(STOP.halted)]), STATUS.idle],
    ["stopped by a person", session([user(), stop(STOP.stopped)]), STATUS.idle],
  ])("%s", (_name, doc, status) => {
    expect(statusOf(doc)).toBe(status)
  })

  // Two at once: which one shows.
  it.each([
    ["a question, while a burst is still marked", session([user(), call(CALL.asking)], { burst: BURST }), STATUS.awaitingAnswer],
    ["a call needing a yes, while a burst is still marked", session([user(), call(CALL.pending)], { burst: BURST }), STATUS.awaitingApproval],
    ["halted, a burst mark left behind", session([user(), stop(STOP.halted)], { burst: BURST }), STATUS.idle],
    ["stopped by a person, a run elsewhere not yet told", session([user(), stop(STOP.stopped)], { burst: BURST }), STATUS.idle],
    ["stopped by a person, then a nudge from a run that had not heard", session([user(), stop(STOP.stopped), makeTurn("user", [noticeBlock("nudge", "(go on)")])]), STATUS.idle],
    ["halted while it waited for the network", session([user(), stop(STOP.halted)], { reconnecting: { reason: "offline", since: 1, attempts: 1 } }), STATUS.idle],
    ["failed, then spoken to and taken up again", session([user(), stop(STOP.error), user("again")], { burst: BURST }), STATUS.running],
    ["a page call cleared, and a page's claim on it", session([user(), call(CALL.approved, "host")], { burst: BURST }), STATUS.running],
  ])("%s", (_name, doc, status) => {
    expect(statusOf(doc)).toBe(status)
  })

  it("a lease an older version wrote is read by nobody", () => {
    const doc = session([user()], { lease: { runner: "tab-a", generation: 1, at: 1 } })
    expect(statusOf(doc)).toBe(STATUS.idle)
  })

  it("a new session stores no status", () => {
    expect("status" in session()).toBe(false)
  })
})
