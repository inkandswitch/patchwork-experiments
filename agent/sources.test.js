import { describe, it, expect } from "vitest"
import { saveSource, sourceName, sourceFooter, titleFrom, isTextResponse, describeBytes, SPILL_AT } from "./tools/sources.js"
import { httpRequest } from "./tools/http.js"
import { webFetch } from "./tools/web.js"
import { runTool } from "./tools/index.js"

/** A repo double that records every document it is asked to make. */
function fakeRepo() {
  const docs = new Map()
  let next = 0
  return {
    docs,
    async create2() {
      const url = `automerge:source${++next}`
      const doc = {}
      docs.set(url, doc)
      return { url, doc: () => doc, change: (fn) => fn(doc) }
    },
  }
}

const long = (marker = "x") => `Title: A Long Page\n\n${marker.repeat(SPILL_AT + 500)}`
/** Longer than web_fetch's default excerpt, so the truncation path is exercised. */
const huge = () => `Title: A Long Page\n\n${"y".repeat(40000)}`

function fetching(body) {
  return { ok: true, text: async () => body }
}

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

describe("saving a source document", () => {
  it("writes a patchwork file document with its provenance", async () => {
    const repo = fakeRepo()
    const ref = await saveSource({ repo }, { url: "https://example.test/a", content: "Title: Hi\n\nbody" })

    expect(ref).toMatchObject({ url: "automerge:source1", name: "Hi.md", bytes: 15, mimeType: "text/markdown" })
    const doc = repo.docs.get(ref.url)
    expect(doc["@patchwork"]).toEqual({ type: "file" })
    expect(doc.content).toBe("Title: Hi\n\nbody")
    expect(doc.source).toBe("https://example.test/a")
    expect(doc.extension).toBe("md")
    expect(typeof doc.fetchedAt).toBe("number")
  })

  it("picks the extension from the mime type", async () => {
    const repo = fakeRepo()
    const ref = await saveSource({ repo }, { url: "https://x.test/data", content: "{}", mimeType: "application/json" })
    expect(ref.name).toBe("x.test data.json")
    expect(repo.docs.get(ref.url).extension).toBe("json")
  })

  it("returns null rather than throwing when there is nowhere to write", async () => {
    expect(await saveSource({}, { url: "https://x.test/", content: "body" })).toBeNull()
    expect(await saveSource({ repo: fakeRepo() }, { url: "https://x.test/", content: "" })).toBeNull()
  })

  it("returns null when the repo refuses the write", async () => {
    const repo = { create2: async () => { throw new Error("read only") } }
    expect(await saveSource({ repo }, { url: "https://x.test/", content: "body" })).toBeNull()
  })
})

describe("the footer that points at the document", () => {
  it("says how much of the page is shown here", () => {
    const ref = { url: "automerge:a", name: "Page.md", bytes: 40000 }
    const footer = sourceFooter(ref, 12000)
    expect(footer).toContain("saved as 'Page.md' at automerge:a")
    expect(footer).toContain("12000 of 40000 characters shown here")
    expect(footer).toContain('doc_read { url: "automerge:a", path: ["content"], offset: 12000 }')
  })

  it("does not suggest re-reading when nothing was cut", () => {
    const footer = sourceFooter({ url: "automerge:a", name: "Page.md", bytes: 900 }, 900)
    expect(footer).toContain("(complete)")
    expect(footer).not.toContain("doc_read")
  })
})

