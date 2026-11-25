/**
 * What a tool call looks like in the log.
 *
 * A transcript is mostly tool calls, and for a long time they read as the raw
 * tool id beside whichever input field happened to be present — `view_interact`
 * next to a CSS selector, `package_build` next to a 50-character automerge URL.
 * That is a dump of the arguments, not a description of what happened.
 *
 * So every tool gets an entry here: a verb a person would use, and a detail
 * drawn from the field that actually says what the call was *about*. Pure
 * functions of (input, result) — the view has the session document and nothing
 * else, so presentation cannot live on the tool definitions, which are in
 * another realm entirely.
 *
 * Three rules the entries follow:
 *
 *   - Never show a bare automerge URL. Fifty characters of base58 tell a reader
 *     nothing; "this document" or a file name tells them everything.
 *   - Say what was touched *within* the thing, not the thing. `doc_edit` is
 *     interesting because of which fields it changed.
 *   - A tool with no entry still renders: it falls back to its id and its
 *     most plausible input. Adding a tool must not produce a broken line.
 */

/** A document URL, for callers who want to decide how to show it. */
const AUTOMERGE = /^automerge:/

export function isDocUrl(value) {
  return typeof value === "string" && AUTOMERGE.test(value)
}

/** A short, readable stand-in for a document URL. */
export function shortDoc(url, subject = null) {
  if (!isDocUrl(url)) return String(url ?? "")
  if (subject && url === subject) return "this document"
  return `doc ${url.replace(AUTOMERGE, "").slice(0, 6)}`
}

/** `["items", 0, "text"]` -> `/items/0/text`, and `[]` -> the whole document. */
export function pathLabel(path) {
  if (!Array.isArray(path) || !path.length) return null
  return `/${path.join("/")}`
}

/** A host name, or the raw string when it will not parse. */
export function hostOf(url) {
  try {
    return new URL(String(url)).host
  } catch {
    return String(url ?? "")
  }
}

/** The last segment of a slash-separated path — usually the interesting part. */
export function baseName(path) {
  const parts = String(path ?? "").split("/").filter(Boolean)
  return parts.at(-1) ?? String(path ?? "")
}

/** Describe an edit by the fields it touches, which is the part worth reading. */
export function describeOps(ops) {
  if (!Array.isArray(ops) || !ops.length) return "no changes"
  const names = []
  for (const op of ops.slice(0, 3)) {
    const where = pathLabel(op?.path) ?? "document"
    const anchor = [op?.find, op?.after, op?.before].find((text) => typeof text === "string")
    if (anchor !== undefined) {
      const snippet = anchor.replace(/\s+/g, " ").trim()
      names.push(`${where} “${snippet.length > 18 ? `${snippet.slice(0, 17)}…` : snippet}”`)
    } else names.push(where)
  }
  const more = ops.length - names.length
  return names.join(", ") + (more > 0 ? ` +${more} more` : "")
}

/**
 * Per-tool presentation.
 *
 * `verb` is what a person would say happened. `detail` answers "to what?" in as
 * few characters as possible, and may return null when the verb says it all.
 */
