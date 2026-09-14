/**
 * Asking the person a question.
 *
 * The agent could always ask something in prose, and that mostly works — but it
 * makes the human read a paragraph, work out what the choices are, and type one
 * back. When there are three named options, three buttons are better, and the
 * answer that comes back is unambiguous rather than something the model has to
 * interpret.
 *
 * This tool never executes. It is written into the transcript with status
 * `asking`, the runner parks, and the human's answer becomes the call's result.
 * That is the whole mechanism: no new channel, no waiting inside a tool, and a
 * question that survives a reload, a navigation, or a runner handing over —
 * because like everything else here it is in the document.
 *
 * Not the same thing as an approval. An approval is "may I", answered yes or
 * no by whoever is present; a question is "which", and its answer is content
 * that goes to the model. Sharing the mechanism would mean a question could be
 * answered by someone clicking "allow".
 */

export const askUser = {
  id: "ask_user",
  name: "Ask the user",
  description: [
    "Ask the person a question and wait for their answer.",
    "",
    "Use it when you genuinely cannot choose: a decision that is theirs (which of two designs, what to call something, whether to keep going), or a fact only they have. Give `options` whenever the answers are knowable — they get buttons instead of a paragraph to read and a reply to type. They can always write something else.",
    "",
    "Do not use it to narrate, to confirm something you were already asked to do, or to check whether you may use a tool — running the tool asks for permission by itself. A question costs the person their attention; one good question beats three timid ones.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  // Never executed by a runner. See the note at the top of this file.
  asksHuman: true,
  input_schema: {
    type: "object",
    required: ["question"],
    properties: {
      question: { type: "string", description: "The question, in one sentence." },
      options: {
        type: "array",
        description: "The answers to offer as buttons. Omit when the answer is genuinely open.",
        items: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              required: ["label"],
              properties: {
                label: { type: "string", description: "Short — it goes on a button." },
                detail: { type: "string", description: "One line on what this choice means." },
              },
            },
          ],
        },
      },
      context: {
        type: "string",
        description: "Anything they need to know to answer. Keep it to a sentence or two.",
      },
    },
  },

  async execute() {
    // Reached only if something routed this to a runner, which would mean the
    // loop's parking logic is broken. Fail loudly rather than inventing an
    // answer on the person's behalf.
    throw new Error("ask_user is answered by a person, not executed. This call should have parked the session.")
  },

  summarize(input) {
    return `asked: ${String(input?.question ?? "").slice(0, 60)}`
  },
}

export default [askUser]
