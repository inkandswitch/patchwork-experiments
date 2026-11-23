import { describe, it, expect } from "vitest"
import { generateAutomergeUrl } from "@automerge/automerge-repo"
import {
  parseBraveResults, braveSearch, braveSearchUrl, BRAVE_SEARCH, SNIPPET_MAX, readerUrl, readerSiteError, webFetch, webSearch, htmlToText,
} from "./tools/web.js"
import { MAX_PDF_BYTES, sha256Hex } from "./tools/sources.js"
import { guardedFetch, Refused } from "./tools/guard.js"
import { httpRequest } from "./tools/http.js"
import { bytes } from "./tools/format.js"
import { makePdf } from "./pdf-fixture.js"

/** A repo double that makes real-looking URLs and records every document. */
function fakeRepo() {
  const docs = new Map()
  return {
    docs,
    async create2() {
      const url = generateAutomergeUrl()
      docs.set(url, {})
      return { url, doc: () => docs.get(url), change: (fn) => fn(docs.get(url)) }
    },
  }
}

const respond = (body, { status = 200, type = "text/plain", url = "", length = null } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  headers: {
    get: (n) => (n.toLowerCase() === "content-type" ? type : n.toLowerCase() === "content-length" ? length : null),
  },
  body: { cancel() {} },
  async arrayBuffer() {
    const b = typeof body === "string" ? new TextEncoder().encode(body) : body
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  },
  async text() {
    return typeof body === "string" ? body : new TextDecoder().decode(body)
  },
})

/** Brave's answer, shaped as its API sends it (trimmed). */
const braveAnswer = (results) => ({ type: "search", query: { original: "q" }, web: { type: "search", results } })

describe("parseBraveResults", () => {
  const answer = braveAnswer([
    { title: "Automerge &amp; <strong>CRDTs</strong>", url: "https://automerge.org/", description: "A <strong>CRDT</strong> library &mdash; local-first." },
    { title: "Automerge again", url: "https://automerge.org/" },
    { title: "Not the web", url: "ftp://files.example/x" },
    { title: "", url: "https://untitled.example/" },
  ])

  it("reads title, URL and excerpt, its tags and entities undone, each URL once", () => {
    expect(parseBraveResults(answer)).toEqual([
      { title: "Automerge & CRDTs", url: "https://automerge.org/", snippet: "A CRDT library &mdash; local-first." },
      { title: "https://untitled.example/", url: "https://untitled.example/", snippet: null },
    ])
  })

  it("honours the limit", () => {
    expect(parseBraveResults(answer, 1)).toHaveLength(1)
  })

  it("returns nothing for an answer with no web results", () => {
    expect(parseBraveResults({ type: "search" })).toEqual([])
    expect(parseBraveResults(null)).toEqual([])
  })

  it("cuts a long excerpt to one line", () => {
    const snippet = parseBraveResults(braveAnswer([{ title: "T", url: "https://t.example/", description: "x\n ".repeat(400) }]))[0].snippet
    expect(snippet.length).toBe(SNIPPET_MAX)
    expect(snippet.endsWith("…")).toBe(true)
    expect(snippet).not.toMatch(/\n|  /)
  })
})

describe("readerSiteError", () => {
  it("is the status the site gave the reader, from the reader's header", () => {
    expect(readerSiteError("Title: Nacra F18\n\nURL Source: https://w.example/x\n\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nNot here")).toBe(404)
  })

  it("is null for a page the site served, even one that quotes the warning", () => {
    expect(readerSiteError("Title: Hi\n\nMarkdown Content:\nWarning: Target URL returned error 500")).toBe(null)
    expect(readerSiteError("Title: Hi\n\nWarning: This is a cached snapshot\n\nMarkdown Content:\nHello")).toBe(null)
  })
})

describe("readerUrl", () => {
  it("prefixes the target with the reader", () => {
    expect(readerUrl("https://example.com", "https://r.example/")).toBe("https://r.example/https://example.com")
  })
})

