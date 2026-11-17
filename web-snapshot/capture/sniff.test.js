/**
 * accept and sniffHtml over a fixed table: what a capture keeps as an image,
 * a stylesheet or a font, and which targets are pages.
 */
import { describe, it, expect } from "vitest"
import { accept, sniffHtml, htmlLooking, formatOf } from "./sniff.js"

const bytes = (...b) => new Uint8Array(b)
const text = (s) => new TextEncoder().encode(s)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0)
const GIF = text("GIF89a")
const WEBP = text("RIFF\0\0\0\0WEBPVP8 ")
const AVIF = text("\0\0\0\x1cftypavif")
const ICO = bytes(0, 0, 1, 0, 1, 0)
const SVG = text(`<?xml version="1.0"?><!-- Generator: x --><svg xmlns="http://www.w3.org/2000/svg"></svg>`)
const WOFF = text("wOFF\0\x01\0\0")
const WOFF2 = text("wOF2\0\x01\0\0")
const TTF = bytes(0, 1, 0, 0, 0, 0x10)
const OTF = text("OTTO\0\x0a")
const TTC = text("ttcf\0\x01")
const HTML = text(`\n  <!DOCTYPE html><html><body>Not found</body></html>`)
const HTML_COMMENTED = text(`<!-- served by nginx --><html>`)
const CSS = text(`body { color: red }`)

describe("accept", () => {
  const CASES = [
    // [kind, declared type, body, ok, kept as]
    ["image", "image/png", PNG, true, "image/png"],
    ["image", "", PNG, true, "image/png"],
    ["image", "application/octet-stream", JPEG, true, "image/jpeg"],
    ["image", "text/plain", GIF, true, "image/gif"],
    ["image", "", WEBP, true, "image/webp"],
    ["image", "", AVIF, true, "image/avif"],
    ["image", "", ICO, true, "image/x-icon"],
    ["image", "text/plain", SVG, true, "image/svg+xml"],
    ["image", "image/bmp", bytes(0x42, 0x4d), true, "image/bmp"],
    ["image", "image/png", HTML, false, "image/png"],
    ["image", "text/html", HTML, false, "text/html"],
    ["image", "text/plain", CSS, false, "text/plain"],
    ["style", "text/css", CSS, true, "text/css"],
    ["style", "text/css; charset=utf-8", CSS, true, "text/css"],
    ["style", "", CSS, true, "text/css"],
    ["style", "text/plain", CSS, true, "text/css"],
    ["style", "text/html", CSS, false, "text/html"],
    ["style", "text/css", HTML, false, "text/css"],
    ["style", "", HTML_COMMENTED, false, null],
    ["style", "", PNG, false, null],
    ["font", "font/woff2", WOFF2, true, "font/woff2"],
    ["font", "application/octet-stream", WOFF2, true, "font/woff2"],
    ["font", "binary/octet-stream", WOFF, true, "font/woff"],
    ["font", "text/plain", TTF, true, "font/ttf"],
    ["font", "", OTF, true, "font/otf"],
    ["font", "", TTC, true, "font/collection"],
    ["font", "application/font-woff", bytes(1, 2, 3), true, "application/font-woff"],
    ["font", "application/x-font-ttf", bytes(1, 2, 3), true, "application/x-font-ttf"],
    ["font", "application/vnd.ms-fontobject", bytes(1, 2, 3), true, "application/vnd.ms-fontobject"],
    ["font", "application/octet-stream", bytes(1, 2, 3), false, "application/octet-stream"],
    ["font", "font/woff2", HTML, false, "font/woff2"],
    ["script", "text/javascript", text("x()"), false, "text/javascript"],
  ]
  it.each(CASES)("%s · %s · %#", (kind, type, body, ok, mimeType) => {
    expect(accept(kind, type, body)).toEqual({ ok, mimeType })
  })
})

describe("sniffHtml routes a capture target", () => {
  const CASES = [
    ["text/html", HTML, true],
    ["application/xhtml+xml", text("<?xml?><html>"), true],
    ["text/html", text("%PDF-1.7"), false],
    ["application/pdf", text("%PDF-1.7"), false],
    ["", HTML, true],
    ["text/plain", HTML_COMMENTED, true],
    ["application/octet-stream", HTML, true],
    ["text/plain", text("just words"), false],
    ["image/png", PNG, false],
    ["application/json", text(`{"html":"<html>"}`), false],
  ]
  it.each(CASES)("%s · %#", (type, body, page) => {
    expect(sniffHtml(body, type)).toBe(page)
  })

  it("an SVG that opens with a comment is not HTML", () => {
    expect(htmlLooking(SVG)).toBe(false)
    expect(htmlLooking(text("<body>"))).toBe(true)
    expect(htmlLooking(text("<bodyguard>"))).toBe(false)
  })

  it("names every format in the magic table", () => {
    expect([PNG, JPEG, GIF, WEBP, AVIF, ICO, WOFF, WOFF2, TTF, OTF, TTC, text("%PDF")].map(formatOf)).toEqual([
      "PNG", "JPEG", "GIF", "WebP", "AVIF", "ICO", "WOFF", "WOFF2", "TrueType font", "OpenType font", "font collection", "PDF",
    ])
  })
})
