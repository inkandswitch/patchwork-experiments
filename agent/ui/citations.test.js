/**
 * Citations: finding a quoted passage in the document it cites.
 *
 * The fixture is written the way kept sources are — markdown emphasis, links,
 * typographic quotes and dashes, non-breaking spaces, ragged whitespace — and
 * every claim below is checked over every window of its words, not a sample.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { normalise, locateQuote, quoteParts, citationsIn, quotableText, checkCitation, MIN_QUOTE, tableCitations, citationsInDocument } from "../documents/citations.js"
import { citationsCheck } from "../tools/citing.js"
import { renderMarkdown } from "./markdown.js"
import { markCitations, _forgetChecks } from "./citations.js"

const SOURCE = [
  "# LiFePO₄ cells — a datasheet",
  "",
  "The **rated capacity** is 280 Ah at 0.2C, measured at 25 °C.",
  "See [the cycle table](https://maker.test/cycles \"cycles\") for life:  6000 cycles to 80 %.",
  "",
  "> “Do not charge below 0 °C,” the manufacturer warns — _ever_.",
  "Internal resistance: `0.18 mΩ` typical; İstanbul plant, lot 7.",
].join("\n")

/** How the fixture reads: its words, as a person would quote them. */
const WORDS = normalise(SOURCE).text.split(" ")

/** Every run of `n` consecutive words. */
const windows = (n) => WORDS.slice(0, WORDS.length - n + 1).map((_, i) => WORDS.slice(i, i + n))

