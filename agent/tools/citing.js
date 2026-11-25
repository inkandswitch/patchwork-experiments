/**
 * Checking a document's citations before calling it done.
 *
 * A citation is checked when the transcript shows it, but a document the
 * agent writes — a report, a table — is read by a person later, and the agent
 * never learned when one of its quotes was not in its source. This looks up
 * every citation in a document, in its text and in its tables, and says which
 * do not hold, so they are fixed before anyone reads them.
 */

import { citationsInDocument, checkCitation } from "../documents/citations.js"

export const citationsCheck = {
  id: "citations_check",
  present: { verb: "check the citations in", detail: (i) => (i.url ? String(i.url).replace(/^automerge:/, "").slice(0, 8) + "…" : null) },
  name: "Check a document's citations",
  target: { fields: ["url"] },
  description: [
    "Check every citation in a document you wrote: each quote is looked up in the document it cites. Run it before you call a report or a table done, and fix what it lists.",
    "",
    "It finds links with quotes in any of the document's text — [label](automerge:… \"exact words\") — and tables with a source column (the automerge: URL) and a quote column (the exact words), the form a table cites in. It also counts what is marked from memory.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "The document to check: its automerge: URL." },
    },
  },
  async execute(input, ctx) {
    const url = String(input.url ?? "").trim()
    if (!url.startsWith("automerge:")) throw new Error("Pass the document's automerge: URL.")
    const doc = (await ctx.repo.find(url)).doc()
    if (!doc) throw new Error(`${url} could not be loaded.`)
    const { citations, fromMemory } = citationsInDocument(doc)
    const loaded = new Map()
    const load = async (cited) => {
      if (!loaded.has(cited)) {
        loaded.set(
          cited,
          (async () => {
            try {
              return (await ctx.repo.find(cited)).doc()
            } catch {
              return null
            }
          })()
        )
      }
      return loaded.get(cited)
    }
    const failures = []
    let found = 0
    for (const cite of citations) {
      const result = await checkCitation(cite, load)
      if (result.status === "found") found++
      else failures.push({ ...cite, ...result })
    }
    const say = {
      missing: (f) => `not in ${f.url}${f.part ? ` (no "${f.part}")` : ""}`,
      short: () => "too short to find a place by: quote more of the passage",
      unreadable: (f) => `${f.url} could not be read`,
    }
    const lines = [
      citations.length
        ? `${found} of ${citations.length} citation${citations.length === 1 ? "" : "s"} hold: the words are in the document cited.`
        : "No citations found — no [label](automerge:… \"quote\") links, and no table with source and quote columns.",
      `${fromMemory} place${fromMemory === 1 ? "" : "s"} marked from memory.`,
    ]
    if (failures.length) {
      lines.push("", "To fix (source_read with find gets the exact words):")
      for (const f of failures.slice(0, 40)) lines.push(`- ${f.where}: "${f.quote.slice(0, 80)}" — ${say[f.status]?.(f) ?? f.status}`)
      if (failures.length > 40) lines.push(`- …and ${failures.length - 40} more`)
    }
    return lines.join("\n")
  },
  summarize(input, output) {
    const match = String(output ?? "").match(/^(\d+) of (\d+) citation/)
    return match ? `${match[1]}/${match[2]} citations hold` : "no citations"
  },
}

export default [citationsCheck]
