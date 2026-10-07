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

import { truncate, bytes } from "./format.js"
import { saveSource, sourceFooter, SPILL_AT } from "./sources.js"

/**
 * Strip HTML down to readable text.
 *
 * Only used in direct mode, where we fetched the page ourselves rather than
 * asking a reader service for markdown. Crude on purpose: the goal is text a
 * model can read, not faithful rendering.
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

/** Pull results straight out of DuckDuckGo's HTML, for direct mode. */
export function parseDuckDuckGoHtml(html, limit = 8) {
  const results = []
  const seen = new Set()
  const anchor = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = anchor.exec(String(html ?? ""))) !== null && results.length < limit) {
    const url = unwrapRedirect(match[1].replace(/&amp;/g, "&"))
    const title = htmlToText(match[2])
    if (!/^https?:\/\//.test(url) || seen.has(url) || !title) continue
    seen.add(url)
    results.push({ title, url })
  }
  return results
}

export const DEFAULT_READER = "https://r.jina.ai/"

/** What a page can be asked to come back as. */
export const FORMATS = ["markdown", "html", "text"]

const FORMAT_MIME = { markdown: "text/markdown", html: "text/html", text: "text/plain" }

/**
 * Headers that tell the reader what to send back.
 *
 * `X-Return-Format: html` returns the DOM after the page's scripts have run,
 * which is the whole point for a dynamic page: a single-page app's markdown is
 * its chrome, and a code editor's is its line numbers. Measured against the live
 * reader, along with the other two formats.
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
const SEARCH_ENGINE = "https://duckduckgo.com/html/?q="

/** Build the reader URL for a target page. */
export function readerUrl(target, reader = DEFAULT_READER) {
  return reader + target
}

/**
 * DuckDuckGo's HTML results wrap every outbound link in a redirect
 * (`/l/?uddg=<encoded>`). Unwrap it so the model gets the real URL and can pass
 * it straight back to web_fetch.
 */
export function unwrapRedirect(href) {
  try {
    const url = new URL(href, "https://duckduckgo.com")
    if (url.pathname === "/l/" && url.searchParams.has("uddg")) {
      return url.searchParams.get("uddg")
    }
    return href
  } catch {
    return href
  }
}

/**
 * Pull `[title](url)` pairs out of the reader's markdown, dropping the engine's
 * own chrome links. Pure, so the parsing is unit-tested rather than hoped at.
 */
