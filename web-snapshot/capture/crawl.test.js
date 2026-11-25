/**
 * The crawl keeps a function of the responses alone.
 *
 *   C1  determinism: one page, every order its fetches can complete in,
 *       every byte budget and every count budget — the same resources and
 *       tally each time, and the ones the prefix rule says.
 *   C2  totality and honesty: one resource per outcome; each link found
 *       appears exactly once with the outcome its response deserves, and
 *       the tally adds up to what was found.
 *   C3  a kept blob's sha256 is the response's.
 *   C4  one URL is fetched once however often it appears; identical bytes
 *       are one blob.
 *   C5  nothing past the budget is fetched beyond the concurrency window.
 */
import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { crawl, resolve, resourceFetcher, blobsOf, tally, notKeptLine, policyLine, DEFAULT_BUDGET } from "./crawl.js"
import { scanHtml } from "./scan.js"
import { pageLinks } from "./links.js"
import { guardedFetch } from "../guard.js"

const PAGE = "https://site.test/"
const hex = (bytes) => createHash("sha256").update(bytes).digest("hex")
const text = (s) => new TextEncoder().encode(s)
const padded = (head, size) => {
  const out = new Uint8Array(size)
  out.set(head)
  return out
}
const linksOf = (html) => pageLinks(scanHtml(html), PAGE)
const raw = (bytes, type) => ({ status: 200, type, bytes, sha256: hex(bytes), finalUrl: null, via: "direct" })

/** All orderings of a list. */
function permutations(list) {
  if (list.length <= 1) return [list]
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest]))
}

/**
 * A fetcher whose answers arrive in a chosen order: whenever several are
 * waiting, the one earliest in `order` is answered next. Records every URL
 * asked for.
 */
function ordered(table, order) {
  const waiting = []
  const asked = []
  const fetchResource = (url) =>
    new Promise((done) => {
      asked.push(url)
      waiting.push({ url, done })
    })
  async function drive(job) {
    let finished = false
    job.then(() => (finished = true), () => (finished = true))
    while (!finished) {
      await new Promise((r) => setTimeout(r, 0))
      if (!waiting.length) continue
      waiting.sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url))
      const next = waiting.shift()
      next.done(table[next.url])
    }
    return job
  }
  return { fetchResource, drive, asked }
}

describe("C1: the same result in every completion order, under every budget", () => {
  // page → sheet A (imports B, whose @font-face uses F) + image I.
  const A = "https://site.test/a.css"
  const B = "https://site.test/b.css"
  const F = "https://site.test/f.woff2"
  const I = "https://site.test/i.png"
  const bodies = {
    [A]: text(`@import "b.css";`),
    [B]: text(`@font-face{font-family:x;src:url(f.woff2)}`),
    [F]: padded([0x77, 0x4f, 0x46, 0x32], 40),
    [I]: padded([0x89, 0x50, 0x4e, 0x47], 80),
  }
  const table = {
    [A]: raw(bodies[A], "text/css"),
    [B]: raw(bodies[B], "text/css"),
    [F]: raw(bodies[F], "font/woff2"),
    [I]: raw(bodies[I], "image/png"),
  }
  const links = linksOf(`<link rel=stylesheet href=a.css><img src=i.png>`)
  const ORDER = [A, B, F, I] // key order: styles, then the font, then the image
  const sizes = ORDER.map((url) => bodies[url].byteLength)
  // The byte budget that lets exactly k of them fit, for k = 0..4.
  const fits = [0, 1, 2, 3, 4].map((k) => (k === 0 ? sizes[0] - 1 : sizes.slice(0, k).reduce((a, b) => a + b, 0)))

  /** The rule: the first n in key order are kept, the rest over budget; a sheet not kept hides what it links. */
  function expected(n) {
    const present = [A, I]
    if (n > 0) present.push(B)
    if (n > 1) present.push(F)
    const outcome = (url) => (ORDER.indexOf(url) < n ? "ok" : "over-budget")
    return Object.fromEntries(present.map((url) => [url, outcome(url)]))
  }

  const cases = []
  for (const [fitName, maxTotalBytes] of fits.entries()) {
    for (const maxCount of [0, 1, 2, 3, 4]) cases.push([`${fitName} fit by bytes · maxCount ${maxCount}`, maxTotalBytes, maxCount, Math.min(fitName, maxCount)])
  }

  it.each(cases)("%s", async (_, maxTotalBytes, maxCount, n) => {
    const budget = { ...DEFAULT_BUDGET, maxTotalBytes, maxCount, concurrency: 6 }
    let first = null
    for (const order of permutations(ORDER)) {
      const { fetchResource, drive } = ordered(table, order)
      const result = await drive(crawl(links, fetchResource, budget, null))
      const outcomes = Object.fromEntries(Object.entries(result.resources).map(([url, r]) => [url, r.outcome]))
      expect(outcomes, `order ${order.map((u) => u.split("/").pop()).join(" ")}`).toEqual(expected(n))
      const settled = { resources: result.resources, tally: result.tally }
      if (!first) first = settled
      expect(settled).toEqual(first)
    }
    expect(first.tally.kept).toBe(n)
  })

  it("orders and attributes every resource by its discovery", async () => {
    const result = resolve(links, new Map(Object.entries(table)), DEFAULT_BUDGET)
    expect(Object.fromEntries(Object.entries(result.resources).map(([url, r]) => [url.split("/").pop(), [r.order, r.from === "page" ? "page" : r.from.split("/").pop(), r.kind]]))).toEqual({
      "a.css": ["0.0", "page", "style"],
      "b.css": ["0.0.0", "a.css", "style"],
      "f.woff2": ["1.0.0.0", "b.css", "font"],
      "i.png": ["2.1", "page", "image"],
    })
    expect(result.pending).toEqual([])
    expect(result.complete).toBe(true)
  })

  it("reads a sheet only to maxDepth", () => {
    const budget = { ...DEFAULT_BUDGET, maxDepth: 1 }
    const result = resolve(links, new Map(Object.entries(table)), budget)
    // a.css (depth 0) is read; b.css (depth 1) is kept but not read, so f is never found.
    expect(Object.keys(result.resources).map((u) => u.split("/").pop()).sort()).toEqual(["a.css", "b.css", "i.png"])
  })
})

