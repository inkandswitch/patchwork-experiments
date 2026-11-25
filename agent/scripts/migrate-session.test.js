/**
 * The one-off migration of a session from version 1 to version 2: each thing
 * that changed, and that what it leaves reads as the session it was.
 */

import { describe, it, expect } from "vitest"
import { migrateSession } from "./migrate-session.js"
import { STATUS } from "../session/schema.js"
import { STOP, stopOf, statusOf } from "../session/status.js"
import { needsWork } from "../kernel/runner.js"
import { toRequest } from "../session/request.js"
import { unknownBlocks } from "../session/schema.js"
import { covered, grantOffers } from "../session/grants.js"
import { INTERRUPTED } from "../session/recovery.js"

const turn = (role, blocks, at = 1) => ({ id: `t${Math.random()}`, role, at, author: null, blocks })
const text = (t) => ({ type: "text", id: `b${Math.random()}`, text: t })
const v1 = (over = {}) => ({
  "@patchwork": { type: "agent-session" },
  schemaVersion: 1,
  title: "old",
  subject: null,
  config: { providerId: "openrouter", model: "m", params: {} },
  turns: [turn("user", [text("go")])],
  status: "idle",
  lease: null,
  grants: {},
  made: [],
  usage: { in: 0, out: 0, turns: 0 },
  ...over,
})

