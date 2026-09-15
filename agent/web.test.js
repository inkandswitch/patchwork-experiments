import { describe, it, expect } from "vitest"
import {
  parseSearchResults, unwrapRedirect, readerUrl, webFetch, webSearch, htmlToText, parseDuckDuckGoHtml,
} from "./tools/web.js"

describe("unwrapRedirect", () => {
  it("unwraps a DuckDuckGo redirect to the real URL", () => {
    const wrapped = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fautomerge.org%2Fdocs&rut=abc"
    expect(unwrapRedirect(wrapped)).toBe("https://automerge.org/docs")
  })

  it("leaves a plain URL alone", () => {
    expect(unwrapRedirect("https://example.com/x")).toBe("https://example.com/x")
  })

  it("does not throw on a malformed href", () => {
    expect(unwrapRedirect("not a url")).toBe("not a url")
  })
})

describe("parseSearchResults", () => {
  const markdown = `
Title: automerge at DuckDuckGo

[](https://duckduckgo.com/html/?q=automerge)
## [Automerge CRDT](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fautomerge.org%2F&rut=1)
Some snippet text.
## [GitHub - automerge/automerge](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fautomerge&rut=2)
[Settings](https://duckduckgo.com/settings)
`

  it("extracts titles and unwrapped urls", () => {
    const results = parseSearchResults(markdown)
    expect(results).toEqual([
      { title: "Automerge CRDT", url: "https://automerge.org/" },
      { title: "GitHub - automerge/automerge", url: "https://github.com/automerge" },
    ])
  })

  it("drops the engine's own links", () => {
    expect(parseSearchResults(markdown).some((r) => /duckduckgo/.test(r.url))).toBe(false)
  })

  it("dedupes repeated urls", () => {
    const doubled = markdown + markdown
    const results = parseSearchResults(doubled)
    expect(new Set(results.map((r) => r.url)).size).toBe(results.length)
  })

  it("honours the limit", () => {
    expect(parseSearchResults(markdown, 1)).toHaveLength(1)
  })

  it("returns nothing for markdown with no results", () => {
    expect(parseSearchResults("Title: nothing here\n\nNo links.")).toEqual([])
  })
})

describe("readerUrl", () => {
  it("prefixes the target with the reader", () => {
    expect(readerUrl("https://example.com", "https://r.example/")).toBe("https://r.example/https://example.com")
  })
})

describe("web_fetch", () => {
  const ctx = (impl) => ({ fetchImpl: impl, reader: "https://r.test/" })

  it("rejects a non-absolute url before making a request", async () => {
    let called = false
    await expect(
      webFetch.execute({ url: "example.com" }, ctx(async () => { called = true }))
    ).rejects.toThrow(/absolute/)
    expect(called).toBe(false)
  })

  it("fetches through the reader and truncates", async () => {
    const impl = async (url) => {
      expect(url).toBe("https://r.test/https://example.com/page")
      return { ok: true, text: async () => "x".repeat(5000) }
    }
    const out = await webFetch.execute({ url: "https://example.com/page", maxChars: 100 }, ctx(impl))
    expect(out.length).toBeLessThan(200)
    expect(out).toMatch(/more chars/)
  })

  it("explains a failure rather than returning empty text", async () => {
    const impl = async () => ({ ok: false, status: 451 })
    await expect(webFetch.execute({ url: "https://example.com" }, ctx(impl))).rejects.toThrow(/451/)
  })

  it("summarizes by host", () => {
    expect(webFetch.summarize({ url: "https://automerge.org/docs/x" }, "abc")).toMatch(/automerge\.org/)
  })
})

describe("web_search", () => {
  it("formats results as a numbered list", async () => {
    const impl = async () => ({
      ok: true,
      text: async () => "## [Automerge](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fautomerge.org%2F)",
    })
    const out = await webSearch.execute({ query: "automerge" }, { fetchImpl: impl })
    expect(out).toContain("1. Automerge")
    expect(out).toContain("https://automerge.org/")
  })

  it("says so when there are no results", async () => {
    const impl = async () => ({ ok: true, text: async () => "nothing" })
    const out = await webSearch.execute({ query: "zzz" }, { fetchImpl: impl })
    expect(out).toMatch(/No results/)
  })

  it("requires a query", async () => {
    await expect(webSearch.execute({ query: "  " }, {})).rejects.toThrow(/query/)
  })
})

