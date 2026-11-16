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

export const sessionRecall = {
  id: "session_recall",
  name: "Recall an earlier result",
  description: [
    "Get back the full output of an earlier tool call in this conversation, without running anything.",
    "",
    "Older large results are shortened to a summary to keep the conversation affordable. When one says it was not re-sent in full and you need what it actually said, pass the call's id — shown on the call — and you get the text back as it was, for free.",
    "",
    "This is HISTORY, not a fresh answer. It is exactly what that call returned at the time. If what you need is the current state of something that may have changed since, run the tool again instead.",
    "",
    "Use `offset` and `limit` for a long one; the result says how much is left.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    required: ["callId"],
    properties: {
      callId: { type: "string", description: "The id of the call whose result you want, exactly as the elided result quotes it." },
      offset: { type: "number", description: "Start here in the stored text. Default 0." },
      limit: { type: "number", description: `How many characters. Default ${RECALL_LIMIT}.` },
    },
  },

  async execute(input, ctx) {
    // Through `ctx.recall`, which the loop gives every call: the transcript and
    // nothing else of the session, the same in every runner — a research step
    // has no session URL to look it up by, and needs none.
    if (typeof ctx.recall !== "function") {
      throw new Error("This runner cannot reach the conversation, so nothing can be recalled here.")
    }
    const callId = String(input.callId ?? "").trim()
    if (!callId) throw new Error("Pass the id of the call whose result you want.")

    const turns = ctx.recall() ?? []

    let found = null
    let call = null
    for (const turn of turns) {
      for (const block of turn.blocks ?? []) {
        if (block.type === "result" && block.callId === callId) found = block
        if (block.type === "call" && block.id === callId) call = block
      }
    }

    if (!found) {
      const answered = turns
        .flatMap((t) => t.blocks ?? [])
        .filter((b) => b.type === "result")
        .map((b) => b.callId)
      throw new Error(
        `No result for call '${callId}' in this conversation.${
          answered.length ? ` Calls with results: ${answered.slice(-12).join(", ")}` : ""
        }`
      )
    }

    const text = String(found.output ?? "")
    const offset = Math.max(0, Math.min(Math.floor(input.offset ?? 0), text.length))
    const limit = Math.max(1, Math.floor(input.limit ?? RECALL_LIMIT))
    const end = Math.min(offset + limit, text.length)
    const remaining = text.length - end

    const header = [
      `${call ? call.tool : "a tool"} returned this earlier${call ? ` (call ${callId})` : ""} — characters ${offset}–${end} of ${text.length}.`,
      remaining ? `${remaining} remaining; recall again with offset: ${end}.` : null,
      "This is what it said at the time, not the current state.",
    ]
      .filter(Boolean)
      .join("\n")

    return `${header}\n\n${text.slice(offset, end)}`
  },

  summarize(input, output) {
    const range = String(output ?? "").match(/characters (\d+)–(\d+) of (\d+)/)
    return `recalled ${input?.callId ?? ""}${range ? ` · ${range[2] - range[1]} of ${range[3]} chars` : ""}`.trim()
  },
}

export default [sessionRecall]
