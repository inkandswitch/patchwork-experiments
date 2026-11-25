/**
 * A PDF's text, read here.
 *
 * A reader service had been the only way the agent got a PDF's words, and it
 * answered 429 for the catalogues and datasheets that mattered — so a PDF was
 * kept with no text beside it, and a model handed one as an attachment (which
 * not every model can read) saw "an attachment note" and nothing else. pdf.js,
 * bundled in documents/vendor/pdfjs.js, reads the bytes themselves, in a page, a
 * worker or node, with no network.
 *
 * What comes out is one text with a `[Page N]` line before each page's words,
 * and a mark (an outline entry) at each, so an offset says which page it is on
 * and a quote can cite the page. A PDF with no text layer (a scan) yields no
 * text and says so; OCR is not attempted.
 */

import { fewest, MAX_MARKS } from "../tools/sources.js"

/** A page with fewer non-space characters than this has no text layer worth reading. */
const EMPTY_PAGE = 8

/** The most pages read from one PDF; the rest are counted and said. */
export const MAX_PAGES = 600

let engine = null
/** pdf.js, loaded on first use: it is 1.7 MB and most conversations never read a PDF. */
async function pdfjs() {
  // Text extraction draws nothing, but in node pdf.js goes looking for a canvas
  // package to polyfill these with and warns when it finds none.
  globalThis.DOMMatrix ??= class DOMMatrix {}
  globalThis.Path2D ??= class Path2D {}
  if (!engine) {
    const warn = console.warn
    console.warn = (...args) => (/@napi-rs\/canvas|polyfill/.test(String(args[0])) ? undefined : warn.apply(console, args))
    engine = import("./vendor/pdfjs.js").finally(() => {
      console.warn = warn
    })
  }
  return engine
}

/**
 * One page's items as lines. A text item is a run of glyphs; pdf.js marks the
 * ones that end a line, and positions the rest, so a gap on the same line
 * becomes a space (a table row's cells would otherwise run together).
 */
export function pageText(items) {
  let out = ""
  let end = null // where the previous item on this line ended
  for (const item of items) {
    const str = item.str ?? ""
    const [, , , height, x, y] = item.transform ?? []
    if (end != null && x != null && !out.endsWith(" ") && !out.endsWith("\n") && !str.startsWith(" ")) {
      if (x - end.x > 0.12 * (Math.abs(height) || 10) && Math.abs(y - end.y) < 0.5 * (Math.abs(height) || 10)) out += " "
    }
    out += str
    if (item.hasEOL) {
      out += "\n"
      end = null
    } else end = x == null ? null : { x: x + (item.width ?? 0), y }
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Read a PDF's text: `{ numPages, read, pages: [{ page, text }], empty, scanned }`.
 * `empty` lists the pages (of those read) with no text; `scanned` is true when
 * none of them has any. Throws when the bytes are not a PDF pdf.js can open.
 */
export async function extractPdf(bytes) {
  const { getDocument } = await pdfjs()
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 })
  const doc = await task.promise
  try {
    const read = Math.min(doc.numPages, MAX_PAGES)
    const pages = []
    for (let page = 1; page <= read; page++) {
      const p = await doc.getPage(page)
      const content = await p.getTextContent()
      pages.push({ page, text: pageText(content.items) })
      p.cleanup()
    }
    const empty = pages.filter((p) => p.text.replace(/\s/g, "").length < EMPTY_PAGE).map((p) => p.page)
    return { numPages: doc.numPages, read, pages, empty, scanned: empty.length === pages.length }
  } finally {
    await task.destroy()
  }
}

/** The label of the line that opens a page's words. */
export const pageLine = (page) => `[Page ${page}]`

/**
 * The extracted pages as one text and its marks. A page with no text still
 * gets its line, with a note, so page numbers stay true.
 */
export function pdfText(extracted) {
  let text = ""
  const marks = []
  for (const { page, text: words } of extracted.pages) {
    marks.push({ at: text.length, label: `## Page ${page}` })
    text += `${pageLine(page)}\n${words || "(no text on this page)"}\n\n`
  }
  if (extracted.read < extracted.numPages) text += `[Only the first ${extracted.read} of ${extracted.numPages} pages were read.]\n`
  return { text: text.trimEnd(), marks: fewest(marks, MAX_MARKS) }
}

/** The page a character offset is on, from the marks, or null. */
export function pageAt(marks, offset) {
  let found = null
  for (const mark of marks ?? []) {
    if (mark.at > offset) break
    const n = mark.label.match(/^## Page (\d+)$/)
    if (n) found = Number(n[1])
  }
  return found
}

/** One line on what the extraction found, for a result to carry. */
export function pdfSummary(extracted) {
  const { numPages, empty, scanned, pages } = extracted
  const chars = pages.reduce((sum, p) => sum + p.text.length, 0)
  if (scanned) {
    return `${numPages} page${numPages === 1 ? "" : "s"}, and none has a text layer: it is a scan, page images with no words in them. Its text cannot be read here, and there is no OCR`
  }
  const gaps = empty.length ? `; page${empty.length === 1 ? "" : "s"} ${empty.join(", ")} ${empty.length === 1 ? "has" : "have"} no text layer (images or scans)` : ""
  return `${numPages} page${numPages === 1 ? "" : "s"}, ${chars.toLocaleString("en-US")} characters of text, marked [Page N]${gaps}`
}

const recent = new Map() // key -> Promise<{ extracted, text, marks }>, a few, newest last

/**
 * A kept PDF's text and marks, read once per document: `key` names it (its
 * url) and its size says whether it is still that one. Same bytes, same text,
 * so offsets read twice name the same characters.
 */
export function readPdf(bytes, key = null) {
  const at = key == null ? null : `${key}:${bytes.byteLength}`
  if (at != null && recent.has(at)) return recent.get(at)
  const read = extractPdf(bytes).then((extracted) => ({ extracted, ...pdfText(extracted) }))
  if (at != null) {
    recent.set(at, read)
    read.catch(() => recent.delete(at))
    if (recent.size > 6) recent.delete(recent.keys().next().value)
  }
  return read
}

