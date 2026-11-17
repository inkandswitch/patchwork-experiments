/**
 * Which label decodes a page or a stylesheet: every combination of a BOM, a
 * header charset, a declaration in the document and (for a stylesheet) its
 * parent's label. The label must follow the precedence, and a non-ASCII
 * fixture written in the winning encoding must come back exactly.
 */
import { describe, it, expect } from "vitest"
import { htmlCharset, cssCharset, metaCharset, atCharset, decode, canonical } from "./charset.js"

const BOMS = { none: null, "utf-8": "utf-8", "utf-16le": "utf-16le", "utf-16be": "utf-16be" }
const HEADERS = { none: [null, null], "utf-8": ["text/html; charset=utf-8", "utf-8"], latin1: ["text/html; charset=latin1", "windows-1252"], shift_jis: ["text/html; charset=Shift_JIS", "shift_jis"] }

/** Text each encoding can carry, beyond ASCII. */
const SAMPLE = { "utf-8": "café 日本", "utf-16le": "café 日本", "utf-16be": "café 日本", "windows-1252": "café", shift_jis: "日本" }
const SJIS = { 日: [0x93, 0xfa], 本: [0x96, 0x7b] }

/** `text` as the bytes of `label`, with the BOM when `bom`. Written by hand, not by the decoder under test. */
function encode(text, label, bom) {
  const out = []
  if (bom === "utf-8") out.push(0xef, 0xbb, 0xbf)
  if (bom === "utf-16le") out.push(0xff, 0xfe)
  if (bom === "utf-16be") out.push(0xfe, 0xff)
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (label === "utf-8") out.push(...new TextEncoder().encode(ch))
    else if (label === "utf-16le") out.push(code & 0xff, code >> 8)
    else if (label === "utf-16be") out.push(code >> 8, code & 0xff)
    else if (label === "windows-1252") out.push(code)
    else if (label === "shift_jis") out.push(...(SJIS[ch] ?? [code]))
  }
  return new Uint8Array(out)
}

describe("a page's charset: BOM × header × <meta>", () => {
  const IN_DOC = { none: ["", null], "meta latin1": [`<meta charset="latin1">`, "windows-1252"] }
  for (const [bomName, bom] of Object.entries(BOMS)) {
    for (const [headerName, [contentType, header]] of Object.entries(HEADERS)) {
      for (const [docName, [markup, declared]] of Object.entries(IN_DOC)) {
        const expected = bom ?? header ?? declared ?? "utf-8"
        it(`BOM ${bomName} · header ${headerName} · ${docName} → ${expected}`, () => {
          const text = `${markup}<p>${SAMPLE[expected]}</p>`
          const bytes = encode(text, expected, bom)
          expect(htmlCharset(bytes, contentType)).toBe(expected)
          expect(decode(bytes, expected)).toBe(text)
        })
      }
    }
  }
})

describe("a stylesheet's charset: BOM × header × @charset × parent", () => {
  const IN_DOC = { none: ["", null], "@charset shift_jis": [`@charset "shift_jis";`, "shift_jis"] }
  const PARENTS = { none: null, latin1: "latin1" }
  for (const [bomName, bom] of Object.entries(BOMS)) {
    for (const [headerName, [contentType, header]] of Object.entries(HEADERS)) {
      for (const [docName, [rule, declared]] of Object.entries(IN_DOC)) {
        for (const [parentName, parent] of Object.entries(PARENTS)) {
          // @charset counts only at byte 0, so not after a BOM: but a BOM wins anyway.
          const expected = bom ?? header ?? declared ?? (parent ? "windows-1252" : null) ?? "utf-8"
          it(`BOM ${bomName} · header ${headerName} · ${docName} · parent ${parentName} → ${expected}`, () => {
            const text = `${rule}a::after{content:"${SAMPLE[expected]}"}`
            const bytes = encode(text, expected, bom)
            expect(cssCharset(bytes, contentType?.replace("text/html", "text/css"), parent)).toBe(expected)
            expect(decode(bytes, expected)).toBe(text)
          })
        }
      }
    }
  }
})

describe("declarations", () => {
  const ascii = (text) => new TextEncoder().encode(text)
  const CASES = [
    [`<meta charset=utf-8>`, "utf-8"],
    [`<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2">`, "iso-8859-2"],
    [`<meta charset="utf-16">`, "utf-8"],
    [`<meta charset="no-such-thing"><meta charset=latin1>`, "windows-1252"],
    [`<!-- <meta charset=latin1> --><p>`, null],
    [`${" ".repeat(1100)}<meta charset=latin1>`, null],
    [`<meta name=viewport content="width=device-width">`, null],
  ]
  it.each(CASES)("%s → %s", (html, label) => {
    expect(metaCharset(ascii(html))).toBe(label)
  })

  it("@charset counts only exactly at byte 0, double-quoted", () => {
    expect(atCharset(ascii(`@charset "latin1";`))).toBe("windows-1252")
    expect(atCharset(ascii(` @charset "latin1";`))).toBe(null)
    expect(atCharset(ascii(`@charset 'latin1';`))).toBe(null)
    expect(atCharset(ascii(`@charset "utf-16be";`))).toBe("utf-8")
  })

  it("an unknown header label is passed over, not fatal", () => {
    expect(htmlCharset(ascii(`<meta charset=latin1>`), "text/html; charset=bogus")).toBe("windows-1252")
    expect(htmlCharset(ascii(`<p>`), "text/html; charset=bogus")).toBe("utf-8")
    expect(canonical("bogus")).toBe(null)
    expect(decode(ascii("ok"), "bogus")).toBe("ok")
  })
})