describe("web_fetch through the reader", () => {
  const ctx = (impl) => ({ fetchImpl: impl, reader: "https://r.test/", repo: fakeRepo() })

  it("rejects a non-absolute url before making a request", async () => {
    let called = false
    await expect(
      webFetch.execute({ url: "example.com" }, ctx(async () => { called = true }))
    ).rejects.toThrow(/absolute/)
    expect(called).toBe(false)
  })

  it("fetches through the reader, keeps the page, and shows the start", async () => {
    const seen = []
    const impl = async (url) => (seen.push(url), respond("x".repeat(5000)))
    const out = await webFetch.execute({ url: "https://example.com/page", maxChars: 100 }, ctx(impl))
    expect(seen).toEqual(["https://r.test/https://example.com/page"])
    expect(out.text.split("\n")[1]).toBe("x".repeat(100))
    expect(out.text).toContain("— 100 of 5000 shown")
  })

  it("explains a failure rather than returning empty text", async () => {
    const impl = async () => respond("", { status: 451 })
    await expect(webFetch.execute({ url: "https://example.com" }, ctx(impl))).rejects.toThrow(/451/)
  })

  it("keeps nothing when the site answered the reader with an error, and says what the site said", async () => {
    const repo = fakeRepo()
    const notHere = "Title: Nacra F18\n\nURL Source: https://w.example/Nacra_F18\n\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nNo such page"
    await expect(webFetch.execute({ url: "https://w.example/Nacra_F18" }, { ...ctx(async () => respond(notHere)), repo })).rejects.toThrow(
      "Could not fetch https://w.example/Nacra_F18 (http-error: HTTP 404, as the reader found it)."
    )
    expect(repo.docs.size).toBe(0)
  })

  it("summarizes by host", () => {
    expect(webFetch.summarize({ url: "https://automerge.org/docs/x" }, "abc")).toMatch(/automerge\.org/)
    expect(webFetch.summarize({ url: "https://a.org/x" }, "Already kept at automerge:x")).toBe("already kept · a.org")
    expect(webFetch.summarize({ url: "https://a.org/x.pdf" }, "Kept the PDF itself (2,215,244 bytes, …")).toBe("fetched a.org · PDF, 2.1 MB")
  })
})

describe("what web_fetch may reach", () => {
  /** A guard around a fetch that records every request, so "refused" can mean "nothing was sent". */
  const recorded = () => {
    const seen = []
    const fetchImpl = guardedFetch({
      fetch: async (url) => (seen.push(url), respond("Title: x\n\nbody")),
      deny: ["https://patchwork.inkandswitch.com"],
    })
    return { seen, ctx: { fetchImpl, repo: fakeRepo() } }
  }

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]:3000/",
    "http://localhost:8080/",
    "https://patchwork.inkandswitch.com/automerge:abc",
    "https://example.com/automerge%3Aabc/x",
  ])("refuses %s before building a reader URL around it", async (url) => {
    const { seen, ctx } = recorded()
    await expect(webFetch.execute({ url }, ctx)).rejects.toBeInstanceOf(Refused)
    expect(seen).toEqual([])
  })

  it("fetches nothing without the runner's guarded fetch", async () => {
    await expect(webFetch.execute({ url: "https://example.com/" }, { repo: fakeRepo() })).rejects.toThrow(/no guarded fetch/)
    await expect(webSearch.execute({ query: "x" }, {})).rejects.toThrow(/no guarded fetch/)
  })
})

