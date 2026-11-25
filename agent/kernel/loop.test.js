import { describe, it, expect, beforeEach } from "vitest"
import { run, decide, say, OUTCOME } from "./loop.js"
import { needsWork } from "./runner.js"
import { memoryStore } from "./store.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { initSession, STATUS, CALL, _resetIds } from "../session/schema.js"
import { claimLease } from "../session/lease.js"
import { makeTurn, textBlock, noticeBlock } from "../session/blocks.js"
import { findCall, callsAwaitingApproval } from "../session/calls.js"
import { settled } from "../fixtures/session.js"

// A toolset double with the same surface as tools/buildToolset.
function fakeToolset(tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return {
    tools,
    schemas: tools.map((t) => ({ id: t.id, description: t.description ?? "", input_schema: {} })),
    get: (id) => byId.get(id) ?? null,
  }
}

const readTool = (impl = async () => "file contents") => ({
  id: "doc_read",
  name: "Read",
  where: "worker",
  risk: "read",
  execute: impl,
  summarize: () => "read a doc",
})

const writeTool = (impl = async () => "edited") => ({
  id: "doc_edit",
  name: "Edit",
  where: "worker",
  risk: "write",
  execute: impl,
})

const hostTool = () => ({
  id: "dom_snapshot",
  name: "Look",
  where: "host",
  risk: "read",
  execute: async () => "<html>",
})

function session({ turns = [], runner = "runner-a" } = {}) {
  const doc = {}
  initSession(doc, { title: "Test", subject: "automerge:subject" })
  doc.turns = turns
  claimLease(doc, runner, Date.now())
  return memoryStore(doc)
}

const transcript = (store) =>
  store
    .doc()
    .turns.flatMap((t) => (t.blocks ?? []).map((b) => ({ role: t.role, ...b })))

beforeEach(_resetIds)

describe("a plain text turn", () => {
  it("streams text into the document and goes idle", async () => {
    const store = session({ turns: [makeTurn("user", [textBlock("hello")])] })
    const provider = makeMock([[{ type: "text", delta: "Hi " }, { type: "text", delta: "there." }]])

    const result = await run({
      store,
      provider,
      toolset: fakeToolset([]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
    })

    expect(result.outcome).toBe(OUTCOME.idle)
    expect(settled(store.doc())).toBe(STATUS.idle)
    const text = transcript(store).filter((b) => b.type === "text").map((b) => b.text)
    expect(text).toContain("Hi there.")
  })

  it("sends the system prompt and prior turns to the provider", async () => {
    const store = session({ turns: [makeTurn("user", [textBlock("hello")])] })
    const provider = makeMock([[{ type: "text", delta: "ok" }]])

    await run({ store, provider, toolset: fakeToolset([]), system: "You are terse.", runnerUrl: "runner-a", generation: 1, flushMs: 0 })

    const request = provider.requests[0]
    expect(request.system).toBe("You are terse.")
    expect(request.messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "hello" }] })
  })

  it("creates no empty text block when the model only calls a tool", async () => {
    const store = session({ turns: [makeTurn("user", [textBlock("read it")])] })
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_read", input: {} }],
      [{ type: "text", delta: "done" }],
    ])

    await run({
      store,
      provider,
      toolset: fakeToolset([readTool()]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
    })

    const assistantTurn = store.doc().turns.find((t) => t.role === "assistant")
    expect(assistantTurn.blocks.some((b) => b.type === "text")).toBe(false)
  })
})

