/**
 * Where a tool may send a request.
 *
 * Every fetch a tool makes goes through `ctx.fetchImpl`, and every runner sets
 * that to `guardedFetch(...)`. There is no fallback to the global `fetch`: a
 * tool that finds no guarded fetch throws, so a runner that forgot to wire one
 * fails loudly instead of quietly reaching anything the platform can.
 *
 * What is refused, and why each one:
 *
 *   - anything but http and https. `file:`, `data:` and the rest are not the
 *     web, and a browser would happily read some of them.
 *   - localhost and every private or link-local address, in any spelling. The
 *     agent runs on someone's machine, behind their router, next to their
 *     cloud metadata endpoint; none of that is the web either.
 *   - Patchwork's own origin and its sync servers. The page's origin serves the
 *     person's documents to anything that asks with a document URL, so a
 *     request there is a read of their data dressed up as a fetch.
 *   - a path that names an automerge document. Another Patchwork deployment
 *     serves documents the same way, and a URL lifted from a page could point
 *     at one.
 *
 * The check is applied to the target, to every redirect hop, and in node to
 * every address the name resolves to. In the browser a redirect is followed by
 * the platform, so the final URL is checked before the body is read, and a
 * refusal cancels it unread.
 *
 * WHATWG URL parsing already turns `2130706433`, `127.1`, `0x7f.1` and
 * `0177.0.0.1` into `127.0.0.1`, and prints IPv6 hosts compressed; this module
 * parses the host only after that, so every spelling meets the same table.
 */

/** IPv4 ranges that are not the public internet, as [first octets, prefix length]. */
const PRIVATE_V4 = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16], // link-local, where cloud metadata lives
  [[172, 16, 0, 0], 12],
  [[192, 168, 0, 0], 16],
]

/** IPv6 ranges, as [first hextets, prefix length]. `::` and `::1` are caught below. */
const PRIVATE_V6 = [
  [[0xfc00], 7], // unique local
  [[0xfe80], 10], // link-local
  [[0xfec0], 10], // site-local: deprecated, but still routed inside some networks
]

/** A dotted-quad IPv4 address as four numbers, or null. */
export function parseV4(text) {
  const parts = String(text).split(".")
  if (parts.length !== 4) return null
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null
}

/** An IPv6 address (brackets optional, a trailing dotted quad allowed) as eight numbers, or null. */
export function parseV6(text) {
  let s = String(text)
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1)
  if (!s.includes(":")) return null
  // A zone ("%eth0") names an interface on this machine; it is never public.
  if (s.includes("%")) return null

  const halves = s.split("::")
  if (halves.length > 2) return null
  const hextets = (part) => {
    if (part === "") return []
    const out = []
    const pieces = part.split(":")
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]
      if (i === pieces.length - 1 && piece.includes(".")) {
        const v4 = parseV4(piece)
        if (!v4) return null
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3])
      } else if (/^[0-9a-f]{1,4}$/i.test(piece)) {
        out.push(parseInt(piece, 16))
      } else {
        return null
      }
    }
    return out
  }
  const head = hextets(halves[0])
  const tail = halves.length === 2 ? hextets(halves[1]) : []
  if (!head || !tail) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - tail.length
  if (missing < 1) return null
  return [...head, ...new Array(missing).fill(0), ...tail]
}

function inPrefix(values, [start, length], width) {
  for (let i = 0, left = length; left > 0; i++, left -= width) {
    const bits = Math.min(width, left)
    const mask = ((1 << bits) - 1) << (width - bits)
    if (((values[i] ?? 0) & mask) !== ((start[i] ?? 0) & mask)) return false
  }
  return true
}

/**
 * Is this address (v4 or v6 text) somewhere a tool must not reach? Null when
 * it is not an address at all, which is the caller's business.
 */
export function isPrivateAddress(text) {
  const v4 = parseV4(text)
  if (v4) return PRIVATE_V4.some((range) => inPrefix(v4, range, 8))
  const v6 = parseV6(text)
  if (!v6) return null
  const embedded = embeddedV4(v6)
  if (embedded) return PRIVATE_V4.some((range) => inPrefix(embedded, range, 8))
  return PRIVATE_V6.some((range) => inPrefix(v6, range, 16))
}

/** Two hextets as the four octets of an IPv4 address. */
const octets = (high, low) => [high >> 8, high & 0xff, low >> 8, low & 0xff]