describe("web_fetch and its document", () => {
  const ctx = (repo, fetchImpl) => ({ repo, fetchImpl })

  it("saves a long page and links it from the result", async () => {
    const repo = fakeRepo()
    const body = huge()
    const out = await webFetch.execute(
      { url: "https://example.test/big" },
      ctx(repo, async () => fetching(body))
    )

    expect(out.doc).toMatchObject({ name: "A Long Page.md", bytes: body.length })
    // The whole page is in the document; the transcript keeps only the excerpt.
    expect(repo.docs.get(out.doc.url).content).toBe(body)
    expect(out.text).toContain("saved as 'A Long Page.md'")
    expect(out.text).toContain("of 40020 characters shown here")
    expect(out.text.length).toBeLessThan(body.length / 3)
  })

  it("saves a page that fits inline too, and says nothing was cut", async () => {
    // Over the spill threshold but under the excerpt limit: worth a document
    // because it is long enough to want to reopen, and the model has all of it.
    const repo = fakeRepo()
    const out = await webFetch.execute(
      { url: "https://example.test/medium" },
      ctx(repo, async () => fetching(long()))
    )
    expect(out.doc).toBeTruthy()
    expect(out.text).toContain("(complete)")
    expect(out.text).not.toContain("doc_read")
  })

  it("still gives the model the excerpt it asked for", async () => {
    const repo = fakeRepo()
    const out = await webFetch.execute(
      { url: "https://example.test/big", maxChars: 500 },
      ctx(repo, async () => fetching(long()))
    )
    expect(out.text.length).toBeLessThan(900) // 500 of content, plus the footer
    expect(out.text).toContain("doc_read")
    expect(out.doc.bytes).toBeGreaterThan(SPILL_AT)
  })

  it("leaves a short page inline, with no document at all", async () => {
    const repo = fakeRepo()
    const out = await webFetch.execute(
      { url: "https://example.test/small" },
      ctx(repo, async () => fetching("Title: Small\n\njust a paragraph"))
    )
    expect(typeof out).toBe("string")
    expect(repo.docs.size).toBe(0)
  })

  it("falls back to inline text when the document cannot be written", async () => {
    const body = long()
    const out = await webFetch.execute(
      { url: "https://example.test/big" },
      ctx(undefined, async () => fetching(body))
    )
    expect(typeof out).toBe("string")
    expect(out).not.toContain("saved as")
  })

  it("carries the reference through runTool onto the result", async () => {
    const repo = fakeRepo()
    const outcome = await runTool(webFetch, { url: "https://example.test/big" }, {
      repo,
      fetchImpl: async () => fetching(long()),
    })
    expect(outcome.isError).toBe(false)
    expect(outcome.doc).toMatchObject({ name: "A Long Page.md" })
    expect(outcome.summary).toMatch(/fetched example\.test/)
  })

  it("leaves doc null for a tool that returns a plain string", async () => {
    const outcome = await runTool({ id: "t", execute: async () => "just text" }, {}, {})
    expect(outcome.doc).toBeNull()
    expect(outcome.output).toBe("just text")
  })
})

// ------------------------------------------------------ binary responses

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

  it("names the format from its magic number", () => {
    expect(describeBytes(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00]))).toContain("WebAssembly module")
    expect(describeBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toContain("PNG")
    expect(describeBytes(new Uint8Array([0x00, 0x61, 0x73, 0x6d]))).toContain("00 61 73 6d")
    expect(describeBytes(new Uint8Array([0xde, 0xad]))).toBe("de ad")
  })
})

