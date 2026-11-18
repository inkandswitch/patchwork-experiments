import { describe, it, expect } from "vitest"
import { ImmutableString, isImmutableString } from "@automerge/automerge"
import { generateAutomergeUrl } from "@automerge/automerge-repo"
import {
  keepSource, readable, sha256Hex, marksFromMarkdown, findKept, sourceName, sourceFooter, titleFrom,
  isTextResponse, describeBytes, decodeText, outline, fewest, formatOf, MAGIC,
} from "./tools/sources.js"
import { httpRequest } from "./tools/http.js"
import { webFetch } from "./tools/web.js"
import { runTool } from "./tools/index.js"
import { recordArtifact } from "./session.js"

const SESSION = generateAutomergeUrl()

/** A repo double that makes real-looking URLs and records every document. */
function fakeRepo(session = { made: [] }) {
  const docs = new Map([[SESSION, session]])
  const handle = (url) => ({ url, doc: () => docs.get(url), change: (fn) => fn(docs.get(url)) })
  return {
    docs,
    session,
    async create2() {
      const url = generateAutomergeUrl()
      docs.set(url, {})
      return handle(url)
    },
    async find(url) {
      const bare = String(url).split("#")[0]
      if (!docs.has(bare)) throw new Error(`no document ${url}`)
      return handle(bare)
    },
  }
}

/** The session as the runner hands it to tools: its own document, through the store. */
const sessionOf = (repo) => ({ url: SESSION, doc: () => repo.session, change: (fn) => fn(repo.session) })

const respond = (body, { status = 200, type = "text/plain", url = "" } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status < 400 ? "OK" : "Error",
  url,
  headers: { get: (n) => (n.toLowerCase() === "content-type" ? type : null) },
  async arrayBuffer() {
    const b = typeof body === "string" ? new TextEncoder().encode(body) : body
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  },
  async text() {
    return typeof body === "string" ? body : new TextDecoder().decode(body)
  },
})

/** Every value in a document, so a test can say none of them is undefined (automerge refuses those). */
function* leaves(value, path = []) {
  if (value === undefined || value === null || typeof value !== "object" || value instanceof Uint8Array || isImmutableString(value)) {
    yield [path.join("."), value]
    return
  }
  for (const [key, inner] of Object.entries(value)) yield* leaves(inner, [...path, key])
}

// sha256 of the ASCII bytes "abc", from FIPS 180-2.
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

describe("naming a fetched document", () => {
  it("uses the page title", () => {
    expect(sourceName("https://example.test/a/b", "Async IO in Python")).toBe("Async IO in Python.md")
  })

  it("falls back to host and last path segment", () => {
    expect(sourceName("https://docs.python.org/3/library/os.html", null)).toBe("docs.python.org os.html.md")
    expect(sourceName("https://example.test/", null)).toBe("example.test.md")
  })

  it("strips characters a file name cannot hold", () => {
    expect(sourceName("https://x.test/", 'a/b:c*d?"e<f>g|h')).toBe("a b c d e f g h.md")
  })

  it("does not double the extension", () => {
    expect(sourceName("https://x.test/", "notes.md")).toBe("notes.md")
  })

  it("reads the reader's Title line", () => {
    expect(titleFrom("Title: Async IO\nURL Source: x\n\nbody")).toBe("Async IO")
    expect(titleFrom("no title here")).toBeNull()
  })
})