describe("direct mode (outside a browser)", () => {
  it("fetches the page itself instead of going through a reader", async () => {
    let requested = null
    const fetchImpl = async (url) => {
      requested = url
      return { ok: true, text: async () => "<html><body><p>Hello</p><script>bad()</script></body></html>" }
    }
    const out = await webFetch.execute({ url: "https://example.com" }, { fetchImpl, direct: true })
    expect(requested).toBe("https://example.com")
    expect(out).toBe("Hello")
    expect(out).not.toContain("bad()")
  })

  it("returns plain text untouched", async () => {
    const fetchImpl = async () => ({ ok: true, text: async () => "just some text" })
    const out = await webFetch.execute({ url: "https://example.com/a.txt" }, { fetchImpl, direct: true })
    expect(out).toBe("just some text")
  })

  it("searches DuckDuckGo directly and unwraps its redirects", async () => {
    const html = `
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fautomerge.org%2F&rut=1">Automerge <b>CRDT</b></a>
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fgithub.com%2Fautomerge&rut=2">GitHub</a>
      <a class="something-else" href="https://ads.example">Ad</a>`
    const fetchImpl = async () => ({ ok: true, text: async () => html })
    const out = await webSearch.execute({ query: "automerge" }, { fetchImpl, direct: true })
    expect(out).toContain("https://automerge.org/")
    expect(out).toContain("Automerge CRDT")
    expect(out).not.toContain("ads.example")
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

describe("parseDuckDuckGoHtml", () => {
  const html = `
    <a class="result__a" href="/l/?uddg=https%3A%2F%2Fa.example%2F">First</a>
    <a class="result__a" href="/l/?uddg=https%3A%2F%2Fa.example%2F">First again</a>
    <a class="result__a" href="/l/?uddg=https%3A%2F%2Fb.example%2F">Second</a>`

  it("extracts and dedupes results", () => {
    expect(parseDuckDuckGoHtml(html)).toEqual([
      { title: "First", url: "https://a.example/" },
      { title: "Second", url: "https://b.example/" },
    ])
  })
  it("honours the limit", () => {
    expect(parseDuckDuckGoHtml(html, 1)).toHaveLength(1)
  })
  it("returns nothing for html with no results", () => {
    expect(parseDuckDuckGoHtml("<p>nothing</p>")).toEqual([])
  })
})

describe("asking a page for its rendered DOM", () => {
  // The case this exists for, from a real session: fetching a code playground
  // as markdown returned the editor's line numbers — "1 2 3 4 5" — and none of
  // its content, because prose extraction throws away what a script built.
  const respond = (body) => ({ ok: true, status: 200, text: async () => body })

  function capture(body = "ok") {
    const seen = []
    return {
      seen,
      fetchImpl: async (url, options) => {
        seen.push({ url, options })
        return respond(body)
      },
    }
  }

  it("asks the reader for markdown by default", async () => {
    const { seen, fetchImpl } = capture()
    await webFetch.execute({ url: "https://x.test/" }, { fetchImpl })
    expect(seen[0].options.headers["X-Return-Format"]).toBe("markdown")
    expect(seen[0].options.headers).not.toHaveProperty("x-no-cache")
  })

  it("asks for html when told to", async () => {
    const { seen, fetchImpl } = capture()
    await webFetch.execute({ url: "https://x.test/", format: "html" }, { fetchImpl })
    expect(seen[0].options.headers["X-Return-Format"]).toBe("html")
  })

  it("asks for text when told to", async () => {
    const { seen, fetchImpl } = capture()
    await webFetch.execute({ url: "https://x.test/", format: "text" }, { fetchImpl })
    expect(seen[0].options.headers["X-Return-Format"]).toBe("text")
  })

  it("ignores a format it does not have, rather than sending nonsense", async () => {
    const { seen, fetchImpl } = capture()
    await webFetch.execute({ url: "https://x.test/", format: "pdf" }, { fetchImpl })
    expect(seen[0].options.headers["X-Return-Format"]).toBe("markdown")
  })

  it("skips the cache when freshness is what matters", async () => {
    const { seen, fetchImpl } = capture()
    await webFetch.execute({ url: "https://x.test/", fresh: true }, { fetchImpl })
    expect(seen[0].options.headers["x-no-cache"]).toBe("true")
  })

  it("saves html as html, so the document is not a .md full of markup", async () => {
    const docs = new Map()
    let n = 0
    const repo = {
      async create2() {
        const url = `automerge:saved${++n}`
        const doc = {}
        docs.set(url, doc)
        return { url, doc: () => doc, change: (fn) => fn(doc) }
      },
    }
    const big = `<div>${"x".repeat(3000)}</div>`
    const out = await webFetch.execute(
      { url: "https://x.test/", format: "html" },
      { repo, fetchImpl: async () => respond(big) }
    )
    expect(out.doc.mimeType).toBe("text/html")
    expect(docs.get(out.doc.url).extension).toBe("html")
  })

  it("returns the literal source in direct mode, where nothing renders", async () => {
    // Outside a browser there is no reader and no rendering, so `html` is the
    // bytes the server sent — a different thing, and the description says so.
    const source = '<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>'
    const out = await webFetch.execute(
      { url: "https://x.test/", format: "html" },
      { direct: true, fetchImpl: async () => respond(source) }
    )
    expect(out).toBe(source)
  })

  it("still strips markup in direct mode when prose was asked for", async () => {
    const out = await webFetch.execute(
      { url: "https://x.test/" },
      { direct: true, fetchImpl: async () => respond("<p>hello</p><p>there</p>") }
    )
    expect(out).toBe("hello\nthere")
  })
})
