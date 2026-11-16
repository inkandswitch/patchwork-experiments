import { describe, it, expect } from "vitest"
import { ImmutableString } from "@automerge/automerge"
import { generateAutomergeUrl, parseAutomergeUrl, encodeHeads } from "@automerge/automerge-repo"
import { slice, findAll, sourceRead, sourceList, MAX_READ } from "./tools/read-source.js"
import { sourceFile } from "./tools/file-source.js"
import { headingAt } from "./tools/sources.js"
import { recordArtifact, MAX_ARTIFACTS } from "./session.js"

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
function world({ access = null } = {}) {
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
    workflow: access ? { access } : undefined,
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
  return { docs, repo, found, ctx: { repo, sessionUrl: session }, page, pdf, other, folder, body, session }
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

  it("will not pretend bytes are text", async () => {
    const { ctx, pdf } = world()
    expect(await sourceRead.execute({ source: pdf }, ctx)).toBe("This is binary (PDF, 12 B) with no text kept; open it in Patchwork.")
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

  it("refuses when it cannot tell whose sources these are", async () => {
    const { repo, page } = world()
    await expect(sourceRead.execute({ source: page }, { repo })).rejects.toThrow(/cannot reach the conversation/)
  })

  describe("in a web-only step, only what that step kept", () => {
    it.each([
      // [which document, access, readable?]
      ["page", "web", true],
      ["pdf", "web", true],
      ["other", "web", false],
      ["folder", "web", false],
      ["page", null, true],
      ["other", null, true],
    ])("%s with access %s → %s", async (which, access, readable) => {
      const w = world({ access })
      const attempt = sourceRead.execute({ source: w[which], limit: 5 }, w.ctx)
      if (readable) await expect(attempt).resolves.toBeTypeOf("string")
      else await expect(attempt).rejects.toThrow("Not one of the sources this step has kept.")
    })

    // Membership is by document, so every spelling of a kept source is
    // readable and every spelling of anything else is refused.
    for (const [which, readable] of [["page", true], ["other", false]]) {
      for (const form of ["heads", "bare id", "legacy UUID"]) {
        it(`${which} spelled as its ${form} → ${readable}`, async () => {
          const w = world({ access: "web" })
          const attempt = sourceRead.execute({ source: spellings(w[which])[form], limit: 5 }, w.ctx)
          if (readable) await expect(attempt).resolves.toBeTypeOf("string")
          else await expect(attempt).rejects.toThrow("Not one of the sources this step has kept.")
          if (!readable) expect(w.found).toEqual([])
        })
      }
    }

    it("keeps every source it kept readable, however much else the session makes", async () => {
      const w = world({ access: "web" })
      const session = w.docs.get(w.session)
      // Many more sources and other documents than the list of what a session
      // made keeps of the others, recorded in the order a long step would.
      for (let i = 0; i < MAX_ARTIFACTS * 2; i++) {
        recordArtifact(session, { url: generateAutomergeUrl(), name: `p${i}.md`, kind: "source", source: `https://x.test/${i}`, engine: "reader-markdown", chars: 1 })
        recordArtifact(session, { url: generateAutomergeUrl(), name: `f${i}.js`, kind: "file" })
      }
      expect(session.made.filter((a) => !a.source)).toHaveLength(MAX_ARTIFACTS)
      for (const which of ["page", "pdf"]) {
        await expect(sourceRead.execute({ source: w[which], limit: 5 }, w.ctx)).resolves.toBeTypeOf("string")
      }
    })
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
    const { repo, docs } = world()
    const empty = generateAutomergeUrl()
    docs.set(empty, { made: [] })
    expect(await sourceList.execute({}, { repo, sessionUrl: empty })).toMatch(/^Nothing has been kept yet/)
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
