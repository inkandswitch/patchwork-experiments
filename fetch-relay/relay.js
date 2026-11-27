/**
 * A fetch relay: fetches a URL for a browser that may not, and returns what
 * the site sent, as it sent it.
 *
 * A Patchwork agent in a browser cannot read most sites directly — they do not
 * allow another site's page to (CORS) — so what it kept of the web was a
 * third-party reader's text, never the PDF or the page itself. Through this,
 * it keeps the originals, as a runner in node does.
 *
 *   GET  <relay>/fetch?url=<target>     (HEAD too)
 *   →    the target's status and body; its content type; and
 *          x-relay-final-url   where redirects ended
 *          x-relay-error       set only when the relay itself refused or failed
 *
 *   <relay>/openai/v1/responses (POST), <relay>/openai/v1/models (GET)
 *   →    a model API that answers no page (LANES): one fixed address each,
 *        the person's token passed there alone, the answer streamed back
 *
 * What it will not do, whatever it is asked:
 *   - fetch anything but http(s) on a public address (guard.js, the same table
 *     the agent uses), checked at the target, at every redirect, and — where a
 *     resolver is given — at every address the name resolves to;
 *   - send anything but GET or HEAD, or forward cookies, credentials or any
 *     header but a few harmless ones — save one credential for one host
 *     (CREDENTIALS: Brave Search's key, to Brave's API alone) — except on a
 *     LANE, which sends its one method to its one fixed address;
 *   - return more than `maxBytes`, or wait longer than `timeoutMs`;
 *   - pass a site's cookies back.
 * And, as configured: answer only a request carrying `key`, and only pages
 * from `origins`. Without a key it is an open relay for anyone who finds it.
 */

import { checkTarget, isPrivateAddress, parseV4, parseV6 } from "./guard.js"

export const DEFAULTS = { maxBytes: 50 * 1024 * 1024, timeoutMs: 30_000, maxRedirects: 5 }

/**
 * Who the relay says it is. Some sites (Wikipedia) refuse a request that does
 * not say; it names the software, never the person using it.
 */
export const USER_AGENT = "PatchworkFetchRelay/1.0 (+https://www.inkandswitch.com/)"

/** Request headers passed on to the site; everything else is dropped. */
const FORWARD = ["accept", "accept-language", "range", "if-none-match", "if-modified-since"]

/**
 * The one credential passed on, and the only host it may reach: Brave Search's
 * key, so the agent can search from a browser (Brave's API answers no page
 * directly). Checked at every hop, so a redirect elsewhere drops it. The
 * agent's tools/relay.js has the same table; change them together.
 */
export const CREDENTIALS = { "api.search.brave.com": ["x-subscription-token"] }

/**
 * Model APIs whose answers no page may read, each on a path of its own.
 *
 * ChatGPT's plan route answers a page's request without CORS headers, so the
 * agent in a browser cannot read a reply. A lane goes to one fixed address
 * with one method: nothing in the request chooses where it goes, so there is
 * no target to guard. It passes on the person's `authorization` — to that
 * address alone — and streams the answer back as it comes, since a reply runs
 * for minutes. The agent's net/relay.js has the same table (API_LANES);
 * change them together.
 */
export const LANES = {
  "/openai/v1/responses": { method: "POST", target: "https://api.openai.com/v1/responses" },
  "/openai/v1/models": { method: "GET", target: "https://api.openai.com/v1/models" },
}

/** What a lane passes on, each way. */
const LANE_FORWARD = ["authorization", "content-type", "accept"]
const LANE_RETURN = ["content-type", "x-request-id", "retry-after"]

/** Response headers passed back; never set-cookie. */
const RETURN = ["content-type", "content-language", "content-disposition", "last-modified", "etag", "content-range"]

const REDIRECTS = new Set([301, 302, 303, 307, 308])