describe("C2: every outcome, each link once, a tally that adds up", () => {
  const png = padded([0x89, 0x50, 0x4e, 0x47], 16)
  const respond = (body, { status = 200, type = "image/png", url = "" } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? type : null) },
    body: { cancel() {} },
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    },
  })
  const sent = []
  const web = (url, init) => {
    sent.push(url)
    const name = new URL(url).pathname.slice(1)
    if (name === "ok.png") return Promise.resolve(respond(png))
    if (name === "missing.png") return Promise.resolve(respond(new Uint8Array(0), { status: 404 }))
    if (name === "throw.png") return Promise.reject(new TypeError("Failed to fetch"))
    if (name === "html.png") return Promise.resolve(respond(text("<!DOCTYPE html><title>404</title>"), { type: "text/html" }))
    if (name === "big.png") return Promise.resolve(respond(padded([0x89, 0x50, 0x4e, 0x47], 2000)))
    if (name === "slow.png") {
      return new Promise((_, fail) => init.signal.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError"))))
    }
    if (name === "redirect.png") return Promise.resolve(respond(png, { url: "http://127.0.0.1/x.png" }))
    return Promise.resolve(respond(new Uint8Array(0), { status: 500 }))
  }
  const fetchImpl = guardedFetch({ fetch: web })
  const html = [
    `<img src=ok.png>`,
    `<img src=missing.png>`,
    `<img src=throw.png>`,
    `<img src=http://127.0.0.1/local.png>`,
    `<img src=redirect.png>`,
    `<img src=html.png>`,
    `<img src=big.png>`,
    `<img src=slow.png>`,
    `<img src="http://[">`,
    `<script src=s.js></script>`,
    `<iframe src=f.html></iframe>`,
    `<video src=v.mp4></video>`,
    `<object data=o.swf></object>`,
    `<img src=x1.png srcset="x2.png 2x">`,
  ].join("")
  const EXPECTED = {
    "https://site.test/ok.png": "ok",
    "https://site.test/missing.png": "http-error",
    "https://site.test/throw.png": "unreachable",
    "http://127.0.0.1/local.png": "refused",
    "https://site.test/redirect.png": "refused",
    "https://site.test/html.png": "type-mismatch",
    "https://site.test/big.png": "over-budget",
    "https://site.test/slow.png": "timeout",
    "http://[": "bad-url",
    "https://site.test/s.js": "policy",
    "https://site.test/f.html": "policy",
    "https://site.test/v.mp4": "policy",
    "https://site.test/o.swf": "policy",
    "https://site.test/x1.png": "http-error",
    "https://site.test/x2.png": "policy",
  }

  it("gives each link exactly one outcome, as its response deserves", async () => {
    sent.length = 0
    const budget = { ...DEFAULT_BUDGET, maxResourceBytes: 1000, timeoutMs: 30 }
    const result = await crawl(linksOf(html), resourceFetcher(fetchImpl, { maxResourceBytes: 1000, timeoutMs: 30 }), budget, null)
    expect(Object.fromEntries(Object.entries(result.resources).map(([u, r]) => [u, r.outcome]))).toEqual(EXPECTED)
    expect(result.resources["https://site.test/missing.png"]).toMatchObject({ status: 404, detail: "HTTP 404" })
    expect(result.resources["https://site.test/throw.png"].detail).toBe("CORS or network")
    expect(result.resources["https://site.test/html.png"].detail).toBe("wanted an image, got an HTML page")
    expect(result.resources["https://site.test/ok.png"]).toMatchObject({ mimeType: "image/png", bytes: 16, via: "direct", status: 200 })
    expect(Object.fromEntries(Object.entries(result.resources).filter(([, r]) => r.outcome === "policy").map(([u, r]) => [u.split("/").pop(), r.kind]))).toEqual({
      "s.js": "script",
      "f.html": "frame",
      "v.mp4": "media",
      "o.swf": "object",
      "x2.png": "image",
    })
    // Never fetched: policy, bad URLs, and what the guard refused before sending.
    for (const url of sent) expect(["policy", "bad-url"]).not.toContain(EXPECTED[url])
    expect(sent).not.toContain("http://127.0.0.1/local.png")

    const t = result.tally
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)
    expect(t.found).toBe(Object.keys(EXPECTED).length)
    expect(t.kept + sum(t.notKept) + sum(t.policy)).toBe(t.found)
    expect(t).toEqual(tally(result.resources))
    expect(t.notKept).toEqual({ "http-error": 2, unreachable: 1, refused: 2, "type-mismatch": 1, "over-budget": 1, timeout: 1, "bad-url": 1 })
    expect(notKeptLine(result.resources)).toBe("2 refused, 1 HTTP 404, 1 HTTP 500, 1 bad-url, 1 over-budget, 1 timeout, 1 type-mismatch, 1 unreachable (CORS or network)")
    // Ties in count go by kind: frame, image, media, object, script.
    expect(policyLine(t.policy)).toBe("1 frame, 1 spare image (another size, or a further icon), 1 video or audio, 1 embed, 1 script")
  })

  it("marks what was unanswered as aborted when the call is stopped, and says it is incomplete", async () => {
    const controller = new AbortController()
    const page = linksOf(`<img src=ok.png><img src=slow.png><img src=ok2.png>`)
    const fetchResource = resourceFetcher(fetchImpl, { timeoutMs: 60000, signal: controller.signal })
    const budget = { ...DEFAULT_BUDGET, concurrency: 1 }
    const job = crawl(page, fetchResource, budget, controller.signal)
    setTimeout(() => controller.abort(), 20)
    const result = await job
    expect(Object.fromEntries(Object.entries(result.resources).map(([u, r]) => [u.split("/").pop(), r.outcome]))).toEqual({
      "ok.png": "ok",
      "slow.png": "aborted",
      "ok2.png": "aborted",
    })
    expect(result.complete).toBe(false)
  })
})

