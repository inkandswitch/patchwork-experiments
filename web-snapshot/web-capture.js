/**
 * web_capture: keep a web page as it looks, durably.
 *
 * web_fetch keeps what a page says — the reader's text of it. This keeps the
 * page: its rendered DOM, and every stylesheet, font and image it loads that
 * can be fetched from here, in one `web-snapshot` document that opens years
 * later looking as it did, with no request to anywhere. The page is frozen
 * before it is stored (capture/freeze.js): what the document holds runs
 * nothing, and every asset it shows is one of its own blobs.
 *
 * The page itself (§4.3 of the design):
 *
 *   A. Ask for it directly, as anyone would get it: no cookies, no referrer.
 *      In a browser this usually fails CORS for an HTML page; that costs one
 *      fast request and is recorded. A refusal by the guard is final.
 *   B. Not a page (a PDF, an image): kept as a file, a PDF with the reader's
 *      text beside it, exactly as the agent's web_fetch keeps one.
 *   C. A page: the reader's rendering of it (r.jina.ai's DOM after its
 *      scripts ran — a third party's rendering, and the snapshot says so),
 *      or, in node with `render: false`, the raw response. When the reader
 *      will not render it but the direct request got the HTML, that is kept,
 *      and the result says it is the page before its scripts ran. When
 *      neither has the page, the reader's text is kept as an extract and
 *      the snapshot's absence is recorded.
 *   D. Its links, crawled through the same guard (capture/crawl.js); the
 *      page frozen with what it loads; its text and headings, for
 *      source_read; one document, written in one change.
 *
 * Every resource found is in the snapshot with exactly one outcome, kept or
 * not, and the result counts them, so a gap is never silent. What a browser
 * cannot fetch — a site's own CSS and images, behind CORS — is recorded as
 * unreachable and left: the snapshot shows the page without it.
 *
 * It works only through what it is handed. `ctx.fetchImpl` is the one way it
 * reaches the network — a guarded fetch, which it refuses to run without —
 * and `ctx.repo` the one way it writes: `create2()` for the snapshot, and
 * nothing else. That is what the plugin's `scoped: true` promises the agent
 * (index.js), which is why a research step may run it: there `ctx.repo` is
 * the step's scoped repo, so the snapshot enters the workflow's ledger and
 * is filed in its Sources folder, and what was kept before is the ledger's
 * (`ctx.repo.sources()`). In a full session what was kept before is the
 * session's `made`. The snapshot view runs the same pipeline for a person,
 * into the document it shows (`capture(input, ctx, {into})`), with its own
 * guarded fetch and a `progress` callback, which the agent never passes.
 */

import { ImmutableString } from "@automerge/automerge"
import { fetcher, assertTarget } from "./guard.js"
import {
  keepSource, keptSources, sourceName, MAX_PDF_BYTES, readOn, outline, size,
  keepPdf, keepResponse, readerUrl, readerHeaders, pdfByPath, DEFAULT_READER,
} from "./keep.js"
import { scanHtml } from "./capture/scan.js"
import { pageLinks, documentBase } from "./capture/links.js"
import { htmlCharset, metaCharset, decode } from "./capture/charset.js"
import { sniffHtml, formatOf } from "./capture/sniff.js"
import { crawl, resolve, resourceFetcher, blobsOf, readCapped, notKeptLine, policyLine, DEFAULT_BUDGET } from "./capture/crawl.js"
import { outlineText } from "./capture/text.js"
import { sha256Hex } from "./capture/bytes.js"
import { freezePage } from "./capture/freeze.js"
import { isCaptured, WEB_SNAPSHOT } from "./snapshot/datatype.js"

/** What a snapshot is, in the ledger and in a session's `made`: its datatype. */
const WHAT = WEB_SNAPSHOT

/** Why a document already captured is not captured into again. */
export const ALREADY_CAPTURED = "This snapshot already holds a capture; a snapshot is written once. Make a new one to capture the page again."

/** The most a snapshot holds, page and resources together. */
export const MAX_SNAPSHOT_BYTES = 2e7
/**
 * Room kept for the snapshot's small fields — title, source, capture,
 * budget, tally — which are a few hundred bytes.
 */
