/**
 * Web tools — ours, not a provider's.
 *
 * The model-independence decision rules out leaning on any provider's hosted
 * search, so the agent needs its own way to read the web. The binding
 * constraint is CORS: a browser cannot fetch an arbitrary origin, and a Web
 * Worker cannot either — workers are subject to exactly the same origin policy,
 * which is the single most common misconception about moving work off the main
 * thread.
 *
 * So these go through a *reader* endpoint that serves permissive CORS and
 * returns readable markdown. That covers reading and searching from the browser
 * today, with no proxy of our own and no API key. Anything the reader cannot
 * reach — an intranet page, a site that blocks it, a request needing custom
 * headers — is what the task tier is for: the same tool, claimed by a runner
 * outside the browser, where no origin policy applies.
 *
 * The endpoint is configurable precisely so that swap is a config change rather
 * than a rewrite.
 */

import { bytes } from "../documents/format.js"
import { keepSource, sourceFooter, findKept, readOn } from "./sources.js"
import { titleFrom, mediaType, isTextResponse, decodeText, isPdf, formatOf, MAX_PDF_BYTES } from "../documents/media.js"
import { fetcher, assertTarget } from "../net/guard.js"
import { Interruption, isInterruption, asInterruption } from "../net/network.js"
import { readPdf, pdfSummary } from "../documents/pdf-text.js"

