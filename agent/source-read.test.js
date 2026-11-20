import { describe, it, expect } from "vitest"
import { ImmutableString } from "@automerge/automerge"
import { Repo, initSubduction, generateAutomergeUrl, parseAutomergeUrl, encodeHeads } from "@automerge/automerge-repo"
import { slice, findAll, sourceRead, sourceList, MAX_READ } from "./tools/read-source.js"
import { sourceFile } from "./tools/file-source.js"
import { headingAt } from "./tools/sources.js"
import { initPlan } from "./workflow/plan.js"
import { scopedRepo, NOT_A_SOURCE } from "./scope.js"

await initSubduction()

// ------------------------------------------------------------------ the pure parts

describe("slicing a ten-character text", () => {
  const TEXT = "abcdefghij"
  // The rule: the offset is clamped into [0, 10]; the limit into [1, MAX_READ],
  // so every read makes progress; `next` is the end, or null at the end.
  it.each([
    [-1, 0, "a", 1],
    [-1, 1, "a", 1],
    [-1, 5, "abcde", 5],
    [-1, 100, "abcdefghij", null],
    [0, 0, "a", 1],
    [0, 1, "a", 1],
    [0, 5, "abcde", 5],
    [0, 100, "abcdefghij", null],
    [5, 0, "f", 6],
    [5, 1, "f", 6],
    [5, 5, "fghij", null],
    [5, 100, "fghij", null],
    [9, 0, "j", null],
    [9, 1, "j", null],
    [9, 5, "j", null],
    [9, 100, "j", null],
    [10, 0, "", null],
    [10, 1, "", null],
    [10, 5, "", null],
    [10, 100, "", null],
    [11, 0, "", null],
    [11, 1, "", null],
    [11, 5, "", null],
    [11, 100, "", null],
  ])("offset %i, limit %i → %j, next %s", (offset, limit, text, next) => {
    const part = slice(TEXT, offset, limit)
    expect(part.text).toBe(text)
    expect(part.next).toBe(next)
    expect(part.total).toBe(10)
  })

  it("never hands back more than the maximum", () => {
    expect(slice("x".repeat(MAX_READ * 2), 0, MAX_READ * 2).text).toHaveLength(MAX_READ)
  })

  it("pages through a text without gaps or overlaps", () => {
    let offset = 0
    let assembled = ""
    for (;;) {
      const part = slice(TEXT, offset, 3)
      assembled += part.text
      if (part.next == null) break
      offset = part.next
    }
    expect(assembled).toBe(TEXT)
  })
})

describe("finding text", () => {
  it.each([
    // [text, find, offsets, count]
    ["alpha beta gamma", "delta", [], 0],
    ["alpha beta gamma", "beta", [6], 1],
    ["Alpha alpha ALPHA", "alpha", [0, 6, 12], 3],
    ["aaa", "aa", [0], 1], // matches do not overlap
    ["aaaa", "aa", [0, 2], 2],
    ["a.b axb a.b", "a.b", [0, 8], 2], // literal, not a pattern
    ["(x) (x)", "(x)", [0, 4], 2],
    ["anything", "", [], 0],
  ])("%j for %j at %j", (text, find, offsets, count) => {
    const found = findAll(text, find)
    expect(found.matches.map((m) => m.at)).toEqual(offsets)
    expect(found.count).toBe(count)
  })

  it("counts every match but keeps only the first twenty", () => {
    const found = findAll("x ".repeat(25), "x")
    expect(found.count).toBe(25)
    expect(found.matches.map((m) => m.at)).toEqual(Array.from({ length: 20 }, (_, i) => i * 2))
  })
})

describe("which heading an offset is under", () => {
  const marks = [{ at: 5, label: "# A" }, { at: 10, label: "## B" }]
  it.each([
    [0, null],
    [4, null],
    [5, "# A"],
    [9, "# A"],
    [10, "## B"],
    [11, "## B"],
  ])("offset %i → %s", (offset, label) => {
    expect(headingAt(marks, offset)?.label ?? null).toBe(label)
  })
})

// ------------------------------------------------------------------ the tools