const FIELDS_BYTES = 2048
/** How long the page is waited for, and the reader's rendering of it (which waits for the page's network to go idle). */
export const PAGE_TIMEOUT_MS = 15000
export const READER_TIMEOUT_MS = 60000

const utf8Length = (text) => new TextEncoder().encode(text).byteLength
const jsonLength = (value) => utf8Length(JSON.stringify(value))

/**
 * A signal for one request, which fires when the call's does or after `ms`,
 * and says which it was. A page or a reader that accepts the connection and
 * never answers would otherwise hold the call until the platform gives up,
 * minutes later. `done()` once the body is read.
 */
function deadline(signal, ms) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, ms)
  const stop = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener?.("abort", stop)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done() {
      clearTimeout(timer)
      signal?.removeEventListener?.("abort", stop)
    },
  }
}
const seconds = (ms) => `no answer in ${Math.round(ms / 1000)} s`

const n = (value) => Number(value ?? 0).toLocaleString("en-US")
const when = (at) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`
const clock = (at) => `${new Date(at).toISOString().slice(11, 16)} UTC`

/** The reader's host, for saying whose rendering this is. */
function readerHost(ctx) {
  try {
    return new URL(ctx.reader ?? DEFAULT_READER).host
  } catch {
    return "the reader"
  }
}

/**
 * The page as anyone would get it: `{ok, response, body, type}` or the
 * outcome that stopped it. A refusal carries the guard's error, which ends
 * the call: the page redirected somewhere no tool may go.
 */
async function getDirect(target, ctx, fetchImpl) {
  const limit = deadline(ctx.signal, PAGE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(target, {
      signal: limit.signal,
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: ctx.direct ? { "user-agent": "patchwork-agent" } : {},
    })
    if (!response.ok) {
      try {
        response.body?.cancel?.()?.catch?.(() => {})
      } catch {
        /* nothing to cancel */
      }
      return { outcome: "http-error", detail: `HTTP ${response.status}`, status: response.status }
    }
    const body = await readCapped(response, MAX_PDF_BYTES)
    if (!body) return { outcome: "over-budget", detail: `larger than the ${size(MAX_PDF_BYTES)} kept of one page` }
    return { ok: true, response, body, type: response.headers?.get?.("content-type") ?? null }
  } catch (err) {
    if (ctx.signal?.aborted) throw err
    if (err?.refused) return { outcome: "refused", detail: err.reason, error: err }
    if (limit.timedOut()) return { outcome: "timeout", detail: seconds(PAGE_TIMEOUT_MS) }
    return { outcome: "unreachable", detail: ctx.direct ? "network" : "CORS or network" }
  } finally {
    limit.done()
  }
}

/**
 * The reader's rendering of the page: `{html, finalUrl, title}`, or
 * `{notAPage}` when it says there is no page to render, or `{status}` when
 * it would not answer (`timeout` when it never did).
 */
async function readerDom(target, ctx, fetchImpl) {
  const limit = deadline(ctx.signal, READER_TIMEOUT_MS)
  let response
  let body
  try {
    response = await fetchImpl(readerUrl(target, ctx.reader ?? DEFAULT_READER), {
      signal: limit.signal,
      headers: {
        accept: "application/json",
        "X-Return-Format": "html",
        // A capture is a record of the page now, never of the reader's cache.
        "x-no-cache": "true",
        "x-respond-timing": "network-idle",
      },
    })
    if (response.status === 422) return { notAPage: true, status: 422 }
    if (!response.ok) return { status: response.status }
    body = await response.text()
  } catch (err) {
    if (ctx.signal?.aborted || err?.refused) throw err
    return { status: limit.timedOut() ? "timeout" : null }
  } finally {
    limit.done()
  }
  let data = null
  try {
    const json = JSON.parse(body)
    data = json?.data ?? json
  } catch {
    data = null
  }
  const html = typeof data?.html === "string" ? data.html : typeof data?.content === "string" ? data.content : null
  if (!html || !html.trim() || html.trim() === "undefined" || /^Markdown Content:\s*undefined/m.test(html)) return { notAPage: true, status: response.status }
  return { html, finalUrl: typeof data.url === "string" ? data.url : null, title: typeof data.title === "string" ? data.title : null }
}

/** The reader's markdown of the target, or null. */
async function readerMarkdown(target, ctx, fetchImpl) {
  const limit = deadline(ctx.signal, READER_TIMEOUT_MS)
  try {
    const response = await fetchImpl(readerUrl(target, ctx.reader ?? DEFAULT_READER), { signal: limit.signal, headers: readerHeaders("markdown", true) })
    if (!response.ok) return { markdown: null, status: response.status }
    const markdown = await response.text()
    return { markdown: markdown.trim() ? markdown : null, status: response.status }
  } catch (err) {
    if (ctx.signal?.aborted || err?.refused) throw err
    return { markdown: null, status: limit.timedOut() ? "timeout" : null }
  } finally {
    limit.done()
  }
}

/** A target that is not a page, kept as the file it is; refused when capturing into a snapshot, which holds only a page. */
async function keepFile(target, direct, ctx, fetchImpl, at, into) {
  if (into) {
    const format = direct.ok ? formatOf(direct.body) : null
    const what = format ? `a ${format} file` : direct.ok ? `served as ${direct.type ? direct.type.split(";")[0].trim() : "something other than HTML"}` : "a PDF, by its address"
    throw new Error(`Not a page: ${target} is ${what}, and a web snapshot keeps web pages. Open or fetch it as a file instead.`)
  }
  ctx.progress?.("Not a page: keeping it as the file it is…")
  if (!direct.ok || formatOf(direct.body) === "PDF") {
    const pdf = !direct.ok
      ? direct
      : direct.body.byteLength > MAX_PDF_BYTES
        ? { outcome: "over-budget", detail: `larger than the ${size(MAX_PDF_BYTES)} kept as a PDF` }
        : { ok: true, response: direct.response, body: direct.body }
    const { markdown, status } = await readerMarkdown(target, ctx, fetchImpl)
    const kept = await keepPdf(target, { pdf, markdown, readerStatus: status, readerCache: "no-cache", at }, ctx)
    return { text: [`Not a page: a PDF. ${kept.lead}`, textLine(kept.ref, kept.marks)].filter(Boolean).join("\n"), doc: kept.ref }
  }
  const { ref, marks } = await keepResponse(ctx, { source: target, response: direct.response, body: direct.body, at })
  const lead = `Not a page (${ref.mimeType}), so kept as the file it is: '${ref.name}', ${size(ref.bytes)}, at ${ref.url}.`
  return { text: [lead, textLine(ref, marks)].filter(Boolean).join("\n"), doc: ref }
}

/** Where a kept source's text is, and its outline. */
function textLine(ref, marks) {
  if (ref.chars == null) return null
  const map = outline(marks)
  return [`Text: ${n(ref.chars)} chars — ${readOn(ref.url, 0)}.`, map].filter(Boolean).join("\n")
}

/** The page's <title>, from its tokens. */
function titleOf(tokens) {
  const at = tokens.findIndex((t) => t.type === "start" && t.name === "title")
  const text = at >= 0 && tokens[at + 1]?.type === "text" ? tokens[at + 1].text.replace(/\s+/g, " ").trim() : ""
  return text || null
}

/** How the page's HTML was had, for the result and the view. */
export function provenance(capture, { readerHost: host = "the reader", fallback = null } = {}) {
  if (capture.engine === "reader-dom") return `rendered by the reader (${host}), resources fetched directly`
  if (fallback) return `the reader was unavailable (${fallback}); kept the raw HTML, i.e. the page before its scripts ran`
  return "the raw response, i.e. the page before its scripts ran; resources fetched directly"
}

export const webCapture = {
  id: "web_capture",
  name: "Keep a web page",
  description: [
    "Keep a web page as it looks: the page as rendered, frozen so that nothing in it runs, with every stylesheet, font and image that can be fetched from here, in one web-snapshot document that opens later exactly as captured, offline. Use it when the page itself is the evidence — a datasheet, a price, a statement that may change — or the person wants to keep it. To read what a page says, web_fetch is cheaper.",
    "",
    "The result says what was kept and what was not, and why. The snapshot's text is read with source_read like any kept source. A PDF or other file is kept as the file it is.",
    "",
    "A URL whose snapshot is already kept here answers from it; pass `again` for a new one.",
  ].join("\n"),
  where: "worker",
  risk: "external",
  // See index.js: it works only through the context it is handed.
  scoped: true,
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "Absolute http(s) URL of the page." },
      again: { type: "boolean", description: "Capture again even if a snapshot of the page is already kept here." },
      render: {
        type: "boolean",
        description: "Outside a browser only: false keeps the raw HTML the server sent (the page before its scripts ran) instead of the reader's rendering. Default true.",
      },
      maxBytes: { type: "number", description: `The most to keep, page and resources together. Default and maximum ${size(MAX_SNAPSHOT_BYTES)}.` },
    },
  },

  execute(input, ctx) {
    return capture(input, ctx)
  },

  summarize(input, output) {
    let host = input?.url ?? ""
    try {
      host = new URL(input.url).host
    } catch {
      /* keep the raw string */
    }
    const text = String(output ?? "")
    if (text.startsWith("Already captured")) return `already captured · ${host}`
    if (text.startsWith("Not a page")) return `kept a file · ${host}`
    const kept = text.match(/(\d[\d,]*) of (\d[\d,]*) resources kept/)
    return kept ? `captured ${host} · ${kept[1]} of ${kept[2]} resources` : `captured ${host}`
  },
}

/**
 * Capture `input.url`. Into a new document from `ctx.repo` — or, with
 * `into`, into that empty snapshot's handle, once: a target that is not a
 * page is then refused rather than kept as some other kind of document, and
 * a snapshot that already holds a capture is never written over.
 */
export async function capture(input, ctx, { into = null } = {}) {
  const target = String(input.url ?? "").trim()
  if (!/^https?:\/\//i.test(target)) throw new Error("Pass an absolute http(s) URL.")
  const fetchImpl = fetcher(ctx)
  if (!into && typeof ctx?.repo?.create2 !== "function") throw new Error("There is no repo here, so nothing fetched can be kept.")
  if (into && isCaptured(into.doc())) throw new Error(ALREADY_CAPTURED)
  // The reader is handed the target inside its own URL, where the guard
  // cannot see it, so the target is checked here first.
  assertTarget(target, fetchImpl)

  if (!input.again && !into) {
    const kept = keptSources(ctx).find((e) => e.source === target && e.what === WHAT)
    if (kept) {
      return {
        text: `Already captured at ${kept.url} (${clock(kept.at)}). ${readOn(kept.url, 0)}. Pass again:true for a new snapshot.`,
        doc: { url: kept.url, name: kept.name, kind: "source", source: kept.source, engine: kept.engine, at: kept.at, what: WHAT },
      }
    }
  }

  // What the call is doing, for a person watching; the agent passes none.
  const progress = typeof ctx.progress === "function" ? ctx.progress : () => {}

  const at = Date.now()
  progress("Asking the page itself…")
  const direct = await getDirect(target, ctx, fetchImpl)
  if (direct.error) throw direct.error
  if (direct.ok && !sniffHtml(direct.body, direct.type)) return keepFile(target, direct, ctx, fetchImpl, at, into)
  if (!direct.ok && pdfByPath(target)) return keepFile(target, direct, ctx, fetchImpl, at, into)

  // The page's HTML, and how it was had.
  let page
  const raw = () => {
    const charset = htmlCharset(direct.body, direct.type)
    return {
      bytes: direct.body,
      charset,
      // What the page's unlabelled stylesheets are read in.
      inherited: charset,
      finalUrl: direct.response.url || null,
      title: null,
      capture: { via: "direct", engine: "raw", status: direct.response.status ?? null, contentType: direct.type, readerCache: null },
    }
  }
  let fallback = null
  if (ctx.direct && input.render === false && direct.ok) {
    page = raw()
  } else {
    progress(`Asking ${readerHost(ctx)} to render the page (up to ${Math.round(READER_TIMEOUT_MS / 1000)} s)…`)
    const rendered = await readerDom(target, ctx, fetchImpl)
    if (rendered.html != null) {
      const bytes = new TextEncoder().encode(rendered.html)
      page = {
        bytes,
        // The reader hands back text, so the page is UTF-8; but its DOM
        // keeps the page's own <meta charset>, which is what the page's
        // unlabelled stylesheets were written in.
        charset: "utf-8",
        inherited: metaCharset(bytes),
        finalUrl: rendered.finalUrl,
        title: rendered.title,
        capture: { via: "reader", engine: "reader-dom", status: null, contentType: null, readerCache: "no-cache" },
      }
    } else if (direct.ok) {
      fallback = rendered.notAPage ? "it found no page to render" : String(rendered.status ?? "no answer")
      page = raw()
    } else if (rendered.notAPage) {
      if (into) {
        throw new Error(`No page to keep: the reader found no page to render at ${target}, and it could not be fetched from here (${direct.outcome}: ${direct.detail}).`)
      }
      return keepExtract(target, direct, ctx, fetchImpl, at)
    } else {
      throw new Error(
        `Could not capture ${target}: the reader was unavailable (${rendered.status ?? "no answer"}) and the page could not be fetched from here (${direct.outcome}: ${direct.detail}).`
      )
    }
  }
  if (page.bytes.byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error(`Could not capture ${target}: its HTML alone is ${size(page.bytes.byteLength)}, more than the ${size(MAX_SNAPSHOT_BYTES)} a snapshot holds.`)
  }
  // The page's text, which the snapshot holds beside its HTML, and so
  // counts against its size with the HTML.
  const pageText = decode(page.bytes, page.charset)
  const tokens = scanHtml(pageText)
  const { text: readable, marks } = outlineText(tokens)
  const limit = Math.min(Number(input.maxBytes) > 0 ? Number(input.maxBytes) : MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_BYTES)
  const beside = utf8Length(readable) + jsonLength(marks) + FIELDS_BYTES

  // Its resources, within what is left of the snapshot's size. The page
  // as received is the estimate of what its frozen self will take.
  const base = documentBase(tokens, page.finalUrl ?? target)
  const links = pageLinks(tokens, base)
  progress("Fetching its stylesheets, fonts and images…")
  let budget = { ...DEFAULT_BUDGET, maxTotalBytes: Math.max(0, limit - page.bytes.byteLength - beside) }
  const fetchResource = resourceFetcher(fetchImpl, { direct: !!ctx.direct, maxResourceBytes: budget.maxResourceBytes, timeoutMs: budget.timeoutMs, signal: ctx.signal })
  let crawled = await crawl(links, fetchResource, budget, ctx.signal, { pageCharset: page.inherited })

  // The page frozen, with what it shows. Its frozen size, and what is
  // recorded of each resource, are known only now; while they do not fit,
  // the same answers are resolved again with less room: by the prefix rule
  // that keeps fewer of the same resources, in the same order, and
  // fetches nothing.
  progress("Freezing the page…")
  let frozen
  let resources
  for (;;) {
    frozen = await freezePage({ text: pageText, base, resources: crawled.resources, blobs: blobsOf(crawled.resources, crawled.table) })
    resources = withStored(crawled.resources, frozen.stored)
    const stored = frozen.html.byteLength + Object.values(frozen.blobs).reduce((sum, bytes) => sum + bytes.byteLength, 0)
    const over = stored + jsonLength(resources) + beside - limit
    if (over <= 0 || crawled.tally.keptBytes === 0) break
    budget = { ...budget, maxTotalBytes: Math.max(0, crawled.tally.keptBytes - over) }
    crawled = { ...resolve(links, crawled.table, budget, { aborted: !crawled.complete, pageCharset: page.inherited }), table: crawled.table }
  }
  const title = page.title?.trim() || titleOf(tokens) || sourceName(target, null, "html").replace(/\.html$/, "")
  // Ordered so the fields read in the same order as the document's shape.
  const keptCapture = {
    at,
    finalUrl: page.finalUrl ?? null,
    via: page.capture.via,
    engine: page.capture.engine,
    status: page.capture.status ?? null,
    contentType: page.capture.contentType ?? null,
    // Of what is stored, the frozen page: the primary.
    sha256: await sha256Hex(frozen.html),
    bytes: frozen.html.byteLength,
    readerCache: page.capture.readerCache ?? null,
    // Of the page as it arrived, before it was frozen.
    received: { sha256: await sha256Hex(page.bytes), bytes: page.bytes.byteLength, charset: page.charset },
  }

  // One document, written in one change: a crash leaves nothing half-kept.
  progress("Writing the snapshot…")
  const write = (d) => {
    d["@patchwork"] = { type: WEB_SNAPSHOT }
    d.title = title
    d.source = target
    d.capture = keptCapture
    d.html = frozen.html
    d.base = base
    d.resources = resources
    d.blobs = frozen.blobs
    d.budget = budget
    d.tally = crawled.tally
    d.complete = crawled.complete
    d.text = new ImmutableString(readable)
    d.textVia = "html-to-text"
    d.marks = marks
    d.pages = null
    d.missing = null
  }
  let handle = into
  if (into) {
    // Checked again inside the change: whatever was true when the capture
    // began, a snapshot that holds a capture by now is not written over.
    into.change((d) => {
      if (isCaptured(d)) throw new Error(ALREADY_CAPTURED)
      write(d)
    })
  } else {
    handle = await ctx.repo.create2()
    handle.change(write)
  }

  const ref = {
    url: handle.url,
    name: title,
    kind: "source",
    bytes: frozen.html.byteLength + Object.values(frozen.blobs).reduce((sum, bytes) => sum + bytes.byteLength, 0),
    chars: readable.length,
    mimeType: "text/html",
    binary: true,
    role: "primary",
    source: target,
    engine: keptCapture.engine,
    at,
    what: WHAT,
  }
  return { text: resultText({ ref, title, target, capture: keptCapture, crawled, marks, fallback, host: readerHost(ctx), direct: !!ctx.direct }), doc: ref }
}

/** Each kept resource, with the blob that holds it as stored: a stylesheet's or an SVG's is its frozen self. */
function withStored(resources, stored) {
  const out = {}
  for (const [url, r] of Object.entries(resources)) out[url] = url in stored ? { ...r, stored: stored[url] } : r
  return out
}

/** When neither the reader nor a direct request has the page: the reader's text, and the reason the page is missing. */
async function keepExtract(target, direct, ctx, fetchImpl, at) {
  ctx.progress?.("No page to keep: asking the reader for its text…")
  const { markdown, status } = await readerMarkdown(target, ctx, fetchImpl)
  if (markdown == null) {
    throw new Error(`Could not capture ${target}: the reader found no page to render (${status ?? "no answer"}) and the page could not be fetched from here (${direct.outcome}: ${direct.detail}).`)
  }
  const { ref, marks } = await keepSource(ctx, {
    source: target,
    role: "extract",
    content: markdown,
    mimeType: "text/markdown",
    capture: { at, via: "reader", engine: "reader-markdown", readerCache: "no-cache" },
    missing: { what: "primary", outcome: direct.outcome, detail: direct.detail },
  })
  const lead = `No snapshot: the reader found no page to render and the page could not be fetched from here (${direct.outcome}: ${direct.detail}). Kept the reader's text instead (${n(ref.chars)} chars) at ${ref.url}.`
  return { text: [lead, textLine(ref, marks)].filter(Boolean).join("\n"), doc: ref }
}

/** The result of a capture: what, from where and how; what was kept and what was not; where the text is. */
function resultText({ ref, title, target, capture, crawled, marks, fallback, host }) {
  const { tally, resources } = crawled
  const fetchable = tally.found - Object.values(tally.policy).reduce((a, b) => a + b, 0)
  const lines = [
    `Captured '${title}' from ${target} at ${when(capture.at)} — ${provenance(capture, { readerHost: host, fallback })}.`,
    `${ref.url} — web snapshot, ${size(capture.bytes)} HTML; ${n(tally.kept)} of ${n(fetchable)} resources kept (${size(tally.keptBytes)}).`,
  ]
  const missing = notKeptLine(resources)
  const policy = policyLine(tally.policy)
  if (missing || policy) lines.push([missing && `Not kept: ${missing}.`, policy && `By policy: ${policy}.`].filter(Boolean).join(" "))
  if (!crawled.complete) lines.push("Stopped part-way: what was not fetched is marked aborted; what was kept is whole.")
  lines.push(`Text: ${n(ref.chars)} chars — ${readOn(ref.url, 0)}.`)
  const map = outline(marks)
  if (map) lines.push(map)
  return lines.join("\n")
}

export default webCapture