describe("a version 1 session", () => {
  it("loses its stored status and says it is version 2", () => {
    const doc = v1({ status: "running" })
    expect(migrateSession(doc)).toBe(true)
    expect("status" in doc).toBe(false)
    expect(doc.schemaVersion).toBe(2)
    expect(unknownBlocks(doc)).toEqual([])
  })

  it("is migrated once: a second pass changes nothing", () => {
    const doc = v1()
    migrateSession(doc)
    const after = JSON.stringify(doc)
    expect(migrateSession(doc)).toBe(false)
    expect(JSON.stringify(doc)).toBe(after)
  })

  it("is not touched unless it is a session", () => {
    const plan = { "@patchwork": { type: "agent-workflow" }, status: "running", steps: [] }
    expect(migrateSession(plan)).toBe(false)
    expect(plan.status).toBe("running")
  })

  // What the harness said as the agent → the stop it now records.
  it.each([
    ["⚠ OpenRouter 401: bad key", STOP.error, "OpenRouter 401: bad key", null, STATUS.error],
    ["⚠ Cut off by the model's output limit 3 times. It is spending…", STOP.error, "Cut off by the model's output limit 3 times. It is spending…", null, STATUS.error],
    ["⚠ Stopped: this session has spent its $1.00 budget ($1.20). It carries on only if it is given more.", STOP.budget, "Stopped: this session has spent its $1.00 budget ($1.20). It carries on only if it is given more.", { spent: 1.2, limit: 1 }, STATUS.idle],
    ["⚠ Stopped while waiting for the network (no relay).", STOP.stopped, "Stopped while waiting for the network (no relay).", null, STATUS.idle],
  ])("%s", (said, kind, words, data, status) => {
    const doc = v1({ status: kind === STOP.error ? "error" : "idle", stopped: kind === STOP.budget ? { reason: "budget", spent: 1.2, limit: 1, at: 5 } : null })
    doc.turns.push(turn("assistant", [text(said)], 5))
    migrateSession(doc)
    expect(doc.turns.at(-1).blocks).toEqual([expect.objectContaining({ type: "notice", kind, text: words, data })])
    expect(stopOf(doc)).toEqual({ kind, text: words, data, at: 5 })
    expect(statusOf(doc)).toBe(status)
    expect("stopped" in doc).toBe(false)
    // And the model reads what it read before.
    expect(toRequest(doc).messages.at(-1).content.at(-1).text).toBe(said)
  })

  it("a failure someone answered since is a notice, and no longer a stop", () => {
    const doc = v1({ status: "idle" })
    doc.turns.push(turn("assistant", [text("⚠ OpenRouter 500")]), turn("user", [text("again")]), turn("assistant", [text("done")]))
    migrateSession(doc)
    expect(doc.turns[1].blocks[0]).toMatchObject({ type: "notice", kind: STOP.error })
    expect(stopOf(doc)).toBeNull()
    expect(statusOf(doc)).toBe(STATUS.idle)
  })

  it("a reply of the model's own that only starts the same way is left alone", () => {
    const doc = v1()
    doc.turns.push(turn("assistant", [text("⚠ Careful: this deletes the folder."), text("Shall I?")]))
    migrateSession(doc)
    expect(doc.turns.at(-1).blocks.map((b) => b.type)).toEqual(["text", "text"])
  })

  // What the harness said as the person, to prompt the model again.
  it.each([
    ["(Your previous message was cut off by the output limit before you finished.) Continue from where you stopped. Do not restate the plan — make the tool calls.", "nudge"],
    ["(Your fs_write call was cut off before its arguments finished, so it was not run.) Make the call again, and keep the arguments small — several narrow calls are better than one that does not fit.", "nudge"],
    ["(You were repeating yourself, so your turn was stopped.) Do not deliberate further. Take the simplest option…", "nudge"],
    ["(You stopped without saying anything or calling a tool.) If the work is finished, say what you did…", "nudge"],
    ["[Your budget is now $2.50. Carry on from where you stopped.]", "budget"],
  ])("%s", (said, kind) => {
    const doc = v1()
    doc.turns.push(turn("assistant", [text("…")]), turn("user", [text(said)]))
    migrateSession(doc)
    expect(doc.turns.at(-1).blocks).toEqual([expect.objectContaining({ type: "notice", kind, text: said })])
    expect(toRequest(doc).messages.at(-1).content.at(-1).text).toBe(said)
  })

  it("what a person typed is theirs, brackets or not", () => {
    const doc = v1()
    doc.turns.push(turn("user", [text("(You were right.) Now do the other one.")]))
    migrateSession(doc)
    expect(doc.turns.at(-1).blocks[0].type).toBe("text")
  })

  it("a halted session stays halted, whatever landed after the halt, until it is spoken to", () => {
    const doc = v1({ status: "idle", halted: { reason: "cancelled by its workflow", at: 9 }, lease: { runner: "driver-1-cancel", generation: 4, at: 9 } })
    doc.turns.push(turn("tool", [{ type: "result", id: "r1", callId: "c1", output: "late", isError: false }]))
    migrateSession(doc)
    expect("halted" in doc).toBe(false)
    expect(doc.lease).toBeNull()
    expect(stopOf(doc)).toMatchObject({ kind: STOP.halted, text: "cancelled by its workflow", at: 9 })
    expect(needsWork(doc)).toBe(false)
    doc.turns.push(turn("user", [text("carry on")]))
    expect(needsWork(doc)).toBe(true)
  })

  it("a lease a runner holds is kept", () => {
    const lease = { runner: "tab-abc", generation: 2, at: 3 }
    const doc = v1({ lease })
    migrateSession(doc)
    expect(doc.lease).toEqual(lease)
  })

  it("a takeover's result for a call it found cut off says that it is one, and the call's own result is the one sent", () => {
    const doc = v1()
    doc.turns.push(
      turn("assistant", [{ type: "call", id: "c1", tool: "doc_edit", input: {}, where: "worker", status: "done", runner: null, generation: null }]),
      turn("tool", [{ type: "result", id: "r1", callId: "c1", output: INTERRUPTED, isError: true, summary: "interrupted" }]),
      turn("tool", [{ type: "result", id: "r2", callId: "c1", output: "edited", isError: false, summary: "edited" }]),
    )
    migrateSession(doc)
    expect(doc.turns[2].blocks[0].placeholder).toBe(true)
    expect(doc.turns[3].blocks[0].placeholder).toBeUndefined()
    const sent = toRequest(doc).messages.flatMap((m) => m.content).filter((part) => part.type === "result")
    expect(sent.map((part) => part.output)).toEqual(["edited"])
  })

  it("each call says how it reads in the log, where its tool can say", () => {
    const call = (id, tool, input) => ({ type: "call", id, tool, input, where: "worker", status: "done", runner: null, generation: null })
    const doc = v1({ subject: "automerge:subject" })
    doc.turns.push(turn("assistant", [call("c1", "doc_read", { url: "automerge:subject" }), call("c2", "fs_write", { path: "tally/tool.js", content: "" }), call("c3", "some_package_tool", { n: 1 })]))
    migrateSession(doc)
    expect(doc.turns.at(-1).blocks.map((b) => b.shown ?? null)).toEqual([{ verb: "read", detail: "this document" }, { verb: "write", detail: "tool.js" }, null])
  })

  it("a view_mount result says which mount it opened; no other result is read for one", () => {
    const call = (id, tool) => ({ type: "call", id, tool, input: {}, where: "host", status: "done", runner: null, generation: null })
    const result = (callId, output) => ({ type: "result", callId, output, isError: false, summary: "ok" })
    const text = "Mounted without throwing.\n\nmountId: mount_ab12cd — use view_interact / view_inspect with it, then view_unmount."
    const doc = v1()
    doc.turns.push(turn("assistant", [call("c1", "view_mount"), call("c2", "view_mount"), call("c3", "doc_read")]))
    doc.turns.push(turn("tool", [result("c1", text), result("c2", "Error: load() threw"), result("c3", text)]))
    migrateSession(doc)
    expect(doc.turns.at(-1).blocks.map((b) => b.facts ?? null)).toEqual([{ mountId: "mount_ab12cd" }, null, null])
  })

  it("a refused call that had no result gets one, where the model will read it", () => {
    const call = (id, status) => ({ type: "call", id, tool: "doc_edit", input: {}, where: "worker", status, runner: null, generation: null })
    const doc = v1()
    doc.turns.push(turn("assistant", [call("c1", "denied"), call("c2", "done")]), turn("tool", [{ type: "result", id: "r2", callId: "c2", output: "ok", isError: false }]))
    doc.turns.push(turn("assistant", [call("c3", "denied")]), turn("user", [text("never mind")]))
    migrateSession(doc)
    expect(doc.turns.map((t) => t.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "user"])
    expect(doc.turns[2].blocks.map((b) => b.callId)).toEqual(["c2", "c1"])
    expect(doc.turns[4].blocks).toEqual([expect.objectContaining({ type: "result", callId: "c3", isError: true, summary: "declined" })])
    const sent = toRequest(doc).messages.flatMap((m) => m.content).filter((part) => part.type === "result")
    expect(sent.map((part) => part.callId).sort()).toEqual(["c1", "c2", "c3"])
  })

  it("grants have one value, and one on a target is under its tool's group", () => {
    const doc = v1({ grants: { "web_fetch@https://docs.python.org/": "session", "fs_write@*": "always", "files@automerge:pkg": "always", "doc_edit@automerge:a": "session", web_search: "always", "web@*": "session" } })
    migrateSession(doc)
    expect(doc.grants).toEqual({ "web@https://docs.python.org/": true, "files@*": true, "files@automerge:pkg": true, "doc_edit@automerge:a": true, web_search: true, "web@*": true })
  })

  it("a call that was waiting still waits, with no grant offered for it or answering it", () => {
    const doc = v1({ grants: { "web@*": "always" } })
    doc.turns.push(turn("assistant", [{ type: "call", id: "c1", tool: "web_fetch", input: { url: "https://x.test/" }, where: "worker", status: "pending", runner: null, generation: null }]))
    migrateSession(doc)
    const call = doc.turns.at(-1).blocks[0]
    expect(statusOf(doc)).toBe(STATUS.awaitingApproval)
    expect(covered(doc, call)).toBe(false)
    expect(grantOffers(call)).toEqual([])
  })

  // A step's list of tools it may not have.
  it.each([
    [{ where: "worker", disabled: ["workflow_start", "workflow_add_steps", "workflow_edit_steps", "workflow_status", "workflow_stop", "workflow_reopen", "workflow_keep", "workflow_decide", "workflow_answer", "workflow_budget"] }, { where: "worker" }],
    [{ disabled: ["workflow_start", "workflow_stop"] }, undefined],
    [{ disabled: ["workflow_start", "web_fetch"] }, { disabled: ["web_fetch"] }],
    [{ enabled: ["doc_read"], disabled: [] }, { enabled: ["doc_read"] }],
    [{ enabled: ["doc_read"] }, { enabled: ["doc_read"] }],
  ])("tools %j → %j", (tools, expected) => {
    const doc = v1({ tools })
    migrateSession(doc)
    expect(doc.tools).toEqual(expected)
  })

  // A research step's scope, and a side thread's copied from one: [its scope] → what it becomes.
  it.each([
    ["none", undefined, undefined],
    ["null", null, null],
    ["a research step's", { kind: "web", ledgerUrl: "automerge:plan", stepId: "r" }, { kind: "web", planUrl: "automerge:plan", stepId: "r" }],
    ["one already naming its plan", { kind: "web", planUrl: "automerge:plan", stepId: "r" }, { kind: "web", planUrl: "automerge:plan", stepId: "r" }],
  ])("scope %s → its plan named", (_name, scope, expected) => {
    const doc = v1(scope === undefined ? {} : { scope })
    migrateSession(doc)
    expect(doc.scope).toEqual(expected)
  })
})
