import { describe, it, expect } from "vitest"
import { saveSource, sourceName, sourceFooter, titleFrom, SPILL_AT } from "./tools/sources.js"
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
