import { describe, it, expect } from "vitest"
import { run, answerQuestion, OUTCOME } from "../kernel/loop.js"
import { needsWork } from "../kernel/runner.js"
import { memoryStore } from "../kernel/store.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { askUser } from "../tools/ask.js"
import { renderTranscript } from "./transcript.js"
import { initSession, STATUS, CALL, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { findCall, questionsAwaitingAnswer, questionOptions, callsAwaitingApproval } from "../session/calls.js"
import { claimLease } from "../session/lease.js"
import { settled } from "../fixtures/session.js"

function toolset(tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return { tools, schemas: tools.map((t) => ({ id: t.id, description: "", input_schema: {} })), get: (id) => byId.get(id) ?? null }
}

const editTool = {
  id: "doc_edit",
  name: "Edit",
  where: "worker",
  risk: "write",
  execute: async () => "edited",
}

function session() {
  _resetIds()
  const doc = {}
  initSession(doc, { title: "Q", subject: "automerge:subject" })
  doc.turns = [makeTurn("user", [textBlock("do the thing")])]
  claimLease(doc, "local", Date.now()) // `run` defaults runnerUrl to "local"
  return memoryStore(doc)
}

const QUESTION = {
  type: "call",
  id: "q1",
  name: "ask_user",
  input: { question: "Which layout?", options: ["Grid", "List"], context: "Both fit the data." },
}

describe("asking a question", () => {
  it("parks the session instead of executing anything", async () => {
    const store = session()
    const result = await run({
      store,
      provider: makeMock([[QUESTION]]),
      toolset: toolset([askUser, editTool]),
      canRun: () => true,
    })

    expect(result.outcome).toBe(OUTCOME.awaitingAnswer)
    expect(settled(store.doc())).toBe(STATUS.awaitingAnswer)

    const asking = questionsAwaitingAnswer(store.doc())
    expect(asking).toHaveLength(1)
    expect(asking[0].input.question).toBe("Which layout?")
    // No result: nobody executed it.
    expect(store.doc().turns.some((t) => t.role === "tool")).toBe(false)
  })

  it("is not an approval, and cannot be answered by approving it", () => {
    const store = session()
    const doc = store.doc()
    doc.turns.push(makeTurn("assistant", [{ type: "call", id: "c1", tool: "ask_user", input: { question: "?" }, status: CALL.asking }]))

    expect(callsAwaitingApproval(doc)).toHaveLength(0)
    expect(questionsAwaitingAnswer(doc)).toHaveLength(1)
  })

  it("gives no runner anything to do until it is answered", async () => {
    const store = session()
    await run({ store, provider: makeMock([[QUESTION]]), toolset: toolset([askUser]), canRun: () => true })

    expect(needsWork(store.doc(), () => true)).toBe(false)
  })

  it("records the answer as the call's result and resumes", async () => {
    const store = session()
    await run({ store, provider: makeMock([[QUESTION]]), toolset: toolset([askUser]), canRun: () => true })
    const callId = questionsAwaitingAnswer(store.doc())[0].id

    expect(answerQuestion(store, callId, "Grid", "automerge:me")).toBe(true)

    const doc = store.doc()
    expect(settled(doc)).toBe(STATUS.idle)
    expect(findCall(doc, callId).block.status).toBe(CALL.done)

    const toolTurn = doc.turns.at(-1)
    expect(toolTurn.role).toBe("tool")
    expect(toolTurn.author).toBe("automerge:me")
    expect(toolTurn.blocks[0]).toMatchObject({ type: "result", callId })
    // Stored frozen; line 119 below checks it reaches the provider as a plain string.
    expect(String(toolTurn.blocks[0].output)).toBe("Grid")

    // …and there is work again.
    expect(needsWork(doc, () => true)).toBe(true)
  })

  it("reaches the model as an ordinary tool result", async () => {
    const store = session()
    const provider = makeMock([[QUESTION], [{ type: "text", delta: "Grid it is." }]])
    await run({ store, provider, toolset: toolset([askUser]), canRun: () => true })
    answerQuestion(store, questionsAwaitingAnswer(store.doc())[0].id, "Grid")

    await run({ store, provider, toolset: toolset([askUser]), canRun: () => true })

    // The second request carries the answer as a result for the call — no
    // special-casing anywhere in the provider adapters.
    const request = provider.requests.at(-1)
    const parts = request.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    expect(parts).toContainEqual(expect.objectContaining({ type: "result", callId: "q1", output: "Grid" }))
    expect(settled(store.doc())).toBe(STATUS.idle)
  })

  it("ignores an empty answer rather than recording a blank one", async () => {
    const store = session()
    await run({ store, provider: makeMock([[QUESTION]]), toolset: toolset([askUser]), canRun: () => true })
    const callId = questionsAwaitingAnswer(store.doc())[0].id

    expect(answerQuestion(store, callId, "   ")).toBe(false)
    expect(settled(store.doc())).toBe(STATUS.awaitingAnswer)
  })

  it("cannot be answered twice", async () => {
    const store = session()
    await run({ store, provider: makeMock([[QUESTION]]), toolset: toolset([askUser]), canRun: () => true })
    const callId = questionsAwaitingAnswer(store.doc())[0].id

    expect(answerQuestion(store, callId, "Grid")).toBe(true)
    expect(answerQuestion(store, callId, "List")).toBe(false)
    expect(store.doc().turns.filter((t) => t.role === "tool")).toHaveLength(1)
  })

  it("takes precedence over a call waiting on approval", async () => {
    // Both in one turn: the question has to win, or the person is asked to
    // approve work that the answer might make pointless.
    const store = session()
    await run({
      store,
      provider: makeMock([[QUESTION, { type: "call", id: "c2", name: "doc_edit", input: { url: "automerge:subject" } }]]),
      toolset: toolset([askUser, editTool]),
      canRun: () => true,
    })

    expect(settled(store.doc())).toBe(STATUS.awaitingAnswer)
    expect(callsAwaitingApproval(store.doc())).toHaveLength(1) // still there, just not first
  })

  it("refuses to execute if anything ever routes it to a runner", async () => {
    await expect(askUser.execute({ question: "?" }, {})).rejects.toThrow(/answered by a person/)
  })
})

describe("normalizing the options", () => {
  it("accepts plain strings and objects alike", () => {
    expect(questionOptions({ input: { options: ["A", { label: "B", detail: "the other one" }] } })).toEqual([
      { label: "A", detail: null },
      { label: "B", detail: "the other one" },
    ])
  })

  it("drops anything without a label, and tolerates nonsense", () => {
    expect(questionOptions({ input: { options: ["", { detail: "no label" }, "C"] } })).toEqual([
      { label: "C", detail: null },
    ])
    expect(questionOptions({ input: { options: "not a list" } })).toEqual([])
    expect(questionOptions({})).toEqual([])
  })
})

describe("the question in the transcript", () => {
  const state = () => ({ open: new Set(), names: new Map(), subject: "automerge:subject" })

  function rendered(input) {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("assistant", [{ type: "call", id: "q1", tool: "ask_user", input, status: CALL.asking }]))
    const answers = []
    const container = document.createElement("div")
    renderTranscript(container, doc, state(), { decide: () => {}, answer: (id, text) => answers.push([id, text]) })
    return { container, answers }
  }

  it("shows the question, its context, and a button per option", () => {
    const { container } = rendered({ question: "Which layout?", options: ["Grid", "List"], context: "Both fit." })
    const card = container.querySelector(".agent-question")

    expect(card.textContent).toContain("Which layout?")
    expect(card.textContent).toContain("Both fit.")
    expect([...card.querySelectorAll(".agent-question-options button")].map((b) => b.textContent)).toEqual([
      "Grid",
      "List",
    ])
  })

  it("is visible without opening the call", () => {
    const { container } = rendered({ question: "Which?" })
    expect(container.querySelector(".agent-question").closest("details")).toBeNull()
  })

  it("answers with the option that was clicked", () => {
    const { container, answers } = rendered({ question: "Which?", options: ["Grid", "List"] })
    container.querySelectorAll(".agent-question-options button")[1].click()
    expect(answers).toEqual([["q1", "List"]])
  })

  it("always offers a way to say something else", () => {
    // The options are the agent's guess. Being forced to pick one of three
    // wrong answers is worse than being asked in prose.
    const { container, answers } = rendered({ question: "Which?", options: ["Grid", "List"] })
    const field = container.querySelector(".agent-question-other input")
    expect(field.placeholder).toMatch(/something else/)

    field.value = "neither — use a table"
    container.querySelector(".agent-question-other button").click()
    expect(answers).toEqual([["q1", "neither — use a table"]])
  })

  it("takes a free-text answer when there are no options at all", () => {
    const { container, answers } = rendered({ question: "What should I call it?" })
    expect(container.querySelectorAll(".agent-question-options button")).toHaveLength(0)

    const field = container.querySelector(".agent-question-other input")
    expect(field.placeholder).toMatch(/your answer/)
    field.value = "Ledger"
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(answers).toEqual([["q1", "Ledger"]])
  })

  it("sends nothing for an empty box", () => {
    const { container, answers } = rendered({ question: "Which?" })
    container.querySelector(".agent-question-other button").click()
    expect(answers).toEqual([])
  })

  it("renders markdown in the question", () => {
    const { container } = rendered({ question: "Use `Grid` or **List**?" })
    expect(container.querySelector(".agent-question code").textContent).toBe("Grid")
    expect(container.querySelector(".agent-question strong").textContent).toBe("List")
  })
})