describe("web_search", () => {
  /** A runner that can search: a key, and direct (node, or a tab with the relay). */
  const searching = (answer, extra = {}) => {
    const sent = []
    const fetchImpl = async (url, init) => {
      sent.push({ url: String(url), init })
      return answer(url, init)
    }
    const key = "key" in extra ? extra.key : "brave-key"
    return { sent, ctx: { fetchImpl, direct: true, search: braveSearch({ key: () => key, fetchImpl }), repo: fakeRepo(), ...extra } }
  }
  const json = (value, status = 200) => respond(JSON.stringify(value), { status, type: "application/json" })

  it("asks Brave's API, with the account's key, for as many results as wanted, at most 20", async () => {
    const { sent, ctx } = searching(() => json(braveAnswer([])))
    await webSearch.execute({ query: "lfp cells", limit: 50 }, ctx)
    await webSearch.execute({ query: "x" }, ctx)
    expect(sent.map((s) => s.url)).toEqual([braveSearchUrl("lfp cells", 20), braveSearchUrl("x", 8)])
    expect(sent[0].url).toBe(`${BRAVE_SEARCH}?q=lfp%20cells&count=20`)
    expect(sent[0].init.headers).toEqual({ accept: "application/json", "x-subscription-token": "brave-key" })
  })

  it("lists each result with its excerpt, and keeps Brave's answer as it came", async () => {
    const answer = braveAnswer([{ title: "Cells", url: "https://cells.example/", description: "Rated 280Ah at 0.5C, 6000 cycles." }])
    const { ctx } = searching(() => json(answer))
    const out = await webSearch.execute({ query: "lfp cells" }, ctx)
    expect(out.text.split("\n").slice(0, 4)).toEqual(['1 results for "lfp cells":', "1. Cells", "   https://cells.example/", "   “Rated 280Ah at 0.5C, 6000 cycles.”"])
    expect(out.text).toContain(`Results page kept at ${out.doc.url}.`)
    const kept = ctx.repo.docs.get(out.doc.url)
    expect(JSON.parse(String(kept.content))).toEqual(answer)
    expect(kept).toMatchObject({ role: "extract", mimeType: "application/json", source: "https://search.brave.com/search?q=lfp%20cells" })
    expect(kept.capture).toMatchObject({ via: "direct", engine: "search", status: 200 })
  })

  it("still answers when nothing can be kept", async () => {
    const { ctx } = searching(() => json(braveAnswer([{ title: "Cells", url: "https://cells.example/" }])), { repo: undefined })
    const out = await webSearch.execute({ query: "lfp" }, ctx)
    expect([out.text, out.doc]).toEqual(['1 results for "lfp":\n1. Cells\n   https://cells.example/', null])
  })

  it("says so when there are no results", async () => {
    const { ctx } = searching(() => json(braveAnswer([])))
    expect((await webSearch.execute({ query: "zzz" }, ctx)).text).toMatch(/^No results for "zzz"/)
  })

  it.each([
    [{ key: null }, /needs a Brave Search API key \(/, /fetch relay/],
    [{ direct: false }, /needs the fetch relay/, /API key/],
    [{ search: undefined, direct: false }, /needs a Brave Search API key .* and the fetch relay/, null],
  ])("says what is missing, asks nothing of the web, and warns against guessing URLs (%#)", async (extra, says, saysNot) => {
    const { sent, ctx } = searching(() => json(braveAnswer([])), extra)
    const error = await webSearch.execute({ query: "q" }, ctx).catch((e) => e)
    expect(error.message).toMatch(/^Web search is not set up here/)
    expect(error.message).toMatch(says)
    if (saysNot) expect(error.message).not.toMatch(saysNot)
    expect(error.message).toMatch(/a guessed URL is usually a 404/)
    expect(sent).toEqual([])
  })

  it.each([
    [401, false, /refused the search \(HTTP 401\).*Web search\.$/],
    [422, true, /refused the search \(HTTP 422\).*redeploy fetch-relay/],
    [429, false, /limit was reached \(HTTP 429\)/],
    [500, false, /^Search failed \(HTTP 500\)\.$/],
  ])("says what Brave's %i means", async (status, relayed, says) => {
    const { ctx } = searching(() => ({ ...json({ error: "x" }, status), relayed }))
    await expect(webSearch.execute({ query: "q" }, ctx)).rejects.toThrow(says)
  })

  it("does not mistake an answer that is not Brave's JSON for no results", async () => {
    const { ctx } = searching(() => respond("<html>a bot check</html>", { type: "text/html" }))
    await expect(webSearch.execute({ query: "q" }, ctx)).rejects.toThrow(/not the JSON/)
  })

  it("requires a query", async () => {
    await expect(webSearch.execute({ query: "  " }, {})).rejects.toThrow(/query/)
  })
})


describe("direct mode (outside a browser)", () => {
  it("points to web_capture for keeping the page as it looks — only where web_capture is here", async () => {
    const page = async () => respond("<html><head><title>Hi</title></head><body><p>Hello</p></body></html>", { type: "text/html" })
    const hint = /web_capture \{ url: "https:\/\/example\.com" \}/
    const withIt = await webFetch.execute({ url: "https://example.com" }, { fetchImpl: page, direct: true, repo: fakeRepo(), hasTool: (id) => id === "web_capture" })
    expect(withIt.text).toMatch(hint)
    for (const ctx of [{ hasTool: () => false }, {}]) {
      const without = await webFetch.execute({ url: "https://example.com" }, { fetchImpl: page, direct: true, repo: fakeRepo(), ...ctx })
      expect(without.text).not.toMatch(/web_capture/)
    }
  })

  it("keeps the page itself, with its text beside it, instead of going through a reader", async () => {
    const seen = []
    const fetchImpl = async (url) => {
      seen.push(url)
      return respond("<html><head><title>Hi</title></head><body><p>Hello</p><script>bad()</script></body></html>", { type: "text/html" })
    }
    const repo = fakeRepo()
    const out = await webFetch.execute({ url: "https://example.com" }, { fetchImpl, direct: true, repo })
    expect(seen).toEqual(["https://example.com"])
    const doc = repo.docs.get(out.doc.url)
    expect(doc).toMatchObject({ role: "primary", mimeType: "text/html", textVia: "html-to-text", name: "Hi.html" })
    expect(doc.capture).toMatchObject({ via: "direct", engine: "raw", status: 200 })
    expect(String(doc.text)).toBe("Hello")
    expect(out.text.split("\n")).toEqual([
      `Kept 'Hi.html' — the response itself (text/html, 5 chars of text) — ${out.doc.url}`,
      "Hello",
      `— all 5 characters shown. Search it later: source_read {source:"${out.doc.url}", find:"…"}.`,
      `Cite what it says as [label](${out.doc.url} "the exact words").`,
    ])
    expect(out.text).not.toContain("bad()")
  })

  it("decodes a page by the charset it declares, reading its bytes once", async () => {
    // response.text() decodes as UTF-8 whatever the header says, so a Latin-1
    // page came back with U+FFFD where its accents were.
    let texts = 0
    const latin1 = new Uint8Array([...new TextEncoder().encode("<p>Caf"), 0xe9, ...new TextEncoder().encode("</p>")])
    const response = respond(latin1, { type: "text/html; charset=windows-1252" })
    response.text = async () => (texts++, "")
    const repo = fakeRepo()
    const out = await webFetch.execute({ url: "https://example.com/menu" }, { direct: true, repo, fetchImpl: async () => response })
    expect(String(repo.docs.get(out.doc.url).content)).toBe("<p>Café</p>")
    expect(String(repo.docs.get(out.doc.url).text)).toBe("Café")
    expect(texts).toBe(0)
  })

  it("keeps plain text as it came", async () => {
    const repo = fakeRepo()
    const out = await webFetch.execute(
      { url: "https://example.com/a.txt" },
      { direct: true, repo, fetchImpl: async () => respond("just some text") }
    )
    expect(String(repo.docs.get(out.doc.url).content)).toBe("just some text")
    expect(out.text.split("\n")[1]).toBe("just some text")
  })

  it("keeps an image as bytes, and says there is no text to read", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const repo = fakeRepo()
    const out = await webFetch.execute({ url: "https://example.com/a.png" }, { direct: true, repo, fetchImpl: async () => respond(png, { type: "image/png" }) })
    expect([...repo.docs.get(out.doc.url).content]).toEqual([...png])
    expect(out.text).toBe(`Kept 'example.com a.png' — PNG bytes, 9 B — ${out.doc.url}. There is no text in it to read here; open it in Patchwork.`)
  })

  it("reports a page it could not get", async () => {
    await expect(
      webFetch.execute({ url: "https://example.com/gone" }, { direct: true, repo: fakeRepo(), fetchImpl: async () => respond("", { status: 404 }) })
    ).rejects.toThrow("Could not fetch https://example.com/gone (http-error: HTTP 404).")
  })
})