describe("normalise: text as it reads, mapped back to where it came from", () => {
  it("each character of the reading maps to a character of the source that reads as it", () => {
    const { text, from } = normalise(SOURCE)
    expect(from).toHaveLength(text.length)
    for (let i = 0; i < text.length; i++) {
      if (i > 0) expect(from[i]).toBeGreaterThanOrEqual(from[i - 1])
      const original = SOURCE[from[i]]
      if (text[i] === " ") expect(/\s/.test(original)).toBe(true)
      else expect(normalise(original).text).toContain(text[i])
    }
  })

  it("drops markup and a link's destination, and reads typographic characters as plain ones", () => {
    const { text } = normalise(SOURCE)
    expect(text).toContain("the rated capacity is 280 ah")
    expect(text).toContain("see the cycle table for life: 6000 cycles")
    expect(text).toContain('"do not charge below 0 °c," the manufacturer warns - ever.')
    expect(text).not.toMatch(/[*_`]|https:| |  /)
  })
})

describe("locateQuote finds every passage of the source, where it is", () => {
  it("every window of three or more words, quoted in any case, is found, and the place found reads as the quote", () => {
    const reading = normalise(SOURCE)
    /** What a span of the source reads as: the characters of the reading that come from it. */
    const readsAs = (at, end) => [...reading.text].filter((_, i) => reading.from[i] >= at && reading.from[i] < end).join("")
    let checked = 0
    for (let n = 3; n <= 8; n++) {
      for (const words of windows(n)) {
        const quote = words.join(" ")
        if (quote.length < MIN_QUOTE) continue
        for (const spelling of [quote, quote.toUpperCase()]) {
          const found = locateQuote(SOURCE, spelling)
          expect(found.found, spelling).toBe(true)
          expect(readsAs(found.at, found.end), spelling).toBe(quote)
        }
        checked++
      }
    }
    expect(checked).toBeGreaterThan(200)
  })

  it("no window with one word changed is found", () => {
    for (const words of windows(4)) {
      for (let k = 0; k < words.length; k++) {
        const changed = words.map((w, j) => (j === k ? `${w}x` : w)).join(" ")
        if (changed.length < MIN_QUOTE) continue
        expect(locateQuote(SOURCE, changed).found, changed).toBe(false)
      }
    }
  })

  it("two passages joined by an ellipsis are found in order, and not out of it", () => {
    const fours = windows(4)
    for (let i = 0; i < fours.length; i += 3) {
      for (let j = i + 4; j < fours.length; j += 5) {
        const [a, b] = [fours[i].join(" "), fours[j].join(" ")]
        for (const dots of [" … ", " ... ", "…", " [...] "]) {
          expect(locateQuote(SOURCE, `${a}${dots}${b}`).found, `${a}${dots}${b}`).toBe(true)
        }
        // Reversed, it is found only if the later passage also occurs earlier, which these do not.
        if (normalise(SOURCE).text.indexOf(b) > normalise(SOURCE).text.indexOf(a) + a.length) {
          expect(locateQuote(SOURCE, `${b} … ${a}`).found, `${b} … ${a}`).toBe(false)
        }
      }
    }
  })

  it("a quote too short to find a place by is not checked, and says so", () => {
    for (const quote of ["", "280 Ah", "…", "0.2C … 25"]) {
      expect(locateQuote(SOURCE, quote)).toEqual({ found: false, reason: "short" })
    }
  })

  it("names the part that is missing", () => {
    expect(locateQuote(SOURCE, "rated capacity is 280 Ah … 9000 cycles to 80")).toEqual({ found: false, reason: "missing", part: "9000 cycles to 80" })
    expect(quoteParts("one two … three [...] four")).toEqual(["one two", "three", "four"])
  })
})

describe("citations in markdown", () => {
  it("are links to a document that carry a quote", () => {
    const text = 'It holds 280 Ah [sheet](automerge:abc "rated capacity is 280 Ah"), see [the page](automerge:def) and [web](https://x.test "a title").'
    expect(citationsIn(text)).toEqual([{ label: "sheet", url: "automerge:abc", quote: "rated capacity is 280 Ah" }])
  })

  it("render as a citation chip; a plain document link stays a link; (from memory) is marked", () => {
    const md = renderMarkdown('Rated 280 Ah [sheet](automerge:abc "rated capacity is 280 Ah"), see [the page](automerge:def). Copper melts at 1085 °C (from memory).')
    const cite = md.querySelector(".agent-cite")
    expect(cite.dataset.docUrl).toBe("automerge:abc")
    expect(cite.dataset.quote).toBe("rated capacity is 280 Ah")
    expect(cite.textContent).toBe("sheet")
    expect([...md.querySelectorAll(".agent-doc-link")].map((a) => [a.textContent, a.classList.contains("agent-cite")])).toEqual([["sheet", true], ["the page", false]])
    expect(md.querySelector(".agent-from-memory").textContent).toBe("from memory")
  })
})

describe("checking citations against their documents", () => {
  beforeEach(_forgetChecks)

  const docs = {
    "automerge:sheet": { "@patchwork": { type: "file" }, role: "primary", text: SOURCE },
    "automerge:note": { title: "Notes", items: [{ body: "the pump runs at 12 volts nominal" }] },
  }
  const find = async (url) => docs[url] ?? null

  it("reads a kept source's text, or else every string of a document", () => {
    expect(quotableText(docs["automerge:sheet"])).toBe(SOURCE)
    expect(quotableText(docs["automerge:note"])).toBe("Notes\nthe pump runs at 12 volts nominal")
  })

  it("says found, missing, short or unreadable", async () => {
    expect(await checkCitation({ url: "automerge:sheet", quote: "rated capacity is 280 Ah" }, find)).toMatchObject({ status: "found" })
    expect(await checkCitation({ url: "automerge:note", quote: "runs at 12 volts" }, find)).toMatchObject({ status: "found" })
    expect(await checkCitation({ url: "automerge:sheet", quote: "rated capacity is 300 Ah" }, find)).toMatchObject({ status: "missing" })
    expect(await checkCitation({ url: "automerge:sheet", quote: "280 Ah" }, find)).toEqual({ status: "short" })
    expect(await checkCitation({ url: "automerge:gone", quote: "rated capacity is 280 Ah" }, find)).toEqual({ status: "unreadable" })
  })

  it("marks each rendered citation with what its check found, once per citation", async () => {
    let finds = 0
    const counting = async (url) => {
      finds++
      return find(url)
    }
    const md = renderMarkdown(
      'A [s](automerge:sheet "rated capacity is 280 Ah") B [s](automerge:sheet "rated capacity is 999 Ah") C [s](automerge:sheet "rated capacity is 280 Ah")'
    )
    markCitations(md, counting)
    markCitations(md, counting)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect([...md.querySelectorAll(".agent-cite")].map((a) => a.dataset.check)).toEqual(["found", "missing", "found"])
    expect(md.querySelectorAll(".agent-cite")[1].title).toMatch(/NOT found in that document/)
    expect(finds).toBe(2)
  })
})

describe("citations in a table", () => {
  // The shape the battery workflow's bill of materials took, unprompted.
  const bom = [
    ["#", "Item", "Unit price", "Source (automerge URL)", "Verbatim price quote", "Notes"],
    ["A", "CELLS", "", "", "", "FX assumption: 1 GBP = 1.27 USD (from memory)"],
    ["1", "EVE LF280K", "89.00", "automerge:sheet", "rated capacity is 280 Ah at 0.2C", ""],
    ["2", "Busbar", "4.10", "automerge:sheet", "rated capacity is 999 Ah", ""],
    ["3", "Fuse", "40", "", "", "ESTIMATE (from memory)"],
  ]

  it("are found from the header row: a source column and a quote column", () => {
    expect(tableCitations(bom)).toEqual([
      { url: "automerge:sheet", quote: "rated capacity is 280 Ah at 0.2C", row: 2 },
      { url: "automerge:sheet", quote: "rated capacity is 999 Ah", row: 3 },
    ])
    expect(tableCitations([{ item: "cell", source: "automerge:sheet", quote: "rated capacity is 280 Ah" }])).toEqual([{ url: "automerge:sheet", quote: "rated capacity is 280 Ah", row: 0 }])
    expect(tableCitations([["a", "b"], ["1", "2"]])).toEqual([])
  })

  it("and a document's citations are found wherever they are, with what is marked from memory", () => {
    const doc = { title: "BOM", data: bom, notes: 'Pack cells [sheet](automerge:sheet "rated capacity is 280 Ah").' }
    const { citations, fromMemory } = citationsInDocument(doc)
    expect(citations.map((c) => c.where)).toEqual(["data row 2", "data row 3", "notes"])
    expect(fromMemory).toBe(2)
  })

  it("citations_check says which hold and what to fix", async () => {
    const docs = {
      "automerge:bom": { title: "BOM", data: bom },
      "automerge:sheet": { "@patchwork": { type: "file" }, role: "primary", text: SOURCE },
    }
    const ctx = { repo: { find: async (url) => ({ doc: () => docs[url] ?? null }) } }
    const out = await citationsCheck.execute({ url: "automerge:bom" }, ctx)
    expect(out).toMatch(/^1 of 2 citations hold/)
    expect(out).toMatch(/2 places marked from memory/)
    expect(out).toMatch(/- data row 3: "rated capacity is 999 Ah" — not in automerge:sheet/)
    expect(citationsCheck.summarize({}, out)).toBe("1/2 citations hold")
  })
})