describe("tool calls", () => {
  it("runs a read tool without asking, then takes another turn", async () => {
    const store = session({ turns: [makeTurn("user", [textBlock("what is in it?")])] })
    let ran = 0
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_read", input: { url: "automerge:x" } }],
      [{ type: "text", delta: "It contains a list." }],
    ])

    const result = await run({
      store,
      provider,
      toolset: fakeToolset([readTool(async () => { ran++; return "a list" })]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
    })

    expect(ran).toBe(1)
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.done)

    const results = transcript(store).filter((b) => b.type === "result")
    expect(String(results[0].output)).toBe("a list")

    // the tool result must reach the model on the next turn
    expect(JSON.stringify(provider.requests[1].messages)).toContain("a list")
  })

  it("passes the tool context through to execute", async () => {
    const store = session()
    let seen = null
    const provider = makeMock([[{ type: "call", id: "c1", name: "doc_read", input: { a: 1 } }], [{ type: "text", delta: "ok" }]])

    await run({
      store,
      provider,
      toolset: fakeToolset([readTool(async (input, ctx) => { seen = { input, ctx }; return "x" })]),
      ctx: { repo: "REPO", subject: "automerge:subject" },
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
    })

    expect(seen.input).toEqual({ a: 1 })
    expect(seen.ctx.repo).toBe("REPO")
    expect(seen.ctx.subject).toBe("automerge:subject")
  })

  it("hands each tool the session's events under its own name", async () => {
    const store = session()
    let seen = null
    const provider = makeMock([[{ type: "call", id: "c1", name: "doc_read", input: {} }], [{ type: "text", delta: "ok" }]])
    const opened = []
    const events = { forTool: (source) => ({ open: (key) => opened.push(`${source}:${key}`) }) }

    await run({
      store,
      provider,
      toolset: fakeToolset([readTool(async (input, ctx) => { seen = ctx; ctx.events.open("k"); return "x" })]),
      ctx: { events },
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
    })

    expect(opened).toEqual(["doc_read:k"])
    expect(seen.events).not.toBe(events)
  })

  it("turns a throwing tool into an error result the model can see", async () => {
    const store = session()
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_read", input: {} }],
      [{ type: "text", delta: "I see, it failed." }],
    ])

    const result = await run({
      store,
      provider,
      toolset: fakeToolset([readTool(async () => { throw new Error("no such document") })]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
    })

    expect(result.outcome).toBe(OUTCOME.idle)
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.error)
    const errorResult = transcript(store).find((b) => b.type === "result")
    expect(errorResult.isError).toBe(true)
    expect(String(errorResult.output)).toContain("no such document")
  })

  it("runs several calls from one turn and answers them all", async () => {
    const store = session()
    const provider = makeMock([
      [
        { type: "call", id: "c1", name: "doc_read", input: { n: 1 } },
        { type: "call", id: "c2", name: "doc_read", input: { n: 2 } },
      ],
      [{ type: "text", delta: "both read" }],
    ])

    await run({
      store,
      provider,
      toolset: fakeToolset([readTool(async (input) => `read ${input.n}`)]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
    })

    const outputs = transcript(store).filter((b) => b.type === "result").map((b) => String(b.output))
    expect(outputs).toEqual(["read 1", "read 2"])
  })
})

