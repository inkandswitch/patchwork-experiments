/**
 * Fetching what a page loads, and deciding what to keep.
 *
 * The decision is a pure function of the responses: `resolve(links, table,
 * budget)` takes the page's links and a table of what each URL answered, and
 * returns every resource with exactly one outcome. `crawl` only fills the
 * table, in order, a few requests at a time. So which resources a snapshot
 * keeps never depends on which response happened to arrive first, and that
 * can be tested by feeding one table in every order.
 *
 * Order. Every resource has an order key: its priority class (style 0, font
 * 1, image 2, everything not fetched 3), then its discovery path — its index
 * among the page's links, then its index within each stylesheet that led to
 * it. A stylesheet always sorts before what it links to, so walking the keys
 * in order meets every sheet before its children. A URL is one resource
 * however often it appears; the discovery with the smallest key decides its
 * kind and where it came from.
 *
 * Budget, by the prefix rule. Walking in key order, the first resource that
 * would take the kept bytes past `maxTotalBytes`, or that comes once
 * `maxCount` resources are kept, is `over-budget`, and so is every fetchable
 * resource after it. One resource larger than `maxResourceBytes` is
 * `over-budget` on its own, and cuts nothing. A kept stylesheet's charset is
 * always recorded, but it is read for links only when it is fewer than
 * `maxDepth` sheets deep. Only a kept sheet is read: a sheet the
 * budget cut may or may not have been fetched by the time the cut was known,
 * and reading it would make the result depend on that.
 *
 * Outcomes, checked in this order: refused (the guard said no to the target
 * or where it redirected), aborted, timeout, unreachable (the fetch threw: in
 * a browser CORS and a network failure look the same), http-error, over-budget,
 * type-mismatch, ok; and without a fetch, policy and bad-url.
 */

import { cssLinks } from "./css.js"
import { cssCharset, decode } from "./charset.js"
import { accept, htmlLooking, mediaTypeOf } from "./sniff.js"
import { FETCHED_KINDS, withoutFragment } from "./links.js"
import { sha256Hex } from "./bytes.js"

export const DEFAULT_BUDGET = Object.freeze({
  maxResourceBytes: 5e6,
  maxTotalBytes: 2e7,
  maxCount: 150,
  maxDepth: 3,
  concurrency: 6,
  timeoutMs: 15000,
})

export const OUTCOMES = ["ok", "http-error", "unreachable", "refused", "type-mismatch", "over-budget", "policy", "bad-url", "timeout", "aborted"]

const CLASS = { style: 0, font: 1, image: 2 }
/** What each fetched kind is called in a type mismatch's detail. */
const WANTED = { style: "a stylesheet", font: "a font", image: "an image" }
const NOT_FETCHED = 3

function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1
    if (b[i] === undefined) return 1
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/** An order key as stored: "2.4.1". */
export const orderString = (order) => order.join(".")
/** And back, for sorting what was stored. */
export const orderOf = (text) => String(text).split(".").map(Number)

/**
 * What a URL answered: classified as the kind it is wanted for.
 * `raw` is what `resourceFetcher` returns.
 */
function classify(raw, kind) {
  if (raw.error) return raw.detail ? { outcome: raw.error, detail: raw.detail } : { outcome: raw.error }
  const status = raw.status
  if (!(status >= 200 && status < 300)) return { outcome: "http-error", status, detail: `HTTP ${status}` }
  const verdict = accept(kind, raw.type, raw.bytes)
  if (!verdict.ok) {
    const what = htmlLooking(raw.bytes) ? "an HTML page" : mediaTypeOf(raw.type) || "no type"
    return { outcome: "type-mismatch", status, detail: `wanted ${WANTED[kind] ?? kind}, got ${what}` }
  }
  return { outcome: "ok", status, mimeType: verdict.mimeType, sha256: raw.sha256, bytes: raw.bytes.byteLength, finalUrl: raw.finalUrl, via: raw.via }
}

/**
 * Every resource and its outcome, from the page's links and what each URL
 * answered so far.
 *
 *   links     pageLinks(): every link of the page, in document order
 *   table     Map: URL (no fragment) -> what it answered
 *   budget    DEFAULT_BUDGET's fields
 *   aborted   the capture was stopped: what has no answer is `aborted`
 *   pageCharset   the page's label, inherited by its unlabelled sheets
 *   cache     Map, reused between calls: a sheet's links, so it is decoded once
 *
 * Returns `{ resources, pending, tally, complete }`. `pending` lists, in key
 * order, the fetchable URLs with no answer yet that the budget has not
 * already ruled out: what to fetch next. Their resources say "pending", and
 * nothing after the first of them is final.
 */
