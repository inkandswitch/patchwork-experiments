/**
 * Every kind of file document, read in the form a model can use (files.js).
 */

import { describe, it, expect, beforeEach } from "vitest"
import { fileKind, decodeIfText, unzip, officeText, withFileData, MAX_FILE_BYTES } from "./files.js"
import { initSession, makeTurn, textBlock, callBlock, resultBlock, attachmentBlock, toRequest, CALL, _resetIds } from "./session.js"
import { toOpenAIMessages } from "./providers/openrouter.js"
import { BUILTIN_TOOLS } from "./tools/index.js"
import { sourceRead, sourceList } from "./tools/read-source.js"
import { makePdf } from "./pdf-fixture.js"

beforeEach(_resetIds)

const enc = (s) => new TextEncoder().encode(s)
const PDF = enc("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n")
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2])
const ZIPPED_AUDIO = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x00, 0xff, 0xfe])

/** A zip of these files: stored, or deflated with the platform's own compression. */
async function zip(files, { deflate = false } = {}) {
  const parts = []
  const central = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = enc(text)
    const data = deflate ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()) : raw
    const nameBytes = enc(name)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, deflate ? 8 : 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    const entry = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, deflate ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    entry.set(nameBytes, 46)
    parts.push(local, data)
    central.push(entry)
    offset += local.length + data.length
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, central.length, true)
  ev.setUint16(10, central.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const DOCX = {
  "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>Battery spec</w:t></w:r></w:p><w:p><w:r><w:t>Cells: 112 &amp; 16 spare</w:t><w:tab/><w:t>LF280K</w:t></w:r></w:p></w:body></w:document>`,
}
const XLSX = {
  "xl/workbook.xml": `<workbook><sheets><sheet name="BOM" sheetId="1"/><sheet name="Notes" sheetId="2"/></sheets></workbook>`,
  "xl/sharedStrings.xml": `<sst><si><t>Part</t></si><si><t>Qty</t></si><si><t>LF280K</t></si></sst>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>112</v></c></row></sheetData></worksheet>`,
  "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>checked</t></is></c></row></sheetData></worksheet>`,
}
const PPTX = {
  "ppt/slides/slide2.xml": `<p:sld><a:p><a:r><a:t>Safety</a:t></a:r></a:p></p:sld>`,
  "ppt/slides/slide1.xml": `<p:sld><a:p><a:r><a:t>100 kWh </a:t></a:r><a:r><a:t>LFP</a:t></a:r></a:p><a:p><a:r><a:t>Overview</a:t></a:r></a:p></p:sld>`,
}

describe("what a file is", () => {
  it("text as a string, text as bytes, images, PDFs, office files and other bytes", () => {
    const cases = [
      [{ name: "notes.md", content: "# Notes" }, "text"],
      [{ name: "parts.csv", mimeType: "text/csv", content: enc("part,qty\n") }, "text"],
      [{ name: "model.scad", content: enc("cube(10);") }, "text"],
      [{ name: "unknown", content: enc("plain words") }, "text"],
      [{ name: "hull.png", content: PNG }, "image"],
      [{ name: "sheet.pdf", content: PDF }, "pdf"],
      [{ name: "renamed.bin", content: PDF }, "pdf"],
      [{ name: "spec.docx", content: new Uint8Array([0x50, 0x4b, 3, 4]) }, "office"],
      [{ name: "song.mp3", mimeType: "audio/mpeg", content: ZIPPED_AUDIO }, "binary"],
      [{ name: "words.txt", mimeType: "text/plain", content: new Uint8Array([0x68, 0x00, 0x69]) }, "binary"], // a NUL: not text
      [{ name: "bad.txt", content: new Uint8Array([0xff, 0xfe, 0xfd]) }, "binary"], // not UTF-8
    ]
    for (const [doc, kind] of cases) expect(fileKind(doc)?.kind, doc.name).toBe(kind)
    expect(fileKind({ title: "not a file" })).toBe(null)
    expect(fileKind({ name: "x.docx", content: new Uint8Array(4) }).format).toBe("docx")
  })

  it("decodes UTF-8 text, and refuses what is not", () => {
    expect(decodeIfText(enc("ångström 3.2 V"))).toBe("ångström 3.2 V")
    expect(decodeIfText(new Uint8Array([0xc3]))).toBe(null)
    expect(decodeIfText(enc("a\u0000b"))).toBe(null)
  })
})

describe("office files' text", () => {
  for (const deflate of [false, true]) {
    it(`Word, Excel and PowerPoint, ${deflate ? "compressed" : "stored"}`, async () => {
      expect(await officeText(await zip(DOCX, { deflate }), "docx")).toBe("Battery spec\nCells: 112 & 16 spare\tLF280K")
      expect(await officeText(await zip(XLSX, { deflate }), "xlsx")).toBe("## BOM\nPart\tQty\nLF280K\t112\n\n## Notes\nchecked")
      expect(await officeText(await zip(PPTX, { deflate }), "pptx")).toBe("## Slide 1\n100 kWh LFP\nOverview\n\n## Slide 2\nSafety")
    })
  }

  it("says plainly when a file is not a zip", async () => {
    await expect(unzip(enc("not a zip at all, just words"))).rejects.toThrow(/not a zip/)
  })
})

describe("doc_read reads every kind", () => {
  const docRead = BUILTIN_TOOLS.find((t) => t.id === "doc_read")
  const read = (doc, input = {}) => docRead.execute({ url: "automerge:file", ...input }, { repo: { find: async (url) => ({ url, doc: () => doc }) } })

  it("text that arrived as bytes, decoded and paged", async () => {
    const out = await read({ name: "parts.csv", mimeType: "text/csv", content: enc("part,qty\nLF280K,112\n") })
    expect(out).toMatch(/'parts\.csv' \(text\/csv, 20 B\) — its text, 20 characters\.\n\npart,qty\nLF280K,112/)
    expect(await read({ name: "parts.csv", content: enc("part,qty\nLF280K,112\n") }, { offset: 9, limit: 6 })).toMatch(/characters 9–15 of 20[\s\S]*LF280K$/)
  })

  it("an office file's text", async () => {
    const out = await read({ name: "spec.docx", content: await zip(DOCX, { deflate: true }) })
    expect(out).toMatch(/'spec\.docx' \(docx, .*\) — the text of this docx file, \d+ characters\.\n\nBattery spec/)
  })

  it("a PDF whose text cannot be read is handed over whole by reference", async () => {
    const out = await read({ name: "sheet.pdf", mimeType: "application/pdf", content: PDF })
    expect(out.text).toMatch(/its text could not be read here.*The PDF itself is attached to this result/)
    expect(out.file).toEqual({ url: "automerge:file", name: "sheet.pdf", mimeType: "application/pdf" })
  })

  describe("a PDF is read as text, page by page", () => {
    const SHEET = makePdf(["Capacity 280 Ah", "Cycle life 6000 cycles at 80% DoD"])
    const SCAN = makePdf([null, null])

    it("gives its text, each page under a [Page N] line", async () => {
      const out = await read({ name: "sheet.pdf", mimeType: "application/pdf", content: SHEET })
      expect(typeof out).toBe("string")
      expect(out).toMatch(/the text of this PDF \(2 pages, \d+ characters of text, marked \[Page N\]\)/)
      expect(out).toContain("[Page 1]\nCapacity 280 Ah\n\n[Page 2]\nCycle life 6000 cycles at 80% DoD")
    })

    it("pages through it with offset and limit, and finds words in it", async () => {
      const doc = { name: "sheet.pdf", mimeType: "application/pdf", content: SHEET }
      expect(await read(doc, { offset: 0, limit: 8 })).toMatch(/characters 0–8 of \d+.*\n\n\[Page 1\]/s)
      const found = await read(doc, { find: "cycle life" })
      expect(found).toMatch(/1 match/)
      expect(found).toContain("[Page 2]")
    })

    it("reads the text a fetch kept beside the PDF, when there is some", async () => {
      const out = await read({ name: "sheet.pdf", mimeType: "application/pdf", content: SHEET, text: "kept text" })
      expect(out).toContain("kept text")
      expect(out).not.toContain("[Page 1]")
    })

    it("says a scan is one, and hands the PDF over for a model that can look at pages", async () => {
      const out = await read({ name: "scan.pdf", mimeType: "application/pdf", content: SCAN })
      expect(out.text).toMatch(/2 pages, and none has a text layer: it is a scan.*no OCR\. The PDF itself is attached/)
      expect(out.file).toEqual({ url: "automerge:file", name: "scan.pdf", mimeType: "application/pdf" })
    })

    it("source_read reads, finds and lists a PDF kept with no text beside it", async () => {
      const doc = { name: "sheet.pdf", mimeType: "application/pdf", content: SHEET, text: null, marks: [] }
      const repo = { find: async (url) => ({ url, doc: () => doc }) }
      const url = "automerge:3bRKtaJ6tCZ7vXwze42qyo3RuATC"
      const whole = await sourceRead.execute({ source: url }, { repo })
      expect(whole).toContain("[Page 2]\nCycle life 6000")
      expect(whole).toContain('under "## Page 1"')
      const found = await sourceRead.execute({ source: url, find: "6000" }, { repo })
      expect(found).toMatch(/1 match for "6000"/)
      expect(found).toContain("## Page 2 ·")
      const session = { made: [{ url, name: "sheet.pdf", kind: "source", source: "https://x.test/sheet.pdf", engine: "raw" }] }
      const listed = await sourceList.execute({ find: "6000" }, { repo, session: { doc: () => session } })
      expect(listed).toMatch(/"6000" appears in 1 of 1/)
    })
  })

  it("other bytes: named for what they are, and said to be unreadable", async () => {
    const out = await read({ name: "song.mp3", mimeType: "audio/mpeg", content: ZIPPED_AUDIO })
    expect(out).toMatch(/'song\.mp3' \(audio\/mpeg, 16 B\): binary, not something readable here as text, an image or a document\./)
  })

  it("source_read finds words in an office file kept with no text", async () => {
    const doc = { name: "BOM.xlsx", content: await zip(XLSX) }
    const out = await sourceRead.execute({ source: "automerge:3bRKtaJ6tCZ7vXwze42qyo3RuATC", find: "LF280K" }, { repo: { find: async (url) => ({ url, doc: () => doc }) } })
    expect(out).toMatch(/1 match for "LF280K"/)
  })
})

describe("a PDF in a request", () => {
  function sessionWithPdfResults(n) {
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("read the datasheets")])]
    for (let i = 0; i < n; i++) {
      doc.turns.push(makeTurn("assistant", [callBlock("doc_read", { url: `automerge:pdf${i}` }, { id: `c${i}`, status: CALL.done })]))
      doc.turns.push(makeTurn("tool", [resultBlock(`c${i}`, `PDF ${i}`, { file: { url: `automerge:pdf${i}`, name: `sheet${i}.pdf`, mimeType: "application/pdf" } })]))
    }
    return doc
  }

  it("only the newest goes with a request; the older are named, to read again", () => {
    const results = toRequest(sessionWithPdfResults(2)).messages.flatMap((m) => m.content.filter((p) => p.type === "result"))
    expect(results[0].file).toBeUndefined()
    expect(results[0].output).toMatch(/The file is not re-sent/)
    expect(results[1].file).toEqual({ url: "automerge:pdf1", name: "sheet1.pdf", mimeType: "application/pdf" })
  })

  it("is loaded from its document as the request is made, never kept in the session", async () => {
    const repo = { find: async (url) => ({ doc: () => (url === "automerge:pdf0" ? { content: PDF, mimeType: "application/pdf" } : null) }) }
    const messages = await withFileData(toRequest(sessionWithPdfResults(1)).messages, repo)
    const result = messages.flatMap((m) => m.content).find((p) => p.type === "result")
    expect(result.file.data).toBe(`data:application/pdf;base64,${Buffer.from(PDF).toString("base64")}`)
    const sent = toOpenAIMessages("sys", messages)
    expect(sent.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "File from the tool call above:" }, { type: "file", file: { filename: "sheet0.pdf", file_data: result.file.data } }],
    })
  })

  it("one that cannot be had becomes a line saying so, and the turn goes ahead", async () => {
    const big = { content: new Uint8Array(MAX_FILE_BYTES + 1), mimeType: "application/pdf" }
    for (const [repo, why] of [
      [{ find: async () => { throw new Error("gone") } }, /could not be opened/],
      [{ find: async () => ({ doc: () => big }) }, /more than the 20 MB sent/],
    ]) {
      const messages = await withFileData(toRequest(sessionWithPdfResults(1)).messages, repo)
      const result = messages.flatMap((m) => m.content).find((p) => p.type === "result")
      expect(result.file).toBeUndefined()
      expect(result.output).toMatch(why)
    }
  })

  it("a person's attached PDF goes in their message", async () => {
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("check this"), attachmentBlock({ url: "automerge:sheet", name: "sheet.pdf", mimeType: "application/pdf" })])]
    const repo = { find: async () => ({ doc: () => ({ content: PDF }) }) }
    const messages = await withFileData(toRequest(doc).messages, repo)
    const sent = toOpenAIMessages("sys", messages)[1]
    expect(sent.content.map((p) => p.type)).toEqual(["text", "file"])
    expect(sent.content[1].file.filename).toBe("sheet.pdf")
  })
})
