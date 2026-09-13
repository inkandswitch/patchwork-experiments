/**
 * A scripted provider.
 *
 * Not a toy: this is how the loop, the lease, approvals, and tool routing get
 * tested without spending money or depending on a model behaving a particular
 * way this afternoon. A script is a list of turns; each turn is a list of
 * neutral events to emit, or a function that receives the request and returns
 * them (so a script can assert on what the loop actually sent).
 *
 *   const provider = makeMock([
 *     [{ type: "text", delta: "Looking..." },
 *      { type: "call", id: "c1", name: "doc_read", input: {} }],
 *     [{ type: "text", delta: "Done." }],
 *   ])
 */

export const id = "mock"
export const name = "Mock"

export function makeMock(script = [], opts = {}) {
  let turn = 0
  const seen = []

  async function* stream(request) {
    seen.push(request)
    const step = script[turn++]

    if (step === undefined) {
      yield { type: "text", delta: "(mock: script exhausted)" }
      yield { type: "stop", reason: "end" }
      return
    }

    const events = typeof step === "function" ? await step(request, turn - 1) : step

    for (const event of events) {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      yield event
    }

    // A script that forgets to stop still terminates; infer the reason from
    // whether it emitted any calls.
    if (!events.some((e) => e.type === "stop")) {
      yield { type: "stop", reason: events.some((e) => e.type === "call") ? "tool_use" : "end" }
    }
  }

  return {
    id,
    name,
    stream,
    /** Every request the loop made, in order. Assert against this. */
    requests: seen,
    get turnsUsed() {
      return turn
    },
  }
}

export default { id, name, makeMock }