describe("the source contract", () => {
  it("hashes with SHA-256", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(ABC)
  })

  it("keeps text as an ImmutableString, with its hash, size and capture", async () => {
    const repo = fakeRepo()
    const { ref } = await keepSource({ repo }, {
      source: "https://example.test/a",
      role: "extract",
      content: "abc",
      mimeType: "text/markdown",
      capture: { at: 1000, via: "reader", engine: "reader-markdown", readerCache: "allowed" },
    })
    const doc = repo.docs.get(ref.url)
    expect(doc["@patchwork"]).toEqual({ type: "file" })
    expect(isImmutableString(doc.content)).toBe(true)
    expect(String(doc.content)).toBe("abc")
    expect(doc.capture).toEqual({
      at: 1000, finalUrl: null, via: "reader", engine: "reader-markdown", status: null,
      contentType: null, sha256: ABC, bytes: 3, readerCache: "allowed",
    })
    expect(doc).toMatchObject({ source: "https://example.test/a", role: "extract", text: null, textVia: null, pages: null, missing: null })
    expect(ref).toMatchObject({ kind: "source", bytes: 3, chars: 3, binary: false, source: "https://example.test/a", engine: "reader-markdown", at: 1000 })
  })

  it("keeps bytes byte for byte, with text beside them", async () => {
    // 0xff 0xfe is not valid UTF-8; anything that decoded this would have
    // written U+FFFD by now.
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0xfe, 0x00])
    const repo = fakeRepo()
    const { ref } = await keepSource({ repo }, {
      source: "https://example.test/p.pdf",
      content: pdf,
      mimeType: "application/pdf",
      text: "# Paper\n\nbody",
      textVia: "reader",
    })
    const doc = repo.docs.get(ref.url)
    expect(doc.content).toBeInstanceOf(Uint8Array)
    expect([...doc.content]).toEqual([...pdf])
    expect(String(doc.text)).toBe("# Paper\n\nbody")
    expect(doc.extension).toBe("pdf")
    expect(doc.capture.sha256).toBe(await sha256Hex(pdf))
    expect(doc.capture.bytes).toBe(8)
    expect(doc.marks).toEqual([{ at: 0, label: "# Paper" }])
    expect(ref).toMatchObject({ binary: true, chars: 13, role: "primary", engine: "raw" })
  })

  it("writes no undefined anywhere, which automerge would refuse", async () => {
    const repo = fakeRepo()
    for (const content of ["text", new Uint8Array([1, 2, 3])]) {
      const { ref } = await keepSource({ repo }, { source: "https://x.test/", content })
      const missing = [...leaves(repo.docs.get(ref.url))].filter(([, v]) => v === undefined).map(([p]) => p)
      expect(missing).toEqual([])
      expect([...leaves(ref)].filter(([, v]) => v === undefined)).toEqual([])
    }
  })

  it("lets errors through: a fetch that cannot be kept is not reported kept", async () => {
    await expect(keepSource({}, { source: "https://x.test/", content: "a" })).rejects.toThrow(/no repo/)
    const refusing = { create2: async () => { throw new Error("read only") } }
    await expect(keepSource({ repo: refusing }, { source: "https://x.test/", content: "a" })).rejects.toThrow(/read only/)
  })
})

describe("readable()", () => {
  const bytes = new Uint8Array([1, 2, 3])
  it.each([
    ["bytes with text beside them", { content: bytes, text: new ImmutableString("the text") }, "the text"],
    ["an ImmutableString content", { content: new ImmutableString("frozen") }, "frozen"],
    ["a plain string content", { content: "collaborative" }, "collaborative"],
    ["bytes alone", { content: bytes, text: null }, null],
    ["nothing", null, null],
  ])("%s", (_, doc, expected) => {
    expect(readable(doc)).toBe(expected)
  })
})