export function parseSearchResults(markdown, limit = 8) {
  const results = []
  const seen = new Set()
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g

  let match
  while ((match = linkPattern.exec(markdown)) !== null) {
    const title = match[1].replace(/\s+/g, " ").trim()
    const href = unwrapRedirect(match[2].trim())

    if (!title || title.length < 3) continue
    if (!/^https?:\/\//.test(href)) continue
    if (/duckduckgo\.com/.test(href)) continue
    if (seen.has(href)) continue

    seen.add(href)
    results.push({ title, url: href })
    if (results.length >= limit) break
  }

  return results
}

export const webFetch = {
  id: "web_fetch",
  name: "Read a web page",
  description: [
    "Fetch a web page and return its readable text as markdown. Use it to read documentation, articles, or anything you found with web_search.",
    "",
    "Anything longer than a couple of paragraphs is also saved to its own document, and the result tells you where. Re-read part of a long page with doc_read on that URL instead of fetching it again — it is cheaper and the content cannot have changed underneath you.",
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
        enum: ["markdown", "html", "text"],
        description:
          "markdown to read it, html to inspect what the page actually rendered, text for bare visible text. Default markdown.",
      },
      fresh: { type: "boolean", description: "Skip the reader's cache. Use it when the page's content changes." },
      maxChars: { type: "number", description: "How much to return inline. Default 12000; the rest is in the saved document." },
    },
  },
  async execute(input, ctx) {
    const target = String(input.url ?? "").trim()
    if (!/^https?:\/\//.test(target)) throw new Error("Pass an absolute http(s) URL.")

    const fetchImpl = ctx.fetchImpl ?? fetch
    const format = FORMATS.includes(input.format) ? input.format : "markdown"

    let content
    if (ctx.direct) {
      // Outside a browser there is no origin policy, so fetch the page itself:
      // no third party in the path, no rate limit, nothing cached by someone
      // else, and sites that block the reader become reachable.
      const response = await fetchImpl(target, {
        signal: ctx.signal,
        headers: { accept: "text/html,text/plain", "user-agent": "patchwork-agent" },
      })
      if (!response.ok) throw new Error(`Could not fetch ${target} (${response.status}).`)
      const body = await response.text()
      const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(body.slice(0, 2000))
      // Nothing renders out here, so `html` is the literal source — a different
      // thing from what the reader returns, and worth knowing when the two
      // disagree about a dynamic page.
      content = format === "html" || !looksLikeHtml ? body : htmlToText(body)
    } else {
      const response = await fetchImpl(readerUrl(target, ctx.reader ?? DEFAULT_READER), {
        signal: ctx.signal,
        headers: readerHeaders(format, input.fresh),
      })
      if (!response.ok) {
        // 422 means the reader could not treat it as a page — which is what
        // happens when it is not one. Watched cost two calls: an agent after a
        // JavaScript bundle tried web_import, then web_fetch, and was told
        // both times to try a different page, which was not the problem.
        const notAPage =
          response.status === 422 || /\.(js|mjs|json|css|txt|xml|csv|map)(\?|$)/i.test(target)
        throw new Error(
          notAPage
            ? `The reader could not read ${target} (${response.status}). This looks like a file rather than a page — fetch it with http_request, which returns it as it is.`
            : `Could not read ${target} (${response.status}). The reader may be blocked by that site; try a different page.`
        )
      }
      content = await response.text()
    }

    const excerpt = truncate(content, input.maxChars ?? 12000)

    // Short pages are already entirely in the transcript; a document would only
    // add a link to something you can see. Longer ones get one, and the model
    // keeps exactly the excerpt it asked for either way.
    if (content.length < SPILL_AT) return excerpt

    const ref = await saveSource(ctx, { url: target, content, mimeType: FORMAT_MIME[format] })
    if (!ref) return excerpt
    return { text: `${excerpt}\n${sourceFooter(ref, excerpt.length)}`, doc: ref }
  },
  summarize(input, output) {
    let host = input?.url ?? ""
    try {
      host = new URL(input.url).host
    } catch {
      /* keep the raw string */
    }
    const saved = String(output ?? "").match(/— (\d+) of (\d+) characters|\(complete\)/)
    const size = saved?.[2] ?? String(output ?? "").length
    return `fetched ${host} · ${bytes(Number(size))}`
  },
}

export const webSearch = {
  id: "web_search",
  name: "Search the web",
  // A search is about no document and no site. Left to the default rule it was
  // keyed on the session's subject, and "any document" on its card wrote
  // `web@*`: every site, for every web tool.
  target: "none",
  description:
    "Search the web and return titles and URLs. Follow up with web_fetch to read any result. Prefer specific queries; this returns links, not answers.",
  where: "worker",
  risk: "external",
  input_schema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", description: "What to search for. Specific beats broad; this returns links, not answers." },
      limit: { type: "number", description: "How many results. Default 8." },
    },
  },
  async execute(input, ctx) {
    const query = String(input.query ?? "").trim()
    if (!query) throw new Error("Pass a query.")

    const fetchImpl = ctx.fetchImpl ?? fetch
    const target = SEARCH_ENGINE + encodeURIComponent(query)
    const limit = input.limit ?? 8

    let results
    if (ctx.direct) {
      const response = await fetchImpl(target, {
        signal: ctx.signal,
        headers: { accept: "text/html", "user-agent": "patchwork-agent" },
      })
      if (!response.ok) throw new Error(`Search failed (${response.status}).`)
      results = parseDuckDuckGoHtml(await response.text(), limit)
    } else {
      const response = await fetchImpl(readerUrl(target, ctx.reader ?? DEFAULT_READER), {
        signal: ctx.signal,
        headers: { accept: "text/plain" },
      })
      if (!response.ok) throw new Error(`Search failed (${response.status}).`)
      results = parseSearchResults(await response.text(), limit)
    }
    if (!results.length) return `No results for "${query}".`

    return [
      `${results.length} results for "${query}":`,
      ...results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`),
    ].join("\n")
  },
  summarize(input, output) {
    const match = String(output ?? "").match(/^(\d+) results/)
    return `searched "${input?.query}" · ${match ? match[1] : "0"} results`
  },
}

export default [webSearch, webFetch]