/**
 * The IPv4 address an IPv6 address carries, when it is one of the forms that
 * reaches that IPv4 address: IPv4-compatible (::a.b.c.d, which also covers `::`
 * and `::1`, both in 0.0.0.0/8), IPv4-mapped (::ffff:a.b.c.d), SIIT
 * (::ffff:0:a.b.c.d), NAT64 (64:ff9b::a.b.c.d), whose gateway translates it to
 * the IPv4 address, and 6to4 (2002:aabb:ccdd::), which routes to it. Each is
 * judged by the IPv4 address inside, so a private one cannot be reached by
 * spelling it as IPv6.
 */
function embeddedV4(v6) {
  const zero = (from, to) => v6.slice(from, to).every((h) => h === 0)
  if (zero(0, 5) && (v6[5] === 0 || v6[5] === 0xffff)) return octets(v6[6], v6[7])
  if (zero(0, 4) && v6[4] === 0xffff && v6[5] === 0) return octets(v6[6], v6[7])
  if (v6[0] === 0x64 && v6[1] === 0xff9b && zero(2, 6)) return octets(v6[6], v6[7])
  if (v6[0] === 0x2002) return octets(v6[1], v6[2])
  return null
}

function isLocalName(host) {
  const name = host.endsWith(".") ? host.slice(0, -1) : host
  return name === "localhost" || name.endsWith(".localhost")
}

/**
 * A parsed URL's origin, with the host's trailing dots dropped. `host.` is the
 * same server as `host`, fully qualified, but its origin string differs, so
 * comparing origins as the URL prints them let the dotted spelling past a
 * deny entry.
 */
function originKey(url) {
  return `${url.protocol}//${url.hostname.replace(/\.+$/, "")}${url.port ? `:${url.port}` : ""}`
}

/** The http(s) origin a deny entry stands for; a sync server is named by its wss URL. */
function originOf(entry) {
  try {
    const url = new URL(entry)
    if (url.protocol === "wss:") url.protocol = "https:"
    else if (url.protocol === "ws:") url.protocol = "http:"
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return originKey(url)
  } catch {
    return null
  }
}

/**
 * Does the path, decoded until it stops changing, name an automerge document?
 *
 * Decoding is byte by byte, each `%XX` to the character with that code,
 * rather than as UTF-8. A path in Latin-1 (`caf%E9`) is a valid path that
 * decodeURIComponent rejects, and `automerge:` is pure ASCII, so no failed
 * UTF-8 sequence could have been hiding it. What is refused is a `%` the
 * request itself sends without two hex digits after it, which no server
 * reads the same way as another.
 */
function automergePath(pathname) {
  if (/%(?![0-9a-f]{2})/i.test(pathname)) return "a malformed %-escape in the path"
  let current = pathname
  for (;;) {
    const next = current.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    if (next === current) break
    current = next
  }
  return /(^|\/)automerge:/i.test(current) ? "a path that names an automerge document" : null
}

/**
 * A fetch for the page's own origin, and nothing else.
 *
 * Every tool's fetch denies the page's origin, because the service worker
 * serves any automerge document there and a model that could name a URL could
 * name one of those. But the page also serves its own static plugins, and
 * reading their source is how the agent learns how existing tools are written;
 * in development the page is on localhost, which the guard refuses outright.
 * This is for that one job: it takes only URLs on `origin` whose path names no
 * automerge document, and only `plugin_source` is given it — with a URL from
 * the plugin registry, not one the model wrote.
 */
export function pageOriginFetch({ fetch: send, origin }) {
  if (typeof send !== "function") throw new Error("pageOriginFetch needs the fetch it guards.")
  const own = originOf(origin)
  async function pageFetch(url, init = {}) {
    let parsed
    try {
      parsed = new URL(String(url))
    } catch {
      throw new Refused(url, "not an absolute URL")
    }
    if (!own || originKey(parsed) !== own) throw new Refused(url, "not on the page's own origin")
    const reason = automergePath(parsed.pathname)
    if (reason) throw new Refused(url, reason)
    return send(parsed.href, { ...init, redirect: "error" })
  }
  pageFetch.origin = own
  return pageFetch
}

/**
 * Why `url` may not be fetched, or null when it may.
 *
 * `policy.deny` lists origins (Patchwork's own, its sync servers) supplied by
 * the runner, because only the runner knows where it is.
 */