describe("headings as marks", () => {
  it.each([
    ["ATX headings at their offsets", "# A\ntext\n## B\n", [{ at: 0, label: "# A" }, { at: 9, label: "## B" }]],
    ["closing hashes dropped", "### C ###", [{ at: 0, label: "### C" }]],
    ["closing hashes after a tab dropped", "## Title\t##  ", [{ at: 0, label: "## Title" }]],
    ["a # with no space before it is the heading's", "## Learn C#", [{ at: 0, label: "## Learn C#" }]],
    ["one at the end of each of two headings", "# Learn C#\n## F# and C# ##\n", [{ at: 0, label: "# Learn C#" }, { at: 11, label: "## F# and C#" }]],
    ["a heading of only closing hashes is empty", "## ##\n# A", [{ at: 6, label: "# A" }]],
    ["hashes that start the text stay", "# #5 bolt", [{ at: 0, label: "# #5 bolt" }]],
    ["setext, both levels", "Top\n===\nbody\nSub\n---\n", [{ at: 0, label: "# Top" }, { at: 13, label: "## Sub" }]],
    ["not inside a fence", "```\n# no\n```\n# yes", [{ at: 13, label: "# yes" }]],
    ["no space, no heading", "#hashtag\n####### seven", []],
    ["a list item over a rule is not a heading", "- item\n---\n", []],
    ["an empty heading is skipped", "#\n# A", [{ at: 2, label: "# A" }]],
    ["nothing", "", []],
  ])("%s", (_, text, marks) => {
    expect(marksFromMarkdown(text)).toEqual(marks)
  })

  it("keeps at most 200, dropping the deepest level first", () => {
    const many = Array.from({ length: 150 }, (_, i) => `# H${i}\n### d${i}`).join("\n")
    const marks = marksFromMarkdown(many)
    expect(marks).toHaveLength(150)
    expect(marks.every((m) => m.label.startsWith("# "))).toBe(true)
  })

  it.each([
    // [levels present, max, levels kept]
    [[1, 2, 2, 3], 4, [1, 2, 2, 3]],
    [[1, 2, 2, 3], 3, [1, 2, 2]],
    [[1, 2, 2, 3], 1, [1]],
    [[1, 1, 1], 2, [1, 1]],
  ])("fewest of levels %j under %i keeps %j", (levels, max, kept) => {
    const marks = levels.map((n, i) => ({ at: i, label: `${"#".repeat(n)} x` }))
    expect(fewest(marks, max).map((m) => m.label.indexOf(" "))).toEqual(kept)
  })

  it("draws an outline of offsets and headings, marking what it left out", () => {
    expect(outline([])).toBeNull()
    expect(outline([{ at: 0, label: "# A" }, { at: 9, label: "## B" }])).toBe("Outline: 0 # A · 9 ## B")
    expect(outline([{ at: 0, label: "# A" }, { at: 9, label: "## B" }], 1)).toBe("Outline: 0 # A · …")
  })
})

describe("the footer that points at the kept source", () => {
  const ref = { url: "automerge:abc", chars: 41893 }

  it("names source_read, with the offset to read on from", () => {
    const footer = sourceFooter(ref, 6000, [{ at: 0, label: "# Title" }])
    expect(footer).toBe(
      [
        '— 6000 of 41893 shown. Read on: source_read {source:"automerge:abc", offset:6000}; search: source_read {source:"automerge:abc", find:"…"}.',
        "Outline: 0 # Title",
        'Cite what it says as [label](automerge:abc "the exact words").',
      ].join("\n")
    )
  })

  it("says when everything was shown", () => {
    expect(sourceFooter({ url: "automerge:abc", chars: 900 }, 900)).toBe(
      [
        '— all 900 characters shown. Search it later: source_read {source:"automerge:abc", find:"…"}.',
        'Cite what it says as [label](automerge:abc "the exact words").',
      ].join("\n")
    )
  })
})

describe("what the session remembers it kept", () => {
  it("records the source and engine of a kept source, and nothing extra for anything else", () => {
    const doc = {}
    recordArtifact(doc, { url: "automerge:k", name: "Page.md", kind: "source", bytes: 3, at: 5, source: "https://x.test/", engine: "reader-markdown", chars: 3 })
    recordArtifact(doc, { url: "automerge:p", name: "a.pdf", kind: "source", bytes: 9, at: 6, source: "https://x.test/a.pdf", engine: "raw", chars: null })
    recordArtifact(doc, { url: "automerge:f", name: "a.js", kind: "file", bytes: 1, at: 7 })
    expect(doc.made).toEqual([
      { url: "automerge:f", name: "a.js", kind: "file", bytes: 1, at: 7 },
      { url: "automerge:p", name: "a.pdf", kind: "source", bytes: 9, at: 6, source: "https://x.test/a.pdf", engine: "raw", chars: null },
      { url: "automerge:k", name: "Page.md", kind: "source", bytes: 3, at: 5, source: "https://x.test/", engine: "reader-markdown", chars: 3 },
    ])
  })

  it("finds the newest kept source of a URL by one of the engines asked for", async () => {
    const session = {
      made: [
        { url: "automerge:new", source: "https://x.test/", engine: "reader-text", at: 2, chars: 10 },
        { url: "automerge:old", source: "https://x.test/", engine: "reader-markdown", at: 1, chars: 10 },
      ],
    }
    const repo = fakeRepo(session)
    const ctx = { repo, session: sessionOf(repo) }
    expect((await findKept(ctx, { source: "https://x.test/", engines: ["reader-markdown"] }))?.url).toBe("automerge:old")
    expect((await findKept(ctx, { source: "https://x.test/", engines: ["reader-markdown", "reader-text"] }))?.url).toBe("automerge:new")
    expect(await findKept(ctx, { source: "https://x.test/other", engines: ["reader-markdown"] })).toBeNull()
    expect(await findKept({ repo: ctx.repo }, { source: "https://x.test/", engines: ["reader-text"] })).toBeNull()
  })
})

