/**
 * One approval, two forms: the call's own card in full, and a waiting item in
 * brief. Finite cases over what a call can ask.
 */
import { describe, it, expect } from "vitest"
import { approvalOf, drawApproval } from "./approval.js"
import { callBlock } from "../session/blocks.js"
import { CALL } from "../session/schema.js"
import { pendingCall, toolOf } from "../fixtures/asking.js"

const page = pendingCall(toolOf("web_fetch"), { url: "https://docs.python.org/3/library/os.html" }, { id: "c1" })
const untargeted = pendingCall({ id: "doc_edit", risk: "write", target: "none" }, { ops: [] }, { id: "c2" })
const always = pendingCall(toolOf("http_request"), { url: "https://api.test/x", method: "POST" }, { id: "c3" })
const unknown = callBlock("gone_tool", { url: "https://x.test/" }, { id: "c4", status: CALL.pending })

const labels = (list) => list.map((a) => a.label)

describe("the call's own card, in full", () => {
  it("says what the call is, what it is about, and its exact input", () => {
    expect(approvalOf(page).lines.map((l) => l.text)).toEqual([
      "Run web_fetch?",
      "on https://docs.python.org/3/library/os.html",
      JSON.stringify(page.input, null, 2),
    ])
    expect(approvalOf(untargeted).lines.map((l) => l.className)).toEqual(["agent-approval-title", "agent-approval-detail"])
  })

  it("answers once or not at all, and offers every standing grant from narrowest to broadest", () => {
    const card = approvalOf(page)
    expect(labels(card.answers)).toEqual(["Allow once", "Deny"])
    expect(labels(card.scopes)).toEqual(["this page", "/3/library/", "docs.python.org", "any site"])
    expect(card.scopes[2].decision).toEqual({ grant: "web@https://docs.python.org/" })
    expect([labels(approvalOf(untargeted).scopes), approvalOf(untargeted).note]).toEqual([["always"], null])
  })

  it("offers no grant for a call that asks every time, and says why", () => {
    const card = approvalOf(always)
    expect([card.scopes, card.note]).toEqual([[], "This one asks every time — it can carry your credentials or change something at the other end."])
  })

  it("offers no grant for a call that does not say what it asks", () => {
    expect([approvalOf(unknown).scopes, approvalOf(unknown).note]).toEqual([[], null])
  })
})

describe("a waiting item, in brief", () => {
  it("says what the call wants, and offers the two broadest grants between once and no", () => {
    const item = { ...page, callId: page.id }
    const brief = approvalOf(item, { brief: true })
    expect(brief.lines.map((l) => [l.tag, l.text])).toEqual([["p", "Wants to web_fetch https://docs.python.org/3/library/os.html"]])
    expect(labels(brief.answers)).toEqual(["Allow once", "Allow docs.python.org", "Allow any site", "Deny"])
    expect([brief.scopes, brief.note]).toEqual([[], null])
  })

  it("offers once and no for a call that asks every time", () => {
    expect(labels(approvalOf(always, { brief: true }).answers)).toEqual(["Allow once", "Deny"])
  })
})

describe("drawing it", () => {
  it("hands each button's decision to decide", () => {
    const chosen = []
    const { nodes } = drawApproval(approvalOf(page), (decision) => chosen.push(decision))
    const card = document.createElement("div")
    card.append(...nodes)
    for (const button of card.querySelectorAll("button")) button.click()
    expect(chosen).toEqual([
      "once",
      "deny",
      { grant: "web@https://docs.python.org/3/library/os.html" },
      { grant: "web@https://docs.python.org/3/library/" },
      { grant: "web@https://docs.python.org/" },
      { grant: "web@*" },
    ])
  })

  it("puts the note where the grants would be", () => {
    const card = document.createElement("div")
    card.append(...drawApproval(approvalOf(always), () => {}).nodes)
    expect([card.querySelector(".agent-approval-scopes"), card.querySelector(".agent-approval-note")?.textContent]).toEqual([null, approvalOf(always).note])
  })
})