/** A repo holding a session and some kept sources, under real document URLs. */
function world() {
  const docs = new Map()
  const add = (doc) => {
    const url = generateAutomergeUrl()
    docs.set(url, doc)
    return url
  }
  const handle = (url) => ({
    url,
    doc: () => docs.get(url),
    change: (fn) => fn(docs.get(url)),
    heads: () => ["h1"],
    view: (heads) => ({ url: `${url}#${heads.join("|")}` }),
  })
  const body = `# Title\n\n${"a".repeat(5990)}\n## 3 Model Architecture\n\n${"b".repeat(30000)}`
  const page = add({ name: "Paper.md", content: new ImmutableString(body), text: null, source: "https://x.test/paper", marks: [{ at: 0, label: "# Title" }, { at: 6000, label: "## 3 Model Architecture" }] })
  const pdf = add({ name: "Scan.pdf", mimeType: "application/pdf", content: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]), text: null, source: "https://x.test/scan.pdf" })
  const other = add({ name: "Elsewhere.md", content: "not kept by this session" })
  const folder = add({ title: "Research", docs: [] })
  const session = add({
    made: [
      { url: pdf, name: "Scan.pdf", kind: "source", source: "https://x.test/scan.pdf", engine: "raw" },
      { url: "automerge:2j9knZ5d4NNxLrYGsbBHuYXu3Twz", name: "a.js", kind: "file" },
      { url: page, name: "Paper.md", kind: "source", source: "https://x.test/paper", engine: "reader-markdown" },
    ],
  })
  // Every source the tool asked the repo for, as it asked: the heads it pins
  // are what decides which version is read. Reading the session is not one.
  const found = []
  const repo = {
    async find(url) {
      const bare = String(url).split("#")[0]
      if (bare !== session) found.push(String(url))
      if (!docs.has(bare)) throw new Error(`no document ${url}`)
      return handle(bare)
    },
  }
  return { docs, repo, found, ctx: { repo, session: { url: session, doc: () => docs.get(session) } }, page, pdf, other, folder, body, session }
}