describe("C3 and C4: blobs", () => {
  it("keeps each kept response under its own sha256, and identical bytes once", async () => {
    const one = padded([0x89, 0x50, 0x4e, 0x47], 30)
    const two = padded([0xff, 0xd8, 0xff], 30)
    const table = {
      "https://site.test/a.png": raw(one, "image/png"),
      "https://site.test/copy.png": raw(one.slice(), "image/png"),
      "https://site.test/b.jpg": raw(two, "image/jpeg"),
      "https://site.test/s.css": raw(text(`x{background:url(a.png)}`), "text/css"),
    }
    const asked = []
    const fetchResource = async (url) => (asked.push(url), table[url])
    const page = linksOf(`<img src=a.png><img src=copy.png><img src=b.jpg><link rel=stylesheet href=s.css><img src="a.png#frag">`)
    const result = await crawl(page, fetchResource, DEFAULT_BUDGET, null)
    // C4: a.png is on the page twice and in the sheet, and fetched once.
    expect(asked.filter((u) => u === "https://site.test/a.png")).toHaveLength(1)
    const blobs = blobsOf(result.resources, result.table)
    expect(Object.keys(blobs).sort()).toEqual([hex(one), hex(two), hex(table["https://site.test/s.css"].bytes)].sort())
    // C3: each blob is named by its own bytes' hash.
    for (const [sha, bytes] of Object.entries(blobs)) expect(hex(bytes)).toBe(sha)
    expect(result.resources["https://site.test/copy.png"].sha256).toBe(result.resources["https://site.test/a.png"].sha256)
  })

  it("the smallest discovery decides a URL's kind, whatever was found first", () => {
    const font = padded([0x77, 0x4f, 0x46, 0x46], 20)
    const table = new Map(
      Object.entries({
        "https://site.test/s.css": raw(text(`@font-face{src:url(x)}`), "text/css"),
        "https://site.test/x": raw(font, "application/octet-stream"),
      })
    )
    // On the page as an image (2.1); in the sheet as a font (1.0.0): the font wins.
    const result = resolve(linksOf(`<link rel=stylesheet href=s.css><img src=x>`), table, DEFAULT_BUDGET)
    expect(result.resources["https://site.test/x"]).toMatchObject({ kind: "font", from: "https://site.test/s.css", order: "1.0.0", outcome: "ok", mimeType: "font/woff" })
  })
})

