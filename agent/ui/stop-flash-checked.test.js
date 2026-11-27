/**
 * A checker's cases of what the line under the composer and the Stop button
 * show after a person's Stop (ui/session-value.js, runners/ask.js), with the
 * session view mounted as the ui tests mount it, the real asker, and a task
 * client standing in for the queue: it hears the cancel late, as the real one
 * does, and rejects the ask it was waiting on with the real client's words
 * for a cancelled task. The clock is moved by hand, and the line and the
 * button are read after every change to the session, every word from the
 * queue, and every step of the clock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { initSession, _resetIds } from "../session/schema.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { STOP, stopOf } from "../session/status.js"
import { askWork, forget, CANCELLED } from "../runners/ask.js"
import { _reset } from "../runners/page.js"
import { AgentTool } from "./session-view.js"
import { standIn } from "../fixtures/task-client.js"

await initSubduction()

/** Real time, kept before the clock is faked: a step lets real work (a dynamic import) finish. */
const realTick = ((set) => () => new Promise((r) => set(r, 2)))(globalThis.setTimeout)

/** Made up. */
const QUEUE = "automerge:3vQm8zKXyT1pRwNbHc4LdFsEaGj"
const HERE = "Working on this browser… Enter to steer, Stop to interrupt"
const FAILURE = `This work needs a device with a GPU, and it could not be asked of your task queue: Invalid AutomergeUrl 'null' while opening ${QUEUE}`

/**
 * The queue, stood in. doWork lists a run of this browser's pool and has it
 * start a reply in the session; stopWork is heard by the queue `hearsCancelMs`
 * later, when the task ends cancelled and the ask waiting on it rejects as the
 * real client's does. While `failing` is set, every doWork rejects with it.
 */
function queue(handle, { hearsCancelMs = 400 } = {}) {
  const q = { view: { state: "missing", runs: [] }, listeners: new Set(), waiting: null, failing: null, asked: 0, onSay: () => {} }
  q.say = (view) => {
    q.view = view
    for (const l of [...q.listeners]) l(view)
    q.onSay(view)
  }
  q.client = {
    doWork: vi.fn(async (_repo, request) => {
      q.asked++
      if (q.failing) throw new Error(q.failing)
      const id = `run-${q.asked}`
      handle.change((d) => {
        d.burst = { run: id }
        const reply = makeTurn("assistant", [textBlock("Half a rep")])
        reply.streaming = { runner: id }
        d.turns.push(reply)
      })
      q.say({ state: "running", runs: [{ id, pool: "pool-here", start: Date.now() }], input: request.input })
      return new Promise((resolve, reject) => (q.waiting = { id, resolve, reject }))
    }),
    watchWork: vi.fn((_repo, _key, onChange) => {
      q.listeners.add(onChange)
      return () => q.listeners.delete(onChange)
    }),
    stopWork: vi.fn(async () => {
      const waiting = q.waiting
      if (!waiting) return false
      setTimeout(() => {
        q.say({ ...q.view, state: "cancelled", runs: q.view.runs.map((r) => ({ ...r, end: Date.now(), status: "cancelled" })) })
        q.waiting = null
        waiting.reject(new Error(CANCELLED))
      }, hearsCancelMs)
      return true
    }),
  }
  return q
}

/** What was shown, each run of equal readings once. */
const runsOf = (seen) => seen.map((s) => [s.hint, s.stop, s.stopped]).filter((x, i, a) => i === 0 || JSON.stringify(x) !== JSON.stringify(a[i - 1]))

let used = []
beforeEach(() => {
  _resetIds()
  document.body.replaceChildren()
  localStorage.clear()
  localStorage.setItem("patchwork-agent:key:openrouter", "sk-made-up")
  localStorage.setItem("patchwork-tasks-pool-id", "pool-here")
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
})
afterEach(() => {
  for (const cleanup of used) cleanup()
  used = []
  _reset()
  vi.useRealTimers()
})

