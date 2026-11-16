/**
 * The snapshot view: a kept page, shown as it looked, with nothing run and
 * nothing fetched.
 *
 * The page is `freeze(doc)` (capture/freeze.js) in an iframe whose sandbox
 * allows popups — so a link opens in a new tab, outside the sandbox — and
 * nothing else: never allow-scripts, allow-same-origin, allow-forms,
 * allow-modals or allow-top-navigation. Its origin is opaque, so it cannot
 * reach this page, its storage or a service worker; the frozen page's own
 * CSP blocks every request but data:. It is given as `srcdoc`, the same
 * string Export saves, so there is no URL to manage and nothing differs
 * between what is seen here and what is saved.
 *
 * Above it, everything a reader needs to judge it: where it came from and
 * when, who rendered it (usually the reader service, a third party, after
 * the page's scripts ran — said plainly), its hash, what was kept and what
 * was not and why, its text with the headings to jump to, and Export.
 */

import { freeze, rfc1123 } from "../capture/freeze.js"
import { notKeptLine, policyLine } from "../capture/crawl.js"
import { readable } from "../tools/sources.js"
import { bytes as size } from "../tools/format.js"

/** The iframe's sandbox, exactly. */
export const SANDBOX = "allow-popups allow-popups-to-escape-sandbox"

/** Is this an http(s) URL, and so safe to link from our own page? */
function webAddress(value) {
  try {
    return ["http:", "https:"].includes(new URL(String(value)).protocol)
  } catch {
    return false
  }
}