export function resolve(links, table, budget = DEFAULT_BUDGET, { aborted = false, pageCharset = null, cache = new Map() } = {}) {
  const found = new Map() // key -> { kind, order, from, depth, policy, bad, processed, charset }
  const queue = [] // keys not yet processed, by order

  const enqueue = (key, entry) => {
    const existing = found.get(key)
    if (existing) {
      if (existing.processed || compare(existing.order, entry.order) <= 0) return
      queue.splice(queue.indexOf(key), 1)
      Object.assign(existing, entry)
    } else {
      found.set(key, { ...entry, processed: false })
    }
    const order = found.get(key).order
    let at = queue.length
    while (at > 0 && compare(found.get(queue[at - 1]).order, order) > 0) at--
    queue.splice(at, 0, key)
  }

  const discover = (link, path, from, depth, parentCharset) => {
    if (link.kind === "navigation") return
    const fetched = FETCHED_KINDS.includes(link.kind) && !link.policy && !link.bad
    const cls = fetched ? CLASS[link.kind] : NOT_FETCHED
    const key = link.bad ? link.raw : withoutFragment(link.url)
    enqueue(key, { kind: link.kind, order: [cls, ...path], from, depth, policy: !link.bad && !fetched, bad: !!link.bad, parentCharset })
  }

  links.forEach((link, i) => discover(link, [i], "page", 0, pageCharset))

  const resources = {}
  const pending = []
  let count = 0
  let total = 0
  let cut = false

  while (queue.length) {
    const key = queue.shift()
    const entry = found.get(key)
    entry.processed = true
    const base = { kind: entry.kind, from: entry.from, order: orderString(entry.order) }

    if (entry.bad) {
      resources[key] = { ...base, outcome: "bad-url" }
      continue
    }
    if (entry.policy) {
      resources[key] = { ...base, outcome: "policy" }
      continue
    }
    // Kept counts only grow as unknowns resolve, so a limit already reached
    // by what is known is reached whatever they turn out to be.
    if (cut || count >= budget.maxCount) {
      cut = true
      resources[key] = { ...base, outcome: "over-budget", detail: "past the capture's budget" }
      continue
    }
    const raw = table.get(key)
    if (!raw) {
      if (aborted) {
        resources[key] = { ...base, outcome: "aborted" }
      } else {
        resources[key] = { ...base, outcome: "pending" }
        pending.push({ url: key, kind: entry.kind })
      }
      continue
    }
    const verdict = classify(raw, entry.kind)
    if (verdict.outcome === "ok" && total + verdict.bytes > budget.maxTotalBytes) {
      cut = true
      resources[key] = { ...base, outcome: "over-budget", detail: "past the capture's budget" }
      continue
    }
    resources[key] = { ...base, ...verdict }
    if (verdict.outcome !== "ok") continue
    count++
    total += verdict.bytes

    if (entry.kind === "style") {
      // Every kept sheet's charset is recorded, however deep: its bytes are
      // decoded with it when the page is frozen.
      const memo = `${key}\n${entry.parentCharset ?? ""}`
      if (!cache.has(memo)) cache.set(memo, { charset: cssCharset(raw.bytes, raw.type, entry.parentCharset), links: null })
      const sheet = cache.get(memo)
      resources[key].charset = sheet.charset
      if (entry.depth < budget.maxDepth) {
        sheet.links ??= cssLinks(decode(raw.bytes, sheet.charset), raw.finalUrl || key)
        sheet.links.forEach((link, j) => discover(link, [...entry.order.slice(1), j], key, entry.depth + 1, sheet.charset))
      }
    }
  }

  // Automerge stores no undefined, so a field nobody filled is left out.
  for (const resource of Object.values(resources)) {
    for (const [field, value] of Object.entries(resource)) if (value === undefined || value === null) delete resource[field]
  }
  const complete = !aborted
  return { resources, pending, tally: tally(resources), complete }
}

/** How many resources were found, kept, and not kept for each reason. */
export function tally(resources) {
  const out = { found: 0, kept: 0, keptBytes: 0, notKept: {}, policy: {} }
  for (const r of Object.values(resources)) {
    out.found++
    if (r.outcome === "ok") {
      out.kept++
      out.keptBytes += r.bytes
    } else if (r.outcome === "policy") {
      out.policy[r.kind] = (out.policy[r.kind] ?? 0) + 1
    } else {
      out.notKept[r.outcome] = (out.notKept[r.outcome] ?? 0) + 1
    }
  }
  return out
}

/** Code-unit order: the same in every locale, so a result reads the same wherever it was made. */
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** "9 unreachable (CORS or network), 2 HTTP 404, 1 over-budget" — what was not kept, and why. */
export function notKeptLine(resources) {
  const groups = new Map()
  for (const r of Object.values(resources)) {
    if (r.outcome === "ok" || r.outcome === "policy") continue
    const label =
      r.outcome === "http-error" ? `HTTP ${r.status}` : r.outcome === "unreachable" ? `unreachable (${r.detail ?? "network"})` : r.outcome
    groups.set(label, (groups.get(label) ?? 0) + 1)
  }
  return [...groups].sort((a, b) => b[1] - a[1] || byName(a[0], b[0])).map(([label, count]) => `${count} ${label}`).join(", ")
}