/** Ways to name one document that the repo accepts, other than its URL. */
function spellings(url) {
  const { documentId, binaryDocumentId } = parseAutomergeUrl(url)
  const hex = [...binaryDocumentId].map((b) => b.toString(16).padStart(2, "0")).join("")
  return {
    heads: `${url}#${HEAD}`,
    "bare id": documentId,
    "legacy UUID": `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  }
}
const HEAD = encodeHeads(["00".repeat(32)])[0]

describe("source_read", () => {
  it("reads a slice, naming the heading it starts under and where to read on", async () => {
    const { ctx, page, body } = world()
    const out = await sourceRead.execute({ source: page, offset: 6000, limit: 8000 }, ctx)
    expect(out).toBe(
      `'Paper.md' (${page}) — characters 6000–14000 of ${body.length} · under "## 3 Model Architecture"\n` +
        `${body.length - 14000} remaining; next: offset 14000.\n\n${body.slice(6000, 14000)}`
    )
  })

  it("says when it has reached the end", async () => {
    const { ctx, page, body } = world()
    const out = await sourceRead.execute({ source: page, offset: body.length - 5 }, ctx)
    expect(out.split("\n")[1]).toBe("That is the end.")
  })

  it("searches, giving each match's offset and heading", async () => {
    const { ctx, page } = world()
    const out = await sourceRead.execute({ source: page, find: "MODEL arch" }, ctx)
    expect(out.split("\n")).toEqual([
      `'Paper.md' (${page}) — 1 match for "MODEL arch". Read around one with source_read {source:"${page}", offset:6005}.`,
      // Eighty characters either side, on one line: 74 a's and the newline
      // before the match, the heading, then the blank line and 70 b's after.
      `6005 · ## 3 Model Architecture · …${"a".repeat(74)} ## 3 Model Architecture ${"b".repeat(70)}…`,
    ])
  })

  it("says plainly when nothing matches", async () => {
    const { ctx, page } = world()
    const out = await sourceRead.execute({ source: page, find: "zebra" }, ctx)
    expect(out).toContain(`no match for "zebra"`)
    expect(out).toContain("Outline: 0 # Title · 6000 ## 3 Model Architecture")
  })

  it("hands over a PDF kept with no text beside it, as the PDF itself", async () => {
    const { ctx, pdf } = world()
    const out = await sourceRead.execute({ source: pdf }, ctx)
    expect(out.text).toMatch(/a PDF \(12 B\) with no text kept beside it; the PDF itself is attached to this result/)
    expect(out.file).toMatchObject({ mimeType: "application/pdf" })
  })

  it("reads the same document however its URL is spelled", async () => {
    const { ctx, page } = world()
    const id = parseAutomergeUrl(page).documentId
    const head = encodeHeads(["00".repeat(32)])[0]
    for (const spelling of [page, `${page}#${head}`, `${page}/content`, id]) {
      const out = await sourceRead.execute({ source: spelling, limit: 7 }, ctx)
      expect(out.endsWith("# Title")).toBe(true)
    }
  })

  it("opens a source at the heads its URL pins, and at the current version otherwise", async () => {
    const { ctx, page, found } = world()
    const named = spellings(page)
    // [spelling, the URL the repo is asked for]
    for (const [spelling, asked] of [
      [named.heads, `${page}#${HEAD}`],
      [page, page],
      [named["bare id"], page],
      [named["legacy UUID"], page],
    ]) {
      found.length = 0
      await sourceRead.execute({ source: spelling, limit: 7 }, ctx)
      expect(found).toEqual([asked])
    }
  })

  it("refuses what does not name a document", async () => {
    const { ctx } = world()
    await expect(sourceRead.execute({ source: "https://x.test/paper" }, ctx)).rejects.toThrow(/does not name a document/)
    await expect(sourceRead.execute({ source: "automerge:" }, ctx)).rejects.toThrow(/does not name a document/)
  })

  describe("in a research step, only what the workflow's research steps kept", () => {
    /**
     * A real repo: a plan whose ledger holds a page and a finding a step kept
     * through the scoped repo, and a document it did not keep. Every find the
     * scoped repo makes is recorded by id.
     */
    async function research() {
      const repo = new Repo({ network: [] })
      const plan = repo.create({})
      plan.change((d) => initPlan(d, { title: "P", goal: "G", steps: [] }))
      const asked = []
      const recording = { find: (url) => (asked.push(String(url)), repo.find(url)), create2: () => repo.create2() }
      const scoped = scopedRepo(recording, plan, { stepId: "r" })
      const page = await scoped.create2()
      page.change((d) => Object.assign(d, { "@patchwork": { type: "file" }, name: "Paper.md", role: "extract", source: "https://x.test/paper", content: new ImmutableString("# Paper\nwords") }))
      // A moment apart, so "newest first" has one answer.
      await new Promise((resolve) => setTimeout(resolve, 2))
      const finding = await scoped.create2()
      finding.change((d) => Object.assign(d, { "@patchwork": { type: "file" }, name: "Note.md", role: "finding", content: "a finding" }))
      const other = repo.create({ name: "Private.md", content: "not kept by any step" })
      const folder = repo.create({ title: "Research", docs: [] })
      asked.length = 0
      return { ctx: { repo: scoped, scope: { stepId: "r" } }, asked, page: page.url, finding: finding.url, other: other.url, folder: folder.url, plan: plan.url }
    }

    // [which document, readable?] × every spelling of it.
    for (const [which, readable] of [["page", true], ["finding", true], ["other", false], ["folder", false], ["plan", false]]) {
      for (const form of ["url", "heads", "bare id", "legacy UUID"]) {
        it(`${which} spelled as its ${form} → ${readable}`, async () => {
          const w = await research()
          const spelling = form === "url" ? w[which] : spellings(w[which])[form]
          const attempt = sourceRead.execute({ source: spelling, limit: 5 }, w.ctx)
          if (readable) await expect(attempt).resolves.toBeTypeOf("string")
          else {
            await expect(attempt).rejects.toThrow(NOT_A_SOURCE)
            // Refused before the repo was asked: no sync request goes out for it.
            expect(w.asked).toEqual([])
          }
        })
      }
    }

    it("lists the ledger, findings and all, newest first, with the step that kept each", async () => {
      const w = await research()
      const out = await sourceList.execute({}, w.ctx)
      expect(out.split("\n")).toEqual([
        "2 kept sources, newest first:",
        `Note.md · finding · 9 chars · ${w.finding} · by r`,
        `Paper.md · extract · 13 chars · ${w.page} · https://x.test/paper · by r`,
      ])
    })
  })
})