/** The session view of a session with one message in it, a stood-in queue, and a log of what the line and Stop showed. */
function mounted(opts) {
  const repo = new Repo({ network: [] })
  const handle = repo.create()
  handle.change((d) => {
    initSession(d, {})
    d.burst = null
    d.turns.push(makeTurn("user", [textBlock("hello")]))
  })
  const q = queue(handle, opts)
  _reset(askWork, { with: standIn(q.client) })
  const element = document.createElement("div")
  document.body.append(element)
  const cleanup = AgentTool(handle, element, { repo })
  used.push(cleanup, () => forget(handle.url))
  const stopButton = element.querySelector("button[data-variant='danger']")
  const seen = []
  const read = (by) =>
    seen.push({
      by,
      hint: element.querySelector(".agent-hint").textContent,
      stop: stopButton.style.display !== "none",
      stopped: stopOf(handle.doc())?.kind ?? null,
    })
  // Read after the view has drawn: its own listeners were added first.
  handle.on("change", () => read("change"))
  q.onSay = () => read("queue")
  // Each step of the clock also lets real work finish (the asker reads the
  // catalogue of installed packages through a dynamic import).
  const step = async (ms, by = "clock") => {
    for (let t = 0; t < ms; t += 50) {
      await vi.advanceTimersByTimeAsync(50)
      await realTick()
      read(by)
    }
  }
  const send = (text) => {
    const input = element.querySelector("textarea")
    input.value = text
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  }
  return { repo, handle, element, stopButton, q, seen, read, step, send }
}

describe("a Stop mid-reply, the queue hearing it 400 ms later", () => {
  it("from the moment the stop is written: no 'Working…', no Stop, nothing said for two seconds; then a message, whose real failure is said, and the cancel never is", async () => {
    const { handle, stopButton, q, seen, step, send } = mounted()
    await step(400, "before")
    expect(q.client.doWork).toHaveBeenCalledTimes(1)
    expect(seen.at(-1)).toMatchObject({ hint: HERE, stop: true })

    stopButton.click()
    await step(2000, "after stop")
    expect(stopOf(handle.doc())?.kind).toBe(STOP.stopped)
    expect(q.client.stopWork).toHaveBeenCalledTimes(1)
    expect(q.view.state).toBe("cancelled")
    const fromStop = seen.slice(seen.findIndex((s) => s.stopped))
    expect(fromStop.length).toBeGreaterThan(40)
    // Every reading once the stop is in force, through the queue still saying "running" and then "cancelled".
    expect(fromStop.filter((s) => s.hint !== "" || s.stop)).toEqual([])
    expect(fromStop.some((s) => s.by === "queue")).toBe(true)
    // Nothing more was asked under the stop.
    expect(q.client.doWork).toHaveBeenCalledTimes(1)

    q.failing = FAILURE
    const before = seen.length
    send("go on")
    await step(1000, "after message")
    expect(q.client.doWork.mock.calls.length).toBeGreaterThanOrEqual(2)
    const afterMessage = seen.slice(before)
    expect(afterMessage.filter((s) => /cancelled/i.test(s.hint))).toEqual([])
    expect(seen.filter((s) => /could not be asked for: The task was cancelled/.test(s.hint))).toEqual([])
    const last = seen.at(-1)
    expect(last.hint).toMatch(/^The work could not be asked for: This work needs a device with a GPU, and it could not be asked of your task queue: Invalid AutomergeUrl 'null' while opening a document\. Asks again/)
    expect(last.hint).not.toContain(QUEUE.slice("automerge:".length))
    // What was shown, in order: the reply under way, the stop and nothing after it, the message, then its failure.
    expect(runsOf(seen)).toEqual([
      ["", false, null],
      ["Working… Enter to steer, Stop to interrupt", true, null],
      [HERE, true, null],
      ["", false, STOP.stopped],
      ["", false, null],
      [last.hint, false, null],
    ])
  })
})

describe("a Stop the queue hears only after the next message", () => {
  it("the cancel is never said; the ask after the task ends is made, and its real failure is said", async () => {
    const { stopButton, q, seen, step, send } = mounted({ hearsCancelMs: 1500 })
    await step(400, "before")
    stopButton.click()
    await step(300, "after stop")
    expect(seen.at(-1)).toMatchObject({ hint: "", stop: false, stopped: STOP.stopped })
    q.failing = FAILURE
    send("go on")
    await step(2000, "after message")
    expect(q.view.state).toBe("cancelled")
    expect(q.client.doWork.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(seen.filter((s) => /cancelled/i.test(s.hint))).toEqual([])
    expect(seen.at(-1).hint).toMatch(/^The work could not be asked for: This work needs a device with a GPU/)
  })
})