describe("web_fetch answers from what was already kept", () => {
  const URL_ = "https://example.test/page"
  // [engine already kept, has text, format asked for, fresh] → answered without
  // a request? The rule: not fresh, the kept copy has text to read, and it is
  // the reader's extract in that format or the response itself.
  const cases = []
  for (const engine of ["reader-markdown", "reader-text", "raw"]) {
    for (const chars of [10, null]) {
      for (const format of ["markdown", "text"]) {
        for (const fresh of [false, true]) {
          cases.push([engine, chars, format, fresh, !fresh && chars != null && (engine === `reader-${format}` || engine === "raw")])
        }
      }
    }
  }

  it.each(cases)("kept by %s with %s chars, asked for %s, fresh %s → hit %s", async (engine, chars, format, fresh, hit) => {
    const session = { made: [{ url: "automerge:kept", name: "Page.md", kind: "source", bytes: 10, at: Date.UTC(2026, 10, 16, 14, 2), source: URL_, engine, chars }] }
    const repo = fakeRepo(session)
    let requests = 0
    const fetchImpl = async () => (requests++, respond("Title: Page\n\nfresh words"))
    const out = await webFetch.execute({ url: URL_, format, fresh }, { repo, session: sessionOf(repo), fetchImpl })
    if (hit) {
      expect(requests).toBe(0)
      expect(out.text).toBe('Already kept at automerge:kept (fetched 14:02 UTC). source_read {source:"automerge:kept", offset:0}. Pass fresh:true to fetch again.')
      expect(out.doc.url).toBe("automerge:kept")
    } else {
      expect(requests).toBe(1)
      expect(out.doc.url).not.toBe("automerge:kept")
    }
  })

  it("does not answer with a PDF that http_request kept as bytes alone, and then answers with the copy that has text", async () => {
    const PDF_URL = "https://example.test/paper.pdf"
    const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    const MARKDOWN = "Title: Paper\n\nNumber of Pages: 1\n\nwords"
    const repo = fakeRepo()
    const kept = await runTool(httpRequest, { url: PDF_URL }, { repo, session: sessionOf(repo), fetchImpl: async () => respond(PDF, { type: "application/pdf" }) })
    recordArtifact(repo.session, kept.doc)
    expect(repo.session.made[0]).toMatchObject({ source: PDF_URL, engine: "raw", chars: null })

    const seen = []
    const fetchImpl = async (url) => (seen.push(url), url.startsWith("https://r.test/") ? respond(MARKDOWN) : respond(PDF, { type: "application/pdf" }))
    const read = await webFetch.execute({ url: PDF_URL }, { repo, session: sessionOf(repo), reader: "https://r.test/", fetchImpl })
    expect(seen).toEqual([`https://r.test/${PDF_URL}`, PDF_URL])
    expect(read.doc.url).not.toBe(kept.doc.url)
    recordArtifact(repo.session, read.doc)

    const again = await webFetch.execute({ url: PDF_URL }, { repo, session: sessionOf(repo), fetchImpl: async () => { throw new Error("no request") } })
    expect(again.text.startsWith(`Already kept at ${read.doc.url} `)).toBe(true)
  })

  it("does not answer for a different URL", async () => {
    const session = { made: [{ url: "automerge:kept", source: `${URL_}/other`, engine: "reader-markdown", at: 1, chars: 10 }] }
    let requests = 0
    await webFetch.execute({ url: URL_ }, { repo: fakeRepo(session), session: { doc: () => session }, fetchImpl: async () => (requests++, respond("x")) })
    expect(requests).toBe(1)
  })
})

