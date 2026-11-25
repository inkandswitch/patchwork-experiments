/**
 * What the session view shows, worked out with no DOM: finite cases, and the
 * hint line's precedence walked row by row and pair by pair.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { HINTS, hintOf, hintFacts, sessionValue, PLACEHOLDER } from "./session-value.js"
import { initSession, CALL, STATUS, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock, callBlock, noticeBlock } from "../session/blocks.js"
import { STOP } from "../session/status.js"

beforeEach(() => _resetIds())

const session = (seed = {}, fill = () => {}) => {
  const doc = {}
  initSession(doc, seed)
  fill(doc)
  return doc
}

const LOCAL = { mode: "panel", hasKey: true, keysSettled: true, runner: "tab", elsewhere: false, voiceStatus: null, place: null, waiting: [], subjectTitle: null, workflowTitle: null }
const value = (doc, local = {}) => sessionValue(doc, { ...LOCAL, ...local })

describe("the hint line", () => {
  // Facts under which no row applies, and for each row what makes it apply.
  const NONE = { voice: null, outdated: false, hasKey: true, elsewhere: false, asking: 0, pending: 0, status: STATUS.idle, reason: null }
  const ROWS = [
    ["voice", { voice: "Listening…" }, "Listening…"],
    ["outdated", { outdated: true }, "Waiting for a newer version of the agent: something in this session needs it"],
    ["no-key-elsewhere", { hasKey: false, elsewhere: true }, "Running in another browser — this one has no API key"],
    ["no-key", { hasKey: false }, "Add an API key to start"],
    ["asking", { asking: 1 }, "Waiting on your answer"],
    ["pending", { pending: 1 }, "1 call needs approval"],
    ["elsewhere", { elsewhere: true }, "Another runner is working on this session"],
    ["parked", { status: STATUS.parked }, "Waiting for a tab to run a page tool"],
    ["reconnecting", { status: STATUS.reconnecting, reason: "offline" }, "Waiting for the network — carries on when it is back (offline)"],
    ["running", { status: STATUS.running }, "Working… Enter to steer, Stop to interrupt"],
  ]

  it("is empty when nothing applies", () => {
    expect(hintOf(NONE)).toBe("")
  })

  it("has its rows in this order", () => {
    expect(HINTS.map((row) => row.name)).toEqual(ROWS.map(([name]) => name))
  })

  it.each(ROWS)("%s, alone, says its words", (_name, facts, words) => {
    expect(hintOf({ ...NONE, ...facts })).toBe(words)
  })

  it("of any two rows that hold at once, the earlier says its words", () => {
    // Three pairs cannot hold at once, since a session has one status; and
    // no key with another runner working is a row of its own, above both.
    const exclusive = []
    for (let i = 0; i < ROWS.length; i++) {
      for (let j = i + 1; j < ROWS.length; j++) {
        const facts = { ...NONE, ...ROWS[i][1], ...ROWS[j][1] }
        const [first, second] = [HINTS[i], HINTS[j]]
        if (!first.when(facts) || !second.when(facts)) {
          exclusive.push(`${first.name}+${second.name}`)
          continue
        }
        const expected = first.name === "no-key" && second.name === "elsewhere" ? ROWS[2][2] : ROWS[i][2]
        expect([first.name, second.name, hintOf(facts)]).toEqual([first.name, second.name, expected])
      }
    }
    expect(exclusive).toEqual(["parked+reconnecting", "parked+running", "reconnecting+running"])
  })

  it("counts answers and approvals", () => {
    expect(hintOf({ ...NONE, asking: 3 })).toBe("Waiting on 3 answers")
    expect(hintOf({ ...NONE, pending: 2 })).toBe("2 calls need approval")
    expect(hintOf({ ...NONE, status: STATUS.reconnecting })).toBe("Waiting for the network — carries on when it is back (no connection)")
  })

  it("reads its facts off the document and the view's own state", () => {
    const doc = session({}, (d) => {
      d.turns.push(makeTurn("user", [textBlock("hi"), { type: "hologram" }]))
      d.turns.push(makeTurn("assistant", [callBlock("ask_user", { question: "?" }, { id: "q", status: CALL.asking }), callBlock("web_fetch", {}, { id: "p", status: CALL.pending })]))
      d.reconnecting = { reason: "offline", since: 1, attempts: 1 }
    })
    expect(hintFacts(doc, { ...LOCAL, voiceStatus: "Listening…", hasKey: false, elsewhere: true })).toEqual({
      voice: "Listening…",
      outdated: true,
      hasKey: false,
      elsewhere: true,
      asking: 1,
      pending: 1,
      status: STATUS.awaitingAnswer,
      reason: "offline",
    })
  })
})

describe("the header", () => {
  it("names the session, or else its subject, or else just Agent; the subject is in the tooltip", () => {
    const cases = [
      // [title, subject, subjectTitle] -> [text, tooltip]
      [["Soup", "automerge:s", "Recipes"], ["Soup", "Soup — on Recipes"]],
      [["Soup", "automerge:s", null], ["Soup", "Soup"]],
      [["Soup", null, null], ["Soup", "Soup"]],
      [[null, "automerge:s", "Recipes"], ["Recipes", "on Recipes"]],
      [[null, "automerge:s", null], ["Agent", ""]],
      [[null, null, null], ["Agent", ""]],
    ]
    for (const [[title, subject, subjectTitle], [text, tooltip]] of cases) {
      const v = value(session({ title, subject }), { subjectTitle })
      expect(v.title).toEqual({ text, tooltip })
    }
  })

  it("shows what was spent once anything was, with how it was counted", () => {
    expect(value(session()).cost).toBe(null)
    const charged = session({}, (d) => (d.usage = { in: 12000, out: 3400, turns: 4, cached: 8000, cost: 0.4213 }))
    expect(value(charged).cost).toEqual({ text: "$0.42", tooltip: "12,000 tokens in (8,000 from cache), 3,400 out over 4 requests · as charged by OpenRouter" })
    const estimated = session({}, (d) => (d.usage = { in: 10, out: 2, turns: 1, cost: 0.004, costEstimated: true }))
    expect(value(estimated).cost).toEqual({ text: "~<$0.01", tooltip: "10 tokens in, 2 out over 1 requests · partly estimated from list prices" })
  })

  it("labels the model by the last part of its name, with its effort", () => {
    const of = (config) => value(session({}, (d) => Object.assign(d.config, config))).model
    expect(of({ model: "~anthropic/claude-opus-latest" })).toBe("claude-opus-latest")
    expect(of({ model: "anthropic/claude-opus-5.5", params: { reasoning: { effort: "high" } } })).toBe("claude-opus-5.5 · high")
    expect(value(session({}, (d) => delete d.config.model)).model).toBe("no model")
  })

  it("links the workflow a step belongs to, or the latest one an orchestrator started", () => {
    const step = session({}, (d) => (d.workflow = { planUrl: "automerge:plan", stepId: "research", orchestratorUrl: null }))
    expect(value(step).workflow).toEqual({ url: "automerge:plan", label: "↑ Workflow", tooltip: "Open the workflow this is a step of" })
    expect(value(step, { workflowTitle: "Rig" }).workflow.tooltip).toBe("Step research of “Rig” — open the workflow")
    const orchestrator = session({}, (d) => (d.made = [{ url: "automerge:w1", kind: "agent-workflow" }, { url: "automerge:w2", kind: "agent-workflow" }]))
    expect(value(orchestrator).workflow).toEqual({ url: "automerge:w2", label: "Workflow", tooltip: "Open the workflow this session started" })
    expect(value(orchestrator, { workflowTitle: "Rig" }).workflow.tooltip).toBe("Open the workflow “Rig”")
    expect(value(session()).workflow).toBe(null)
  })
})

describe("the composer", () => {
  it("can send with a key, and stop while running or waiting for the network", () => {
    expect(value(session(), { hasKey: false }).canSend).toBe(false)
    expect(value(session()).canSend).toBe(true)
    const stoppable = (fill) => value(session({}, fill)).canStop
    expect(stoppable(() => {})).toBe(false)
    expect(stoppable((d) => (d.lease = { runner: "r", generation: 1, at: 1 }))).toBe(true)
    expect(stoppable((d) => (d.reconnecting = { reason: "offline", since: 1, attempts: 1 }))).toBe(true)
    expect(stoppable((d) => d.turns.push(makeTurn("assistant", [noticeBlock(STOP.error, "failed")])))).toBe(false)
  })

  it("says what a message to a step that takes none straight will be", () => {
    expect(value(session()).placeholder).toBe(PLACEHOLDER)
    const done = { role: "step", standing: { steer: false, reopen: true, later: [], label: "done" } }
    expect(value(session(), { place: done })).toMatchObject({ placeholder: "This step is done: ask about it, or reopen it…", gate: { reopen: true, label: "done" } })
    const running = { role: "step", standing: { steer: true, label: "running" } }
    expect(value(session(), { place: running })).toMatchObject({ placeholder: PLACEHOLDER, gate: null })
  })
})

describe("the settings panel opens itself", () => {
  it("only once the account has answered, with no key, before anything is said", () => {
    const said = session({}, (d) => d.turns.push(makeTurn("user", [textBlock("hi")])))
    for (const keysSettled of [false, true]) {
      for (const hasKey of [false, true]) {
        for (const doc of [session(), said]) {
          expect(value(doc, { keysSettled, hasKey }).openSettings).toBe(keysSettled && !hasKey && doc !== said)
        }
      }
    }
  })
})

describe("what waits on a person", () => {
  it("puts what steps wait on in the strip, and spent budgets at the end of the transcript", () => {
    const approval = { kind: "approval", callId: "c1" }
    const stepBudget = { kind: "budget", scope: "session", callId: "budget:1" }
    const planBudget = { kind: "budget", scope: "plan", callId: "plan:1" }
    const stopped = session({ config: { budget: 0.5 } }, (d) => {
      d.turns.push(makeTurn("assistant", [noticeBlock(STOP.budget, "Stopped", { spent: 0.52, limit: 0.5 })], { at: 9 }))
    })
    const v = value(stopped, { waiting: [approval, stepBudget, planBudget] })
    expect(v.strip).toEqual([approval, stepBudget])
    expect(v.inline).toEqual({ session: [{ kind: "budget", scope: "session", callId: "budget:9", spent: 0.52, limit: 0.5 }], workflows: [planBudget] })
  })
})

describe("the side pane", () => {
  it("shows the subject in the pop-out, and nothing in a panel", () => {
    expect(value(session({ subject: "automerge:s" }), { mode: "full" }).side).toBe("automerge:s")
    expect(value(session({ subject: "automerge:s" }), { mode: "panel" }).side).toBe(null)
    expect(value(session(), { mode: "full" }).side).toBe(null)
  })
})