describe("htmlToText", () => {
  it("drops scripts, styles and tags but keeps structure", () => {
    const html = "<h1>Title</h1><style>.x{}</style><p>One</p><p>Two</p>"
    expect(htmlToText(html)).toBe("Title\nOne\nTwo")
  })
  it("decodes the common entities", () => {
    expect(htmlToText("<p>a &amp; b &lt;c&gt; &quot;d&quot;</p>")).toBe('a & b <c> "d"')
  })
  it("turns breaks into newlines", () => {
    expect(htmlToText("a<br>b")).toBe("a\nb")
  })
})

describe("asking the reader", () => {
  function capture(body = "ok") {
    const seen = []
    return {
      seen,
      ctx: {
        repo: fakeRepo(),
        fetchImpl: async (url, options) => {
          seen.push({ url, options })
          return respond(body)
        },
      },
    }
  }

  it("asks for markdown by default", async () => {
    const { seen, ctx } = capture()
    await webFetch.execute({ url: "https://x.test/" }, ctx)
    expect(seen[0].options.headers["X-Return-Format"]).toBe("markdown")
    expect(seen[0].options.headers).not.toHaveProperty("x-no-cache")
  })

  it("asks for text when told to", async () => {
    const { seen, ctx } = capture()
    await webFetch.execute({ url: "https://x.test/", format: "text" }, ctx)
    expect(seen[0].options.headers["X-Return-Format"]).toBe("text")
  })

  it.each(["html", "pdf"])("ignores a format it does not have (%s), rather than sending nonsense", async (format) => {
    const { seen, ctx } = capture()
    await webFetch.execute({ url: "https://x.test/", format }, ctx)
    expect(seen[0].options.headers["X-Return-Format"]).toBe("markdown")
  })

  it("skips the cache when freshness is what matters, and records that it did", async () => {
    const { seen, ctx } = capture()
    const out = await webFetch.execute({ url: "https://x.test/", fresh: true }, ctx)
    expect(seen[0].options.headers["x-no-cache"]).toBe("true")
    expect(ctx.repo.docs.get(out.doc.url).capture.readerCache).toBe("no-cache")
    expect(out.text.split("\n")[0]).toMatch(/\(fetched fresh by the reader\)$/)
  })
})