export const PRESENTATION = {
  // ---- documents
  doc_read: {
    verb: "read",
    detail: (i, subject) => pathLabel(i.path) ?? (i.shapeOnly ? "shape" : shortDoc(i.url, subject)),
  },
  doc_edit: { verb: "edit", detail: (i) => describeOps(i.ops) },
  doc_create: { verb: "create", detail: (i) => i.title || i.datatype || null },
  doc_history: { verb: "history", detail: (i, subject) => shortDoc(i.url, subject) },
  doc_watch: {
    verb: "watch",
    detail: (i, subject) => (i.stop ? `stop ${i.stop}` : pathLabel(i.path) ?? shortDoc(i.url, subject)),
  },
  doc_search: { verb: "search docs", detail: (i) => (i.query ? `“${i.query}”` : null) },
  doc_tree: { verb: "browse", detail: () => null },

  // ---- files
  fs_list: { verb: "list", detail: (i) => (i.path ? `/${i.path}` : "/") },
  fs_read: { verb: "read", detail: (i) => baseName(i.path) },
  fs_grep: {
    verb: "grep",
    detail: (i) => (i.pattern ? `${i.pattern}${i.include ? ` in ${i.include}` : ""}` : null),
  },
  fs_delete: { verb: "remove", detail: (i) => baseName(i.path) },
  note_write: { verb: "note", detail: (i) => i.name ?? null },
  workflow_start: { verb: "orchestrate", detail: (i) => (i.title ? `${i.title} · ${i.steps?.length ?? 0} steps` : null) },
  workflow_add_steps: { verb: "extend workflow", detail: (i) => `${i.steps?.length ?? 0} steps` },
  workflow_status: { verb: "check workflow", detail: () => null },
  workflow_edit_steps: { verb: "edit steps", detail: (i) => (i.steps ?? []).map((x) => x?.id).filter(Boolean).join(", ") || null },
  workflow_reopen: { verb: "reopen", detail: (i) => (i.steps?.length ? `${i.steps.join(", ")}${i.cascade ? " and what follows" : ""}` : null) },
  workflow_keep: { verb: "keep results of", detail: (i) => (i.steps ?? []).join(", ") || null },
  workflow_decide: { verb: "decide request", detail: (i) => (i.request ? `${i.request} · ${i.accept ? "accept" : "decline"}` : null) },
  workflow_request: {
    verb: "ask the orchestrator",
    detail: (i) =>
      [i.add_steps?.length ? `${i.add_steps.length} more step${i.add_steps.length === 1 ? "" : "s"}` : null, i.reopen?.length ? `reopen ${i.reopen.join(", ")}` : null].filter(Boolean).join(" and ") || null,
  },
  workflow_stop: { verb: "stop", detail: (i) => (i.steps?.length ? i.steps.join(", ") : "workflow") },
  workflow_answer: { verb: "answer step", detail: (i) => i.step ?? null },
  citations_check: { verb: "check the citations in", detail: (i) => (i.url ? String(i.url).replace(/^automerge:/, "").slice(0, 8) + "…" : null) },
  workflow_budget: { verb: "give more budget to", detail: (i) => (i.step ? `${i.step} (+${i.add ?? "?"})` : null) },
  note_edit: { verb: "amend note", detail: (i) => i.name ?? null },
  note_read: { verb: "recall", detail: (i) => i.name ?? "notes" },
  note_delete: { verb: "forget", detail: (i) => i.name ?? null },
  // A package is named by folder URL, which a person should not have to read.
  guide_read: { verb: "recall the guide for", detail: (i) => (i.package && !/^automerge:/.test(i.package) ? i.package : i.package ? "a package" : "all packages") },
  guide_changes: { verb: "see what changed in", detail: (i) => (i.package && !/^automerge:/.test(i.package) ? i.package : "a package") },
  guide_pin: { verb: "mark reviewed", detail: (i) => (i.package && !/^automerge:/.test(i.package) ? i.package : "a guide") },
  guide_write: { verb: "write the guide for", detail: (i) => i.name ?? (i.package && !/^automerge:/.test(i.package) ? i.package : "a package") },
  fs_edit: {
    verb: "edit",
    detail: (i) => (i.path ? baseName(i.path) : i.url ? "file" : null),
  },
  fs_write: {
    verb: "write",
    detail: (i) => {
      // `files` is a map of path to content, not an array.
      const paths = i.files && typeof i.files === "object" ? Object.keys(i.files) : []
      if (paths.length) {
        const names = paths.slice(0, 2).map(baseName)
        return names.join(", ") + (paths.length > 2 ? ` +${paths.length - 2}` : "")
      }
      return i.path ? baseName(i.path) : i.url ? "file" : null
    },
  },

  // ---- the world outside
  web_search: { verb: "search", detail: (i) => (i.query ? `“${i.query}”` : null) },
  web_fetch: { verb: "fetch", detail: (i) => hostOf(i.url) },
  // A plugin, the Web snapshot package's, presented like the tools beside it.
  web_capture: { verb: "capture", detail: (i) => hostOf(i.url) },
  http_request: {
    verb: (i) => (i.method ?? "GET").toUpperCase(),
    detail: (i) => hostOf(i.url),
  },
  source_read: {
    verb: (i) => (i.find ? "search" : "read"),
    detail: (i) => (i.find ? `“${i.find}”` : i.offset ? `from ${i.offset}` : "kept source"),
  },
  source_list: { verb: "kept sources", detail: (i) => (i.find ? `“${i.find}”` : null) },
  source_file: { verb: "file", detail: (i) => i.name ?? "kept source" },
  finding_write: {
    verb: (i) => (!i.finding ? "finding" : i.mode === "replace" ? "rewrite finding" : "add to finding"),
    detail: (i) => i.title ?? null,
  },

  // ---- knowing things
  skill_list: { verb: "skills", detail: () => null },
  skill_read: { verb: "read skill", detail: (i) => i.name ?? null },
  registry_list: { verb: "installed", detail: (i) => i.search || i.type || null },
  plugin_source: { verb: "source", detail: (i) => (i.file ? `${i.id}/${baseName(i.file)}` : i.id ?? null) },

  // ---- building and checking
  package_build: { verb: "build", detail: (i) => i.entry ?? "package" },
  package_test: { verb: "test", detail: (i) => i.filter ?? "package" },
  tool_check: { verb: "check", detail: (i) => i.toolId ?? i.datatype ?? "tool" },

  // ---- driving the front end
  view_open: { verb: "open", detail: (i, subject) => shortDoc(i.url, subject) },
  view_mount: { verb: "mount", detail: (i) => i.toolId ?? i.datatype ?? null },
  view_unmount: { verb: "close", detail: (i) => i.mountId ?? null },
  view_inspect: { verb: "inspect", detail: (i) => i.selector ?? i.mountId ?? null },
  view_interact: {
    verb: (i) => i.action ?? "interact",
    detail: (i) => `${i.selector ?? ""}${i.value != null ? ` = ${String(i.value).slice(0, 24)}` : ""}`.trim() || null,
  },
  view_screenshot: { verb: "screenshot", detail: (i) => i.selector ?? null },
  dom_snapshot: { verb: "look", detail: (i) => i.selector ?? "the page" },

  // ---- asking and naming
  ask_user: { verb: "ask", detail: (i) => i.question ?? null },
  session_title: { verb: "name", detail: (i) => i.title ?? null },
  session_recall: { verb: "recall", detail: (i) => i.callId ?? null },
}