describe("saving bytes", () => {
  const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xff, 0xfe])

  it("stores a Uint8Array as a binary file document, unchanged", async () => {
    const repo = fakeRepo()
    const ref = await saveSource({ repo }, {
      url: "https://example.test/m.wasm",
      content: wasm,
      mimeType: "application/wasm",
    })

    const stored = repo.docs.get(ref.url).content
    expect(stored).toBeInstanceOf(Uint8Array)
    // The bytes that came in are the bytes that went to disk. 0xff 0xfe is not
    // valid UTF-8; if anything decoded this it would be U+FFFD by now.
    expect([...stored]).toEqual([...wasm])
    expect(ref).toMatchObject({ binary: true, bytes: 10, mimeType: "application/wasm", name: "example.test m.wasm" })
    expect(repo.docs.get(ref.url).extension).toBe("wasm")
  })

  it("keeps text as text", async () => {
    const repo = fakeRepo()
    const ref = await saveSource({ repo }, { url: "https://x.test/a", content: "plain words" })
    expect(typeof repo.docs.get(ref.url).content).toBe("string")
    expect(ref.binary).toBe(false)
  })

  it("files the document into a folder when asked", async () => {
    const repo = fakeRepo()
    const folder = { docs: [] }
    repo.docs.set("automerge:pkg", folder)
    repo.find = async (url) => ({ url, doc: () => repo.docs.get(url), change: (fn) => fn(repo.docs.get(url)) })

    const ref = await saveSource({ repo }, {
      url: "https://example.test/m.wasm",
      content: wasm,
      name: "esbuild.wasm",
      mimeType: "application/wasm",
      folder: "automerge:pkg",
    })

    expect(folder.docs).toEqual([{ name: "esbuild.wasm", type: "file", url: ref.url }])
    expect(ref.folder).toBe("automerge:pkg")
  })
})

describe("http_request and binary bodies", () => {
  const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x0a, 0xff, 0xfe, 0x00])

  const respond = (body, { status = 200, type = "application/octet-stream" } = {}) => ({
    ok: status < 400,
    status,
    statusText: status < 400 ? "OK" : "Error",
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? type : null) },
    async arrayBuffer() {
      const b = typeof body === "string" ? new TextEncoder().encode(body) : body
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
    },
    async text() {
      return typeof body === "string" ? body : new TextDecoder().decode(body)
    },
  })

  it("saves a wasm module byte for byte instead of decoding it", async () => {
    const repo = fakeRepo()
    const out = await httpRequest.execute(
      { url: "https://example.test/m.wasm" },
      { repo, fetchImpl: async () => respond(wasm, { type: "application/wasm" }) }
    )

    expect(out.doc.binary).toBe(true)
    expect([...repo.docs.get(out.doc.url).content]).toEqual([...wasm])
    expect(out.text).toContain("WebAssembly module")
    expect(out.text).toContain("NOT decoded")
    // The bytes must not appear in the conversation in any form.
    expect(out.text).not.toContain("�")
  })

  it("puts it in a package folder when told to", async () => {
    const repo = fakeRepo()
    const folder = { docs: [] }
    repo.docs.set("automerge:pkg", folder)
    repo.find = async (url) => ({ url, doc: () => repo.docs.get(url), change: (fn) => fn(repo.docs.get(url)) })

    const out = await httpRequest.execute(
      { url: "https://example.test/m.wasm", folder: "automerge:pkg", saveAs: "engine.wasm" },
      { repo, fetchImpl: async () => respond(wasm, { type: "application/wasm" }) }
    )

    expect(folder.docs[0].name).toBe("engine.wasm")
    expect(out.text).toContain("in automerge:pkg")
  })

  it("still returns JSON inline, as before", async () => {
    const out = await httpRequest.execute(
      { url: "https://example.test/api" },
      { fetchImpl: async () => respond('{"ok":true}', { type: "application/json" }) }
    )
    expect(typeof out).toBe("string")
    expect(out).toContain('{"ok":true}')
    expect(out).toContain("application/json")
  })

  it("refuses to dump a binary body when there is nowhere to put it", async () => {
    await expect(
      httpRequest.execute(
        { url: "https://example.test/m.wasm" },
        { fetchImpl: async () => respond(wasm, { type: "application/wasm" }) }
      )
    ).rejects.toThrow(/nowhere to write it/)
  })

  it("describes a binary error body rather than decoding it", async () => {
    const out = await httpRequest.execute(
      { url: "https://example.test/m.wasm" },
      { fetchImpl: async () => respond(wasm, { status: 500, type: "application/wasm" }) }
    )
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
    await expect(
      httpRequest.execute({ url: "https://example.test/m.wasm" }, { fetchImpl: async () => textOnly })
    ).rejects.toThrow(/cannot return bytes/)
  })
})
