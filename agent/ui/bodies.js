/**
 * What a tool call looks like when you open it.
 *
 * `JSON.stringify(input, null, 2)` followed by the output is fine for
 * `{ "path": ["title"] }` and unreadable for the call that writes a file: JSON
 * escapes every newline, so 200 lines of source render as one endless line of
 * `\n`. Writing a file is the most common thing the agent does, so it must
 * not be the least readable thing in the log.
 *
 * So: short scalars go in a compact field list, long or multi-line strings get
 * their own labelled code block with real newlines, and a handful of tools whose
 * shape is worth knowing — writing files, editing documents, asking a question —
 * get a rendering built for them.
 *
 * DOM calls only, like everything else here. This is tool output and model
 * output; it is never parsed as markup.
 */

import { renderMarkdown } from "./markdown.js"
import { pathLabel, baseName } from "./calls.js"

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/** Above this, or with a newline in it, a string gets its own block. */
const INLINE_LIMIT = 80

export function isLong(value) {
  return typeof value === "string" && (value.length > INLINE_LIMIT || value.includes("\n"))
}

/** A monospace block that keeps its newlines. The whole point of this file. */
export function codeBlock(text, { language = null, className = "agent-code" } = {}) {
  const pre = el("pre", className)
  const code = el("code", null, String(text ?? ""))
  if (language) code.dataset.language = language
  pre.append(code)
  return pre
}

/** `src/tool.js` -> `js`, for a label. */
export function languageOf(path) {
  const extension = String(path ?? "").split(".").pop()?.toLowerCase()
  return /^(js|jsx|ts|tsx|json|css|html|md|mjs)$/.test(extension ?? "") ? extension : null
}

/** One `label: value` row, for the short stuff. */
function field(label, value) {
  const row = el("div", "agent-field")
  row.append(el("span", "agent-field-label", label))
  row.append(el("span", "agent-field-value", typeof value === "string" ? value : JSON.stringify(value)))
  return row
}

/**
 * The generic input rendering: a field list, with long strings pulled out.
 *
 * `skip` lets a per-tool renderer show some keys its own way without the
 * generic list repeating them.
 */
export function renderInput(input, { skip = [] } = {}) {
  const parts = []
  const rows = el("div", "agent-fields")
  const entries = Object.entries(input ?? {}).filter(([key]) => !skip.includes(key))

  for (const [key, value] of entries) {
    if (isLong(value)) {
      parts.push(el("div", "agent-block-label", key), codeBlock(value))
    } else if (value !== null && typeof value === "object") {
      const rendered = JSON.stringify(value)
      if (rendered.length > INLINE_LIMIT) {
        parts.push(el("div", "agent-block-label", key), codeBlock(JSON.stringify(value, null, 2)))
      } else {
        rows.append(field(key, rendered))
      }
    } else {
      rows.append(field(key, String(value)))
    }
  }

  return [...(rows.childElementCount ? [rows] : []), ...parts]
}

/** Tool output. A `<pre>` by default: reports and trees depend on alignment. */
function renderOutput(text, { markdown = false } = {}) {
  const value = String(text ?? "")
  if (!value.trim()) return []
  const wrapper = el("div", "agent-output")
  if (markdown) wrapper.append(renderMarkdown(value))
  else wrapper.append(codeBlock(value, { className: "agent-code agent-code-output" }))
  return [el("div", "agent-block-label", "result"), wrapper]
}

// ------------------------------------------------------------- per tool

/** Every file in one write, each under its own name. */
function writeBody(input) {
  const files = input.files ?? (input.path != null ? { [input.path]: input.content ?? "" } : null)
  if (!files) return renderInput(input)

  const parts = []
  if (input.root) parts.push(...renderInput({ root: input.root }))
  for (const [path, content] of Object.entries(files)) {
    parts.push(el("div", "agent-block-label", path))
    parts.push(codeBlock(content, { language: languageOf(path) }))
  }
  return parts
}

const quoted = (text) => {
  const line = String(text).replace(/\s+/g, " ").trim()
  return `“${line.length > 40 ? `${line.slice(0, 39)}…` : line}”`
}