describe("approvals", () => {
  it("stops before running a write tool and records why", async () => {
    const store = session()
    let ran = 0
    const provider = makeMock([[{ type: "call", id: "c1", name: "doc_edit", input: { ops: [] } }]])

    const result = await run({
      store,
      provider,
      toolset: fakeToolset([writeTool(async () => { ran++; return "edited" })]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
    })

    expect(result.outcome).toBe(OUTCOME.awaitingApproval)
    expect(settled(store.doc())).toBe(STATUS.awaitingApproval)
    expect(ran).toBe(0)
    expect(callsAwaitingApproval(store.doc())).toHaveLength(1)
  })

  it("runs the call after a one-off approval, without granting future ones", async () => {
    const store = session()
    let ran = 0
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_edit", input: {} }],
      [{ type: "text", delta: "done" }],
    ])
    const toolset = fakeToolset([writeTool(async () => { ran++; return "edited" })])

    await run({ store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0 })
    decide(store, "c1", "once")
    const result = await run({ store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0 })

    expect(ran).toBe(1)
    expect(result.outcome).toBe(OUTCOME.idle)
    expect(store.doc().grants.doc_edit).toBeUndefined()
  })

  it("stops asking for the rest of the session after a grant", async () => {
    const store = session()
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_edit", input: {} }],
      [{ type: "call", id: "c2", name: "doc_edit", input: {} }],
      [{ type: "text", delta: "all done" }],
    ])
    const toolset = fakeToolset([writeTool()])

    await run({ store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0 })
    decide(store, "c1", "always")
    const result = await run({ store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0 })

    expect(store.doc().grants.doc_edit).toBe(true)
    expect(findCall(store.doc(), "c2").block.status).toBe(CALL.done)
    expect(result.outcome).toBe(OUTCOME.idle)
  })

  it("never runs a denied call, and tells the model it was declined", async () => {
    const store = session()
    let ran = 0
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_edit", input: {} }],
      [{ type: "text", delta: "understood" }],
    ])
    const toolset = fakeToolset([writeTool(async () => { ran++; return "edited" })])

    await run({ store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0 })
    decide(store, "c1", "deny")
    await run({ store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0 })

    expect(ran).toBe(0)
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.denied)

    // The model learns about it as the call's own result, once.
    const sent = JSON.stringify(provider.requests[1].messages)
    expect(sent).toContain("Declined by the user.")
    expect(sent.split("Declined by the user.").length - 1).toBe(1)
  })

  it("does not leave the session stuck after a denial", async () => {
    // The bug behind "it keeps reporting a decline": denying left status at
    // awaiting-approval with nothing runnable and no trailing user turn, so no
    // runner saw work and the model never heard about the refusal. The only way
    // forward was to type — and every nudge re-sent the pile of refusal notices.
    const store = session()
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_edit", input: {} }],
      [{ type: "text", delta: "understood, leaving it" }],
    ])
    const toolset = fakeToolset([writeTool()])

    await run({ store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0 })
    expect(settled(store.doc())).toBe(STATUS.awaitingApproval)

    decide(store, "c1", "deny")

    expect(settled(store.doc())).toBe(STATUS.idle)
    expect(needsWork(store.doc(), () => true)).toBe(true)

    // The refusal is in the document as the call's result, so the transcript
    // and the model see the same thing.
    const result = store.doc().turns.at(-1)
    expect(result.role).toBe("tool")
    expect(result.blocks[0]).toMatchObject({ callId: "c1", isError: true })
    expect(String(result.blocks[0].output)).toMatch(/^Declined by the user\./)

    await run({ store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0 })
    expect(transcript(store).map((b) => b.text).join(" ")).toContain("understood, leaving it")
    expect(settled(store.doc())).toBe(STATUS.idle)
  })

  it("does not re-announce an old denial on every later turn", async () => {
    // What the agent was doing wrong: reporting the same decline again and
    // again, because it was being told about it again and again — last, after
    // everything else, on every single turn.
    const store = session()
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_edit", input: {} }],
      [{ type: "text", delta: "understood" }],
      [{ type: "text", delta: "still going" }],
      [{ type: "text", delta: "and again" }],
    ])
    const toolset = fakeToolset([writeTool()])
    const turn = () => run({ store, provider, toolset, runnerUrl: "runner-a", generation: 1, flushMs: 0 })

    await turn()
    decide(store, "c1", "deny")
    await turn()
    say(store, "do something else")
    await turn()
    say(store, "and another thing")
    await turn()

    for (const request of provider.requests.slice(1)) {
      const sent = JSON.stringify(request.messages)
      expect(sent.split("Declined by the user.").length - 1).toBe(1)
    }

    // …and the refusal is never the last thing the model reads.
    const last = provider.requests.at(-1).messages.at(-1)
    expect(JSON.stringify(last)).not.toContain("Declined by the user.")
  })
})

describe("tiers", () => {
  it("parks rather than failing when a call needs a tab and there is none", async () => {
    const store = session()
    const provider = makeMock([[{ type: "call", id: "c1", name: "dom_snapshot", input: {} }]])

    const result = await run({
      store,
      provider,
      toolset: fakeToolset([hostTool()]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
      canRun: (where) => where === "worker",
    })

    expect(result.outcome).toBe(OUTCOME.parked)
    expect(settled(store.doc())).toBe(STATUS.parked)
    // the call is still approved and unclaimed, so a host runner can pick it up
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.approved)
  })

  it("runs the host call when a host runner takes the turn", async () => {
    const store = session()
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "dom_snapshot", input: {} }],
      [{ type: "text", delta: "I can see it" }],
    ])

    const result = await run({
      store,
      provider,
      toolset: fakeToolset([hostTool()]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
      canRun: () => true,
    })

    expect(result.outcome).toBe(OUTCOME.idle)
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.done)
  })
})

