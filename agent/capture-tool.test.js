/**
 * web_capture, end to end, over every branch of how it gets a page (the
 * design's §4.3): the direct request {HTML, PDF, CORS failure, refused} ×
 * the reader {renders, finds no page, rate-limits} × {browser, node} ×
 * render {true, false}. Each gives the document the rule says — a snapshot
 * by the reader or of the raw response, a kept file, an extract that says
 * the page is missing, or an error — and says so in its result.
 *
 * Then: a research step's capture lands in its workflow's ledger, is read
 * with source_read, and answers a second capture without the network.
 */
import { describe, it, expect, vi } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { webCapture } from "./tools/capture.js"
import { sourceRead } from "./tools/read-source.js"
import { guardedFetch } from "./tools/guard.js"
import { scopedRepo } from "./scope.js"
import { readable } from "./tools/sources.js"
import { freeze } from "./capture/freeze.js"
import { grantGroup, needsApproval } from "./session.js"
import { BUILTIN_TOOLS } from "./tools/index.js"
import { SCOPED_TOOL_IDS } from "./scope.js"
import { PRESENTED } from "./ui/calls.js"

await initSubduction()

const READER = "https://reader.test/"
const TARGET = "https://site.test/page"
const RAW = `<html><head><title>Raw</title><link rel=stylesheet href=/s.css></head><body><h1>Raw page</h1><img src=/a.png></body></html>`
const RENDERED = `<html><head><title>Rendered</title><link rel=stylesheet href=/s.css></head><body><h1>Rendered page</h1><p>After scripts.</p><img src=/a.png></body></html>`
const MARKDOWN = "Title: Doc\n\n# Doc\nThe reader's words."
const PDF = new TextEncoder().encode("%PDF-1.7\nnot really a pdf, but it starts like one")
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

function respond(body, { status = 200, type = "text/plain", url = "", location = null } = {}) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get: (n) => ({ "content-type": type, location })[n.toLowerCase()] ?? null,
    },
    body: { cancel() {} },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
    async text() {
      return new TextDecoder().decode(bytes)
    },
  }
}

/** The web, as each case has it. Records every request that reached it. */
function web({ direct, reader }) {
  const sent = []
  const fetch = async (url, init = {}) => {
    sent.push(url)
    if (url.startsWith(READER)) {
      if (reader === "429") return respond("rate limited", { status: 429 })
      const json = /json/.test(init.headers?.accept ?? "")
      if (!json) return respond(MARKDOWN)
      if (reader === "ok-json") return respond(JSON.stringify({ code: 200, data: { title: "Rendered", url: `${TARGET}/final`, html: RENDERED } }), { type: "application/json" })
      return respond(JSON.stringify({ code: 200, data: { title: "", url: TARGET, html: "undefined" } }), { type: "application/json" })
    }
    if (url === TARGET) {
      if (direct === "throw") throw new TypeError("Failed to fetch")
      if (direct === "refused") return respond("", { status: 302, location: "http://127.0.0.1/admin", url: "http://127.0.0.1/admin" })
      if (direct === "ok-pdf") return respond(PDF, { type: "application/pdf", url: TARGET })
      return respond(RAW, { type: "text/html; charset=utf-8", url: TARGET })
    }
    if (url === "https://site.test/s.css") return respond("body{background:url(bg.png)}", { type: "text/css", url })
    if (url === "https://site.test/a.png" || url === "https://site.test/bg.png") return respond(PNG, { type: "image/png", url })
    return respond("", { status: 404, url })
  }
  return { fetch, sent }
}

function context({ direct, reader, node }) {
  const repo = new Repo({ network: [] })
  const { fetch, sent } = web({ direct, reader })
  const ctx = {
    repo,
    reader: READER,
    direct: node,
    fetchImpl: guardedFetch({ fetch, direct: node }),
    session: { doc: () => ({ made: [] }) },
  }
  return { ctx, repo, sent }
}

/**
 * The rule, restated: what each combination keeps. `snapshot` names the
 * engine; `fallback` is why a raw snapshot was kept when the reader was asked.
 */