// ------------------------------------------------------------------ PDFs

describe("a PDF is kept as the PDF", () => {
  const TARGET = "https://papers.example/pdf/2401.00001.pdf"
  const READER = "https://r.test/"
  const MARKDOWN = "Title: Attention\n\nNumber of Pages: 3\n\n# Abstract\n\nwords"
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0xfe, 0x00])
  const OVER = (() => {
    const big = new Uint8Array(MAX_PDF_BYTES + 1)
    big.set(PDF)
    return big
  })()

  /** What the bytes request does, by case. */
  const BYTES = {
    ok: () => respond(PDF, { type: "application/pdf", url: TARGET }),
    unreachable: () => {
      throw new TypeError("Failed to fetch")
    },
    "not-pdf": () => respond("<html>landing page</html>", { type: "text/html", url: TARGET }),
    "over-budget": () => respond(OVER, { type: "application/pdf", url: TARGET }),
  }
  const READERS = {
    ok: () => respond(MARKDOWN),
    429: () => respond("rate limited", { status: 429 }),
  }
  /** Why the PDF is missing, from the outcome table: [outcome, detail]. */
  const missing = (bytesCase, direct) =>
    ({
      unreachable: ["unreachable", direct ? "network" : "CORS or network"],
      "not-pdf": ["type-mismatch", "the response is not a PDF"],
      "over-budget": ["over-budget", `larger than the ${bytes(MAX_PDF_BYTES)} kept as a PDF`],
    })[bytesCase]

  for (const direct of [false, true]) {
    for (const bytesCase of Object.keys(BYTES)) {
      for (const readerCase of Object.keys(READERS)) {
        it(`${direct ? "node" : "browser"}: bytes ${bytesCase}, reader ${readerCase}`, async () => {
          const seen = []
          const fetchImpl = async (url) => {
            seen.push(url.startsWith(READER) ? "reader" : "bytes")
            return url.startsWith(READER) ? READERS[readerCase]() : BYTES[bytesCase]()
          }
          const repo = fakeRepo()
          const attempt = webFetch.execute({ url: TARGET }, { repo, reader: READER, direct, fetchImpl })

          // A PDF's own bytes are asked for first, in a browser as in node: the
          // reader is asked only when they gave no text (these are not real PDFs).
          const order = ["bytes", "reader"]

          if (bytesCase !== "ok" && readerCase !== "ok") {
            const [outcome, detail] = missing(bytesCase, direct)
            await expect(attempt).rejects.toThrow(
              `Could not keep ${TARGET}: the PDF could not be fetched from here (${outcome}: ${detail}) and the reader was unavailable (429).`
            )
            expect(seen).toEqual(order)
            expect(repo.docs.size).toBe(0)
            return
          }

          const out = await attempt
          expect(seen).toEqual(order)
          expect(repo.docs.size).toBe(1)
          const doc = repo.docs.get(out.doc.url)
          const first = out.text.split("\n")[0]

          if (bytesCase === "ok") {
            const sha = await sha256Hex(PDF)
            expect(doc).toMatchObject({ role: "primary", extension: "pdf", mimeType: "application/pdf", missing: null, source: TARGET })
            expect([...doc.content]).toEqual([...PDF])
            expect(doc.capture).toMatchObject({ via: "direct", engine: "raw", status: 200, contentType: "application/pdf", sha256: sha, bytes: PDF.length, finalUrl: TARGET })
            if (readerCase === "ok") {
              expect(String(doc.text)).toBe(MARKDOWN)
              expect(doc.textVia).toBe("reader")
              expect(doc.name).toBe("Attention.pdf")
              expect(first).toBe(`Kept the PDF itself (12 bytes, sha256 ${sha.slice(0, 8)}…) and its text (${MARKDOWN.length} chars, via reader) at ${out.doc.url}`)
              expect(out.text).toContain(`— all ${MARKDOWN.length} characters shown`)
            } else {
              expect(doc.text).toBeNull()
              expect(doc.textVia).toBeNull()
              expect(out.text).toBe(`Kept the PDF itself (12 bytes, sha256 ${sha.slice(0, 8)}…) at ${out.doc.url}. It has no text to read here (the reader was unavailable too: 429). Open it in Patchwork to look at it.`)
            }
            return
          }

          const [outcome, detail] = missing(bytesCase, direct)
          expect(doc).toMatchObject({ role: "extract", extension: "md", text: null, missing: { what: "pdf", outcome, detail } })
          expect(String(doc.content)).toBe(MARKDOWN)
          expect(doc.capture).toMatchObject({ via: "reader", engine: "reader-markdown", status: null, finalUrl: null })
          expect(first).toBe(`Kept the reader's text (${MARKDOWN.length} chars) at ${out.doc.url}; the PDF itself could not be fetched from here (${outcome}: ${detail}).`)
        })
      }
    }
  }

  describe("in node, at a URL that does not end .pdf", () => {
    const PLAIN = "https://papers.example/download/2401.00001"
    const BIG_ZIP = (() => {
      const big = new Uint8Array(MAX_PDF_BYTES + 1)
      big.set([0x50, 0x4b, 0x03, 0x04])
      return big
    })()
    const HTML = "<html><head><title>Landing</title></head><body><p>landing page</p></body></html>"
    const OVER_LENGTH = String(MAX_PDF_BYTES + 1)

    // [case, body, content type, content-length] → what is kept. The rule (§4.4):
    // the content type or the bytes starting %PDF say PDF, and only then is the
    // reader asked, the 30 MB cap applied, and a missing PDF recorded; anything
    // else is the response itself, kept whole.
    it.each([
      ["%PDF bytes, typed as octet-stream", PDF, "application/octet-stream", null, { pdf: true }],
      ["%PDF bytes, untyped", PDF, "", null, { pdf: true }],
      ["%PDF bytes, typed as a PDF", PDF, "application/pdf", null, { pdf: true }],
      ["%PDF bytes, typed as a PDF with a parameter", PDF, "application/pdf; qs=0.001", null, { pdf: true }],
      ["HTML typed as a PDF", HTML, "application/pdf", null, { missing: ["type-mismatch", "the response is not a PDF"] }],
      ["%PDF bytes over the cap, typed as octet-stream", OVER, "application/octet-stream", null, { missing: ["over-budget", `larger than the ${bytes(MAX_PDF_BYTES)} kept as a PDF`] }],
      ["a PDF whose length says it is over the cap", PDF, "application/pdf", OVER_LENGTH, { missing: ["over-budget", `larger than the ${bytes(MAX_PDF_BYTES)} kept as a PDF`], unread: true }],
      ["plain HTML", HTML, "text/html", null, { response: "text/html" }],
      ["HTML whose length says it is over the cap", HTML, "text/html", OVER_LENGTH, { response: "text/html" }],
      ["bytes over the cap that are not a PDF", BIG_ZIP, "application/octet-stream", null, { response: "application/octet-stream" }],
    ])("%s", async (_, body, type, length, expected) => {
      const seen = []
      let read = 0
      const fetchImpl = async (url) => {
        seen.push(url.startsWith(READER) ? "reader" : "bytes")
        if (url.startsWith(READER)) return respond(MARKDOWN)
        const response = respond(body, { type, length, url: PLAIN })
        const whole = response.arrayBuffer
        response.arrayBuffer = async () => (read++, whole())
        return response
      }
      const repo = fakeRepo()
      const out = await webFetch.execute({ url: PLAIN }, { repo, reader: READER, direct: true, fetchImpl })
      const doc = repo.docs.get(out.doc.url)
      expect(repo.docs.size).toBe(1)
      expect(read).toBe(expected.unread ? 0 : 1)

      if (expected.response) {
        expect(seen).toEqual(["bytes"])
        expect(doc).toMatchObject({ role: "primary", mimeType: expected.response, missing: null, source: PLAIN })
        expect(doc.capture).toMatchObject({ via: "direct", engine: "raw" })
        const size = typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength
        expect(doc.capture.bytes).toBe(size)
        return
      }
      expect(seen).toEqual(["bytes", "reader"])
      if (expected.pdf) {
        expect(doc).toMatchObject({ role: "primary", mimeType: "application/pdf", extension: "pdf", missing: null })
        expect([...doc.content]).toEqual([...PDF])
        expect(String(doc.text)).toBe(MARKDOWN)
        return
      }
      const [outcome, detail] = expected.missing
      expect(doc).toMatchObject({ role: "extract", extension: "md", missing: { what: "pdf", outcome, detail } })
      expect(String(doc.content)).toBe(MARKDOWN)
    })
  })

  it("in a browser, follows the reader's page count to a PDF the path did not announce", async () => {
    const seen = []
    const fetchImpl = async (url) => (seen.push(url), url.startsWith(READER) ? respond(MARKDOWN) : respond(PDF, { type: "application/pdf" }))
    const repo = fakeRepo()
    const out = await webFetch.execute({ url: "https://papers.example/abs/2401.00001" }, { repo, reader: READER, fetchImpl })
    expect(seen).toEqual([`${READER}https://papers.example/abs/2401.00001`, "https://papers.example/abs/2401.00001"])
    expect(repo.docs.get(out.doc.url).role).toBe("primary")
  })

  it("in a browser, asks for no bytes when nothing says PDF", async () => {
    const seen = []
    const fetchImpl = async (url) => (seen.push(url), respond("Title: Page\n\nwords"))
    await webFetch.execute({ url: "https://papers.example/about" }, { repo: fakeRepo(), reader: READER, fetchImpl })
    expect(seen).toEqual([`${READER}https://papers.example/about`])
  })

  it("does not read the body of a PDF its headers say is too big", async () => {
    let read = 0
    const huge = respond(PDF, { type: "application/pdf", length: String(MAX_PDF_BYTES + 1) })
    huge.arrayBuffer = async () => (read++, new ArrayBuffer(0))
    const repo = fakeRepo()
    const fetchImpl = async (url) => (url.startsWith(READER) ? respond(MARKDOWN) : huge)
    const out = await webFetch.execute({ url: TARGET }, { repo, reader: READER, fetchImpl })
    expect(read).toBe(0)
    expect(repo.docs.get(out.doc.url).missing.outcome).toBe("over-budget")
  })

  describe("reads the PDF itself, with no reader", () => {
    const SHEET = makePdf(["Capacity 280 Ah", "Cycle life 6000 cycles"])
    const SCAN = makePdf([null])
    for (const direct of [false, true]) {
      it(`${direct ? "node" : "browser"}: the text comes from the bytes and the reader is never asked, even when it would say 429`, async () => {
        const seen = []
        const fetchImpl = async (url) => (seen.push(url), url.startsWith(READER) ? respond("rate limited", { status: 429 }) : respond(SHEET, { type: "application/pdf", url: TARGET }))
        const repo = fakeRepo()
        const out = await webFetch.execute({ url: TARGET }, { repo, reader: READER, direct, fetchImpl })
        expect(seen).toEqual([TARGET])
        const doc = repo.docs.get(out.doc.url)
        expect(doc.textVia).toBe("pdf")
        expect(String(doc.text)).toBe("[Page 1]\nCapacity 280 Ah\n\n[Page 2]\nCycle life 6000 cycles")
        expect(doc.marks.map((m) => m.label)).toEqual(["## Page 1", "## Page 2"])
        expect(out.text).toContain("read from the PDF: 2 pages")
        expect(out.text).toContain("[Page 2]\nCycle life 6000 cycles")
      })
    }

    it("a scan is kept without text, and the answer says it is a scan", async () => {
      const fetchImpl = async (url) => (url.startsWith(READER) ? respond("rate limited", { status: 429 }) : respond(SCAN, { type: "application/pdf", url: TARGET }))
      const repo = fakeRepo()
      const out = await webFetch.execute({ url: TARGET }, { repo, reader: READER, fetchImpl })
      expect(out.text).toMatch(/It has no text: 1 page, and none has a text layer: it is a scan.*no OCR\. Open it in Patchwork/)
      expect(repo.docs.get(out.doc.url).text).toBeNull()
    })

    it("a scan's reader text, when the reader has some, is kept and the scan said", async () => {
      const fetchImpl = async (url) => (url.startsWith(READER) ? respond(MARKDOWN) : respond(SCAN, { type: "application/pdf", url: TARGET }))
      const repo = fakeRepo()
      const out = await webFetch.execute({ url: TARGET }, { repo, reader: READER, fetchImpl })
      expect(out.text.split("\n")[0]).toMatch(/via reader; 1 page, and none has a text layer/)
      expect(repo.docs.get(out.doc.url).textVia).toBe("reader")
    })
  })

  it("records a refused PDF as refused", async () => {
    const fetchImpl = async (url) => {
      if (url.startsWith(READER)) return respond(MARKDOWN)
      throw new Refused(url, "a private, local or link-local address")
    }
    const repo = fakeRepo()
    const out = await webFetch.execute({ url: TARGET }, { repo, reader: READER, fetchImpl })
    expect(repo.docs.get(out.doc.url).missing).toEqual({ what: "pdf", outcome: "refused", detail: "a private, local or link-local address" })
  })

  it("records an HTTP error as one", async () => {
    const fetchImpl = async (url) => (url.startsWith(READER) ? respond(MARKDOWN) : respond("", { status: 403 }))
    const repo = fakeRepo()
    const out = await webFetch.execute({ url: TARGET }, { repo, reader: READER, fetchImpl })
    expect(repo.docs.get(out.doc.url).missing).toEqual({ what: "pdf", outcome: "http-error", detail: "HTTP 403" })
  })
})