describe("source_read on a web snapshot", () => {
  // As the Web snapshot package's web_capture writes one: the frozen page's
  // bytes in `html`, its readable text and headings beside them. Restated
  // here, since the agent cannot import that package; what source_read
  // relies on is the source contract, which a snapshot keeps.
  it("reads and searches its text, by its headings, and never its HTML", async () => {
    const repo = new Repo({ network: [] })
    const text = "# Rendered page\n\nAfter scripts."
    const snapshot = repo.create({
      "@patchwork": { type: "web-snapshot" },
      title: "Rendered",
      source: "https://site.test/page",
      capture: { at: 1, via: "reader", engine: "reader-dom" },
      html: new TextEncoder().encode("<html><body><h1>Rendered page</h1><p>After scripts.</p></body></html>"),
      text: new ImmutableString(text),
      textVia: "html-to-text",
      marks: [{ at: 0, label: "# Rendered page" }],
    })
    const ctx = { repo, session: { doc: () => ({ made: [{ url: snapshot.url, name: "Rendered", kind: "source", source: "https://site.test/page", engine: "reader-dom", chars: text.length, what: "web-snapshot" }] }) } }
    const found = await sourceRead.execute({ source: snapshot.url, find: "scripts" }, ctx)
    expect(found.split("\n")).toEqual([
      `'Rendered' (${snapshot.url}) — 1 match for "scripts". Read around one with source_read {source:"${snapshot.url}", offset:23}.`,
      `23 · # Rendered page · # Rendered page After scripts.`,
    ])
    const read = await sourceRead.execute({ source: snapshot.url }, ctx)
    expect(read).toBe(`'Rendered' (${snapshot.url}) — characters 0–${text.length} of ${text.length} · under "# Rendered page"\nThat is the end.\n\n${text}`)
    expect(read).not.toContain("<h1>")
  })
})

describe("source_list", () => {
  it("lists the kept sources newest first, and nothing else the session made", async () => {
    const { ctx, page, pdf, body } = world()
    expect(await sourceList.execute({}, ctx)).toBe(
      [
        "2 kept sources, newest first:",
        `Scan.pdf · pdf · binary · ${pdf} · https://x.test/scan.pdf`,
        `Paper.md · file · ${body.length} chars · ${page} · https://x.test/paper`,
      ].join("\n")
    )
  })

  it("searches every kept source at once", async () => {
    const { ctx, page } = world()
    expect(await sourceList.execute({ find: "architecture" }, ctx)).toBe(
      `"architecture" appears in 1 of 2 kept sources:\nPaper.md · 1 match, first at 6011 · ${page}`
    )
    expect(await sourceList.execute({ find: "zebra" }, ctx)).toBe(`"zebra" appears in none of the 2 kept sources.`)
  })

  it("says when nothing has been kept", async () => {
    const { repo } = world()
    expect(await sourceList.execute({}, { repo, session: { doc: () => ({ made: [] }) } })).toMatch(/^Nothing has been kept yet/)
  })

  it("refuses when it cannot tell whose sources these are", async () => {
    const { repo } = world()
    await expect(sourceList.execute({}, { repo })).rejects.toThrow(/cannot reach the conversation/)
  })
})

describe("source_file", () => {
  it("files a kept source into a folder, pinned to the version that was fetched", async () => {
    const { ctx, docs, page, folder } = world()
    expect(await sourceFile.execute({ source: page, folder }, ctx)).toBe("Filed 'Paper.md' in Research.")
    expect(docs.get(folder).docs).toEqual([{ name: "Paper.md", type: "file", url: `${page}#h1` }])
    // Filing again is a no-op, not a duplicate.
    expect(await sourceFile.execute({ source: page, folder }, ctx)).toBe("'Paper.md' is already filed in Research.")
    expect(docs.get(folder).docs).toHaveLength(1)
  })

  it("files a web snapshot under its title, as a web-snapshot, so the folder opens it in its own view", async () => {
    const { ctx, docs, folder } = world()
    const url = generateAutomergeUrl()
    docs.set(url, { "@patchwork": { type: "web-snapshot" }, title: "Pack cells", source: "https://x.test/cells", html: new Uint8Array([60]), text: new ImmutableString("Cells") })
    expect(await sourceFile.execute({ source: url, folder }, ctx)).toBe("Filed 'Pack cells' in Research.")
    expect(docs.get(folder).docs).toEqual([{ name: "Pack cells", type: "web-snapshot", url: `${url}#h1` }])
  })

  it("takes the name the package imports", async () => {
    const { ctx, docs, pdf, folder } = world()
    await sourceFile.execute({ source: pdf, folder, name: "scan.pdf" }, ctx)
    expect(docs.get(folder).docs[0].name).toBe("scan.pdf")
  })

  it("refuses what it should not do", async () => {
    const { ctx, page, pdf, other, folder } = world()
    await expect(sourceFile.execute({ source: other, folder }, ctx)).rejects.toThrow(/is not a kept source/)
    await expect(sourceFile.execute({ source: page, folder: other }, ctx)).rejects.toThrow(/is not a folder/)
    await sourceFile.execute({ source: page, folder, name: "x.md" }, ctx)
    await expect(sourceFile.execute({ source: pdf, folder, name: "x.md" }, ctx)).rejects.toThrow(/already has something called 'x.md'/)
  })
})