function expected({ direct, reader, node, render }) {
  if (direct === "refused") return { error: /^Refused to fetch http:\/\/127\.0\.0\.1\/admin/ }
  if (direct === "ok-pdf") return { file: "application/pdf", role: "primary", text: reader === "429" ? null : MARKDOWN }
  if (direct === "ok-html") {
    if (node && render === false) return { snapshot: "raw", title: "Raw", fallback: null }
    if (reader === "ok-json") return { snapshot: "reader-dom", title: "Rendered" }
    return { snapshot: "raw", title: "Raw", fallback: reader === "429" ? "the reader was unavailable (429)" : "the reader was unavailable (it found no page to render)" }
  }
  if (reader === "ok-json") return { snapshot: "reader-dom", title: "Rendered" }
  if (reader === "not-a-page") return { file: "text/markdown", role: "extract", missing: { what: "primary", outcome: "unreachable", detail: node ? "network" : "CORS or network" } }
  return { error: /^Could not capture https:\/\/site\.test\/page: the reader was unavailable \(429\)/ }
}

describe("web_capture: every way of getting a page", () => {
  const cases = []
  for (const direct of ["ok-html", "ok-pdf", "throw", "refused"]) {
    for (const reader of ["ok-json", "not-a-page", "429"]) {
      for (const node of [false, true]) {
        for (const render of [true, false]) cases.push([`direct ${direct} · reader ${reader} · ${node ? "node" : "browser"} · render ${render}`, { direct, reader, node, render }])
      }
    }
  }

  it("covers the product", () => expect(cases).toHaveLength(48))

  it.each(cases)("%s", async (_, c) => {
    const { ctx, repo, sent } = context(c)
    const want = expected(c)
    const call = webCapture.execute({ url: TARGET, render: c.render }, ctx)
    if (want.error) {
      await expect(call).rejects.toThrow(want.error)
      // Nothing was kept: the repo holds no document.
      expect(Object.keys(repo.handles)).toEqual([])
      return
    }
    const out = await call
    const doc = (await repo.find(out.doc.url)).doc()

    if (want.file) {
      expect(doc["@patchwork"].type).toBe("file")
      expect([doc.mimeType, doc.role]).toEqual([want.file, want.role])
      expect(doc.missing ?? null).toEqual(want.missing ?? null)
      if (want.file === "application/pdf") {
        expect([...doc.content]).toEqual([...PDF])
        expect(doc.text == null ? null : String(doc.text)).toBe(want.text)
        expect(out.text).toMatch(/^Not a page: a PDF\. Kept the PDF itself/)
      } else {
        expect(String(doc.content)).toBe(MARKDOWN)
        expect(out.text).toMatch(/^No snapshot: the reader found no page to render and the page could not be fetched from here \(unreachable: (CORS or )?network\)\. Kept the reader's text instead/)
      }
      return
    }

    expect(doc["@patchwork"].type).toBe("web-snapshot")
    expect(doc.capture.engine).toBe(want.snapshot)
    expect(doc.capture.via).toBe(want.snapshot === "raw" ? "direct" : "reader")
    expect(doc.title).toBe(want.title)
    expect(new TextDecoder().decode(doc.html)).toBe(want.snapshot === "raw" ? RAW : RENDERED)
    expect(doc.capture.finalUrl).toBe(want.snapshot === "raw" ? TARGET : `${TARGET}/final`)
    expect(doc.missing).toBe(null)
    expect(doc.complete).toBe(true)
    expect(doc.tally).toMatchObject({ found: 3, kept: 3, notKept: {}, policy: {} })
    expect(readable(doc)).toBe(want.snapshot === "raw" ? "# Raw page" : "# Rendered page\n\nAfter scripts.")
    expect(doc.marks[0]).toEqual({ at: 0, label: want.snapshot === "raw" ? "# Raw page" : "# Rendered page" })

    const how =
      want.snapshot === "reader-dom"
        ? "rendered by the reader (reader.test), resources fetched directly"
        : want.fallback
          ? `${want.fallback}; kept the raw HTML, i.e. the page before its scripts ran`
          : "the raw response, i.e. the page before its scripts ran; resources fetched directly"
    const lines = out.text.split("\n")
    expect(lines[0]).toMatch(new RegExp(`^Captured '${want.title}' from https://site\\.test/page at \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC — ${how.replace(/[().]/g, "\\$&")}\\.$`))
    expect(lines[1]).toMatch(/^automerge:\w+ — web snapshot, [\d.]+ (B|kB) HTML; 3 of 3 resources kept \([\d.]+ B\)\.$/)
    expect(lines[2]).toMatch(/^Text: \d+ chars — source_read \{source:"automerge:\w+", offset:0\}\.$/)
    // The reader was asked for a rendering only when one could be used.
    expect(sent.some((u) => u.startsWith(READER))).toBe(!(c.node && c.render === false && c.direct === "ok-html"))
  })
})

describe("web_capture: what a snapshot holds", () => {
  it("keeps every resource once, as bytes, and freezes to a page that loads only them", async () => {
    const { ctx, repo } = context({ direct: "throw", reader: "ok-json", node: false })
    const out = await webCapture.execute({ url: TARGET }, ctx)
    const doc = (await repo.find(out.doc.url)).doc()
    expect(Object.fromEntries(Object.entries(doc.resources).map(([u, r]) => [u, [r.kind, r.outcome, r.from]]))).toEqual({
      "https://site.test/s.css": ["style", "ok", "page"],
      "https://site.test/bg.png": ["image", "ok", "https://site.test/s.css"],
      "https://site.test/a.png": ["image", "ok", "page"],
    })
    // a.png and bg.png are the same bytes: one blob.
    expect(Object.keys(doc.blobs)).toHaveLength(2)
    expect(doc.base).toBe(`${TARGET}/final`)
    // The room for resources: the limit, less the HTML, its text and marks, and 2 KB for the small fields.
    const utf8 = (t) => new TextEncoder().encode(t).byteLength
    expect(doc.budget.maxTotalBytes).toBe(2e7 - doc.html.byteLength - utf8(String(doc.text)) - utf8(JSON.stringify(doc.marks)) - 2048)
    const frozen = freeze(doc)
    expect(frozen).not.toMatch(/https:\/\/site\.test\/(s\.css|a\.png)/)
    expect(frozen).toContain(`<img src="data:image/png;base64,`)
  })

  it("records what it could not get, and says so", async () => {
    const { ctx } = context({ direct: "throw", reader: "ok-json", node: false })
    const blocked = ctx.fetchImpl
    ctx.fetchImpl = Object.assign(async (url, init) => (url.endsWith(".png") ? Promise.reject(new TypeError("Failed to fetch")) : blocked(url, init)), { policy: blocked.policy })
    const out = await webCapture.execute({ url: TARGET }, ctx)
    expect(out.text.split("\n")[1]).toMatch(/1 of 3 resources kept/)
    expect(out.text.split("\n")[2]).toBe("Not kept: 2 unreachable (CORS or network).")
  })

  it("keeps within maxBytes, page and text included", async () => {
    const { ctx, repo } = context({ direct: "throw", reader: "ok-json", node: false })
    const out = await webCapture.execute({ url: TARGET, maxBytes: RENDERED.length + 30 }, ctx)
    const doc = (await repo.find(out.doc.url)).doc()
    // 30 bytes past the HTML do not hold its text, so no resource fits; the
    // sheet is not kept, so what it links is never found.
    expect(Object.fromEntries(Object.entries(doc.resources).map(([u, r]) => [u.split("/").pop(), r.outcome]))).toEqual({
      "s.css": "over-budget",
      "a.png": "over-budget",
    })
  })

  it("refuses a target the guard refuses, before asking anyone", async () => {
    const { ctx, sent } = context({ direct: "ok-html", reader: "ok-json", node: false })
    await expect(webCapture.execute({ url: "http://localhost:8080/" }, ctx)).rejects.toThrow(/Refused/)
    await expect(webCapture.execute({ url: "file:///etc/passwd" }, ctx)).rejects.toThrow(/absolute http/)
    expect(sent).toEqual([])
  })
})

describe("web_capture in a research step", () => {
  it("lands in the ledger, reads with source_read, and answers again from it", async () => {
    const { ctx, repo, sent } = context({ direct: "throw", reader: "ok-json", node: false })
    const plan = repo.create({ sources: {} })
    const scoped = { ...ctx, repo: scopedRepo(repo, plan, { stepId: "research" }), scope: { stepId: "research" } }
    delete scoped.session

    const out = await webCapture.execute({ url: TARGET }, scoped)
    const entry = plan.doc().sources[Object.keys(plan.doc().sources)[0]]
    expect(entry).toMatchObject({ url: out.doc.url, kind: "source", what: "snapshot", source: TARGET, engine: "reader-dom", by: "research", name: "Rendered" })
    expect(entry.chars).toBe("# Rendered page\n\nAfter scripts.".length)

    const read = await sourceRead.execute({ source: out.doc.url, find: "scripts" }, scoped)
    expect(read).toMatch(/1 match for "scripts"/)
    expect(read).toMatch(/· # Rendered page ·/)

    const before = sent.length
    const again = await webCapture.execute({ url: TARGET }, scoped)
    expect(again.text).toMatch(/^Already captured at automerge:\w+ \(\d\d:\d\d UTC\)\. source_read \{source:"automerge:\w+", offset:0\}\. Pass again:true for a new snapshot\.$/)
    expect(sent.length).toBe(before)
    expect(webCapture.summarize({ url: TARGET }, again.text)).toBe("already captured · site.test")
    expect(webCapture.summarize({ url: TARGET }, out.text)).toBe("captured site.test · 3 of 3 resources")
  })
})

describe("web_capture in the registry", () => {
  it("is a built-in, a research step's tool, presented, and granted with the rest of the web", () => {
    expect(BUILTIN_TOOLS.filter((t) => t.id === "web_capture")).toEqual([webCapture])
    expect(SCOPED_TOOL_IDS).toContain("web_capture")
    expect(PRESENTED).toContain("web_capture")
    expect(grantGroup("web_capture")).toBe("web")
    const call = { input: { url: TARGET } }
    expect(needsApproval({ grants: {} }, webCapture, call)).toBe(true)
    expect(needsApproval({ grants: { "web@*": "session" } }, webCapture, call)).toBe(false)
    expect(needsApproval({ grants: { "web@https://site.test/": "session" } }, webCapture, call)).toBe(false)
    expect(needsApproval({ grants: { "web@https://other.test/": "session" } }, webCapture, call)).toBe(true)
  })
})

/** A context whose web is `fetch`, in a browser. */
function contextOf(fetch) {
  const repo = new Repo({ network: [] })
  const ctx = { repo, reader: READER, direct: false, fetchImpl: guardedFetch({ fetch, direct: false }), session: { doc: () => ({ made: [] }) } }
  return { ctx, repo }
}

describe("web_capture: when nobody answers", () => {
  /** When the capture began, on the fake clock. */
  let began = 0
  /** Every request, and the second it was made at. */
  let asked = []
  /** The web of `web()`, except that what `hangs` matches never answers until it is aborted. */
  const hanging = (base, hangs) => async (url, init = {}) => {
    asked.push([url, (Date.now() - began) / 1000])
    if (!hangs(url)) return base(url, init)
    return new Promise((_, reject) => {
      const fail = () => reject(new DOMException("The operation was aborted.", "AbortError"))
      if (init.signal?.aborted) fail()
      init.signal?.addEventListener("abort", fail)
    })
  }
  /** Run a capture on fake timers, moving the clock a second at a time until it settles. */
  async function run(fetch) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    try {
      const { ctx, repo } = contextOf(fetch)
      const call = webCapture.execute({ url: TARGET }, ctx)
      let settled = false
      call.then(
        () => (settled = true),
        () => (settled = true)
      )
      began = Date.now()
      asked = []
      while (!settled && Date.now() - began < 600000) await vi.advanceTimersByTimeAsync(1000)
      return { call, repo }
    } finally {
      vi.useRealTimers()
    }
  }
  const page = (url) => url === TARGET
  const reader = (url) => url.startsWith(READER)

  it("a page that never answers is given up after 15 s, and the reader's rendering is kept", async () => {
    const { call, repo } = await run(hanging(web({ direct: "ok-html", reader: "ok-json" }).fetch, page))
    const out = await call
    expect((await repo.find(out.doc.url)).doc().capture.engine).toBe("reader-dom")
    // The page was asked at once, and the reader when the page was given up.
    expect(asked.slice(0, 2)).toEqual([
      [TARGET, 0],
      [expect.stringMatching(/^https:\/\/reader\.test\//), 15],
    ])
  })

  it("a reader that never answers is given up after 60 s, and the raw page is kept, saying why", async () => {
    const { call, repo } = await run(hanging(web({ direct: "ok-html", reader: "ok-json" }).fetch, reader))
    const out = await call
    expect((await repo.find(out.doc.url)).doc().capture.engine).toBe("raw")
    expect(out.text.split("\n")[0]).toMatch(/the reader was unavailable \(timeout\); kept the raw HTML/)
    // The page's stylesheet was asked for when the reader was given up.
    expect(asked.find(([url]) => url === "https://site.test/s.css")).toEqual(["https://site.test/s.css", 60])
  })

  it("when neither answers, the call fails with both reasons", async () => {
    const { call } = await run(hanging(web({ direct: "ok-html", reader: "ok-json" }).fetch, (url) => page(url) || reader(url)))
    await expect(call).rejects.toThrow(
      "Could not capture https://site.test/page: the reader was unavailable (timeout) and the page could not be fetched from here (timeout: no answer in 15 s)."
    )
  })
})

describe("web_capture: the rendered page's encoding", () => {
  it("hands the label the rendered page declares to its unlabelled sheets", async () => {
    const html = `<html><head><meta charset="windows-1252"><link rel=stylesheet href=/l.css></head><body><h1>x</h1></body></html>`
    const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0))
    const fetch = async (url) => {
      if (url.startsWith(READER)) return respond(JSON.stringify({ code: 200, data: { title: "L", url: TARGET, html } }), { type: "application/json" })
      if (url === TARGET) throw new TypeError("Failed to fetch")
      if (url === "https://site.test/l.css") return respond(latin1(`p{background:url(caf\xE9.png)}`), { type: "text/css", url })
      if (url === "https://site.test/caf%C3%A9.png") return respond(PNG, { type: "image/png", url })
      return respond("", { status: 404, url })
    }
    const { ctx, repo } = contextOf(fetch)
    const out = await webCapture.execute({ url: TARGET }, ctx)
    const doc = (await repo.find(out.doc.url)).doc()
    // The page itself is the reader's UTF-8; its sheets are what it declared.
    expect(doc.charset).toBe("utf-8")
    expect(doc.resources["https://site.test/l.css"]).toMatchObject({ outcome: "ok", charset: "windows-1252" })
    expect(doc.resources["https://site.test/caf%C3%A9.png"]).toMatchObject({ outcome: "ok", from: "https://site.test/l.css" })
  })
})

describe("web_capture: the snapshot's size", () => {
  // A page of 3,000 characters of text and ten 1,000-byte images.
  const IMAGES = Array.from({ length: 10 }, (_, i) => `https://site.test/i${i}.png`)
  const HTML = `<html><body><p>${"word ".repeat(600)}</p>${IMAGES.map((u) => `<img src="${u}">`).join("")}</body></html>`
  const BIG = new Uint8Array(1000)
  BIG.set([0x89, 0x50, 0x4e, 0x47])
  const fetch = async (url) => {
    if (url.startsWith(READER)) return respond(JSON.stringify({ code: 200, data: { title: "Big", url: TARGET, html: HTML } }), { type: "application/json" })
    if (url === TARGET) throw new TypeError("Failed to fetch")
    if (IMAGES.includes(url)) return respond(BIG, { type: "image/png", url })
    return respond("", { status: 404, url })
  }
  /** What the document holds: its bytes, its text, and everything else as JSON. */
  const sizeOf = (doc) => {
    const { html, blobs, text, ...rest } = doc
    const blobBytes = Object.values(blobs).reduce((a, b) => a + b.byteLength, 0)
    return html.byteLength + blobBytes + new TextEncoder().encode(String(text)).byteLength + new TextEncoder().encode(JSON.stringify(rest)).byteLength
  }

  it("counts the text and what is recorded of each resource, not only the bytes kept", async () => {
    let previous = -1
    for (const extra of [0, 4000, 6000, 8000, 10000, 12000, 16000, 20000]) {
      const limit = HTML.length + extra
      const { ctx, repo } = contextOf(fetch)
      const out = await webCapture.execute({ url: TARGET, maxBytes: limit }, ctx)
      const doc = (await repo.find(out.doc.url)).doc()
      const kept = Object.values(doc.resources).filter((r) => r.outcome === "ok").length
      // Within the limit whenever anything was kept; and more room never keeps less.
      if (kept) expect(sizeOf(doc), `limit ${limit}`).toBeLessThanOrEqual(limit)
      expect(kept).toBeGreaterThanOrEqual(previous)
      // What was kept is the first so many, in order.
      expect(IMAGES.map((u) => doc.resources[u].outcome)).toEqual(IMAGES.map((_, i) => (i < kept ? "ok" : "over-budget")))
      previous = kept
    }
    expect(previous).toBe(10)
  })
})
