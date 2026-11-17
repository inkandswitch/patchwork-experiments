/**
 * The snapshot view: a kept page, shown as it looked, with nothing run and
 * nothing fetched — and, for a snapshot still empty, the place a person
 * captures one.
 *
 * Four states. Empty: a field for the page's address and Capture. Capturing:
 * each step as it happens, and Cancel. Failed: why, honestly, with the form
 * still there to try again. Captured: the page. A capture fills this very
 * document, once (web-capture.js `capture` with `into`); a snapshot that
 * holds a capture offers no Capture, and the capture itself refuses to write
 * over one, so capturing a page again is a new snapshot. Capturing and
 * failing are this view's own state, not the document's: a snapshot is
 * written once, by the capture that fills it, and a capture abandoned when
 * the tab closed leaves it empty, not stuck.
 *
 * The page is `render(doc)` (capture/freeze.js) — the stored frozen page,
 * frozen again on the way out, since a collaborator can edit a shared
 * document, with its stored assets written in as data: URLs — in an iframe
 * whose sandbox allows popups, so a link opens in a new tab outside the
 * sandbox, and nothing else: never allow-scripts, allow-same-origin,
 * allow-forms, allow-modals or allow-top-navigation. Its origin is opaque, so
 * it cannot reach this page, its storage or a service worker; the page's own
 * CSP blocks every request but data:. It is given as `srcdoc`, the same
 * string Export saves but for the Memento tags, so there is no URL to manage.
 *
 * Above it, everything a reader needs to judge it: where it came from and
 * when, who rendered it (usually the reader service, a third party, after
 * the page's scripts ran — said plainly), its hash, what was kept and what
 * was not and why, its text with the headings to jump to, and Export.
 *
 * Options, for tests: `fetchImpl` (default viewFetch()), `reader`.
 */

import { getConflicts } from "@automerge/automerge"
import { render as renderFrozen, rfc1123 } from "../capture/freeze.js"
import { notKeptLine, policyLine } from "../capture/crawl.js"
import { readable, size, DEFAULT_READER } from "../keep.js"
import { capture } from "../web-capture.js"
import { isCaptured } from "./datatype.js"
import { viewFetch } from "./fetch.js"
import { ensureStyles, el, when } from "../ui.js"

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
  return { name: exportName(doc), html: renderFrozen(doc, { export: true }) }
}

/** Who made this HTML, honestly. */
export function renderedBy(capture) {
  if (capture?.engine === "reader-dom") return "rendered by the reader service (a third party), after the page's scripts ran"
  return "the raw response, before the page's scripts ran"
}

/**
 * Were two captures written into this snapshot at once, from different
 * places? Each found it empty before writing, and neither could see the
 * other's write until the two met; Automerge then keeps one value for each
 * field, chosen field by field, so what is left mixes the two — one's page
 * beside the other's blobs. Both wrote `capture`, so it holds both values,
 * and since nothing writes it again it says so for good.
 */
export function capturedTwice(doc) {
  try {
    return Object.keys(getConflicts(doc, "capture") ?? {}).length > 1
  } catch {
    // Not an Automerge document, so nothing was merged into it.
    return false
  }
}

export const CAPTURED_TWICE =
  "Two captures were written into this snapshot at the same time, from different places, and merged into one that mixes the two, so it is not shown. Capture the page again into a new snapshot."

/** A capture this view can show: the frozen page and how it was had. */
const showable = (doc) => doc?.html instanceof Uint8Array && doc?.capture != null