// ------------------------------------------------------------------ refusals

/**
 * A refusal is the call's answer, whichever tool and runner meets it: the
 * guard's Refused reaches the caller, not a failure dressed as CORS or a
 * network error. A refused target is never sent at all; a refused redirect is
 * never requested in node (each hop is checked first), and in a browser,
 * where the platform follows it, its body is never read.
 */
describe("a refused target or redirect is refused, by every tool that fetches", () => {
  const METADATA = "http://169.254.169.254/latest/meta-data/"
  const START = "https://example.com/page"
  const READER = "https://r.test/"

  const TOOLS = {
    http_request: { tool: httpRequest, direct: false },
    "web_fetch in node": { tool: webFetch, direct: true },
    "web_fetch in a browser": { tool: webFetch, direct: false },
  }
  const TARGETS = {
    "a private target": "http://10.0.0.1/x",
    "a redirect to the metadata address": START,
  }

  for (const [toolName, { tool, direct }] of Object.entries(TOOLS)) {
    for (const [targetName, url] of Object.entries(TARGETS)) {
      it(`${toolName}, ${targetName}`, async () => {
        const seen = []
        let read = 0
        const send = async (requested) => {
          seen.push(requested)
          // Node sees the redirect; a browser follows it and reports where it ended.
          const response = direct
            ? { status: 302, ok: false, url: requested, headers: { get: (n) => (n.toLowerCase() === "location" ? METADATA : null) }, body: { cancel() {} } }
            : respond("secret", { url: METADATA })
          response.arrayBuffer = async () => (read++, new ArrayBuffer(0))
          response.text = async () => (read++, "")
          return response
        }
        const fetchImpl = guardedFetch({ fetch: send, direct })
        const repo = fakeRepo()
        await expect(tool.execute({ url }, { fetchImpl, direct, reader: READER, repo })).rejects.toBeInstanceOf(Refused)
        expect(seen.some((u) => u.includes("169.254"))).toBe(false)
        expect(read).toBe(0)
        expect(repo.docs.size).toBe(0)
        if (url !== START) expect(seen).toEqual([])
      })
    }
  }
})

describe("fetching something that is not a page", () => {
  const failWith = (status) => async () => respond("", { status })

  it("points at http_request for a file, rather than at another page", async () => {
    // Watched cost two calls: an agent after a JavaScript bundle tried two
    // page tools in turn, and was told both times to try a different page —
    // which was not the problem.
    await expect(
      webFetch.execute({ url: "https://x.test/assets/index-Bnz1O14r.js" }, { fetchImpl: failWith(422) })
    ).rejects.toThrow(/looks like a file rather than a page — fetch it with http_request/)
  })

  it("recognises a file by its extension even on another status", async () => {
    await expect(
      webFetch.execute({ url: "https://x.test/data.json" }, { fetchImpl: failWith(500) })
    ).rejects.toThrow(/http_request/)
  })

  it("still gives the blocked-page advice for an actual page", async () => {
    await expect(
      webFetch.execute({ url: "https://x.test/article" }, { fetchImpl: failWith(403) })
    ).rejects.toThrow(/may be blocked by that site; try a different page/)
  })
})
