import { ImmutableString } from "@automerge/automerge"
import { describe, it, expect, beforeEach } from "vitest"
import { CALL, STATUS, _resetIds, initSession, makeId } from "./schema.js"
import { DENIED_RESULT, toRequest } from "./request.js"
import { callBlock, makeTurn, reasoningBlock, resultBlock, textBlock } from "./blocks.js"
import { callsAwaitingApproval, findCall, findResult, runnableCalls, unansweredCalls } from "./calls.js"
import { canClaim, claimLease, holdsLease, leaseIsLive } from "./lease.js"
import { needsApproval as approval, askOf } from "./grants.js"
import { statusOf } from "./status.js"

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
    expect(statusOf(doc)).toBe(STATUS.idle)
    expect(doc.turns).toEqual([])
    expect(doc.burst).toBeNull()
    expect("lease" in doc).toBe(false)
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
    // Answered: a call goes in a request only with its result.
    doc.turns.push(makeTurn("tool", [resultBlock(call.id, "read")]))
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

  /** A call the person refused, as deciding writes it: the call, and the refusal as its result. */
  const refused = (id, tool = "doc_edit") => [
    makeTurn("assistant", [callBlock(tool, {}, { id, status: CALL.denied })]),
    makeTurn("tool", [resultBlock(id, DENIED_RESULT, { isError: true, summary: "declined" })]),
  ]

  it("answers a denied call with a result, in the place it happened", () => {
    const doc = freshDoc()
    doc.turns.push(...refused("c9"))
    const { messages } = toRequest(doc)

    // The call is sent AND answered, which is the shape the model already
    // understands.
    expect(messages.at(-2).content).toEqual([{ type: "call", id: "c9", name: "doc_edit", input: {} }])
    expect(messages.at(-1).content).toEqual([{ type: "result", callId: "c9", output: DENIED_RESULT, isError: true }])
  })

  it("says a denial exactly once, however many turns have passed since", () => {
    // Said at the end of every request instead, it is the last thing the model
    // reads before writing, and it reports the decline over and over.
    const doc = freshDoc()
    doc.turns.push(...refused("c9"))
    for (let i = 0; i < 6; i++) {
      doc.turns.push(makeTurn("user", [textBlock(`carry on ${i}`)]))
      doc.turns.push(makeTurn("assistant", [textBlock(`working ${i}`)]))
    }

    const rendered = JSON.stringify(toRequest(doc).messages)
    expect(rendered.split(DENIED_RESULT).length - 1).toBe(1)
  })

  it("leaves the denial where it happened rather than at the end", () => {
    const doc = freshDoc()
    doc.turns.push(...refused("c9"))
    doc.turns.push(makeTurn("user", [textBlock("do something else then")]))

    const { messages } = toRequest(doc)
    // The person's next instruction is the last thing the model sees, not a
    // re-run of the refusal.
    expect(messages.at(-1).content[0]).toMatchObject({ type: "text", text: "do something else then" })
  })

  it("keeps denials distinct when several calls were refused", () => {
    const doc = freshDoc()
    doc.turns.push(
      makeTurn("assistant", [
        callBlock("doc_edit", {}, { id: "c1", status: CALL.denied }),
        callBlock("fs_write", {}, { id: "c2", status: CALL.denied }),
      ]),
      makeTurn("tool", [resultBlock("c1", DENIED_RESULT, { isError: true }), resultBlock("c2", DENIED_RESULT, { isError: true })]),
    )
    const content = toRequest(doc).messages.at(-1).content
    expect(content.filter((p) => p.type === "result").map((p) => p.callId)).toEqual(["c1", "c2"])
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
    expect(String(findResult(doc, "c1").block.output)).toBe("ok")
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
  const needsApproval = (doc, tool) => approval(doc, tool, {}, tool ? askOf(tool, {}) : null)
  it("lets read tools run silently", () => {
    expect(needsApproval(freshDoc(), { id: "doc_read", risk: "read" })).toBe(false)
  })

  it("asks for write tools with no grant", () => {
    expect(needsApproval(freshDoc(), { id: "doc_edit", risk: "write" })).toBe(true)
  })

  it("honours a session grant", () => {
    const doc = freshDoc()
    doc.grants.doc_edit = true
    expect(needsApproval(doc, { id: "doc_edit", risk: "write" })).toBe(false)
  })

  it("ignores grants for tools flagged alwaysAsk", () => {
    const doc = freshDoc()
    doc.grants.tool_install = true
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

describe("what a result costs to keep", () => {
  // A plain string in automerge is a text CRDT — per-character structure, for
  // collaborative editing nobody does to a tool result. Measured on this
  // version: twelve 200kB screenshots cost 374MB resident and about a second
  // apiece to write and to load as plain strings, against 9MB and 13ms frozen.
  // A session with a few dozen screenshots in it was taking the browser down.
  // This is one line in resultBlock, with no local symptom if it goes away.
  test("output and image are stored frozen, not as editable text", () => {
    const block = resultBlock("c1", "ok", { image: "data:image/png;base64,AAAA" })
    expect(block.output).toBeInstanceOf(ImmutableString)
    expect(block.image).toBeInstanceOf(ImmutableString)
    expect(String(block.output)).toBe("ok")
    expect(String(block.image)).toBe("data:image/png;base64,AAAA")
  })

  test("a result with no image keeps null rather than an empty frozen string", () => {
    expect(resultBlock("c1", "ok").image).toBe(null)
  })

  // Frozen in the document, plain at the boundary: an ImmutableString is not a
  // string to a `typeof` check or to JSON.stringify, and the provider adapters
  // do both.
  test("the provider is handed plain strings", () => {
    const doc = {
      turns: [
        makeTurn("assistant", [{ type: "call", id: "c1", tool: "shot", input: {}, status: "done" }]),
        makeTurn("tool", [resultBlock("c1", "ok", { image: "data:image/png;base64,AAAA" })]),
      ],
    }
    const parts = toRequest(doc, { system: "" }).messages.flatMap((m) => m.content)
    const result = parts.find((p) => p.type === "result")
    expect(typeof result.output).toBe("string")
    expect(typeof result.image).toBe("string")
  })
})

describe("a new session's type", () => {
  it("is set by initSession, so no way of creating a session can leave it out", () => {
    const doc = {}
    initSession(doc, {})
    expect(doc["@patchwork"]).toEqual({ type: "agent-session" })
  })

  it("keeps what Patchwork already put beside it", () => {
    const doc = { "@patchwork": { mainDraftUrl: "automerge:draft" } }
    initSession(doc, {})
    expect(doc["@patchwork"]).toEqual({ mainDraftUrl: "automerge:draft", type: "agent-session" })
  })
})
