/**
 * Probes P1 and P2: what the reader gives web_capture.
 *
 * web_capture asks the reader for its rendering of a page as JSON, with
 * `X-Return-Format: html`, `x-no-cache` and `x-respond-timing: network-idle`,
 * and reads `data.html` (or `data.content`), `data.url` as the final URL and
 * `data.title` (web-capture.js `readerDom`). None of that is documented
 * where we can pin it, so this asks, for a page and for a PDF, and prints
 * what came back:
 *
 *   P1  does the JSON carry the rendered HTML, and the final URL after
 *       redirects? Does the timing header change anything (it is sent both
 *       ways and the timings compared)?
 *   P2  what does html mode make of a PDF? web-capture.js keeps a PDF as a file
 *       before the reader is asked, but a browser's direct request is often
 *       refused by CORS, so this is what a capture of a PDF behind CORS gets.
 *
 * Nothing is kept; it reads and reports. It talks to the real reader, so it
 * costs two to four of the reader's twenty requests a minute.
 *
 * Usage: node probes/reader-dom.mjs [--reader https://r.jina.ai/] [--page URL] [--pdf URL]
 */

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}

const READER = option("reader", "https://r.jina.ai/")
// A page that redirects (http to https, and a trailing slash), so the final URL is visible.
const PAGE = option("page", "http://example.com")
const PDF = option("pdf", "https://arxiv.org/pdf/1706.03762")

async function ask(target, timing) {
  const headers = { accept: "application/json", "X-Return-Format": "html", "x-no-cache": "true" }
  if (timing) headers["x-respond-timing"] = "network-idle"
  const started = Date.now()
  const response = await fetch(READER + target, { headers })
  const body = await response.text()
  const ms = Date.now() - started
  let json = null
  try {
    json = JSON.parse(body)
  } catch {
    /* reported below */
  }
  const data = json?.data ?? json
  return {
    target,
    timing: timing ? "network-idle" : "(none)",
    status: response.status,
    contentType: response.headers.get("content-type"),
    ms,
    json: !!json,
    keys: data && typeof data === "object" ? Object.keys(data) : null,
    finalUrl: data?.url ?? null,
    title: data?.title ?? null,
    html: typeof data?.html === "string" ? `${data.html.length} chars: ${data.html.slice(0, 120).replace(/\s+/g, " ")}…` : null,
    content: typeof data?.content === "string" ? `${data.content.length} chars: ${data.content.slice(0, 120).replace(/\s+/g, " ")}…` : null,
    raw: json ? null : body.slice(0, 300),
  }
}

console.log("P1: a page, with and without the timing header")
console.log(await ask(PAGE, true))
console.log(await ask(PAGE, false))
console.log("\nP2: a PDF in html mode")
console.log(await ask(PDF, true))
console.log(
  "\nRead: P1 holds if `finalUrl` is the redirected URL and `html` is a whole document; P2 says what web-capture.js should do with a PDF the browser could not fetch directly (today: the reader's rendering is kept as a snapshot unless the URL ends .pdf)."
)
