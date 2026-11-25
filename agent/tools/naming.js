/**
 * Naming the work.
 *
 * A session is an ordinary Patchwork document, so it appears in the user's
 * document list alongside everything else they own. Before this it appeared
 * there as "Agent" — and a list of twenty things called "Agent" is a list you
 * cannot use. Coming back to a piece of work meant opening sessions one at a
 * time until you recognised one.
 *
 * The fallback — name it after the first thing asked — covers the case where
 * the agent never gets round to it, and is usually decent. But the first
 * message is a request, not a description: "have a look at the folder thing and
 * see if you can work out why it's slow" is what was asked, and "Folder view
 * performance" is what the work turned out to be. Only the agent knows the
 * second one, and only once it has started.
 *
 * So the agent renames it, and may rename it again. The tool writes to the
 * session's OWN document and nothing else, which is why it runs without asking:
 * stopping to request permission to name your own conversation would be an
 * absurd thing to put in front of someone.
 */

import { cleanTitle, MAX_TITLE } from "../session/title.js"

export const sessionTitleTool = {
  id: "session_title",
  needs: ["session.write"],
  name: "Name this session",
  description: [
    "Set the title of this session, so it is findable later in the user's document list.",
    "",
    "Do it once you know what the work actually is — usually after the first look, not before. Name the WORK, not the request: a few words, the way you would label a branch or a ticket. 'Tally counter tool', 'Why the folder view is slow', 'Import the 2024 invoices'. No trailing punctuation, no 'Session:' prefix.",
    "",
    "Rename it if the work turns into something else. This costs nothing and affects no document but this conversation's own.",
  ].join("\n"),
  where: "worker",
  // A write, but only ever to the session document — this conversation itself.
  // Never asked about; see session.needsApproval for why that is its own risk
  // level rather than a tool that writes claiming to be a reader.
  risk: "self",
  input_schema: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string", description: `A few words. Up to ${MAX_TITLE} characters; longer is trimmed.` },
    },
  },

  async execute(input, ctx) {
    const title = cleanTitle(input.title)
    if (!title) throw new Error("Pass a title with something in it.")

    // `ctx.session` is this conversation's own document, and the runner
    // makes it writable for this tool's calls alone (kernel/runner.js privileges).
    // The repo the tools get cannot change a session at all (kernel/scope.js
    // kernelRepo), so this is the one way a tool writes one, and this is the
    // one tool that does.
    if (!ctx.session?.change) {
      throw new Error("This runner cannot reach the session document, so the title cannot be set here.")
    }

    const before = ctx.session.doc()?.title ?? null
    if (before === title) return `Already called '${title}'.`

    ctx.session.change((doc) => {
      doc.title = title
    })
    return before ? `Renamed from '${before}' to '${title}'.` : `Named this session '${title}'.`
  },

  summarize(input) {
    return `named “${cleanTitle(input?.title) ?? ""}”`
  },
}

export default [sessionTitleTool]