/**
 * Strip HTML down to readable text.
 *
 * Used wherever we hold a page's own bytes rather than a reader's markdown of
 * it: the text kept beside an HTML response. Crude on purpose: the goal is
 * text a model can read, not faithful rendering.
 */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    // Stripping a tag leaves the whitespace that surrounded it, so every line
    // would otherwise start with a space.
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Search is Brave's Search API: an index of its own, and an API meant for
 * programs, so a search is a request the engine agreed to answer. (Scraping
 * DuckDuckGo's results page got its bot check instead, which read as "no
 * results", and the agent went on to guess URLs.)
 *
 * It needs the account's key (kept with the API keys) and, in a browser, the
 * fetch relay: Brave's API does not answer pages on other origins. The relay
 * passes the key to Brave's API and to nothing else.
 *
 * A runner hands tools `ctx.search` (braveSearch below), not the key: the key
 * is closed over, so a tool can search — a research step's admitted plugins
 * included — but never read it.
 */
export const BRAVE_SEARCH = "https://api.search.brave.com/res/v1/web/search"
export const BRAVE_KEY_HEADER = "x-subscription-token"
/** The same search as a person would see it: the kept record's source. */
const BRAVE_PAGE = "https://search.brave.com/search?q="
/** The most results Brave returns to one request. */
export const BRAVE_MAX = 20

/** The API request for `query`, asking for `count` results. */
export function braveSearchUrl(query, count) {
  return `${BRAVE_SEARCH}?q=${encodeURIComponent(query)}&count=${count}`
}

/**
 * A runner's `ctx.search`: `search(query, count, signal)` asks Brave through
 * the runner's guarded fetch with `key()`, read afresh each time;
 * `search.ready()` says whether there is a key.
 */
export function braveSearch({ key, fetchImpl }) {
  const search = (query, count, signal) =>
    fetchImpl(braveSearchUrl(query, count), { signal, headers: { accept: "application/json", [BRAVE_KEY_HEADER]: key() } })
  search.ready = () => !!key()
  return search
}

/**
 * Results out of Brave's JSON: title, URL and the engine's excerpt, its
 * emphasis tags and entities undone. Pure, so the parsing is unit-tested.
 */
export function parseBraveResults(json, limit = 8) {
  const results = []
  const seen = new Set()
  for (const result of json?.web?.results ?? []) {
    if (results.length >= limit) break
    const url = String(result?.url ?? "")
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue
    seen.add(url)
    results.push({ title: htmlToText(result.title ?? "") || url, url, snippet: cleanSnippet(htmlToText(result.description ?? "")) })
  }
  return results
}

/** Why a search cannot run on this runner, or null when it can. */
function searchMissing(ctx) {
  const missing = []
  if (!ctx.search?.ready?.()) missing.push("a Brave Search API key (the agent's settings, under Web search)")
  if (!ctx.direct) missing.push("the fetch relay (the agent's settings, under Fetch relay), because Brave's API does not answer a browser page directly")
  if (!missing.length) return null
  return `Web search is not set up here: it needs ${missing.join(" and ")}. Tell the person so in one line. Until then, web_fetch only URLs you were given or found in what you have read — a guessed URL is usually a 404.`
}

/** What a failed search says, by Brave's status. */
function searchFailed(status, relayed) {
  if (status === 401 || status === 403 || status === 422) {
    const relay = relayed ? " If the key is right, the fetch relay may be older than this agent and not passing it on: redeploy fetch-relay." : ""
    return `Brave Search refused the search (HTTP ${status}): the key may be wrong or expired — the person can check it in the agent's settings, under Web search.${relay}`
  }
  if (status === 429) return "Brave Search's rate or monthly limit was reached (HTTP 429). Carry on without searching, and say so."
  return `Search failed (HTTP ${status}).`
}

/** How much of an engine's excerpt a result shows. */
export const SNIPPET_MAX = 300

/** An excerpt on one line, without emphasis marks, cut at SNIPPET_MAX. */
export function cleanSnippet(text) {
  const line = String(text ?? "").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim()
  if (!line) return null
  return line.length > SNIPPET_MAX ? `${line.slice(0, SNIPPET_MAX - 1).trimEnd()}…` : line
}

export const DEFAULT_READER = "https://r.jina.ai/"

/**
 * What a page can be asked to come back as. There is no `html`: the reader's
 * rendering of a DOM is not something to keep under the page's name, and a
 * page's own bytes are what http_request keeps.
 */
export const FORMATS = ["markdown", "text"]

const FORMAT_MIME = { markdown: "text/markdown", text: "text/plain" }

/** How much of a page a result shows. The rest is a source_read away. */
export const EXCERPT = 6000

/**
 * Headers that tell the reader what to send back.
 *
 * The reader caches and says so in its markdown ("This is a cached snapshot").
 * `x-no-cache` opts out, which matters when the question is what a page says
 * NOW rather than what it usually says.
 */
export function readerHeaders(format = "markdown", fresh = false) {
  const headers = { accept: "text/plain", "X-Return-Format": format }
  if (fresh) headers["x-no-cache"] = "true"
  return headers
}

/** Build the reader URL for a target page. */
export function readerUrl(target, reader = DEFAULT_READER) {
  return reader + target
}

/**
 * The body of a response, read once, as bytes.
 *
 * Calling response.text() first is the bug this exists to avoid: it decodes as
 * UTF-8 with replacement, so a PDF or a wasm module comes back full of U+FFFD
 * and still looks like a successful result. A fetch implementation that cannot
 * hand back bytes is used only when what it returns is undamaged text.
 */
export async function readBytes(response) {
  if (typeof response.arrayBuffer === "function") return new Uint8Array(await response.arrayBuffer())
  const text = await response.text()
  if (/\ufffd/.test(text)) {
    throw new Error(
      "This response is binary and the fetch implementation in use cannot return bytes, so it cannot be retrieved without corrupting it."
    )
  }
  return new TextEncoder().encode(text)
}

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"])

/**
 * Keep a response exactly as it came: text decoded by its own charset, bytes as
 * bytes. An HTML page also gets its text beside it, so reading it later is
 * reading prose rather than markup.
 */
export async function keepResponse(ctx, { source, response, body, at }) {
  const contentType = response.headers?.get?.("content-type") ?? null
  const textual = isTextResponse(contentType, body)
  const type = mediaType(contentType) || (textual ? "text/plain" : "application/octet-stream")
  const capture = { at, finalUrl: response.url || null, via: "direct", engine: "raw", status: response.status ?? null, contentType }
  if (!textual) return keepSource(ctx, { source, content: body, mimeType: type, capture })

  const decoded = decodeText(body, contentType)
  if (!HTML_TYPES.has(type)) return keepSource(ctx, { source, content: decoded, mimeType: type, capture })
  const title = decoded.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return keepSource(ctx, {
    source,
    content: decoded,
    mimeType: type,
    capture,
    title: title ? htmlToText(title) : null,
    text: htmlToText(decoded),
    textVia: "html-to-text",
  })
}

/** Does the URL's path say PDF? One of the three signals; the others are the reader's and the bytes'. */
export function pdfByPath(url) {
  try {
    return /\.pdf$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** The reader's markdown of a PDF carries a page count; a page's never does. */
export const readerSaysPdf = (markdown) => /^Number of Pages:/m.test(String(markdown ?? ""))

/**
 * Ask for a target's own response, as anyone would get it: `{response}`, or
 * the outcome that stopped it — `refused` (with the guard's error, so a
 * caller can let it stand), `unreachable` or `http-error` — with a detail fit
 * to show the model. Aborting is not an outcome; it ends the call.
 */
async function requestDirect(target, ctx, fetchImpl) {
  let response
  try {
    response = await fetchImpl(target, {
      signal: ctx.signal,
      // No cookies and no referrer: what is kept is what anyone would get.
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      // A header outside CORS's safelist would make a browser send a preflight
      // that most file hosts refuse, so the user agent is named only in node.
      headers: ctx.direct ? { "user-agent": "patchwork-agent" } : {},
    })
  } catch (err) {
    if (ctx.signal?.aborted) throw err
    // This end has no network (or no relay): not the site's answer, and not
    // the model's to hear. The call runs again when the network is back.
    const interruption = asInterruption(err, `Could not fetch ${target}`)
    if (interruption) throw interruption
    if (err?.refused) return { outcome: "refused", detail: err.reason, error: err }
    // A browser reports a CORS refusal and a network failure identically;
    // outside one there is no CORS to blame.
    return { outcome: "unreachable", detail: ctx.direct ? "network" : "CORS or network" }
  }
  if (!response.ok) return { outcome: "http-error", detail: `HTTP ${response.status}` }
  return { response }
}

const tooBig = () => ({ outcome: "over-budget", detail: `larger than the ${bytes(MAX_PDF_BYTES)} kept as a PDF` })

/** Bytes already read, judged as a PDF: kept when they are one and within the cap. */
function judgePdf(response, body) {
  if (body.byteLength > MAX_PDF_BYTES) return tooBig()
  if (!isPdf(body)) return { outcome: "type-mismatch", detail: "the response is not a PDF" }
  return { ok: true, response, body }
}

/**
 * Get a response's own bytes, expecting a PDF: `{ok, response, body}`, or the
 * outcome that stopped it — one of requestDirect's, `over-budget` or
 * `type-mismatch`. A body its headers say is over the cap is never read.
 */
export async function fetchPdf(target, ctx, fetchImpl) {
  const got = await requestDirect(target, ctx, fetchImpl)
  return got.response ? pdfFrom(got.response) : got
}

/** A response expected to be a PDF, read only when its headers do not already put it over the cap. */
async function pdfFrom(response) {
  if (Number(response.headers?.get?.("content-length")) > MAX_PDF_BYTES) {
    response.body?.cancel?.()
    return tooBig()
  }
  return judgePdf(response, await readBytes(response))
}

/** The error for a reader that would not read a page, saying what to try instead. */
function readerRefused(target, status) {
  // 422 means the reader could not treat it as a page — which is what happens
  // when it is not one. Watched cost two calls: an agent after a JavaScript
  // bundle tried two page tools in turn and was told both times to try a
  // different page, which was not the problem.
  const notAPage = status === 422 || /\.(js|mjs|json|css|txt|xml|csv|map)(\?|$)/i.test(target)
  return new Error(
    notAPage
      ? `The reader could not read ${target} (${status}). This looks like a file rather than a page — fetch it with http_request, which returns it as it is.`
      : `Could not read ${target} (${status}). The reader may be blocked by that site; try a different page.`
  )
}

const n = (value) => Number(value ?? 0).toLocaleString("en-US")
const clock = (at) => `${new Date(at).toISOString().slice(11, 16)} UTC`

/** Ask the reader for a page, in the format wanted. */
async function viaReader(target, format, input, ctx, fetchImpl) {
  return fetchImpl(readerUrl(target, ctx.reader ?? DEFAULT_READER), {
    signal: ctx.signal,
    headers: readerHeaders(format, input.fresh),
  })
}

/**
 * The status the site gave the reader, when it was an error, or null.
 *
 * The reader answers 200 even when the site did not: it says so in its
 * header ("Warning: Target URL returned error 404: Not Found") and renders the
 * error page — a 404, or a bot wall — as though it were the page. Kept, that
 * was a source made of an error page.
 */
export function readerSiteError(markdown) {
  const header = String(markdown ?? "").split(/^Markdown Content:/m)[0]
  const match = header.match(/^Warning: Target URL returned error (\d{3})/m)
  return match ? Number(match[1]) : null
}

/** The reader's text of a page, or null with why: the reader's status, or the site's. */
async function readerText(response) {
  if (!response.ok) return { markdown: null, why: response.status }
  const markdown = await response.text()
  const site = readerSiteError(markdown)
  return site ? { markdown: null, why: `the site answered it ${site}`, site } : { markdown, why: null }
}

/**
 * The PDF's own text, read from its bytes here (documents/pdf-text.js): `{text, marks,
 * summary}`, or null when there is none — bytes pdf.js cannot open, or a scan
 * with no text layer, whose `summary` says so.
 */
async function ownText(body) {
  let read
  try {
    read = await readPdf(body)
  } catch {
    return null
  }
  const summary = pdfSummary(read.extracted)
  return read.extracted.scanned ? { text: null, marks: [], summary } : { text: read.text, marks: read.marks, summary }
}

/**
 * Keep the PDF's bytes with the text read from them, or — when they hold none,
 * or could not be had — the reader's text, which is asked for only then:
 * `askReader()` gives `{markdown, why}`. The reader's text with the reason the
 * PDF is missing is kept when the bytes could not be fetched.
 */
export async function keepPdf(target, { pdf, markdown = null, readerStatus = null, readerCache, at, askReader }, ctx) {
  if (pdf.ok) {
    const mine = await ownText(pdf.body)
    if (!mine?.text && markdown == null && askReader) ({ markdown, why: readerStatus } = await askReader())
    const text = mine?.text ?? markdown
    const { ref, marks, capture } = await keepSource(ctx, {
      source: target,
      content: pdf.body,
      mimeType: "application/pdf",
      title: titleFrom(markdown),
      text,
      textVia: mine?.text ? "pdf" : "reader",
      marks: mine?.text ? mine.marks : undefined,
      capture: {
        at,
        finalUrl: pdf.response.url || null,
        via: "direct",
        engine: "raw",
        status: pdf.response.status ?? null,
        contentType: pdf.response.headers?.get?.("content-type") ?? null,
      },
    })
    const head = `Kept the PDF itself (${n(ref.bytes)} bytes, sha256 ${capture.sha256.slice(0, 8)}…)`
    const what = mine?.text
      ? `${head} and its text (${n(ref.chars)} chars, read from the PDF: ${mine.summary}) at ${ref.url}`
      : markdown != null
        ? `${head} and its text (${n(ref.chars)} chars, via reader${mine ? `; ${mine.summary}` : ""}) at ${ref.url}`
        : `${head} at ${ref.url}. It has no text${mine ? `: ${mine.summary}` : ` to read here (the reader was unavailable too: ${readerStatus})`}. Open it in Patchwork to look at it.`
    return { ref, marks, text, lead: what }
  }
  if (markdown == null && askReader) ({ markdown, why: readerStatus } = await askReader())
  if (markdown == null) {
    throw new Error(
      `Could not keep ${target}: the PDF could not be fetched from here (${pdf.outcome}: ${pdf.detail}) and the reader was unavailable (${readerStatus}).`
    )
  }
  const { ref, marks } = await keepSource(ctx, {
    source: target,
    role: "extract",
    content: markdown,
    mimeType: "text/markdown",
    capture: { at, via: "reader", engine: "reader-markdown", readerCache },
    missing: { what: "pdf", outcome: pdf.outcome, detail: pdf.detail },
  })
  const lead = `Kept the reader's text (${n(ref.chars)} chars) at ${ref.url}; the PDF itself could not be fetched from here (${pdf.outcome}: ${pdf.detail}).`
  return { ref, marks, text: markdown, lead }
}

/** In a browser: the reader first (it is needed anyway), then a PDF's bytes when there is a signal for one. */
async function readInBrowser(target, format, input, ctx, fetchImpl, at) {
  const readerCache = input.fresh ? "no-cache" : "allowed"
  // A PDF's own bytes carry its words (documents/pdf-text.js), so when the path says PDF
  // they are asked for first and the reader only when they hold none.
  if (pdfByPath(target)) {
    const pdf = await fetchPdf(target, ctx, fetchImpl)
    const askReader = async () => {
      const { markdown, why } = await readerText(await viaReader(target, format, input, ctx, fetchImpl))
      return { markdown, why }
    }
    return keepPdf(target, { pdf, readerCache, at, askReader }, ctx)
  }
  const response = await viaReader(target, format, input, ctx, fetchImpl)
  const { markdown, why, site } = await readerText(response)
  if (markdown == null) {
    if (site) throw new Error(`Could not fetch ${target} (http-error: HTTP ${site}, as the reader found it).`)
    throw readerRefused(target, response.status)
  }
  if (readerSaysPdf(markdown)) {
    const pdf = await fetchPdf(target, ctx, fetchImpl)
    return keepPdf(target, { pdf, markdown, readerCache, at }, ctx)
  }
  const { ref, marks } = await keepSource(ctx, {
    source: target,
    role: "extract",
    content: markdown,
    mimeType: FORMAT_MIME[format],
    capture: { at, via: "reader", engine: `reader-${format}`, readerCache },
  })
  const title = titleFrom(markdown) ?? ref.name
  const cache = input.fresh ? "fetched fresh by the reader" : "the reader may have answered from its cache"
  return { ref, marks, text: markdown, lead: `Kept '${title}' — reader extract, ${n(ref.chars)} chars — ${ref.url} (${cache})` }
}

/**
 * In node: the response first, read once as bytes. No origin policy applies,
 * so the page itself is kept — HTML with its text beside it — and the reader
 * is asked only for a PDF's text.
 *
 * What says PDF: the path, the content type, or the bytes starting `%PDF`.
 * Only a PDF is held to the PDF cap; any other response is kept whole, as
 * http_request keeps it.
 */
async function readDirect(target, input, ctx, fetchImpl, at) {
  const withReader = async (pdf) => {
    const askReader = async () => {
      const { markdown, why } = await readerText(await viaReader(target, "markdown", input, ctx, fetchImpl))
      return { markdown, why }
    }
    return keepPdf(target, { pdf, readerCache: input.fresh ? "no-cache" : "allowed", at, askReader }, ctx)
  }

  const got = await requestDirect(target, ctx, fetchImpl)
  const typed = mediaType(got.response?.headers?.get?.("content-type")) === "application/pdf"
  if (pdfByPath(target) || typed) return withReader(got.response ? await pdfFrom(got.response) : got)
  // A refusal by the guard stands as the call's answer.
  if (got.error) throw got.error
  if (!got.response) {
    // The site would not hand over the page itself — some refuse fetchers
    // like a relay or a server, some are down. The reader may still read it:
    // keep its text, and say plainly that it is not the original.
    const read = await readInBrowser(target, "markdown", input, ctx, fetchImpl, at).catch((err) => {
      if (isInterruption(err)) throw err
      return null
    })
    if (read) return { ...read, lead: `${read.lead}. The page itself could not be had (${got.outcome}: ${got.detail}), so what is kept is the reader's text of it, not the original.` }
    throw new Error(`Could not fetch ${target} (${got.outcome}: ${got.detail}).`)
  }

  const body = await readBytes(got.response)
  if (isPdf(body)) return withReader(judgePdf(got.response, body))
  const { ref, marks } = await keepResponse(ctx, { source: target, response: got.response, body, at })
  const kept = readableOf(ref, { response: got.response, body })
  const lead =
    kept == null
      ? `Kept '${ref.name}' — ${formatOf(body) ?? ref.mimeType} bytes, ${bytes(ref.bytes)} — ${ref.url}. There is no text in it to read here; open it in Patchwork.`
      : `Kept '${ref.name}' — the response itself (${ref.mimeType}, ${n(ref.chars)} chars of text) — ${ref.url}`
  return { ref, marks, text: kept, lead }
}

/** The readable text of a response just kept, without reading the document back. */
function readableOf(ref, { response, body }) {
  if (ref.binary) return null
  const decoded = decodeText(body, response.headers?.get?.("content-type"))
  return HTML_TYPES.has(mediaType(ref.mimeType)) ? htmlToText(decoded) : decoded
}

/**
 * Read a page: through the reader in a browser, directly in node. Either way
 * what comes back is kept, and the result is an excerpt of it.
 *
 * A PDF is the case that matters most and was handled worst: the reader's
 * markdown of a paper is not the paper. When the path ends `.pdf`, the reader
 * reports a page count, or (in node) the response says application/pdf or its
 * bytes start `%PDF`, the bytes are
 * fetched and kept as the primary, with the reader's text beside them. When
 * they cannot be had — a browser's CORS, a 404, something that is not a PDF,
 * more than the cap — the reader's text is kept as an extract and the result
 * says why the PDF is missing.
 */
export const webFetch = {
  id: "web_fetch",
  scoped: true,
  name: "Read a web page",
  description: [
    "Fetch a web page and return the start of its readable text. Use it to read documentation, articles, papers, or anything you found with web_search.",
    "",
    "Everything fetched is kept as a document, and the result says where. A PDF is kept as the PDF itself, whenever it can be fetched from here, with the text read from it beside it, each page under a `[Page N]` line so you can cite the page. A scan with no text layer is kept without text, and the result says so. Read further with source_read on that document — by offset, or with `find` to jump to what you need — rather than fetching again: it is free, and the offsets never shift.",
    "",
    "Fetching a URL this conversation already kept answers from the kept copy without a request; pass `fresh` when you need what it says now.",
  ].join("\n"),
  where: "worker",
  risk: "external",
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "Absolute http(s) URL." },
      format: {
        type: "string",
        enum: FORMATS,
        description: "markdown to read it (the default), text for bare visible text.",
      },
      fresh: {
        type: "boolean",
        description: "Fetch again even if this conversation already kept the page, and skip the reader's cache. Use it when the page's content changes.",
      },
      maxChars: { type: "number", description: `How much of the text to show in the result. Default ${EXCERPT}; the rest is read with source_read.` },
    },
  },
  async execute(input, ctx) {
    const target = String(input.url ?? "").trim()
    if (!/^https?:\/\//.test(target)) throw new Error("Pass an absolute http(s) URL.")
    const fetchImpl = fetcher(ctx)
    // The reader is handed the target inside its own URL, where the guard
    // cannot see it, so the target is checked here first.
    assertTarget(target, fetchImpl)
    const format = FORMATS.includes(input.format) ? input.format : "markdown"

    if (!input.fresh) {
      // The response itself, kept by any tool, answers too: it is the page.
      const kept = await findKept(ctx, { source: target, engines: [`reader-${format}`, "raw"] })
      if (kept) {
        return {
          text: `Already kept at ${kept.url} (fetched ${clock(kept.at)}). ${readOn(kept.url, 0)}. Pass fresh:true to fetch again.`,
          doc: { url: kept.url, name: kept.name, kind: "source", bytes: kept.bytes ?? null, source: kept.source, engine: kept.engine, at: kept.at },
        }
      }
    }

    const at = Date.now()
    const read = ctx.direct
      ? await readDirect(target, input, ctx, fetchImpl, at)
      : await readInBrowser(target, format, input, ctx, fetchImpl, at)

    const max = Math.max(0, Math.floor(input.maxChars ?? EXCERPT))
    const lines = [read.lead]
    if (read.text != null) {
      const shown = Math.min(max, read.text.length)
      lines.push(read.text.slice(0, shown), sourceFooter(read.ref, shown, read.marks))
    }
    // What was kept is the page's text. When a claim will rest on the page
    // itself — how it looks, or what it says today if it may change — a
    // frozen snapshot keeps that too; say so only where web_capture is here.
    if (read.ref && !/pdf/i.test(String(read.ref.mimeType ?? "")) && ctx.hasTool?.("web_capture")) {
      lines.push(`To keep the page as it looks — for a claim that rests on it, or if it may change — web_capture { url: "${target}" }.`)
    }
    return { text: lines.join("\n"), doc: read.ref }
  },
  summarize(input, output) {
    let host = input?.url ?? ""
    try {
      host = new URL(input.url).host
    } catch {
      /* keep the raw string */
    }
    const text = String(output ?? "")
    if (text.startsWith("Already kept")) return `already kept · ${host}`
    const pdf = text.match(/^Kept the PDF itself \(([\d,]+) bytes/)
    if (pdf) return `fetched ${host} · PDF, ${bytes(Number(pdf[1].replace(/,/g, "")))}`
    const total = text.match(/— \d+ of (\d+) shown|— all (\d+) characters shown/)
    return total ? `fetched ${host} · ${bytes(Number(total[1] ?? total[2]))}` : `fetched ${host}`
  },
}

export const webSearch = {
  id: "web_search",
  scoped: true,
  name: "Search the web",
  // A search is about no document and no site. Left to the default rule it was
  // keyed on the session's subject, and "any document" on its card wrote
  // `web@*`: every site, for every web tool.
  target: "none",
  description:
    "Search the web: each result's title, URL and the engine's excerpt of it. Choose from the excerpts what is worth reading, then web_fetch it — an excerpt is the engine's words, not the page's, so cite the page once fetched. The results page is kept, as a record of what the search returned. Prefer specific queries.",
  where: "worker",
  risk: "external",
  input_schema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", description: "What to search for. Specific beats broad; this returns links, not answers." },
      limit: { type: "number", description: "How many results, at most 20. Default 8." },
    },
  },
  async execute(input, ctx) {
    const query = String(input.query ?? "").trim()
    if (!query) throw new Error("Pass a query.")

    fetcher(ctx) // nothing is asked of the web without the runner's guarded fetch
    const missing = searchMissing(ctx)
    if (missing) throw new Error(missing)
    const limit = Math.min(BRAVE_MAX, Math.max(1, Math.floor(Number(input.limit) || 8)))

    const at = Date.now()
    let response
    try {
      response = await ctx.search(query, limit, ctx.signal)
    } catch (err) {
      if (ctx.signal?.aborted) throw err
      // Brave's endpoint is fixed and up, so no answer from it — or a name of
      // its that would not resolve — is this end's network: an interruption,
      // and the search runs again when the network is back (net/network.js).
      throw isInterruption(err) ? err : new Interruption(`Could not reach the search API (${err?.reason ?? err?.message ?? err})`, { cause: err })
    }
    if (!response.ok) throw new Error(searchFailed(response.status, !!response.relayed))
    const body = await response.text()
    let json
    try {
      json = JSON.parse(body)
    } catch {
      throw new Error("Search failed: Brave's answer was not the JSON its API sends.")
    }
    const results = parseBraveResults(json, limit)

    // What the search returned, as it came — how the agent came to read what
    // it read, kept with this run for provenance. Best-effort: a runner that
    // cannot keep still searches.
    const source = BRAVE_PAGE + encodeURIComponent(query)
    let kept = null
    try {
      kept = (
        await keepSource(ctx, {
          source,
          role: "extract",
          content: body,
          mimeType: "application/json",
          title: `Search: ${query}`,
          capture: { at, via: "direct", engine: "search", status: response.status ?? null },
        })
      ).ref
    } catch {
      kept = null
    }

    const keptLine = kept ? [`Results page kept at ${kept.url}.`] : []
    if (!results.length) return { text: [`No results for "${query}".`, ...keptLine].join("\n"), doc: kept }
    return {
      text: [
        `${results.length} results for "${query}":`,
        ...results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   “${r.snippet}”` : ""}`),
        ...keptLine,
      ].join("\n"),
      doc: kept,
    }
  },
  summarize(input, output) {
    const match = String(output ?? "").match(/^(\d+) results/)
    return `searched "${input?.query}" · ${match ? match[1] : "0"} results`
  },
}

export default [webSearch, webFetch]