describe("C5: past the budget, nothing is fetched beyond the concurrency window", () => {
  const images = Array.from({ length: 8 }, (_, i) => `https://site.test/${i}.png`)
  const table = Object.fromEntries(images.map((u) => [u, raw(padded([0x89, 0x50, 0x4e, 0x47], 10), "image/png")]))
  const page = linksOf(images.map((u) => `<img src="${u}">`).join(""))

  for (const concurrency of [1, 2, 3]) {
    for (const [name, limits] of [["bytes", { maxTotalBytes: 25 }], ["count", { maxCount: 2 }], ["nothing fits", { maxCount: 0 }]]) {
      it(`concurrency ${concurrency} · limited by ${name}`, async () => {
        const asked = []
        const fetchResource = async (url) => (asked.push(url), table[url])
        const budget = { ...DEFAULT_BUDGET, concurrency, ...limits }
        const result = await crawl(page, fetchResource, budget, null)
        const overFetched = asked.filter((u) => result.resources[u].outcome === "over-budget")
        expect(overFetched.length).toBeLessThanOrEqual(concurrency)
        expect(result.tally.kept).toBe(limits.maxCount ?? 2)
        if (limits.maxCount === 0) expect(asked).toEqual([])
      })
    }
  }
})

describe("C6: a sheet's charset, inherited down its chain, and its links read where it really is", () => {
  // A latin-1 page links css/a.css, which redirects to the CDN; a.css,
  // unlabelled, imports b.css relative to where it landed; b.css, unlabelled,
  // loads "café.png". Read as latin-1 that is caf%C3%A9.png (URLs are always
  // UTF-8); read as UTF-8, 0xE9 is no character and it would be caf%EF%BF%BD.png.
  const A = "https://site.test/css/a.css"
  const A_FINAL = "https://cdn.test/v2/a.css"
  const B = "https://cdn.test/v2/b.css"
  const IMAGE = "https://cdn.test/img/caf%C3%A9.png"
  const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0))
  const sheet = (body, finalUrl) => ({ ...raw(latin1(body), "text/css"), finalUrl })
  const table = new Map([
    [A, sheet(`@import "b.css";`, A_FINAL)],
    [B, sheet(`p{background:url(../img/caf\xE9.png)}`, B)],
    [IMAGE, raw(padded([0x89, 0x50, 0x4e, 0x47], 12), "image/png")],
  ])
  const links = linksOf(`<link rel=stylesheet href=css/a.css>`)

  it("inherits the page's label through @import, and resolves each sheet's links against its final URL", async () => {
    const fetchResource = async (url) => table.get(url)
    const result = await crawl(links, fetchResource, DEFAULT_BUDGET, null, { pageCharset: "windows-1252" })
    expect(Object.fromEntries(Object.entries(result.resources).map(([u, r]) => [u, [r.outcome, r.from, r.charset ?? null]]))).toEqual({
      [A]: ["ok", "page", "windows-1252"],
      [B]: ["ok", A, "windows-1252"],
      [IMAGE]: ["ok", B, null],
    })
  })

  // A sheet too deep to be read for links still has its bytes kept, and
  // they are decoded with its charset when it is frozen; so every kept
  // sheet's charset is recorded, whatever its depth.
  it.each([0, 1, 2])("records every kept sheet's charset at maxDepth %i", (maxDepth) => {
    const result = resolve(links, table, { ...DEFAULT_BUDGET, maxDepth }, { pageCharset: "windows-1252" })
    for (const url of [A, B]) {
      if (result.resources[url]) expect(result.resources[url].charset, url).toBe("windows-1252")
    }
    expect(Object.keys(result.resources)).toEqual(maxDepth === 0 ? [A] : maxDepth === 1 ? [A, B] : [A, B, IMAGE])
  })

  it("records a sheet's own label at any depth", () => {
    const labelled = new Map([[A, { ...raw(text("x{}"), "text/css; charset=iso-8859-1"), finalUrl: A }]])
    const result = resolve(links, labelled, { ...DEFAULT_BUDGET, maxDepth: 0 })
    expect(result.resources[A].charset).toBe("windows-1252")
  })
})