/** The not-kept list, grouped by outcome: each URL with why. */
function notKeptList(resources) {
  const groups = new Map()
  for (const [url, r] of Object.entries(resources ?? {})) {
    if (r.outcome === "ok") continue
    const label = r.outcome === "policy" ? `not fetched by policy (${r.kind})` : r.outcome
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push([url, r])
  }
  const list = el("div", "ws-missing")
  for (const [label, entries] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    list.append(el("h4", null, `${label} · ${entries.length}`))
    const ul = el("ul")
    for (const [url, r] of entries) {
      const li = el("li")
      li.append(el("code", null, url))
      const why = r.outcome === "http-error" ? `HTTP ${r.status}` : r.detail
      if (why) li.append(el("span", "ws-why", ` — ${why}`))
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
  const panel = el("div", "ws-text")
  const jumps = el("nav", "ws-jumps")
  const pre = el("pre")
  let at = 0
  marks.forEach((mark) => {
    if (mark.at < at || mark.at > text.length) return
    pre.append(document.createTextNode(text.slice(at, mark.at)))
    const anchor = el("span", "ws-mark")
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
export function downloadSnapshot(doc) {
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

export function SnapshotView(handle, element, options = {}) {
  ensureStyles()
  const root = el("div", "web-snapshot")
  element.append(root)
  let shown = null // what was last drawn: heads and state, so a re-render happens only when either moved
  let disposed = false
  // This view's own capture: null, or { running: AbortController, step } while it runs,
  // or { error, url } when it failed.
  let local = null

  function render() {
    if (disposed) return
    const doc = handle.doc()
    const heads = typeof handle.heads === "function" ? (handle.heads() ?? []).join(",") : null
    const key = `${heads}|${local?.running ? `capturing:${local.step}` : local?.error ? `failed:${local.error}` : ""}`
    if (heads !== null && key === shown) return
    shown = key
    root.replaceChildren()
    if (capturedTwice(doc)) return root.append(el("p", "ws-empty", CAPTURED_TWICE))
    if (showable(doc)) return root.append(...captured(doc))
    if (isCaptured(doc)) return root.append(el("p", "ws-empty", "This snapshot holds a capture this view cannot show: its page is missing."))
    root.append(...empty())
  }

  /** The form a person captures with, and what became of the last try. */
  function empty() {
    const parts = []
    const intro = el("p", "ws-empty", "This snapshot is empty. Give the address of a page to keep it here as it looks now: frozen, with its stylesheets, fonts and images, and nothing that runs.")
    const form = el("form", "ws-capture")
    const field = el("input")
    field.type = "url"
    field.name = "url"
    field.placeholder = "https://…"
    field.setAttribute("aria-label", "Address of the page to capture")
    field.value = local?.url ?? ""
    const go = el("button", null, "Capture")
    go.type = "submit"
    form.append(field, go)
    const status = el("p", "ws-status")
    status.setAttribute("role", "status")
    if (local?.running) {
      field.disabled = true
      go.disabled = true
      const cancel = el("button", null, "Cancel")
      cancel.type = "button"
      cancel.addEventListener("click", () => local?.running?.abort())
      form.append(cancel)
      status.dataset.state = "capturing"
      status.textContent = local.step
    } else if (local?.error) {
      status.dataset.state = "failed"
      status.textContent = `${local.error} You can try again.`
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      start(field.value.trim())
    })
    parts.push(intro, form, status)
    return parts
  }

  async function start(url) {
    if (local?.running) return
    if (!/^https?:\/\//i.test(url)) {
      local = { error: "Give the page's full address, starting with https:// or http://.", url }
      return render()
    }
    let fetchImpl
    try {
      fetchImpl = options.fetchImpl ?? viewFetch()
    } catch (err) {
      local = { error: String(err?.message ?? err), url }
      return render()
    }
    const running = new AbortController()
    local = { running, step: `Capturing ${url}…`, url }
    render()
    const ctx = {
      fetchImpl,
      reader: options.reader ?? DEFAULT_READER,
      direct: false,
      signal: running.signal,
      progress: (step) => {
        if (local?.running !== running) return
        local = { ...local, step }
        render()
      },
    }
    try {
      await capture({ url }, ctx, { into: handle })
      local = null
    } catch (err) {
      local = { error: running.signal.aborted ? "Cancelled; nothing was kept." : String(err?.message ?? err), url }
    }
    render()
  }

  /** A captured snapshot: its account of itself, its text, and the page. */
  function captured(doc) {
    const capture = doc.capture
    const tally = doc.tally ?? { found: 0, kept: 0, keptBytes: 0, policy: {} }

    const header = el("header", "ws-header")
    header.append(el("h2", null, doc.title || doc.source))

    const facts = el("div", "ws-facts")
    // This header is in Patchwork's own page, outside the frame's sandbox,
    // and anyone who can edit the snapshot can edit its source: so it is a
    // link only when it is a web address, never javascript: or data:.
    const source = el("a", "ws-source", doc.source)
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
    facts.append(el("span", "ws-via", renderedBy(capture) + (capture.readerCache === "allowed" ? " · reader cache allowed" : "")))
    facts.append(el("code", "ws-hash", `sha256 ${String(capture.sha256 ?? "").slice(0, 12)}…`))
    header.append(facts)

    const policyCount = Object.values(tally.policy ?? {}).reduce((a, b) => a + b, 0)
    const resources = el("details", "ws-resources")
    const summary = el("summary", null, `${tally.kept} of ${tally.found - policyCount} resources kept · ${size(tally.keptBytes)}`)
    resources.append(summary)
    const why = [notKeptLine(doc.resources ?? {}), policyLine(tally.policy) && `by policy: ${policyLine(tally.policy)}`].filter(Boolean).join(" · ")
    if (why) resources.append(el("p", "ws-why", `Not kept: ${why}.`))
    resources.append(notKeptList(doc.resources))
    header.append(resources)
    if (doc.complete === false) header.append(el("p", "ws-partial", "The capture was stopped part-way; what was not fetched is marked aborted."))

    const actions = el("div", "ws-actions")
    const textToggle = el("button", null, "Text")
    textToggle.type = "button"
    const exporter = el("button", null, "Export")
    exporter.type = "button"
    exporter.addEventListener("click", () => downloadSnapshot(handle.doc()))
    actions.append(textToggle, exporter)
    header.append(actions)

    const text = textPanel(doc)
    text.hidden = true
    textToggle.addEventListener("click", () => {
      text.hidden = !text.hidden
      textToggle.setAttribute("aria-pressed", String(!text.hidden))
    })

    const frame = document.createElement("iframe")
    frame.className = "ws-frame"
    frame.setAttribute("sandbox", SANDBOX)
    frame.setAttribute("referrerpolicy", "no-referrer")
    frame.setAttribute("title", `Snapshot of ${doc.title || doc.source}`)
    frame.srcdoc = renderFrozen(doc)

    return [header, text, frame]
  }

  render()
  handle.on?.("change", render)
  return () => {
    disposed = true
    local?.running?.abort()
    handle.off?.("change", render)
    root.remove()
  }
}
