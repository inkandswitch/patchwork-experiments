import { describe, it, expect, beforeEach } from "vitest"
import {
  initSession,
  makeTurn,
  textBlock,
  callBlock,
  resultBlock,
  reasoningBlock,
  toRequest,
  findCall,
  findResult,
  unansweredCalls,
  callsAwaitingApproval,
  runnableCalls,
  needsApproval,
  leaseIsLive,
  canClaim,
  claimLease,
  holdsLease,
  makeId,
  _resetIds,
  CALL,
  STATUS,
} from "./session.js"

const freshDoc = () => {
  const doc = {}
  initSession(doc, { title: "Test" })
  return doc
}

beforeEach(_resetIds)

describe("initSession", () => {
  it("seeds a document with no undefined values", () => {
    const doc = freshDoc()
    for (const [key, value] of Object.entries(doc)) {
      expect(value, `${key} must not be undefined — automerge cannot hold it`).not.toBeUndefined()
    }
    expect(doc.status).toBe(STATUS.idle)
    expect(doc.turns).toEqual([])
    expect(doc.lease).toBeNull()
  })
})

describe("makeId", () => {
  it("does not collide within a millisecond", () => {
    const now = () => 1700000000000
    const ids = new Set(Array.from({ length: 500 }, () => makeId("b", now)))
    expect(ids.size).toBe(500)
  })
})

describe("toRequest", () => {
  it("turns turns into neutral messages", () => {
    const doc = freshDoc()
    doc.turns.push(makeTurn("user", [textBlock("hello")]))
    doc.turns.push(makeTurn("assistant", [textBlock("hi")]))

    const { messages } = toRequest(doc, { system: "sys" })
    expect(messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ])
  })

  it("drops reasoning blocks — they are not portable between models", () => {
    const doc = freshDoc()
    doc.turns.push(makeTurn("assistant", [reasoningBlock("thinking hard"), textBlock("done")]))
    const { messages } = toRequest(doc)
    expect(JSON.stringify(messages)).not.toContain("thinking hard")
    expect(messages[0].content).toEqual([{ type: "text", text: "done" }])
  })

  it("drops empty text blocks so a tool-only turn sends no empty content", () => {
    const doc = freshDoc()
    const call = callBlock("doc_read", {}, { status: CALL.done })
    doc.turns.push(makeTurn("assistant", [textBlock(""), call]))
    const { messages } = toRequest(doc)
    expect(messages[0].content).toHaveLength(1)
    expect(messages[0].content[0].type).toBe("call")
  })

  it("carries calls and results across", () => {
    const doc = freshDoc()
    const call = callBlock("doc_read", { url: "automerge:x" }, { id: "c1", status: CALL.done })
    doc.turns.push(makeTurn("assistant", [call]))
    doc.turns.push(makeTurn("tool", [resultBlock("c1", "the contents")]))

    const { messages } = toRequest(doc)
    expect(messages[0].content[0]).toMatchObject({ type: "call", id: "c1", name: "doc_read" })
    expect(messages[1].content[0]).toMatchObject({ type: "result", callId: "c1", output: "the contents" })
  })

  it("turns a denied call into a note instead of sending the call", () => {
    const doc = freshDoc()
    doc.turns.push(makeTurn("assistant", [callBlock("doc_edit", {}, { id: "c9", status: CALL.denied })]))
    const { messages } = toRequest(doc)
    expect(JSON.stringify(messages)).not.toContain('"type":"call"')
    expect(messages.at(-1).content[0].text).toMatch(/declined by the user/)
  })

  it("passes the system prompt through untouched", () => {
    expect(toRequest(freshDoc(), { system: "be terse" }).system).toBe("be terse")
  })
})

