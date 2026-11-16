/**
 * Getting back an elided tool result.
 *
 * Older large results stop travelling in full — they become a one-line summary
 * and a note saying to call the tool again. But the text was never deleted: it
 * is still in the session document, exactly as it came back. Re-running the
 * call to recover it does real work, costs a turn, and for anything that has
 * changed in the meantime gives a *different* answer to the one being talked
 * about.
 *
 * So the elided text is retrievable, and deliberately not as a cache. Serving
 * a stale value in place of a fresh call would be the worst of both: the model
 * asks for the current state of a document it just edited and is handed what
 * the document said an hour ago, with nothing marking the difference. This tool
 * says plainly that it is returning history, and the agent chooses:
 *
 *   - the value as it was, for free, when the question is what the call said
 *   - the call again, when the question is what is true now
 */

export const RECALL_LIMIT = 12000

/**
 * A result up to this size is brought back by restoring it where it was, not
 * by copying it into a new result.
 *
 * Copying is what went wrong: the copy was itself a large result, shortened a
 * few turns later like the original, so the agent recalled it again — one real
 * step recalled a recall of a recall. Restoring puts the original back in full,
 * in its own place, and pins it there; the conversation carries it once.
 */
export const RESTORE_LIMIT = 40_000

/** The result a call id names, following a recall back to what it recalled. */
export function originalResult(turns, callId) {
  const results = new Map()
  const calls = new Map()
  for (const turn of turns) {
    for (const block of turn.blocks ?? []) {
      if (block.type === "result") results.set(block.callId, block)
      if (block.type === "call") calls.set(block.id, block)
    }
  }
  let id = callId
  const seen = new Set()
  while (calls.get(id)?.tool === "session_recall" && calls.get(id)?.input?.callId && !seen.has(id)) {
    seen.add(id)
    id = String(calls.get(id).input.callId).trim()
  }
  return { callId: id, result: results.get(id) ?? null, call: calls.get(id) ?? null, viaRecall: id !== callId }
}

export const sessionRecall = {
  id: "session_recall",
  name: "Recall an earlier result",
  description: [
    "Bring back the full output of an earlier tool call in this conversation, without running anything.",
    "",
    "Older large results are shortened to a summary to keep the conversation affordable. When one says it was not re-sent in full and you need what it actually said, pass the call's id: the result is restored in full where it was, and stays in full. Recalling a recall brings back the original.",
    "",
    "This is HISTORY, not a fresh answer. It is exactly what that call returned at the time. If what you need is the current state of something that may have changed since, run the tool again instead.",
    "",
    "A very long result is paged instead: use `offset` and `limit`, and the result says how much is left.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    required: ["callId"],
    properties: {
      callId: { type: "string", description: "The id of the call whose result you want, exactly as the elided result quotes it." },
      offset: { type: "number", description: "Page through a very long result from here. Default 0." },
      limit: { type: "number", description: `With offset: how many characters. Default ${RECALL_LIMIT}.` },
    },
  },

  async execute(input, ctx) {
    // Through `ctx.recall`, which the loop gives every call: this
    // conversation's transcript and nothing else of the session, the same in
    // every runner — a research step has no session URL to look it up by, and
    // needs none.
    if (typeof ctx.recall !== "function") {
      throw new Error("This runner cannot reach the conversation, so nothing can be recalled here.")
    }
    const asked = String(input.callId ?? "").trim()
    if (!asked) throw new Error("Pass the id of the call whose result you want.")

    const turns = ctx.recall() ?? []
    const { callId, result, call, viaRecall } = originalResult(turns, asked)

    if (!result) {
      const answered = turns
        .flatMap((t) => t.blocks ?? [])
        .filter((b) => b.type === "result")
        .map((b) => b.callId)
      throw new Error(
        `No result for call '${asked}' in this conversation.${
          answered.length ? ` Calls with results: ${answered.slice(-12).join(", ")}` : ""
        }`
      )
    }

    const text = String(result.output ?? "")
    const what = `${call ? call.tool : "a tool"} (call ${callId})${viaRecall ? `, which ${asked} had recalled` : ""}`
    const paging = input.offset != null || input.limit != null

    if (!paging && ctx.recall.isWhole?.(result.id)) {
      return `The result of ${what} is already in full above, ${text.length} characters, as it was at the time. Nothing to bring back.`
    }

    if (!paging && text.length <= RESTORE_LIMIT && ctx.recall.pin) {
      const { released } = ctx.recall.pin(result.id)
      return [
        `Restored the result of ${what} in full where it was above: ${text.length} characters, and it stays in full from now on.`,
        released.length ? `To make room, ${released.length} earlier restored result${released.length === 1 ? "" : "s"} went back to a summary.` : null,
        "It is what the call said at the time, not the current state.",
      ]
        .filter(Boolean)
        .join("\n")
    }

    const offset = Math.max(0, Math.min(Math.floor(input.offset ?? 0), text.length))
    const limit = Math.max(1, Math.floor(input.limit ?? RECALL_LIMIT))
    const end = Math.min(offset + limit, text.length)
    const remaining = text.length - end

    const header = [
      `${what} returned this earlier — characters ${offset}–${end} of ${text.length}.`,
      remaining ? `${remaining} remaining; recall again with offset: ${end}.` : null,
      "This is what it said at the time, not the current state.",
    ]
      .filter(Boolean)
      .join("\n")

    return `${header}\n\n${text.slice(offset, end)}`
  },

  summarize(input, output) {
    const text = String(output ?? "")
    if (text.startsWith("Restored")) return `restored ${input?.callId ?? ""} in place`
    if (text.includes("already in full above")) return `${input?.callId ?? ""} already in full`
    const range = text.match(/characters (\d+)–(\d+) of (\d+)/)
    return `recalled ${input?.callId ?? ""}${range ? ` · ${range[2] - range[1]} of ${range[3]} chars` : ""}`.trim()
  },
}

export default [sessionRecall]
