/**
 * What a fetched resource is, judged from what it says it is and what it starts with.
 *
 * A capture keeps a resource only when it is what the page wanted it for: an
 * image where an image was asked for, a stylesheet where a stylesheet was.
 * The commonest failure this catches is a server that answers a missing image
 * with its HTML 404 page and a 200, which would otherwise be kept and shown
 * as a broken picture with a clean bill of health. So an HTML-looking body is
 * never anything but a page.
 *
 * The magic-byte table is this package's own. The agent keeps a copy of it,
 * copied rather than shared, as packages do here. Within this package it is
 * the one table, so a format recognised in one place is recognised in all of
 * them. It lives here because capture code must load without automerge, in a
 * tab, a worker or node.
 */

/**
 * [magic bytes, name, offset]: the format's name when `bytes` start with the
 * magic at the offset (0 when absent).
 *
 * Some formats say what they are a few bytes in: a WebP is a RIFF file whose
 * form type at byte 8 is "WEBP", and an AVIF is an ISO media file whose first
 * box at byte 4 is "ftypavif".
 */
export const MAGIC = [
  [[0x00, 0x61, 0x73, 0x6d], "WebAssembly module"],
  [[0x1f, 0x8b], "gzip"],
  [[0x50, 0x4b, 0x03, 0x04], "zip"],
  [[0x25, 0x50, 0x44, 0x46], "PDF"],
  [[0x89, 0x50, 0x4e, 0x47], "PNG"],
  [[0xff, 0xd8, 0xff], "JPEG"],
  [[0x47, 0x49, 0x46, 0x38], "GIF"],
  [[0x57, 0x45, 0x42, 0x50], "WebP", 8],
  [[0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], "AVIF", 4],
  [[0x00, 0x00, 0x01, 0x00], "ICO"],
  [[0x77, 0x4f, 0x46, 0x46], "WOFF"],
  [[0x77, 0x4f, 0x46, 0x32], "WOFF2"],
  [[0x00, 0x01, 0x00, 0x00], "TrueType font"],
  [[0x4f, 0x54, 0x54, 0x4f], "OpenType font"],
  [[0x74, 0x74, 0x63, 0x66], "font collection"],
]

/** The format's name, from its magic number, or null. */
export function formatOf(bytes) {
  const head = [...(bytes?.subarray?.(0, 16) ?? [])]
  return MAGIC.find(([magic, , at = 0]) => magic.every((byte, i) => head[at + i] === byte))?.[1] ?? null
}

/** The media type each recognised image or font format is kept as. */
const FORMAT_TYPES = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  GIF: "image/gif",
  WebP: "image/webp",
  AVIF: "image/avif",
  ICO: "image/x-icon",
  WOFF: "font/woff",
  WOFF2: "font/woff2",
  "TrueType font": "font/ttf",
  "OpenType font": "font/otf",
  "font collection": "font/collection",
}
const IMAGE_FORMATS = ["PNG", "JPEG", "GIF", "WebP", "AVIF", "ICO"]
const FONT_FORMATS = ["WOFF", "WOFF2", "TrueType font", "OpenType font", "font collection"]

/** The media type alone, lowercased, without parameters. */
export function mediaTypeOf(contentType) {
  return String(contentType ?? "").split(";")[0].trim().toLowerCase()
}

/** The first kilobyte as Latin-1 text: every byte one character, so markup is findable whatever the encoding claims. */
function head(bytes, size = 1024) {
  const part = bytes?.subarray?.(0, size) ?? new Uint8Array(0)
  let text = ""
  for (const byte of part) text += String.fromCharCode(byte)
  return text
}

/**
 * The tags that, first in a body, mean HTML: the WHATWG sniffing table's
 * patterns, less `<!--`. An SVG often opens with a comment (an editor's
 * "Generator" line), and a comment says nothing about which markup follows,
 * so a comment is skipped rather than taken as HTML.
 */
const HTML_OPENERS = ["!doctype html", "html", "head", "script", "iframe", "h1", "div", "font", "table", "a", "style", "title", "b", "body", "br", "p"]

/** Does this body look like an HTML page? Leading whitespace, a BOM and comments are skipped. */
export function htmlLooking(bytes) {
  let text = head(bytes).replace(/^\xef\xbb\xbf/, "")
  for (;;) {
    const trimmed = text.replace(/^[\t\n\f\r ]+/, "")
    if (!trimmed.startsWith("<!--")) {
      text = trimmed
      break
    }
    const close = trimmed.indexOf("-->", 4)
    if (close < 0) return false
    text = trimmed.slice(close + 3)
  }
  const lower = text.toLowerCase()
  return HTML_OPENERS.some((tag) => lower.startsWith(`<${tag}`) && /^[ >]/.test(lower.slice(tag.length + 1) || ">"))
}

/** Does an `<svg` tag appear in the first kilobyte? */
export const looksSvg = (bytes) => /<svg[\s>]/i.test(head(bytes))

/**
 * Is this response what a page wanted for `kind`? `{ok, mimeType}`, where the
 * media type is the one it is kept and shown as.
 *
 *   image   an image/* type, or the magic of a known image, or `<svg` in the
 *           first kilobyte
 *   style   text/css, or no type or text/plain with a body that is not HTML
 *   font    a font type (font/*, application/(x-)font-*, the EOT type), or
 *           the magic of a known font whatever the type says: CDNs serve
 *           fonts as octet-stream, binary/octet-stream and even text/plain,
 *           and the magic is the better witness
 *
 * Anything else is not kept by a capture, and neither is an HTML-looking body
 * of any kind.
 */
export function accept(kind, declaredType, bytes) {
  const type = mediaTypeOf(declaredType)
  if (htmlLooking(bytes)) return { ok: false, mimeType: type || null }
  const format = formatOf(bytes)

  if (kind === "image") {
    if (IMAGE_FORMATS.includes(format)) return { ok: true, mimeType: type.startsWith("image/") ? type : FORMAT_TYPES[format] }
    if (type.startsWith("image/")) return { ok: true, mimeType: type }
    if (looksSvg(bytes)) return { ok: true, mimeType: "image/svg+xml" }
    return { ok: false, mimeType: type || null }
  }
  if (kind === "style") {
    const ok = type === "text/css" || ((type === "" || type === "text/plain") && !format)
    return { ok, mimeType: ok ? "text/css" : type || null }
  }
  if (kind === "font") {
    if (FONT_FORMATS.includes(format)) return { ok: true, mimeType: type.startsWith("font/") ? type : FORMAT_TYPES[format] }
    const fontType = type.startsWith("font/") || /^application\/(x-)?font-/.test(type) || type === "application/vnd.ms-fontobject"
    return { ok: fontType, mimeType: type || null }
  }
  return { ok: false, mimeType: type || null }
}

/**
 * Is a capture target a page, to be kept as a snapshot, rather than a file?
 * A known binary format never is, whatever its header says. An HTML or XHTML
 * type is; and with no useful type — none, text/plain, octet-stream — the
 * body decides.
 */
export function sniffHtml(bytes, contentType) {
  if (formatOf(bytes)) return false
  const type = mediaTypeOf(contentType)
  if (type === "text/html" || type === "application/xhtml+xml") return true
  if (type === "" || type === "text/plain" || type === "application/octet-stream") return htmlLooking(bytes)
  return false
}