/** Tool ids we have written a presentation for. Used by the tests. */
export const PRESENTED = Object.keys(PRESENTATION)

/**
 * The plugins presented here, though no part of this package defines them:
 * the Web snapshot package's web_capture. Its calls land in this log like
 * any other, and a plugin cannot reach this table, so its entry lives here;
 * a test holds this list to exactly the entries that are not built-ins.
 */
export const PRESENTED_PLUGINS = ["web_capture"]

const MAX_DETAIL = 64

/** The first argument a person could read, for a tool we have no entry for. */
function firstReadableValue(input) {
  for (const value of Object.values(input ?? {})) {
    if (typeof value === "string" && value.trim()) return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
  }
  return undefined
}

/**
 * The one-line description of a call: a verb, what it acted on, and how it went.
 *
 * `note` is the tool's own summary when it has one, because a tool knows better
 * than this file what its result meant.
 */
export function describeCall(block, result, { subject = null } = {}) {
  const input = block?.input ?? {}
  const entry = PRESENTATION[block?.tool]

  const verb = entry ? (typeof entry.verb === "function" ? entry.verb(input) : entry.verb) : block?.tool ?? "call"

  let detail
  if (entry) {
    try {
      detail = entry.detail(input, subject)
    } catch {
      detail = null // a malformed input must not break the log
    }
  } else {
    // No entry — a tool contributed by a package. Show the field most likely to
    // mean something, and if none of the usual names are there, the first short
    // string it was given: a third-party tool's row was otherwise its bare id
    // and nothing else, which is the dump-the-arguments problem in its purest
    // form.
    const named = input.path ?? input.name ?? input.query ?? input.selector ?? input.id ?? input.url
    const guess = named ?? firstReadableValue(input)
    detail = isDocUrl(guess) ? shortDoc(guess, subject) : (pathLabel(guess) ?? guess)
  }

  detail = detail == null ? "" : String(detail)
  if (detail.length > MAX_DETAIL) detail = `${detail.slice(0, MAX_DETAIL - 1)}…`

  return { verb: String(verb), detail, note: noteFor(block, result) }
}

function noteFor(block, result) {
  if (block?.status === "running") return "running…"
  if (block?.status === "asking") return "waiting for you"
  if (block?.status === "pending") return "needs approval"
  if (block?.status === "denied") return "declined"
  if (!result) return ""

  if (result.isError) {
    const firstLine = String(result.output ?? "").split("\n")[0]
    return firstLine.replace(/^Error:\s*/, "").slice(0, 80)
  }
  // The tool's own summary, else the first line — a fallback for results
  // written before summaries were recorded.
  if (result.summary) return result.summary
  return String(result.output ?? "").split("\n")[0].slice(0, 60)
}
