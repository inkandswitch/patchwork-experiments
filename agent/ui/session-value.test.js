/**
 * What the session view shows, worked out with no DOM: finite cases, and the
 * hint line's precedence walked row by row and pair by pair.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { HINTS, hintOf, hintFacts, sessionValue, workOf, PLACEHOLDER } from "./session-value.js"
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

const LOCAL = { mode: "panel", hasKey: true, keysSettled: true, work: null, pool: null, pageTool: null, voiceStatus: null, place: null, waiting: [], subjectTitle: null, workflowTitle: null }
const value = (doc, local = {}) => sessionValue(doc, { ...LOCAL, ...local })

describe("the hint line", () => {
  // Facts under which no row applies, and for each row what makes it apply.
  const NONE = { voice: null, version: "current", outdated: false, hasKey: true, work: null, foreign: false, pageTool: null, claimed: null, parked: null, asking: 0, pending: 0, status: STATUS.idle, reason: null, failed: null }
  const ROWS = [
    ["voice", { voice: "Listening…" }, "Listening…"],
    ["earlier", { version: "earlier" }, "This session is from an earlier version of the agent and does not run. Start a new one to carry on."],
    ["outdated", { outdated: true }, "Waiting for a newer version of the agent: something in this session needs it"],
    ["no-key-elsewhere", { hasKey: false, work: "elsewhere" }, "Working on another device — this browser has no API key"],
    ["no-key", { hasKey: false }, "Add an API key to start"],
    ["asking", { asking: 1 }, "Waiting on your answer"],
    ["pending", { pending: 1 }, "1 call needs approval"],
    ["page-here", { pageTool: "view_mount" }, "Running view_mount in this page"],
    ["page-elsewhere", { claimed: "view_mount" }, "Running view_mount in another page"],
    ["foreign", { foreign: true }, "Someone else's work is under way here, or work that stopped without saying"],
    ["reconnecting", { status: STATUS.reconnecting, reason: "offline" }, "Waiting for the network; carries on when it is back (offline)"],
    ["here", { work: "here" }, "Working on this browser… Enter to steer, Stop to interrupt"],
    ["elsewhere", { work: "elsewhere" }, "Working on another device… Enter to steer, Stop to interrupt"],
    ["waiting", { work: "waiting" }, "Waiting for a device to take it"],
    ["failed", { failed: "Invalid AutomergeUrl: 'a document'." }, "The work could not be asked for: Invalid AutomergeUrl: 'a document'. Asks again on the next change, when a device is heard, or when the network is back"],
    ["parked", { status: STATUS.parked, parked: "view_mount" }, "Waiting for an open page to run view_mount"],
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
    // Some pairs cannot hold at once, since a session has one status and its
    // task is in one place; and no key with work on another device is a row
    // of its own, above both.
    const exclusive = []
    for (let i = 0; i < ROWS.length; i++) {
      for (let j = i + 1; j < ROWS.length; j++) {
        const facts = { ...NONE, ...ROWS[i][1], ...ROWS[j][1] }
        const [first, second] = [HINTS[i], HINTS[j]]
        if (!first.when(facts) || !second.when(facts)) {
          exclusive.push(`${first.name}+${second.name}`)
          continue
        }
        const expected = first.name === "no-key" && second.name === "elsewhere" ? ROWS[3][2] : ROWS[i][2]
        expect([first.name, second.name, hintOf(facts)]).toEqual([first.name, second.name, expected])
      }
    }
    expect(exclusive).toEqual([
      "no-key-elsewhere+here",
      "no-key-elsewhere+waiting",
      "reconnecting+parked",
      "reconnecting+running",
      "here+elsewhere",
      "here+waiting",
      "elsewhere+waiting",
      "parked+running",
    ])
  })

  it("a session a newer agent wrote waits for one, whether it says so by its version or by a block this one cannot read", () => {
    expect(hintOf({ ...NONE, version: "newer" })).toBe(ROWS[2][2])
    expect(hintOf({ ...NONE, outdated: true })).toBe(ROWS[2][2])
  })

  it("counts answers and approvals", () => {
    expect(hintOf({ ...NONE, asking: 3 })).toBe("Waiting on 3 answers")
    expect(hintOf({ ...NONE, pending: 2 })).toBe("2 calls need approval")
    expect(hintOf({ ...NONE, status: STATUS.reconnecting })).toBe("Waiting for the network; carries on when it is back (no connection)")
    expect(hintOf({ ...NONE, status: STATUS.parked })).toBe("Waiting for an open page to run a page tool")
  })

  it("reads its facts off the document and the view's own state", () => {
    const doc = session({}, (d) => {
      d.turns.push(makeTurn("user", [textBlock("hi"), { type: "hologram" }]))
      d.turns.push(makeTurn("assistant", [callBlock("ask_user", { question: "?" }, { id: "q", status: CALL.asking }), callBlock("web_fetch", {}, { id: "p", status: CALL.pending })]))
      d.reconnecting = { reason: "offline", since: 1, attempts: 1 }
    })
    const view = { state: "running", runs: [{ id: "run-1", pool: "pool-b", start: 1 }] }
    expect(hintFacts(doc, { ...LOCAL, voiceStatus: "Listening…", hasKey: false, work: view, pool: "pool-a" })).toEqual({
      voice: "Listening…",
      version: "current",
      outdated: true,
      hasKey: false,
      work: "elsewhere",
      foreign: false,
      pageTool: null,
      claimed: null,
      parked: null,
      asking: 1,
      pending: 1,
      status: STATUS.awaitingAnswer,
      reason: "offline",
      failed: null,
    })
  })

  it("says a failed ask only while the copy shows work a run can do", () => {
    const waiting = session({}, (d) => d.turns.push(makeTurn("user", [textBlock("hi")])))
    const answered = session({}, (d) => d.turns.push(makeTurn("user", [textBlock("hi")]), makeTurn("assistant", [textBlock("hello")])))
    const local = { ...LOCAL, askFailed: "no pool was heard" }
    expect(hintFacts(waiting, local).failed).toBe("no pool was heard")
    expect(value(waiting, { askFailed: "no pool was heard" }).hint).toMatch(/^The work could not be asked for: no pool was heard\. Asks again/)
    expect(hintFacts(answered, local).failed).toBe(null)
    expect(hintFacts(waiting, LOCAL).failed).toBe(null)
  })
})

describe("where the session's task is, as the queue says", () => {
  const view = (state, runs = []) => ({ state, runs })
  it.each([
    ["nothing said yet", null, null],
    ["no task", view("missing"), null],
    ["ended", view("succeeded", [{ id: "r1", pool: "pool-a", start: 1, end: 2 }]), null],
    ["not yet taken", view("waiting"), "waiting"],
    ["its pool not heard", view("stalled", [{ id: "r1", pool: "pool-a", start: 1 }]), "waiting"],
    ["a run of this browser's pool", view("running", [{ id: "r1", pool: "pool-a", start: 1 }]), "here"],
    ["a run of another pool", view("running", [{ id: "r1", pool: "pool-b", start: 1 }]), "elsewhere"],
    ["a later run, after this browser's ended", view("running", [{ id: "r1", pool: "pool-a", start: 1, end: 2, status: "lost" }, { id: "r2", pool: "pool-b", start: 3 }]), "elsewhere"],
    ["being stopped", view("stopping", [{ id: "r1", pool: "pool-a", start: 1 }]), "here"],
  ])("%s → %s", (_name, work, where) => {
    expect(workOf(work, "pool-a")).toBe(where)
  })

  it("`burst` naming a run the queue lists is this person's; one it does not list, or before it has said, is not foreign until it has", () => {
    const doc = session({}, (d) => (d.burst = { run: "run-x" }))
    expect(hintFacts(doc, { ...LOCAL, work: null }).foreign).toBe(false)
    expect(hintFacts(doc, { ...LOCAL, work: view("running", [{ id: "run-x", pool: "pool-a", start: 1 }]) }).foreign).toBe(false)
    expect(hintFacts(doc, { ...LOCAL, work: view("missing") }).foreign).toBe(true)
    expect(value(doc, { work: view("missing") })).toMatchObject({ canTakeOver: true, canStop: true })
  })

  it("a page's claim on a call it runs is not foreign: it says the tool, in another page, and offers Take over", () => {
    const doc = session({}, (d) => {
      d.burst = { run: "claim-1" }
      d.turns.push(makeTurn("assistant", [callBlock("view_mount", {}, { id: "c1", where: "host", status: CALL.running, runner: "claim-1" })]))
    })
    const facts = hintFacts(doc, { ...LOCAL, work: view("missing") })
    expect([facts.foreign, facts.claimed]).toEqual([false, "view_mount"])
    // It may be a page that died mid-call, which nothing here can tell apart.
    expect(value(doc, { work: view("missing") })).toMatchObject({ canTakeOver: true, canStop: true })
    expect(hintFacts(doc, { ...LOCAL, work: view("missing"), pageTool: "view_mount" })).toMatchObject({ foreign: false, claimed: null, pageTool: "view_mount" })
    expect(value(doc, { work: view("missing"), pageTool: "view_mount" }).canTakeOver).toBe(false)
  })

  it("during the beat of this page's own claim (the call approved, not yet claimed) it is work in this page, not someone else's", () => {
    const doc = session({}, (d) => {
      d.burst = { run: "claim-2" }
      d.turns.push(makeTurn("assistant", [callBlock("doc_create", {}, { id: "c2", where: "host", status: CALL.approved })]))
    })
    // Another page's view, or this one's before it knows: foreign, as before.
    expect(hintFacts(doc, { ...LOCAL, work: view("missing") }).foreign).toBe(true)
    // This page's follower holds the claim.
    const facts = hintFacts(doc, { ...LOCAL, work: view("missing"), pageClaim: "claim-2" })
    expect([facts.foreign, facts.claimed, facts.pageTool]).toEqual([false, null, "doc_create"])
    expect(value(doc, { work: view("missing"), pageClaim: "claim-2" })).toMatchObject({ hint: "Running doc_create in this page", canTakeOver: false })
    // A claim this page held earlier is not this one.
    expect(hintFacts(doc, { ...LOCAL, work: view("missing"), pageClaim: "claim-old" }).foreign).toBe(true)
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
  it("can send with a key, and stop while running, waiting for the network or for a page, or while the queue says its task goes on", () => {
    expect(value(session(), { hasKey: false }).canSend).toBe(false)
    expect(value(session()).canSend).toBe(true)
    const stoppable = (fill, local = {}) => value(session({}, fill), local).canStop
    expect(stoppable(() => {})).toBe(false)
    expect(stoppable((d) => (d.burst = { run: "r" }))).toBe(true)
    expect(stoppable((d) => d.turns.push(makeTurn("assistant", [callBlock("view_mount", {}, { id: "c1", where: "host", status: CALL.approved })])))).toBe(true)
    expect(stoppable(() => {}, { work: { state: "waiting", runs: [] } })).toBe(true)
    expect(stoppable(() => {}, { work: { state: "succeeded", runs: [] } })).toBe(false)
    expect(stoppable((d) => (d.reconnecting = { reason: "offline", since: 1, attempts: 1 }))).toBe(true)
    expect(stoppable((d) => d.turns.push(makeTurn("assistant", [noticeBlock(STOP.error, "failed")])))).toBe(false)
  })

  // Seen live: right after Stop the line said "Working on this browser…" with
  // Stop again, for as long as the queue still said the task ran.
  it("a stop in force wins over what the queue says of the task, in the line and in Stop, for every place the queue may say it is", () => {
    const pool = "pool-a"
    const QUEUE_SAYS = [
      { state: "running", runs: [{ id: "r1", pool, start: 1 }] },
      { state: "running", runs: [{ id: "r1", pool: "pool-b", start: 1 }] },
      { state: "stopping", runs: [{ id: "r1", pool, start: 1 }] },
      { state: "waiting", runs: [] },
      { state: "stalled", runs: [{ id: "r1", pool, start: 1 }] },
    ]
    const STOPS = [
      [STOP.stopped, "Stopped by a person."],
      [STOP.halted, "Stopped by its workflow."],
      [STOP.error, "OpenRouter refused the API key (401). Change it in this session's settings."],
      [STOP.budget, "Stopped: this session has spent its budget."],
    ]
    for (const work of QUEUE_SAYS) {
      for (const [kind, text] of STOPS) {
        const doc = session({}, (d) => d.turns.push(makeTurn("user", [textBlock("go")]), makeTurn("assistant", [noticeBlock(kind, text)])))
        const shown = value(doc, { work, pool })
        expect(shown).toMatchObject({ work: "none", canStop: false, hint: "" })
      }
      // Once something is said after the stop, the queue is heard again.
      const spoken = session({}, (d) => d.turns.push(makeTurn("assistant", [noticeBlock(STOP.stopped, "Stopped by a person.")]), makeTurn("user", [textBlock("again")])))
      expect(value(spoken, { work, pool }).canStop).toBe(true)
    }
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