/** What one op puts in, in a few words: the row's right-hand side. */
function opDetail(op) {
  if (op?.op === "delete") return null
  const what = op?.from
    ? `the text at ${pathLabel(op.from.path) ?? "/"}${op.from.url ? " in another document" : ""}`
    : op?.text !== undefined && op?.text !== null
      ? isLong(op.text) ? `${String(op.text).slice(0, 60)}…` : quoted(op.text)
      : isLong(op?.value) ? `${String(op.value).slice(0, 60)}…` : typeof op?.value === "string" ? op.value : JSON.stringify(op?.value)
  if (op?.op === "replace") return `${quoted(op.find ?? "")} → ${op.text === "" ? "nothing" : what}`
  if (op?.op === "insert" && (op.after != null || op.before != null)) return `${what} ${op.after != null ? "after" : "before"} ${quoted(op.after ?? op.before)}`
  if (op?.op === "test") return `is ${what}`
  return op?.op === "set" ? what : `${op?.op} ${what}`
}

/** An edit as the changes it makes, one line each, rather than as a blob. */
function editBody(input) {
  const ops = Array.isArray(input.ops) ? input.ops : null
  if (!ops) return renderInput(input)

  const parts = []
  const list = el("div", "agent-ops")
  for (const op of ops) {
    const row = el("div", "agent-op")
    row.append(el("span", "agent-op-where", pathLabel(op?.path) ?? "/"))
    const detail = opDetail(op)
    if (detail === null) row.append(el("span", "agent-op-delete", "delete"))
    else row.append(el("span", "agent-op-value", detail))
    list.append(row)
  }
  parts.push(list)

  // Long text is unreadable squeezed into a row, so it gets a block too.
  for (const op of ops) {
    const long = isLong(op?.text) ? op.text : isLong(op?.value) ? op.value : null
    if (long !== null) parts.push(el("div", "agent-block-label", pathLabel(op.path) ?? "value"), codeBlock(long))
  }
  return parts
}

/** A question shows what was offered; the card above it does the asking. */
function askBody(input) {
  const parts = []
  if (input.context) parts.push(el("div", "agent-field-value", input.context))
  if (Array.isArray(input.options) && input.options.length) {
    const list = el("ul", "agent-md-list")
    for (const option of input.options) {
      const label = typeof option === "string" ? option : option?.label
      const detail = typeof option === "string" ? null : option?.detail
      if (label) list.append(el("li", null, detail ? `${label} — ${detail}` : label))
    }
    parts.push(el("div", "agent-block-label", "offered"), list)
  }
  return parts
}

/**
 * How each tool's call renders when opened.
 *
 * `input` builds the request side; `markdown` says the result is prose rather
 * than a report whose alignment matters.
 */
const BODIES = {
  fs_write: { input: writeBody },
  doc_edit: { input: editBody },
  ask_user: { input: askBody },
  fs_read: { input: (i) => renderInput(i), language: (i) => languageOf(i.path) },
  web_fetch: { markdown: true },
  source_read: { markdown: true },
  skill_read: { markdown: true },
  plugin_source: { language: (i) => languageOf(i.file) },
}

/**
 * Render the open body of a call: what was asked for, and what came back.
 */
export function renderCallBody(block, result) {
  const body = el("div", "agent-call-body")
  const input = block?.input ?? {}
  const spec = BODIES[block?.tool] ?? {}

  const requested = spec.input ? spec.input(input) : renderInput(input)
  if (requested.length) {
    body.append(el("div", "agent-block-label", "call"))
    body.append(...requested)
  }

  if (result) {
    // A code result keeps its language; prose is rendered as prose. Errors are
    // always monospace — they carry stacks and file positions.
    const markdown = !result.isError && !!spec.markdown
    const rendered = renderOutput(result.output, { markdown })
    if (rendered.length) {
      const [label, content] = rendered
      if (result.isError) content.classList.add("agent-output-error")
      const language = spec.language?.(input)
      if (language && !markdown) content.querySelector("code")?.setAttribute("data-language", language)
      body.append(label, content)
    }
  }

  return body
}

/** Exported for the tests: which tools have a bespoke body. */
export const BESPOKE = Object.keys(BODIES)
export { baseName }