describe("web_fetch keeps every page it reads", () => {
  const page = `Title: A Long Page\n\n# A Long Page\n\n${"y".repeat(20000)}\n\n## Later\n\nend`
  const ctx = (repo) => ({ repo, session: sessionOf(repo), fetchImpl: async () => respond(page) })

  it("keeps the reader's extract, labelled as one, and shows the start of it", async () => {
    const repo = fakeRepo()
    const out = await webFetch.execute({ url: "https://example.test/big" }, ctx(repo))
    const doc = repo.docs.get(out.doc.url)
    expect(String(doc.content)).toBe(page)
    expect(doc).toMatchObject({ role: "extract", source: "https://example.test/big", text: null, missing: null, extension: "md" })
    expect(doc.capture).toMatchObject({ via: "reader", engine: "reader-markdown", finalUrl: null, status: null, readerCache: "allowed" })
    expect(doc.marks).toEqual([{ at: 20, label: "# A Long Page" }, { at: page.indexOf("## Later"), label: "## Later" }])

    const lines = out.text.split("\n")
    expect(lines[0]).toBe(`Kept 'A Long Page' — reader extract, ${page.length.toLocaleString("en-US")} chars — ${out.doc.url} (the reader may have answered from its cache)`)
    expect(out.text).toContain(page.slice(0, 6000))
    expect(out.text).not.toContain(page.slice(0, 6001))
    expect(out.text).toContain(`— 6000 of ${page.length} shown. Read on: source_read {source:"${out.doc.url}", offset:6000}`)
    expect(out.text).toContain(`Outline: 20 # A Long Page · ${page.indexOf("## Later")} ## Later`)
  })

  it("shows as much as maxChars asks for", async () => {
    const out = await webFetch.execute({ url: "https://example.test/big", maxChars: 500 }, ctx(fakeRepo()))
    expect(out.text).toContain(`— 500 of ${page.length} shown`)
    expect(out.text).toContain("offset:500}")
  })

  it("keeps a short page too: every fetch leaves one kept source", async () => {
    const repo = fakeRepo()
    const out = await webFetch.execute(
      { url: "https://example.test/small" },
      { repo, session: sessionOf(repo), fetchImpl: async () => respond("Title: Small\n\njust a paragraph") }
    )
    expect(repo.docs.size).toBe(2) // the session and the kept page
    expect(out.text).toContain("— all 30 characters shown")
  })

  it("keeps a text extract as text", async () => {
    const repo = fakeRepo()
    const out = await webFetch.execute({ url: "https://example.test/t", format: "text" }, ctx(repo))
    expect(repo.docs.get(out.doc.url)).toMatchObject({ extension: "txt", mimeType: "text/plain" })
    expect(repo.docs.get(out.doc.url).capture.engine).toBe("reader-text")
  })

  it("fails rather than pretend, when there is nowhere to keep it", async () => {
    await expect(webFetch.execute({ url: "https://example.test/big" }, { fetchImpl: async () => respond(page) })).rejects.toThrow(/no repo/)
  })

  it("records what it kept on the session, through runTool", async () => {
    const repo = fakeRepo()
    const outcome = await runTool(webFetch, { url: "https://example.test/big" }, ctx(repo))
    expect(outcome.isError).toBe(false)
    expect(outcome.doc).toMatchObject({ name: "A Long Page.md", kind: "source", source: "https://example.test/big", engine: "reader-markdown" })
    expect(outcome.summary).toBe(`fetched example.test · ${(page.length / 1024).toFixed(1)} kB`)
  })
})

// ------------------------------------------------------ responses

