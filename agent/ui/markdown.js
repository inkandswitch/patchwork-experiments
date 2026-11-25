/**
 * Markdown, rendered as DOM.
 *
 * Everything this renders is untrusted: model output, a fetched page, something
 * a person pasted. So there is no `innerHTML` anywhere in this file and no HTML
 * parsing at all — markup in the source is text, and stays text. That rules out
 * a library too: every markdown library worth using emits an HTML string, and
 * accepting one here would undo the guarantee.
 *
 * Scope is what a conversation actually contains: headings, lists, fenced code,
 * quotes, rules, tables, and the inline run of code, emphasis, links and
 * images. Not a spec-complete implementation, and it does not try to be —
 * anything it fails to recognise degrades to the text it came from, which is
 * what a chat log should do with an oddity.
 */

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/**
 * Schemes a link may use.
 *
 * An allow-list, not a block-list: `javascript:` is the one everybody
 * remembers, but `data:text/html` and `vbscript:` are the same hole, and so is
 * whatever gets invented next. `automerge:` is here because linking to another
 * document is the point of half of this.
 */
const SAFE_LINK = /^(https?:|mailto:|automerge:|#|\/|\.{1,2}\/)/i
const SAFE_IMAGE = /^(https?:\/\/|data:image\/)/i

/** Whitespace and control characters, which a real scheme cannot contain. */
const SMUGGLED = /[\x00-\x20\x7f]/

export function safeHref(href) {
  const trimmed = String(href ?? "").trim()
  if (SMUGGLED.test(trimmed)) return null
  return SAFE_LINK.test(trimmed) ? trimmed : null
}

export function safeImageSrc(src) {
  const trimmed = String(src ?? "").trim()
  if (SMUGGLED.test(trimmed)) return null
  return SAFE_IMAGE.test(trimmed) ? trimmed : null
}

// ------------------------------------------------------------------ inline

/**
 * Inline spans, in precedence order.
 *
 * Code first and deliberately: inside backticks nothing else applies, which is
 * the rule people rely on when they write `**` in a code span.
 */
const INLINE = [
  { name: "code", pattern: /`([^`\n]+)`/ },
  // The destination allows one level of balanced parentheses, because real URLs
  // contain them — `…/wiki/Foo_(bar)` is the common case, and stopping at the
  // first `)` both breaks the link and leaves a stray bracket in the prose.
  { name: "image", pattern: /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/ },
  { name: "link", pattern: /\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"([^"]*)")?\)/ },
  // The agent's word that a fact has no document behind it (see documents/citations.js).
  { name: "memory", pattern: /\(from memory\)/i },
  { name: "bold", pattern: /\*\*([^*]+)\*\*|__([^_]+)__/ },
  { name: "italic", pattern: /(?<![*\w])\*([^*\n]+)\*(?!\*)|(?<![_\w])_([^_\n]+)_(?![\w_])/ },
  { name: "strike", pattern: /~~([^~]+)~~/ },
  { name: "autolink", pattern: /<(https?:\/\/[^>\s]+)>|(?<![(\w])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/ },
]

/** Render one run of inline markdown into `parent`. */
export function renderInline(parent, text) {
  let rest = String(text ?? "")

  while (rest) {
    // The earliest match across all the inline forms wins; ties go to whichever
    // is listed first, which is how code beats emphasis at the same offset.
    let best = null
    for (const { name, pattern } of INLINE) {
      const match = pattern.exec(rest)
      if (match && (best === null || match.index < best.match.index)) best = { name, match }
    }

    if (!best) {
      parent.append(document.createTextNode(rest))
      return
    }

    const { name, match } = best
    if (match.index > 0) parent.append(document.createTextNode(rest.slice(0, match.index)))
    const content = match[1] ?? match[2] ?? ""

    if (name === "code") {
      parent.append(el("code", null, content))
    } else if (name === "image") {
      const src = safeImageSrc(match[2])
      if (src) {
        const image = el("img", "agent-md-image")
        image.src = src
        image.alt = match[1] ?? ""
        image.loading = "lazy"
        parent.append(image)
      } else {
        parent.append(document.createTextNode(match[0]))
      }
    } else if (name === "link") {
      const href = safeHref(match[2])
      if (href && match[3] && /^automerge:/i.test(href)) {
        parent.append(citation(href, match[1] || "source", match[3]))
      } else if (href) {
        parent.append(anchor(href, match[1] || match[2]))
      } else {
        // Keep the words, drop the destination: a reader should still see what
        // was written, without a link they cannot trust.
        parent.append(document.createTextNode(match[1] || match[0]))
      }
    } else if (name === "memory") {
      parent.append(el("span", "agent-from-memory", "from memory"))
    } else if (name === "bold") {
      renderInline(parent.appendChild(el("strong")), content)
    } else if (name === "italic") {
      renderInline(parent.appendChild(el("em")), content)
    } else if (name === "strike") {
      renderInline(parent.appendChild(el("s")), content)
    } else if (name === "autolink") {
      const url = match[1] ?? match[2]
      parent.append(anchor(url, url))
    }

    rest = rest.slice(match.index + match[0].length)
  }
}

/**
 * A link, or — for another document — something the view can turn into
 * navigation. Patchwork navigates in place, so an automerge link must not open
 * a tab; it carries the URL on a data attribute and the transcript wires it up.
 */
function anchor(href, label) {
  const link = el("a", null, label)
  if (/^automerge:/i.test(href)) {
    link.className = "agent-doc-link"
    link.dataset.docUrl = href
    link.setAttribute("role", "link")
    link.tabIndex = 0
  } else {
    link.href = href
    link.target = "_blank"
    link.rel = "noopener noreferrer"
  }
  return link
}

/**
 * A citation: a link to a document carrying the passage it rests on. The
 * view checks the passage is really there (documents/citations.js) and marks it.
 */
function citation(href, label, quote) {
  const link = anchor(href, label)
  link.classList.add("agent-cite")
  link.dataset.quote = quote
  link.title = `“${quote}”`
  return link
}

// ------------------------------------------------------------------- blocks

const HEADING = /^(#{1,6})\s+(.*)$/
const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/

/** Split a table row on its pipes. */
function cells(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

/**
 * Render markdown into a fresh element.
 *
 * Line-based rather than a real parser: the block forms above are recognised in
 * order, and anything else accumulates into a paragraph.
 */
export function renderMarkdown(source, { className = "agent-md" } = {}) {
  const root = el("div", className)
  const lines = String(source ?? "").split("\n")

  let paragraph = []
  const flush = () => {
    if (!paragraph.length) return
    const p = el("p")
    // A single newline inside a paragraph is a line break here. Markdown says
    // it is a space, but a chat log full of hard-wrapped model output reads far
    // better with the breaks kept.
    paragraph.forEach((line, index) => {
      if (index) p.append(el("br"))
      renderInline(p, line)
    })
    root.append(p)
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const closer = fence[1]
      const body = []
      i++
      while (i < lines.length && !new RegExp(`^\\s*${closer}\\s*$`).test(lines[i])) body.push(lines[i++])
      const pre = el("pre", "agent-md-code")
      const code = el("code", null, body.join("\n"))
      if (fence[2]) code.dataset.language = fence[2]
      pre.append(code)
      root.append(pre)
      continue
    }

    if (!line.trim()) {
      flush()
      continue
    }

    if (RULE.test(line)) {
      flush()
      root.append(el("hr"))
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      const node = el(`h${heading[1].length}`)
      renderInline(node, heading[2])
      root.append(node)
      continue
    }

    // A table needs its divider row to be a table at all, which is also what
    // stops a line of prose containing a pipe from becoming one.
    if (line.includes("|") && TABLE_DIVIDER.test(lines[i + 1] ?? "")) {
      flush()
      const table = el("table", "agent-md-table")
      const headRow = el("tr")
      for (const cell of cells(line)) renderInline(headRow.appendChild(el("th")), cell)
      table.appendChild(el("thead")).append(headRow)

      const body = el("tbody")
      i += 2
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const row = el("tr")
        for (const cell of cells(lines[i])) renderInline(row.appendChild(el("td")), cell)
        body.append(row)
        i++
      }
      i--
      table.append(body)
      root.append(table)
      continue
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      flush()
      i = renderList(root, lines, i) - 1
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      flush()
      const body = [quote[1]]
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) body.push(QUOTE.exec(lines[++i])[1])
      const block = el("blockquote")
      block.append(renderMarkdown(body.join("\n"), { className: "agent-md-quote" }))
      root.append(block)
      continue
    }

    paragraph.push(line)
  }

  flush()
  return root
}

/**
 * Render a run of list items, nesting by indentation.
 *
 * Returns the index of the first line it did not consume.
 */
function renderList(root, lines, start, depth = 0) {
  const ordered = !BULLET.test(lines[start])
  const first = ordered ? NUMBERED.exec(lines[start]) : BULLET.exec(lines[start])
  const list = el(ordered ? "ol" : "ul", "agent-md-list")
  if (ordered && first[2] !== "1") list.start = Number(first[2])

  let i = start
  while (i < lines.length) {
    const line = lines[i]
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    if (!bullet && !numbered) {
      // A blank line between items keeps the list going; anything else ends it.
      if (!line.trim() && (BULLET.test(lines[i + 1] ?? "") || NUMBERED.test(lines[i + 1] ?? ""))) {
        i++
        continue
      }
      break
    }

    const indent = (bullet ?? numbered)[1].length
    if (indent < depth) break
    if (indent > depth) {
      const nested = list.lastElementChild ?? list.appendChild(el("li"))
      i = renderList(nested, lines, i, indent)
      continue
    }

    // A change of marker starts a new list rather than continuing this one.
    if (!!numbered !== ordered) break

    const item = el("li")
    renderInline(item, bullet ? bullet[2] : numbered[3])
    list.append(item)
    i++
  }

  root.append(list)
  return i
}

export default renderMarkdown
