/**
 * Writing down what a research step learned.
 *
 * A research step's transcript is shortened as it goes, and its result is one
 * message at the end; what it worked out along the way was lost with the
 * turns that held it, and found again by fetching again. A finding is that
 * work kept: a markdown file the step writes as it goes, that it and its
 * sibling steps can read back with source_read, and that the person finds in
 * the workflow's Sources folder.
 *
 * Research steps only (SCOPED_ONLY_IDS): it writes through the scoped repo,
 * which can create a document or change a finding in the ledger and nothing
 * else, so there is nothing here to ask anyone about. A finding a person has
 * edited is theirs: the repo refuses to write over it, and the step writes a
 * new one instead of building on text it has not seen.
 *
 * A finding records which step wrote it, and not the plan: a research step
 * may hand any URL it holds to a site, and a finding that named the plan
 * would lead from there to everything the plan names.
 */

import { splice, updateText } from "@automerge/automerge"
import { stringifyAutomergeUrl } from "@automerge/automerge-repo"
import { documentIdOf, cleanTitle } from "../session.js"

const MODES = ["append", "replace"]

/** A title from the text's first line, when none was given. */
function titleOf(input, text) {
  const given = cleanTitle(input.title)
  if (given) return given
  const first = text.split("\n").find((line) => line.trim()) ?? ""
  return cleanTitle(first.replace(/^#+\s*/, "")) ?? "Finding"
}

/** A file name a folder can show: no slashes, and the markdown extension. */
const fileName = (title) => `${title.replace(/[\\/]/g, "-")}.md`

/** The canonical URLs of what a finding cites, every one a member of the ledger, or a refusal naming the first that is not. */
function citations(cites, members) {
  const out = []
  for (const cite of cites ?? []) {
    const id = documentIdOf(cite)
    if (!id || !members.has(id)) {
      throw new Error(`'${cite}' is not one of this workflow's sources. Cite the automerge: URLs that source_list or a fetch result gave you.`)
    }
    const url = stringifyAutomergeUrl({ documentId: id })
    if (!out.includes(url)) out.push(url)
  }
  return out
}

export const findingWrite = {
  id: "finding_write",
  name: "Write down a finding",
  target: "none",
  description: [
    "Write down something you have learned, as you go, so it is kept: a short markdown note of what you found and why you believe it, citing the kept sources it rests on. You, the other research steps of this workflow and the person can read it later (source_read, source_list), and it survives when older results in this conversation are shortened.",
    "",
    "Without `finding` it writes a new one. With `finding` it adds to one already written (or, with mode 'replace', rewrites it). A finding someone else has edited since cannot be written over: write a new one.",
  ].join("\n"),
  where: "worker",
  // It only ever makes a document of its own or changes a finding in the
  // workflow's ledger: nothing of the person's, and nothing to ask about.
  risk: "self",
  input_schema: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string", description: "The finding, in markdown: what you learned, and why you believe it." },
      title: { type: "string", description: "What it is about, in a few words. Defaults to the text's first line; with `finding`, renames it." },
      finding: { type: "string", description: "The automerge: URL of a finding already written, to add to or rewrite. Omit to write a new one." },
      mode: { type: "string", enum: MODES, description: "With `finding`: 'append' (the default) adds the text at the end; 'replace' rewrites the finding." },
      cites: {
        type: "array",
        items: { type: "string" },
        description: "automerge: URLs of the kept sources or findings this rests on, as source_list or a fetch result gave them.",
      },
    },
  },

  async execute(input, ctx) {
    if (!ctx.scope || typeof ctx.repo?.sources !== "function") {
      throw new Error("finding_write keeps what a research step learns; this session is not one.")
    }
    const text = String(input.text ?? "")
    if (!text.trim()) throw new Error("Pass the finding's `text`.")
    const mode = input.mode == null ? "append" : String(input.mode)
    if (!MODES.includes(mode)) throw new Error(`'mode' must be one of ${MODES.join(", ")}.`)
    const cites = citations(input.cites, new Set(ctx.repo.sources().map((entry) => entry.id)))

    if (input.finding == null || input.finding === "") {
      const title = titleOf(input, text)
      const handle = await ctx.repo.create2()
      handle.change((d) => {
        d["@patchwork"] = { type: "file" }
        d.name = fileName(title)
        d.extension = "md"
        d.mimeType = "text/markdown"
        d.role = "finding"
        // Collaborative text, unlike a kept source's: people may edit it.
        d.content = text
        d.cites = cites
        d.by = { stepId: ctx.scope.stepId }
      })
      return {
        text: `Kept finding '${title}' at ${handle.url} (${text.length} chars). Cite it in your result.`,
        doc: { url: handle.url, name: fileName(title), kind: "finding", bytes: text.length },
      }
    }

    const handle = await ctx.repo.find(input.finding)
    if (typeof handle.change !== "function" || handle.doc()?.role !== "finding") {
      throw new Error(`${input.finding} is a kept source, not a finding. Write a new finding that cites it.`)
    }
    const title = cleanTitle(input.title)
    handle.change((d) => {
      const current = typeof d.content === "string" ? d.content : null
      if (current == null) {
        // Not collaborative text any more (a person replaced it); start it again.
        d.content = text
      } else if (mode === "replace") {
        updateText(d, ["content"], text)
      } else {
        const joint = !current ? "" : current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n"
        splice(d, ["content"], current.length, 0, joint + text)
      }
      if (title) d.name = fileName(title)
      if (!Array.isArray(d.cites)) d.cites = []
      for (const url of cites) if (!d.cites.includes(url)) d.cites.push(url)
    })
    const after = handle.doc()
    const name = String(after.name ?? "finding").replace(/\.md$/i, "")
    const length = String(after.content ?? "").length
    return {
      text: `Kept finding '${name}' at ${handle.url} (${length} chars). Cite it in your result.`,
      doc: { url: handle.url, name: after.name ?? "finding", kind: "finding", bytes: length },
    }
  },

  summarize(input, output) {
    const kept = String(output ?? "").match(/^Kept finding '([^']+)'/)
    const verb = !input?.finding ? "kept finding" : input?.mode === "replace" ? "rewrote finding" : "added to finding"
    return kept ? `${verb} · ${kept[1]}` : verb
  },
}

export default [findingWrite]