const STYLE_MARK = "data-patchwork-agent-styles"
function ensureStyles() {
  if (typeof document === "undefined") return
  try {
    const href = new URL("../styles.css", import.meta.url).href
    if ([...document.querySelectorAll(`link[${STYLE_MARK}]`)].some((link) => link.href === href)) return
    const link = document.createElement("link")
    link.setAttribute(STYLE_MARK, "")
    link.rel = "stylesheet"
    link.href = href
    document.head.appendChild(link)
  } catch {
    /* tests: no external stylesheets */
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

const when = (at) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`

/** The file an export is saved as: the title, made safe for a file name. */
export function exportName(doc) {
  const stem = String(doc?.title || doc?.source || "snapshot")
    .replace(/[\/\\:*?"<>|\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
  return `${stem || "snapshot"}.html`
}

/** The page as one self-contained HTML file, with its Memento tags. The same document always gives the same bytes. */
export function exportSnapshot(doc) {
  return { name: exportName(doc), html: freeze(doc, { export: true }) }
}

/** Who made this HTML, honestly. */
export function renderedBy(capture) {
  if (capture?.engine === "reader-dom") return "rendered by the reader service (a third party), after the page's scripts ran"
  return "the raw response, before the page's scripts ran"
}

const isSnapshot = (doc) => doc?.html instanceof Uint8Array && doc?.capture

/** The not-kept list, grouped by outcome: each URL with why. */
function notKeptList(resources) {
  const groups = new Map()
  for (const [url, r] of Object.entries(resources ?? {})) {
    if (r.outcome === "ok") continue
    const label = r.outcome === "policy" ? `not fetched by policy (${r.kind})` : r.outcome
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push([url, r])
  }
  const list = el("div", "agent-snap-missing")
  for (const [label, entries] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    list.append(el("h4", null, `${label} · ${entries.length}`))
    const ul = el("ul")
    for (const [url, r] of entries) {
      const li = el("li")
      li.append(el("code", null, url))
      const why = r.outcome === "http-error" ? `HTTP ${r.status}` : r.detail
      if (why) li.append(el("span", "agent-snap-why", ` — ${why}`))
      ul.append(li)
    }
    list.append(ul)
  }
  return list
}

/** The readable text, with its headings as a jump list. */
function textPanel(doc) {
  const text = readable(doc) ?? ""
  const marks = Array.isArray(doc.marks) ? doc.marks : []
  const panel = el("div", "agent-snap-text")
  const jumps = el("nav", "agent-snap-jumps")
  const pre = el("pre")
  let at = 0
  marks.forEach((mark) => {
    if (mark.at < at || mark.at > text.length) return
    pre.append(document.createTextNode(text.slice(at, mark.at)))
    const anchor = el("span", "agent-snap-mark")
    pre.append(anchor)
    const jump = el("button", null, mark.label)
    jump.type = "button"
    jump.addEventListener("click", () => anchor.scrollIntoView?.({ block: "start" }))
    jumps.append(jump)
    at = mark.at
  })
  pre.append(document.createTextNode(text.slice(at)))
  if (marks.length) panel.append(jumps)
  panel.append(pre)
  return panel
}

/** Save the export through a download link: no server, no permission. */
function download(doc) {
  const { name, html } = exportSnapshot(doc)
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.rel = "noopener"
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function SnapshotView(handle, element) {
  ensureStyles()
  const root = el("div", "patchwork-agent agent-snapshot")
  element.append(root)
  let shown = null // the heads last rendered: a re-render only when the document moved

  function render() {
    const doc = handle.doc()
    const heads = typeof handle.heads === "function" ? (handle.heads() ?? []).join(",") : null
    if (heads !== null && heads === shown) return
    shown = heads
    root.replaceChildren()
    if (!isSnapshot(doc)) {
      root.append(el("p", "agent-snap-empty", "This snapshot is empty. web_capture makes snapshots of pages."))
      return
    }
    const capture = doc.capture
    const tally = doc.tally ?? { found: 0, kept: 0, keptBytes: 0, policy: {} }

    const header = el("header", "agent-snap-header")
    header.append(el("h2", null, doc.title || doc.source))

    const facts = el("div", "agent-snap-facts")
    // This header is in Patchwork's own page, outside the frame's sandbox,
    // and anyone who can edit the snapshot can edit its source: so it is a
    // link only when it is a web address, never javascript: or data:.
    const source = el("a", "agent-snap-source", doc.source)
    if (webAddress(doc.source)) {
      source.href = doc.source
      source.target = "_blank"
      source.rel = "noopener noreferrer"
    }
    facts.append(source)
    const time = el("time", null, when(capture.at))
    time.dateTime = new Date(capture.at).toISOString()
    time.title = rfc1123(capture.at)
    facts.append(time)
    facts.append(el("span", "agent-snap-via", renderedBy(capture) + (capture.readerCache === "allowed" ? " · reader cache allowed" : "")))
    facts.append(el("code", "agent-snap-hash", `sha256 ${String(capture.sha256 ?? "").slice(0, 12)}…`))
    header.append(facts)

    const policyCount = Object.values(tally.policy ?? {}).reduce((a, b) => a + b, 0)
    const resources = el("details", "agent-snap-resources")
    const summary = el("summary", null, `${tally.kept} of ${tally.found - policyCount} resources kept · ${size(tally.keptBytes)}`)
    resources.append(summary)
    const why = [notKeptLine(doc.resources ?? {}), policyLine(tally.policy) && `by policy: ${policyLine(tally.policy)}`].filter(Boolean).join(" · ")
    if (why) resources.append(el("p", "agent-snap-why", `Not kept: ${why}.`))
    resources.append(notKeptList(doc.resources))
    header.append(resources)
    if (doc.complete === false) header.append(el("p", "agent-snap-partial", "The capture was stopped part-way; what was not fetched is marked aborted."))

    const actions = el("div", "agent-snap-actions")
    const textToggle = el("button", null, "Text")
    textToggle.type = "button"
    const exporter = el("button", null, "Export")
    exporter.type = "button"
    exporter.addEventListener("click", () => download(handle.doc()))
    actions.append(textToggle, exporter)
    header.append(actions)

    const text = textPanel(doc)
    text.hidden = true
    textToggle.addEventListener("click", () => {
      text.hidden = !text.hidden
      textToggle.setAttribute("aria-pressed", String(!text.hidden))
    })

    const frame = document.createElement("iframe")
    frame.className = "agent-snap-frame"
    frame.setAttribute("sandbox", SANDBOX)
    frame.setAttribute("referrerpolicy", "no-referrer")
    frame.setAttribute("title", `Snapshot of ${doc.title || doc.source}`)
    frame.srcdoc = freeze(doc)

    root.append(header, text, frame)
  }

  render()
  handle.on?.("change", render)
  return () => {
    handle.off?.("change", render)
    root.remove()
  }
}