describe("the lease", () => {
  it("stands down without executing when it has been taken over", async () => {
    const store = session()
    let ran = 0
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_read", input: {} }],
      [{ type: "text", delta: "should never happen" }],
    ])

    // another runner takes over while the first is mid-turn
    const provider2 = {
      id: "racing",
      async *stream(request) {
        claimLease(store.doc(), "runner-b", Date.now())
        yield* provider.stream(request)
      },
    }

    const result = await run({
      store,
      provider: provider2,
      toolset: fakeToolset([readTool(async () => { ran++; return "x" })]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
    })

    expect(result.outcome).toBe(OUTCOME.aborted)
    expect(result.reason).toBe("lease lost")
    expect(ran).toBe(0)
  })

  it("refuses to start at all without the lease", async () => {
    const store = session({ runner: "someone-else" })
    const provider = makeMock([[{ type: "text", delta: "nope" }]])

    const result = await run({
      store,
      provider,
      toolset: fakeToolset([]),
      runnerUrl: "runner-a",
      generation: 99,
      flushMs: 0,
    })

    expect(result.outcome).toBe(OUTCOME.aborted)
    expect(store.doc().turns).toHaveLength(0)
  })

  it("does not re-run a call another runner already claimed", async () => {
    const store = session()
    let ran = 0
    // A call left in `running` by a runner that died — it must not be re-run by
    // the takeover, because its side effects may already have happened.
    store.change((d) => {
      d.turns.push(
        makeTurn("assistant", [
          {
            type: "call",
            id: "c1",
            tool: "doc_edit",
            input: {},
            where: "worker",
            status: CALL.running,
            runner: "runner-dead",
            generation: 1,
          },
        ])
      )
    })

    const provider = makeMock([[{ type: "text", delta: "carrying on" }]])
    await run({
      store,
      provider,
      toolset: fakeToolset([writeTool(async () => { ran++; return "edited" })]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
    })

    expect(ran).toBe(0)
  })
})

describe("interruption and budget", () => {
  it("stops when the signal aborts", async () => {
    const store = session()
    const controller = new AbortController()
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_read", input: {} }],
      [{ type: "text", delta: "more" }],
    ])

    const result = await run({
      store,
      provider,
      toolset: fakeToolset([
        readTool(async () => {
          controller.abort()
          return "read before the abort"
        }),
      ]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
      signal: controller.signal,
    })

    expect(result.outcome).toBe(OUTCOME.aborted)
  })

  it("stops at the turn budget instead of looping forever", async () => {
    const store = session()
    // a model that always asks for another tool call
    const provider = {
      id: "greedy",
      async *stream() {
        yield { type: "call", id: `c${Math.random()}`, name: "doc_read", input: {} }
        yield { type: "stop", reason: "tool_use" }
      },
    }

    const result = await run({
      store,
      provider,
      toolset: fakeToolset([readTool()]),
      runnerUrl: "runner-a",
      generation: 1,
      flushMs: 0,
      maxTurns: 3,
    })

    expect(result.outcome).toBe(OUTCOME.budgetExhausted)
    expect(store.doc().turns.filter((t) => t.role === "assistant")).toHaveLength(3)
  })
})

describe("a call as it is written", () => {
  it("carries how it reads in the log, from the tool that will run it", async () => {
    const store = session()
    const provider = makeMock([[{ type: "call", id: "c1", name: "doc_read", input: { n: 7 } }], [{ type: "text", delta: "done" }]])
    const tool = { ...readTool(), present: { verb: "read", detail: (input) => `entry ${input.n}` } }
    await run({ store, provider, toolset: fakeToolset([tool]), runnerUrl: "runner-a", generation: 1, flushMs: 0 })
    expect(findCall(store.doc(), "c1").block.shown).toEqual({ verb: "read", detail: "entry 7" })
  })

  it("and nothing, for a tool that does not say", async () => {
    const store = session()
    const provider = makeMock([[{ type: "call", id: "c1", name: "doc_read", input: {} }], [{ type: "text", delta: "done" }]])
    await run({ store, provider, toolset: fakeToolset([readTool()]), runnerUrl: "runner-a", generation: 1, flushMs: 0 })
    expect(findCall(store.doc(), "c1").block.shown).toBeNull()
  })
})