describe("telling text from bytes", () => {
  it("believes a text content-type", () => {
    for (const type of [
      "text/plain",
      "text/html; charset=utf-8",
      "application/json",
      "application/ld+json",
      "image/svg+xml",
      "application/xml",
      "application/javascript",
    ]) {
      expect(isTextResponse(type, null)).toBe(true)
    }
  })

  it("treats anything else as bytes", () => {
    for (const type of ["application/wasm", "application/octet-stream", "image/png", "font/woff2", "application/pdf"]) {
      expect(isTextResponse(type, null)).toBe(false)
    }
  })

  it("sniffs for a NUL byte when there is no content-type", () => {
    expect(isTextResponse(null, new TextEncoder().encode("hello, world"))).toBe(true)
    expect(isTextResponse(null, new Uint8Array([0x00, 0x61, 0x73, 0x6d]))).toBe(false)
    expect(isTextResponse("", new Uint8Array([1, 2, 0, 3]))).toBe(false)
  })

  it("names every format in the magic table, at the offset each is found at", () => {
    const bytes = (...b) => new Uint8Array(b)
    const text = (t) => new TextEncoder().encode(t)
    const cases = [
      [bytes(0x00, 0x61, 0x73, 0x6d, 1), "WebAssembly module"],
      [bytes(0x1f, 0x8b, 8), "gzip"],
      [text("PK\x03\x04"), "zip"],
      [text("%PDF-1.7"), "PDF"],
      [bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a), "PNG"],
      [bytes(0xff, 0xd8, 0xff, 0xe0), "JPEG"],
      [text("GIF89a"), "GIF"],
      [text("RIFF\0\0\0\0WEBPVP8 "), "WebP"],
      [text("\0\0\0\x1cftypavif"), "AVIF"],
      [bytes(0, 0, 1, 0, 1, 0), "ICO"],
      [text("wOFF\0\x01\0\0"), "WOFF"],
      [text("wOF2\0\x01\0\0"), "WOFF2"],
      [bytes(0, 1, 0, 0, 0, 0x10), "TrueType font"],
      [text("OTTO\0\x0a"), "OpenType font"],
      [text("ttcf\0\x01"), "font collection"],
      // The right bytes at the wrong offset are not the format.
      [text("WEBPRIFF\0\0\0\0"), null],
      [text("ftypavif"), null],
      [text("<html>"), null],
      [bytes(), null],
    ]
    expect(cases.map(([b]) => formatOf(b))).toEqual(cases.map(([, name]) => name))
    expect(MAGIC.map(([, name]) => name).sort()).toEqual(cases.map(([, name]) => name).filter(Boolean).sort())
  })

  it("names the format from its magic number", () => {
    expect(describeBytes(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00]))).toContain("WebAssembly module")
    expect(describeBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toContain("PNG")
    expect(describeBytes(new Uint8Array([0x00, 0x61, 0x73, 0x6d]))).toContain("00 61 73 6d")
    expect(describeBytes(new Uint8Array([0xde, 0xad]))).toBe("de ad")
  })

  it.each([
    // [bytes, content-type, decoded]
    [[0x63, 0x61, 0x66, 0xe9], "text/html; charset=iso-8859-1", "café"],
    [[0x63, 0x61, 0x66, 0xc3, 0xa9], "text/html", "café"],
    [[0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xc3, 0xa9], "text/html; charset=iso-8859-1", "café"], // the BOM outranks the header
    [[0xff, 0xfe, 0x63, 0x00, 0xe9, 0x00], null, "cé"],
    [[0xfe, 0xff, 0x00, 0x63, 0x00, 0xe9], null, "cé"],
    [[0x63, 0x61, 0x66, 0xc3, 0xa9], "text/plain; charset=no-such-thing", "café"], // unknown label: UTF-8
  ])("decodes %j labelled %s", (bytes, type, text) => {
    expect(decodeText(new Uint8Array(bytes), type)).toBe(text)
  })
})