/**
 * Answer one request.
 *
 *   request   a Fetch API Request (or { method, url, headers: Headers })
 *   options   { fetch, key, origins, lookup, maxBytes, timeoutMs, maxRedirects }
 *     fetch     the fetch that reaches the web (required)
 *     key       if set, requests must carry it as `x-relay-key`
 *     origins   if set, the page origins a browser may call from
 *     lookup    host -> [{ address }], to refuse names that resolve privately
 */
export async function handle(request, options = {}) {
  // An option left unset — a deployment's missing variable arrives as
  // undefined — keeps its default. Spread as it was, an undefined timeout
  // replaced the 30 seconds, and every fetch was cancelled the moment it began.
  const given = Object.fromEntries(Object.entries(options).filter(([, value]) => value != null && !Number.isNaN(value)))
  const config = { ...DEFAULTS, ...given }
  if (typeof config.fetch !== "function") throw new Error("handle needs the fetch that reaches the web.")
  const origin = request.headers.get("origin")
  const cors = corsHeaders(origin, config.origins)
  if (cors === null) return refuse(403, "this page's origin may not use the relay", {})

  const lane = LANES[new URL(request.url).pathname]
  if (lane) return await laned(request, lane, config, cors)

  const method = String(request.method ?? "GET").toUpperCase()
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "GET, HEAD", "access-control-allow-headers": `x-relay-key, accept, range, ${[...new Set(Object.values(CREDENTIALS).flat())].join(", ")}`, "access-control-max-age": "86400" } })
  if (method !== "GET" && method !== "HEAD") return refuse(405, "only GET and HEAD are relayed", cors)
  if (config.key && request.headers.get("x-relay-key") !== config.key) return refuse(401, "missing or wrong x-relay-key", cors)

  const target = new URL(request.url).searchParams.get("url")
  if (!target) return refuse(400, "pass the page to fetch as ?url=", cors)

  const headers = { "user-agent": config.userAgent ?? USER_AGENT }
  for (const name of FORWARD) {
    const value = request.headers.get(name)
    if (value) headers[name] = value
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    let current = target
    for (let hop = 0; ; hop++) {
      const reason = await refusal(current, config.lookup)
      if (reason) return refuse(403, `refused ${current}: ${reason}`, cors)
      const response = await config.fetch(current, { method, headers: { ...headers, ...credentials(request, current) }, redirect: "manual", signal: controller.signal })
      const location = response.headers.get("location")
      if (REDIRECTS.has(response.status) && location) {
        response.body?.cancel?.()
        if (hop >= config.maxRedirects) return refuse(508, `more than ${config.maxRedirects} redirects`, cors)
        current = new URL(location, current).href
        continue
      }
      return await relayed(response, current, method, config, cors)
    }
  } catch (err) {
    const why = controller.signal.aborted ? `no answer within ${config.timeoutMs} ms` : String(err?.message ?? err)
    return refuse(502, why, cors)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A request on a lane: its one method to its one address, the body as sent
 * (up to maxBytes), the answer's body streamed back untouched. The timeout
 * covers waiting for the answer to begin, not the answer: a model may stream
 * for many minutes. A page that goes away cancels the request upstream.
 */
async function laned(request, lane, config, cors) {
  const method = String(request.method ?? "GET").toUpperCase()
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": lane.method, "access-control-allow-headers": "x-relay-key, authorization, content-type, accept", "access-control-max-age": "86400" } })
  }
  if (method !== lane.method) return refuse(405, `only ${lane.method} is relayed here`, cors)
  if (config.key && request.headers.get("x-relay-key") !== config.key) return refuse(401, "missing or wrong x-relay-key", cors)

  const headers = { "user-agent": config.userAgent ?? USER_AGENT }
  for (const name of LANE_FORWARD) {
    const value = request.headers.get(name)
    if (value) headers[name] = value
  }
  let body
  if (method === "POST") {
    body = await readCapped(request, config.maxBytes)
    if (body === null) return refuse(413, `the request is more than the ${config.maxBytes} bytes relayed`, cors)
  }

  const controller = new AbortController()
  request.signal?.addEventListener?.("abort", () => controller.abort(), { once: true })
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  let response
  try {
    response = await config.fetch(lane.target, { method, headers, body, redirect: "manual", signal: controller.signal })
  } catch (err) {
    const why = controller.signal.aborted ? `no answer within ${config.timeoutMs} ms` : String(err?.message ?? err)
    return refuse(502, why, cors)
  } finally {
    clearTimeout(timer)
  }
  if (REDIRECTS.has(response.status)) {
    response.body?.cancel?.()
    return refuse(502, `${new URL(lane.target).host} redirected, and a lane does not follow`, cors)
  }
  const out = { ...cors, "cache-control": "no-store" }
  for (const name of LANE_RETURN) {
    const value = response.headers.get(name)
    if (value) out[name] = value
  }
  return new Response(response.body, { status: response.status, headers: out })
}