describe("what a call did, as data", () => {
  const once = (tool, afterCall = []) => {
    const store = session()
    const provider = makeMock([[{ type: "call", id: "c1", name: "doc_read", input: {} }], [{ type: "text", delta: "done" }]])
    return run({ store, provider, toolset: fakeToolset([tool]), afterCall, runnerUrl: "runner-a", generation: 1, flushMs: 0 }).then(() => ({ store, provider }))
  }
  const result = (store) => transcript(store).find((b) => b.type === "result")

  it("is kept on the result beside the text, given to what runs after the call, and never sent to the model", async () => {
    const seen = []
    const facts = { mountId: "mount_ab12", plugins: [{ type: "patchwork:tool", id: "tally" }] }
    const tool = { ...readTool(async () => ({ text: "Mounted.", facts })), summarize: (input, output, said) => `opened ${said.mountId}` }
    const after = async (ctx, call, ran, outcome) => (seen.push({ call: call.id, tool: ran.id, facts: outcome.facts }), "A guide.")
    const { store, provider } = await once(tool, [after])

    expect(String(result(store).output)).toBe("Mounted.\n\nA guide.")
    expect(result(store)).toMatchObject({ facts, summary: "opened mount_ab12" })
    expect(seen).toEqual([{ call: "c1", tool: "doc_read", facts }])
    expect(JSON.stringify(provider.requests[1].messages)).not.toContain("mount_ab12")
  })

  it("a hook is shown what earlier results said, this turn's included, and adds to what this one says", async () => {
    const store = session()
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "doc_read", input: {} }, { type: "call", id: "c2", name: "doc_read", input: {} }],
      [{ type: "call", id: "c3", name: "doc_read", input: {} }],
      [{ type: "text", delta: "done" }],
    ])
    const seen = []
    // Tells once, and its only memory of having told is what results say.
    const after = async (ctx, call, tool, outcome, earlier) => {
      seen.push(earlier)
      return earlier.some((facts) => facts.told) ? null : { text: "Told once.", facts: { told: true } }
    }
    const tool = readTool(async () => ({ text: "read", facts: { n: 1 } }))
    await run({ store, provider, toolset: fakeToolset([tool]), afterCall: [after], runnerUrl: "runner-a", generation: 1, flushMs: 0 })

    const results = transcript(store).filter((b) => b.type === "result")
    expect(results.map((r) => String(r.output))).toEqual(["read\n\nTold once.", "read", "read"])
    expect(results.map((r) => r.facts)).toEqual([{ n: 1, told: true }, { n: 1 }, { n: 1 }])
    expect(seen).toEqual([[], [{ n: 1, told: true }], [{ n: 1, told: true }, { n: 1 }]])
  })

  it("is null for a tool that says nothing, a plain string, or a failure", async () => {
    for (const impl of [async () => "text", async () => ({ text: "text" }), async () => { throw new Error("no") }]) {
      const { store } = await once(readTool(impl))
      expect(result(store).facts).toBeNull()
    }
  })

  it("is a copy: plain data, whatever the tool held on to", async () => {
    const held = { plugins: [{ type: "patchwork:tool", id: "tally", load: () => {} }] }
    const { store } = await once(readTool(async () => ({ text: "ok", facts: held })))
    expect(result(store).facts).toEqual({ plugins: [{ type: "patchwork:tool", id: "tally" }] })
  })
})

describe("say", () => {
  it("appends a user turn, which ends a stop", async () => {
    const store = session()
    store.change((d) => { d.turns.push(makeTurn("assistant", [noticeBlock("error", "it broke")])) })
    expect(settled(store.doc())).toBe(STATUS.error)
    say(store, "try again", "automerge:contact")

    const turn = store.doc().turns.at(-1)
    expect(turn.role).toBe("user")
    expect(turn.blocks[0].text).toBe("try again")
    expect(turn.author).toBe("automerge:contact")
    expect(settled(store.doc())).toBe(STATUS.idle)
  })
})