const POLICY_NOUN = { script: ["script", "scripts"], frame: ["frame", "frames"], media: ["video or audio", "videos or audio"], object: ["embed", "embeds"], image: ["spare image (another size, or a further icon)", "spare images (other sizes, or further icons)"] }

/** "6 scripts, 2 frames" — what was never fetched, by choice. */
export function policyLine(policy) {
  return Object.entries(policy ?? {})
    .sort((a, b) => b[1] - a[1] || byName(a[0], b[0]))
    .map(([kind, count]) => `${count} ${(POLICY_NOUN[kind] ?? [kind, `${kind}s`])[count === 1 ? 0 : 1]}`)
    .join(", ")
}

/** The kept bytes, by SHA-256: identical bytes from two URLs are one blob. */
export function blobsOf(resources, table) {
  const blobs = {}
  for (const [url, r] of Object.entries(resources)) {
    if (r.outcome === "ok" && !(r.sha256 in blobs)) blobs[r.sha256] = table.get(url).bytes
  }
  return blobs
}

/**
 * Fill the table, in key order, at most `budget.concurrency` requests at a
 * time, until nothing fetchable is unanswered; then resolve it. Stops
 * scheduling once the signal fires, and what was not answered is `aborted`.
 *
 * Returns resolve()'s result plus `table` (for blobsOf).
 */
export async function crawl(links, fetchResource, budget = DEFAULT_BUDGET, signal = null, { pageCharset = null } = {}) {
  const table = new Map()
  const inflight = new Map()
  const cache = new Map()
  const limit = Math.max(1, Math.floor(budget.concurrency ?? 1))
  for (;;) {
    const aborted = !!signal?.aborted
    if (aborted && inflight.size) {
      await Promise.all(inflight.values())
      continue
    }
    const plan = resolve(links, table, budget, { aborted, pageCharset, cache })
    if (aborted) return { ...plan, table }
    for (const { url, kind } of plan.pending) {
      if (inflight.size >= limit) break
      if (inflight.has(url)) continue
      const job = Promise.resolve()
        .then(() => fetchResource(url, kind))
        .then(
          (raw) => table.set(url, raw),
          (err) => table.set(url, { error: "unreachable", detail: String(err?.message ?? err) })
        )
        .finally(() => inflight.delete(url))
      inflight.set(url, job)
    }
    if (!inflight.size) return { ...plan, table }
    await Promise.race(inflight.values())
  }
}

/** The body, read until it passes `max` bytes: the bytes, or null when it did. */
export async function readCapped(response, max) {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.byteLength > max ? null : bytes
  }
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

function cancel(response) {
  try {
    response?.body?.cancel?.()?.catch?.(() => {})
  } catch {
    /* already consumed or never streamed */
  }
}

/**
 * Fetch one resource through the runner's guarded fetch: what `resolve`
 * reads. No cookies and no referrer, so what is kept is what anyone would
 * get; and from the HTTP cache when it can be, since the page was usually
 * just loaded.
 *
 *   fetchImpl         the guard (ctx.fetchImpl)
 *   direct            node: there is no CORS to blame for a failure
 *   maxResourceBytes  a body past this is cancelled and over-budget
 *   timeoutMs         per request, body included
 *   signal            the call's: stopping the session stops the crawl
 */
export function resourceFetcher(fetchImpl, { direct = false, maxResourceBytes = DEFAULT_BUDGET.maxResourceBytes, timeoutMs = DEFAULT_BUDGET.timeoutMs, signal = null } = {}) {
  return async function fetchResource(url) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const stop = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener?.("abort", stop)
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "force-cache",
        headers: direct ? { "user-agent": "patchwork-agent" } : {},
      })
      const finalUrl = response.url || url
      if (!response.ok) {
        cancel(response)
        return { status: response.status, finalUrl }
      }
      const type = response.headers?.get?.("content-type") ?? null
      const tooBig = { error: "over-budget", detail: `larger than the ${maxResourceBytes} bytes kept of one resource` }
      if (Number(response.headers?.get?.("content-length")) > maxResourceBytes) {
        cancel(response)
        return tooBig
      }
      const bytes = await readCapped(response, maxResourceBytes)
      if (!bytes) return tooBig
      return { status: response.status, type, bytes, sha256: await sha256Hex(bytes), finalUrl, via: "direct" }
    } catch (err) {
      if (err?.refused) return { error: "refused", detail: err.reason }
      if (signal?.aborted) return { error: "aborted" }
      if (timedOut) return { error: "timeout", detail: `no answer in ${Math.round(timeoutMs / 1000)} s` }
      return { error: "unreachable", detail: direct ? "network" : "CORS or network" }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.("abort", stop)
    }
  }
}