describe("call bookkeeping", () => {
  const withCall = (status) => {
    const doc = freshDoc()
    doc.turns.push(makeTurn("assistant", [callBlock("doc_edit", {}, { id: "c1", status })]))
    return doc
  }

  it("finds a call by id", () => {
    const doc = withCall(CALL.pending)
    expect(findCall(doc, "c1").block.tool).toBe("doc_edit")
    expect(findCall(doc, "nope")).toBeNull()
  })

  it("treats a call with a result as answered", () => {
    const doc = withCall(CALL.done)
    expect(unansweredCalls(doc)).toHaveLength(1)
    doc.turns.push(makeTurn("tool", [resultBlock("c1", "ok")]))
    expect(unansweredCalls(doc)).toHaveLength(0)
    expect(findResult(doc, "c1").block.output).toBe("ok")
  })

  it("separates pending from runnable", () => {
    const pending = withCall(CALL.pending)
    expect(callsAwaitingApproval(pending)).toHaveLength(1)
    expect(runnableCalls(pending)).toHaveLength(0)

    const approved = withCall(CALL.approved)
    expect(callsAwaitingApproval(approved)).toHaveLength(0)
    expect(runnableCalls(approved)).toHaveLength(1)
  })

  it("ignores denied calls entirely", () => {
    const denied = withCall(CALL.denied)
    expect(unansweredCalls(denied)).toHaveLength(0)
  })
})

describe("needsApproval", () => {
  it("lets read tools run silently", () => {
    expect(needsApproval(freshDoc(), { id: "doc_read", risk: "read" })).toBe(false)
  })

  it("asks for write tools with no grant", () => {
    expect(needsApproval(freshDoc(), { id: "doc_edit", risk: "write" })).toBe(true)
  })

  it("honours a session grant", () => {
    const doc = freshDoc()
    doc.grants.doc_edit = "session"
    expect(needsApproval(doc, { id: "doc_edit", risk: "write" })).toBe(false)
  })

  it("ignores grants for tools flagged alwaysAsk", () => {
    const doc = freshDoc()
    doc.grants.tool_install = "always"
    expect(needsApproval(doc, { id: "tool_install", risk: "write", alwaysAsk: true })).toBe(true)
  })

  it("asks when the tool is unknown", () => {
    expect(needsApproval(freshDoc(), null)).toBe(true)
  })
})

describe("the lease", () => {
  it("is live only while the heartbeat is recent", () => {
    expect(leaseIsLive({ runner: "a", at: 1000 }, { now: 5000, staleAfterMs: 15000 })).toBe(true)
    expect(leaseIsLive({ runner: "a", at: 1000 }, { now: 99000, staleAfterMs: 15000 })).toBe(false)
    expect(leaseIsLive(null)).toBe(false)
  })

  it("can be claimed when absent, ours, or stale", () => {
    const doc = freshDoc()
    expect(canClaim(doc, "runner-a")).toBe(true)

    claimLease(doc, "runner-a", 1000)
    expect(canClaim(doc, "runner-a", { now: 2000 })).toBe(true)
    expect(canClaim(doc, "runner-b", { now: 2000 })).toBe(false)
    expect(canClaim(doc, "runner-b", { now: 999999 })).toBe(true)
  })

  it("bumps the generation on takeover but not on renewal", () => {
    const doc = freshDoc()
    const first = claimLease(doc, "runner-a", 1000)
    expect(first.generation).toBe(1)

    const renewed = claimLease(doc, "runner-a", 2000)
    expect(renewed.generation).toBe(1)

    const takenOver = claimLease(doc, "runner-b", 99999)
    expect(takenOver.generation).toBe(2)
  })

  it("tells a displaced runner it no longer holds the lease", () => {
    const doc = freshDoc()
    claimLease(doc, "runner-a", 1000)
    expect(holdsLease(doc, "runner-a", 1)).toBe(true)

    claimLease(doc, "runner-b", 99999)
    expect(holdsLease(doc, "runner-a", 1)).toBe(false)
    expect(holdsLease(doc, "runner-b", 2)).toBe(true)
  })
})