/** The credentials the page sent that `url`'s host may have: none, but for CREDENTIALS. */
function credentials(request, url) {
  const out = {}
  for (const name of CREDENTIALS[new URL(url).hostname] ?? []) {
    const value = request.headers.get(name)
    if (value) out[name] = value
  }
  return out
}

/** Why the relay will not fetch `url`, or null. */
async function refusal(url, lookup) {
  const reason = checkTarget(url)
  if (reason) return reason
  if (!lookup) return null
  const host = new URL(url).hostname
  if (parseV4(host) || parseV6(host)) return null
  let answers
  try {
    answers = await lookup(host)
  } catch {
    answers = null
  }
  if (!answers?.length) return `${host} did not resolve`
  for (const answer of answers) {
    const address = typeof answer === "string" ? answer : answer?.address
    if (isPrivateAddress(address) !== false) return `${host} resolves to ${address}, a private, local or link-local address`
  }
  return null
}

/** The site's answer, passed back with only the headers that are safe to. */
async function relayed(response, finalUrl, method, config, cors) {
  const headers = { ...cors, "x-relay-final-url": finalUrl, "cache-control": "no-store" }
  for (const name of RETURN) {
    const value = response.headers.get(name)
    if (value) headers[name] = value
  }
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > config.maxBytes) {
    response.body?.cancel?.()
    return refuse(413, `the response is ${declared} bytes, more than the ${config.maxBytes} relayed`, cors)
  }
  if (method === "HEAD") return new Response(null, { status: response.status, headers })
  const body = await readCapped(response, config.maxBytes)
  if (body === null) return refuse(413, `the response is more than the ${config.maxBytes} bytes relayed`, cors)
  return new Response(body, { status: response.status, headers })
}

/** The body as bytes, or null once it passes `max`. */
async function readCapped(response, max) {
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.byteLength > max ? null : bytes
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

/**
 * The CORS headers for a page at `origin`, or null when it may not call.
 * No allowlist: any page may (still subject to the key). A request with no
 * Origin (not from a page) gets no CORS headers, and is answered.
 */
export function corsHeaders(origin, origins) {
  const list = Array.isArray(origins) ? origins : typeof origins === "string" && origins.trim() ? origins.split(",").map((o) => o.trim()) : null
  if (!origin) return {}
  if (list && !list.includes(origin)) return null
  return {
    "access-control-allow-origin": list ? origin : "*",
    "access-control-expose-headers": "x-relay-final-url, x-relay-error, content-type, content-disposition, content-length, x-request-id, retry-after",
    vary: "origin",
  }
}

function refuse(status, why, cors) {
  // A header carries printable ASCII only; the body has the reason in full.
  const header = String(why).replace(/[^\x20-\x7e]/g, "?").slice(0, 300)
  return new Response(why, { status, headers: { ...cors, "x-relay-error": header, "content-type": "text/plain; charset=utf-8" } })
}