describe("http_request keeps what it fetched", () => {
  const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x0a, 0xff, 0xfe, 0x00])
  const ctx = (repo, response) => ({ repo, fetchImpl: async () => response })

  it("keeps a wasm module byte for byte instead of decoding it", async () => {
    const repo = fakeRepo()
    const out = await httpRequest.execute({ url: "https://example.test/m.wasm" }, ctx(repo, respond(wasm, { type: "application/wasm" })))

    const doc = repo.docs.get(out.doc.url)
    expect([...doc.content]).toEqual([...wasm])
    expect(doc).toMatchObject({ role: "primary", extension: "wasm", text: null, source: "https://example.test/m.wasm" })
    expect(doc.capture).toMatchObject({ via: "direct", engine: "raw", status: 200, contentType: "application/wasm" })
    expect(out.text).toContain("WebAssembly module")
    expect(out.text).toContain("NOT decoded")
    expect(out.text).toContain(`source_file {source:"${out.doc.url}"`)
    // The bytes must not appear in the conversation in any form.
    expect(out.text).not.toContain("�")
  })

  it("keeps a JSON body as text and shows it", async () => {
    const repo = fakeRepo()
    const out = await httpRequest.execute({ url: "https://example.test/api" }, ctx(repo, respond('{"ok":true}', { type: "application/json" })))
    expect(String(repo.docs.get(out.doc.url).content)).toBe('{"ok":true}')
    expect(repo.docs.get(out.doc.url).extension).toBe("json")
    expect(out.text).toContain('{"ok":true}')
    expect(out.text).toContain("application/json")
    expect(out.text).toContain("— all 11 characters shown")
  })

  it("keeps an HTML page as it came, with its text beside it, decoded by its charset", async () => {
    const repo = fakeRepo()
    const html = new Uint8Array([...new TextEncoder().encode("<head><title>Caf"), 0xe9, ...new TextEncoder().encode("</title></head><p>Menu</p><script>x()</script>")])
    const out = await httpRequest.execute({ url: "https://example.test/" }, ctx(repo, respond(html, { type: "text/html; charset=iso-8859-1" })))
    const doc = repo.docs.get(out.doc.url)
    expect(String(doc.content)).toBe("<head><title>Café</title></head><p>Menu</p><script>x()</script>")
    expect(String(doc.text)).toBe("Menu")
    expect(doc).toMatchObject({ textVia: "html-to-text", name: "Café.html", mimeType: "text/html" })
    expect(out.text).toContain("Menu")
    expect(out.text).not.toContain("x()")
  })

  it("keeps nothing but a successful GET with a body", async () => {
    for (const [input, response] of [
      [{ url: "https://example.test/m", method: "POST", body: "{}" }, respond('{"id":1}', { type: "application/json" })],
      [{ url: "https://example.test/m" }, respond("missing", { status: 404 })],
      [{ url: "https://example.test/m" }, respond(wasm, { status: 500, type: "application/wasm" })],
      [{ url: "https://example.test/m", method: "HEAD" }, respond("")],
    ]) {
      const repo = fakeRepo()
      const out = await httpRequest.execute(input, ctx(repo, response))
      expect(typeof out).toBe("string")
      expect(repo.docs.size).toBe(1)
    }
  })

  it("describes a binary error body rather than decoding it", async () => {
    const out = await httpRequest.execute({ url: "https://example.test/m.wasm" }, ctx(fakeRepo(), respond(wasm, { status: 500, type: "application/wasm" })))
    expect(out).toContain("→ 500")
    expect(out).toContain("is not shown")
  })

  it("will not quietly corrupt bytes when the fetch cannot return them", async () => {
    const textOnly = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/wasm" },
      text: async () => new TextDecoder().decode(wasm), // lossy, as the platform would be
    }
    await expect(httpRequest.execute({ url: "https://example.test/m.wasm" }, ctx(fakeRepo(), textOnly))).rejects.toThrow(/cannot return bytes/)
  })

  it("fetches nothing without the runner's guarded fetch", async () => {
    await expect(httpRequest.execute({ url: "https://example.test/" }, { repo: fakeRepo() })).rejects.toThrow(/no guarded fetch/)
  })
})
