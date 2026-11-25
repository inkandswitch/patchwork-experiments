/**
 * A session's status and its stop are read off the document. Each is a small
 * rule over a few facts, so the cases are written out rather than sampled.
 */

import { describe, it, expect } from "vitest"
import { initSession, STATUS, CALL } from "./schema.js"
import { makeTurn, textBlock, noticeBlock, callBlock, resultBlock, eventBlock } from "./blocks.js"
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
const LEASE = { runner: "tab-a", generation: 1, at: 1 }

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

  it("none without a notice, and a nudge is not a stop", () => {
    expect(stopOf(session([user(), said()]))).toBeNull()
    expect(stopOf(session([user(), makeTurn("user", [noticeBlock("nudge", "(go on)")])]))).toBeNull()
    expect(stopOf(null)).toBeNull()
  })

  it("the last of two is the one in force", () => {
    expect(stopOf(session([user(), stop(STOP.budget), stop(STOP.halted)])).kind).toBe(STOP.halted)
  })
})

describe("status", () => {
  // Each fact a status rests on, alone.
  it.each([
    ["nothing happening", session([user(), said()]), STATUS.idle],
    ["a new session", session(), STATUS.idle],
    ["no document", null, STATUS.idle],
    ["a runner holds it", session([user()], { lease: LEASE }), STATUS.running],
    ["a question to the person", session([user(), call(CALL.asking)]), STATUS.awaitingAnswer],
    ["a call needing a yes", session([user(), call(CALL.pending)]), STATUS.awaitingApproval],
    ["a page call cleared, nobody on it", session([user(), call(CALL.approved, "host")]), STATUS.parked],
    ["a worker call cleared, nobody on it yet", session([user(), call(CALL.approved, "worker")]), STATUS.idle],
    ["waiting for the network", session([user()], { lease: LEASE, reconnecting: { reason: "offline", since: 1, attempts: 1 } }), STATUS.reconnecting],
    ["failed", session([user(), stop(STOP.error)]), STATUS.error],
    ["out of budget", session([user(), stop(STOP.budget)]), STATUS.idle],
    ["halted", session([user(), stop(STOP.halted)]), STATUS.idle],
    ["stopped by the person offline", session([user(), stop(STOP.stopped)]), STATUS.idle],
  ])("%s", (_name, doc, status) => {
    expect(statusOf(doc)).toBe(status)
  })

  // Two at once: which one shows.
  it.each([
    ["a question, while a runner still holds it", session([user(), call(CALL.asking)], { lease: LEASE }), STATUS.awaitingAnswer],
    ["a call needing a yes, while a runner still holds it", session([user(), call(CALL.pending)], { lease: LEASE }), STATUS.awaitingApproval],
    ["halted, a stale lease left behind", session([user(), stop(STOP.halted)], { lease: LEASE }), STATUS.idle],
    ["halted while it waited for the network", session([user(), stop(STOP.halted)], { reconnecting: { reason: "offline", since: 1, attempts: 1 } }), STATUS.idle],
    ["failed, then spoken to and taken up again", session([user(), stop(STOP.error), user("again")], { lease: LEASE }), STATUS.running],
    ["a page call cleared, and a runner on it", session([user(), call(CALL.approved, "host")], { lease: LEASE }), STATUS.running],
  ])("%s", (_name, doc, status) => {
    expect(statusOf(doc)).toBe(status)
  })

  it("a lease the observer judges dead is nobody running", () => {
    const doc = session([user()], { lease: LEASE })
    expect(statusOf(doc, { live: () => true })).toBe(STATUS.running)
    expect(statusOf(doc, { live: () => false })).toBe(STATUS.idle)
  })

  it("a new session stores no status", () => {
    expect("status" in session()).toBe(false)
  })
})
