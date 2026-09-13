import { describe, it, expect } from "vitest"
import { initSession, needsApproval, grantKey, callTarget, makeTurn, callBlock, CALL, findCall } from "./session.js"
import { decide } from "./loop.js"
import { memoryStore } from "./store.js"

const fresh = () => { const d = {}; initSession(d, {}); return d }
const editTool = { id: "doc_edit", risk: "write" }

describe("callTarget", () => {
  it("prefers an explicit url", () => {
    expect(callTarget({ input: { url: "automerge:a" } }, "automerge:subject")).toBe("automerge:a")
  })
  it("falls back to root, then to the session subject", () => {
    expect(callTarget({ input: { root: "automerge:r" } }, "automerge:s")).toBe("automerge:r")
    expect(callTarget({ input: {} }, "automerge:s")).toBe("automerge:s")
  })
  it("is null when nothing identifies a document", () => {
    expect(callTarget({ input: {} }, null)).toBeNull()
  })
})

describe("scoped grants", () => {
  it("a grant for one document does not cover another", () => {
    const doc = fresh()
    doc.grants[grantKey("doc_edit", "automerge:a")] = "session"

    const onA = { input: { url: "automerge:a" } }
    const onB = { input: { url: "automerge:b" } }

    expect(needsApproval(doc, editTool, onA)).toBe(false)
    expect(needsApproval(doc, editTool, onB)).toBe(true)
  })

  it("covers calls that fall back to the subject", () => {
    const doc = fresh()
    doc.grants[grantKey("doc_edit", "automerge:subject")] = "session"
    expect(needsApproval(doc, editTool, { input: {} }, "automerge:subject")).toBe(false)
    expect(needsApproval(doc, editTool, { input: {} }, "automerge:other")).toBe(true)
  })

  it("an unscoped grant no longer covers a document-targeted call", () => {
    // This is the behaviour change: approving the tool once must not hand it
    // every document you own.
    const doc = fresh()
    doc.grants.doc_edit = "session"
    expect(needsApproval(doc, editTool, { input: { url: "automerge:a" } })).toBe(true)
  })

  it("an unscoped grant still covers a tool that targets no document", () => {
    const doc = fresh()
    doc.grants.web_search = "session"
    expect(needsApproval(doc, { id: "web_search", risk: "external" }, { input: { query: "x" } })).toBe(false)
  })

  it("still lets read tools through and still always asks for alwaysAsk tools", () => {
    const doc = fresh()
    doc.grants[grantKey("tool_install", "automerge:a")] = "always"
    expect(needsApproval(doc, { id: "doc_read", risk: "read" }, { input: {} })).toBe(false)
    expect(
      needsApproval(doc, { id: "tool_install", risk: "external", alwaysAsk: true }, { input: { url: "automerge:a" } })
    ).toBe(true)
  })
})

describe("decide records the scoped grant", () => {
  function session() {
    const doc = fresh()
    doc.turns.push(makeTurn("assistant", [callBlock("doc_edit", { url: "automerge:a" }, { id: "c1" })]))
    return memoryStore(doc)
  }

  it("writes a tool@document key for a session grant", () => {
    const store = session()
    decide(store, "c1", "session")
    expect(store.doc().grants).toEqual({ "doc_edit@automerge:a": "session" })
  })

  it("uses the subject when the call names no document", () => {
    const doc = fresh()
    doc.turns.push(makeTurn("assistant", [callBlock("doc_edit", {}, { id: "c1" })]))
    const store = memoryStore(doc)
    decide(store, "c1", "session", "automerge:subject")
    expect(store.doc().grants["doc_edit@automerge:subject"]).toBe("session")
  })

  it("grants nothing for a one-off approval", () => {
    const store = session()
    decide(store, "c1", "once")
    expect(store.doc().grants).toEqual({})
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.approved)
  })

  it("grants nothing on a denial", () => {
    const store = session()
    decide(store, "c1", "deny")
    expect(store.doc().grants).toEqual({})
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.denied)
  })
})
