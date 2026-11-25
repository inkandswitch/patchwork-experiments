import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { makePdf } from "../fixtures/pdf-fixture.js"
import { extractPdf, pdfText, pdfSummary, pageAt, readPdf, pageText } from "./pdf-text.js"

describe("pageText", () => {
  const item = (str, x, y, extra = {}) => ({ str, transform: [12, 0, 0, 12, x, y], width: str.length * 6, ...extra })
  it("puts a space where a gap on the same line says one, and a newline where a line ends", () => {
    expect(pageText([item("Cell", 10, 700), item("Value", 100, 700, { hasEOL: true }), item("Next", 10, 686)])).toBe("Cell Value\nNext")
  })
  it("adds nothing between runs that touch", () => {
    expect(pageText([item("Ah", 10, 700), item("ead", 22, 700)])).toBe("Ahead")
  })
})

describe("extractPdf", () => {
  it("reads each page's words under its own number", async () => {
    const got = await extractPdf(makePdf(["Capacity 280 Ah", "Mass 5.4 kg", "Cycle life 6000"]))
    expect(got).toMatchObject({ numPages: 3, read: 3, empty: [], scanned: false })
    expect(got.pages.map((p) => [p.page, p.text])).toEqual([[1, "Capacity 280 Ah"], [2, "Mass 5.4 kg"], [3, "Cycle life 6000"]])
  })

  it("says which pages have no text layer, and that a PDF of only those is a scan", async () => {
    const mixed = await extractPdf(makePdf(["Specification", null]))
    expect(mixed).toMatchObject({ empty: [2], scanned: false })
    expect(pdfSummary(mixed)).toContain("page 2 has no text layer")

    const scan = await extractPdf(makePdf([null, null]))
    expect(scan).toMatchObject({ empty: [1, 2], scanned: true })
    expect(pdfSummary(scan)).toMatch(/none has a text layer: it is a scan.*no OCR$/)
  })

  it("rejects bytes that are not a PDF", async () => {
    await expect(extractPdf(new TextEncoder().encode("<html>not a pdf</html>"))).rejects.toThrow()
  })

  it("leaves the caller's bytes usable", async () => {
    const bytes = makePdf(["Hello"])
    await extractPdf(bytes)
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect((await extractPdf(bytes)).pages[0].text).toBe("Hello")
  })
})

describe("pdfText", () => {
  it("writes a [Page N] line before each page, with a mark at it, so an offset names its page", async () => {
    const { text, marks } = pdfText(await extractPdf(makePdf(["Alpha", null, "Gamma"])))
    expect(text).toBe("[Page 1]\nAlpha\n\n[Page 2]\n(no text on this page)\n\n[Page 3]\nGamma")
    expect(marks.map((m) => m.label)).toEqual(["## Page 1", "## Page 2", "## Page 3"])
    for (const mark of marks) expect(text.slice(mark.at, mark.at + 7)).toBe(`[Page ${mark.label.slice(-1)}`)
    expect(pageAt(marks, text.indexOf("Gamma"))).toBe(3)
    expect(pageAt(marks, text.indexOf("Alpha"))).toBe(1)
    expect(pageAt(marks, 0)).toBe(1)
  })
})

describe("readPdf", () => {
  it("reads a kept document once and gives the same text again", async () => {
    const bytes = makePdf(["Once"])
    const a = readPdf(bytes, "automerge:x")
    expect(readPdf(bytes, "automerge:x")).toBe(a)
    expect((await a).text).toBe("[Page 1]\nOnce")
  })
})

// The four datasheets the Nootka run kept but could not read, when they have
// been fetched (see the lane notes); skipped on a machine without them.
const REAL = process.env.REAL_PDF_DIR
describe.skipIf(!REAL)("the datasheets the run kept", () => {
  it.each(["lf280k", "db80", "orion", "gv200"])("%s has a text layer, read here", async (name) => {
    const path = `${REAL}/${name}.pdf`
    if (!existsSync(path)) return
    const got = await extractPdf(new Uint8Array(readFileSync(path)))
    expect(got.scanned).toBe(false)
    expect(got.pages.map((p) => p.text).join(" ")).toMatch(/\w{3,}/)
  })
})