export function checkTarget(url, policy = {}) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return "not an absolute URL"
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `only http and https are fetched, not ${parsed.protocol}`
  const host = parsed.hostname.toLowerCase()
  if (isLocalName(host)) return "a name for this machine"
  if (isPrivateAddress(host)) return "a private, local or link-local address"
  const deny = (policy.deny ?? []).map(originOf).filter(Boolean)
  if (deny.includes(originKey(parsed))) return "Patchwork's own origin or its sync server"
  return automergePath(parsed.pathname)
}

/** A refused target. Tools let it propagate: being refused is the call's answer. */
export class Refused extends Error {
  constructor(url, reason) {
    super(`Refused to fetch ${url}: ${reason}.`)
    this.name = "Refused"
    this.refused = true
    this.reason = reason
  }
}

/** Throw unless `url` passes the guard that `fetchImpl` carries. For targets a tool wraps in another URL. */
export function assertTarget(url, fetchImpl) {
  const reason = checkTarget(url, fetchImpl?.policy)
  if (reason) throw new Refused(url, reason)
}

/** The tool's fetch: the runner's guarded one, never the platform's. */
export function fetcher(ctx) {
  if (typeof ctx?.fetchImpl !== "function") {
    throw new Error("This runner provides no guarded fetch, so nothing can be fetched from here.")
  }
  return ctx.fetchImpl
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])

function cancel(response) {
  try {
    response?.body?.cancel?.()
  } catch {
    /* already consumed or never streamed */
  }
}

/**
 * A fetch that refuses what `checkTarget` refuses, at every step.
 *
 *   fetch          the fetch to guard. Required: this module never reaches for a global.
 *   deny           origins to refuse, from the runner.
 *   direct         node: follow redirects by hand, one checked hop at a time.
 *   lookup         node: host -> [{address}], every one of which must pass.
 *   maxRedirects   node: how many hops before giving up.
 *
 * Residual gap in node: the name is resolved here and again by the fetch, so a
 * DNS answer that changes between the two is not caught.
 */
export function guardedFetch({ fetch: send, deny = [], direct = false, lookup = null, maxRedirects = 5 } = {}) {
  if (typeof send !== "function") throw new Error("guardedFetch needs the fetch it guards.")
  // What the guard checks, readable so a runner's wiring can be tested.
  const policy = { deny: [...new Set(deny.map(originOf).filter(Boolean))], direct, dns: !!lookup }

  const check = async (url) => {
    const reason = checkTarget(url, policy)
    if (reason) throw new Refused(url, reason)
    if (!lookup) return
    const host = new URL(url).hostname
    if (parseV4(host) || parseV6(host)) return
    const answers = await lookup(host)
    // No answer is not a pass: "every address is public" must not hold for
    // want of addresses.
    if (!answers?.length) throw new Refused(url, `${host} did not resolve`)
    for (const answer of answers) {
      const address = typeof answer === "string" ? answer : answer?.address
      if (isPrivateAddress(address) !== false) throw new Refused(url, `${host} resolves to ${address}, a private, local or link-local address`)
    }
  }

  async function guarded(url, init = {}) {
    await check(url)

    if (!direct) {
      const response = await send(url, { ...init, redirect: "follow" })
      const final = response?.url || url
      const reason = checkTarget(final, policy)
      if (reason) {
        cancel(response)
        throw new Refused(final, reason)
      }
      return response
    }

    let current = String(url)
    let options = { ...init, redirect: "manual" }
    for (let hop = 0; ; hop++) {
      const response = await send(current, options)
      const location = response?.headers?.get?.("location")
      if (!REDIRECTS.has(response?.status) || !location) return response
      cancel(response)
      if (hop >= maxRedirects) throw new Error(`Gave up after ${maxRedirects} redirects, at ${current}.`)
      const next = new URL(location, current).href
      await check(next)
      // A 303, and a 301 or 302 answering a POST, turn into a GET with no body,
      // as browsers do.
      const method = String(options.method ?? "GET").toUpperCase()
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        options = { ...options, method: "GET", body: undefined }
      }
      current = next
    }
  }

  guarded.policy = policy
  return guarded
}

/**
 * The sync servers a Patchwork page talks to: subduction, and the classic
 * automerge-repo server it still falls back to. Fetching them is refused like
 * the page's own origin.
 */
export const SYNC_SERVERS = ["wss://subduction.sync.inkandswitch.com", "wss://sync3.automerge.org"]
