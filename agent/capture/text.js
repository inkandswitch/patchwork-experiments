/**
 * A page's readable text, with its headings as marks.
 *
 * A snapshot keeps the page's HTML, which no model should read; this is the
 * text beside it, so `source_read` pages through and searches a snapshot the
 * way it does any kept source. Headings become markdown lines (`## Title`)
 * and marks at the offsets where those lines start, so a result can carry an
 * outline and a search can say which heading a match sits under.
 *
 * Left out: everything in <head> (which ends where the tree builder ends it,
 * </head> or not), and script, style, noscript, template,
 * iframe, noembed and noframes, none of which a reader sees. Whitespace
 * collapses as a browser collapses it, except inside <pre> and <textarea>;
 * block elements start new lines, at most one blank line apart.
 */

/** The most marks a kept source carries. */
export const MAX_MARKS = 200

const level = (mark) => mark.label.match(/^#*/)[0].length || 1

/**
 * At most `max` marks, keeping the outline's top: every heading down to the
 * deepest level that still fits, in document order. When even the top level
 * does not fit, its first `max`. (tools/sources.js re-exports this; it lives
 * here so capture code loads without automerge.)
 */
export function fewest(marks, max) {
  if (marks.length <= max) return marks
  for (let depth = 5; depth >= 1; depth--) {
    const kept = marks.filter((m) => level(m) <= depth)
    if (kept.length <= max) return kept
  }
  return marks.filter((m) => level(m) === 1).slice(0, max)
}

const HIDDEN = new Set(["script", "style", "noscript", "template", "iframe", "noembed", "noframes", "title"])
/** What may be in <head>. Any other start tag, or text, ends it, as the tree builder has it. */
const HEAD_CONTENT = new Set(["html", "title", "meta", "link", "style", "script", "base", "noscript", "template", "basefont", "bgsound"])
const LINE = new Set(["br", "li", "tr", "dt", "dd", "option"])
const BLOCK = new Set([
  "p", "div", "section", "article", "header", "footer", "nav", "aside", "main", "ul", "ol", "dl", "table",
  "blockquote", "pre", "figure", "figcaption", "form", "fieldset", "address", "details", "summary", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6", "body", "caption", "thead", "tbody", "tfoot",
])
const CELL = new Set(["td", "th"])
const PRESERVE = new Set(["pre", "textarea"])
const HEADING = /^h([1-6])$/
/** Elements with no end tag, which must not be counted as open. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

export function outlineText(tokens) {
  // The text is kept as parts with its length and last character beside
  // them: looking at the end of one growing string costs its whole length,
  // and a page of many blocks would take time in the square of its size.
  const parts = []
  let length = 0
  let last = "" // the last character written
  let breaks = 0 // newlines wanted before the next text: 0, 1 or 2
  let space = false // a space wanted before the next text
  const hidden = new Map() // element -> how many are open
  let inHead = false
  let preserve = 0
  let heading = null // { level, at, text }
  const marks = []

  const isHidden = () => [...hidden.values()].some((n) => n > 0)
  const open = (name, delta) => hidden.set(name, Math.max(0, (hidden.get(name) ?? 0) + delta))
  const wantBreak = (n) => {
    breaks = Math.max(breaks, n)
  }
  const append = (piece) => {
    if (!piece) return
    parts.push(piece)
    length += piece.length
    last = piece[piece.length - 1]
  }
  /** The spaces at the end of what is written, removed. */
  const trimSpaces = () => {
    while (parts.length && last === " ") {
      const piece = parts[parts.length - 1]
      let end = piece.length
      while (end > 0 && piece[end - 1] === " ") end--
      length -= piece.length - end
      if (end) parts[parts.length - 1] = piece.slice(0, end)
      else parts.pop()
      const now = parts[parts.length - 1]
      last = now ? now[now.length - 1] : ""
    }
  }

  const write = (text) => {
    // Nothing leads the text, so no mark ever moves when it is trimmed.
    if (!length) text = text.replace(/^[\t\n\f\r ]+/, "")
    if (!text) return
    let lead = ""
    if (length) {
      if (breaks) {
        trimSpaces()
        lead = "\n".repeat(breaks)
      } else if (space && !/\s/.test(last)) lead = " "
    }
    breaks = 0
    space = false
    append(lead)
    if (heading) {
      if (heading.at == null) {
        heading.at = length
        append(`${"#".repeat(heading.level)} `)
      } else heading.text += lead
    }
    append(text)
    if (heading) heading.text += text
  }

  for (const token of tokens) {
    if (token.type === "start") {
      const name = token.name
      if (name === "head") {
        inHead = true
        continue
      }
      if (HIDDEN.has(name) && !VOID.has(name) && !token.selfClosing) {
        open(name, 1)
        continue
      }
      if (isHidden()) continue
      // </head> is optional: anything that is not head content ends it.
      if (inHead) {
        if (HEAD_CONTENT.has(name)) continue
        inHead = false
      }
      if (PRESERVE.has(name)) preserve++
      const level = name.match(HEADING)?.[1]
      if (level) {
        wantBreak(2)
        heading = { level: Number(level), at: null, text: "" }
      } else if (LINE.has(name)) wantBreak(1)
      else if (BLOCK.has(name)) wantBreak(2)
      else if (CELL.has(name)) space = true
      continue
    }
    if (token.type === "end") {
      const name = token.name
      if (name === "head") {
        inHead = false
        continue
      }
      if (HIDDEN.has(name) && !VOID.has(name)) {
        open(name, -1)
        continue
      }
      if (isHidden() || inHead) continue
      if (PRESERVE.has(name)) preserve = Math.max(0, preserve - 1)
      if (heading && HEADING.test(name)) {
        const label = heading.text.replace(/\s+/g, " ").trim()
        if (heading.at != null && label) marks.push({ at: heading.at, label: `${"#".repeat(heading.level)} ${label}`.slice(0, 120) })
        heading = null
        wantBreak(2)
      } else if (LINE.has(name)) wantBreak(1)
      else if (BLOCK.has(name)) wantBreak(2)
      else if (CELL.has(name)) space = true
      continue
    }
    if (token.type !== "text" || isHidden()) continue
    if (inHead) {
      // Whitespace in head is nothing; any other text ends it.
      if (!/[^\t\n\f\r ]/.test(token.text)) continue
      inHead = false
    }
    if (preserve) {
      write(token.text)
      continue
    }
    const collapsed = token.text.replace(/[\t\n\f\r ]+/g, " ")
    if (collapsed === " ") {
      space = true
      continue
    }
    if (collapsed.startsWith(" ")) space = true
    write(collapsed.trim())
    if (collapsed.endsWith(" ")) space = true
  }
  return { text: parts.join("").replace(/\s+$/, ""), marks: fewest(marks, MAX_MARKS) }
}
