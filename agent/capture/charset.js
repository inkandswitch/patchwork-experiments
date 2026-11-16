/**
 * Which encoding a page or a stylesheet is in, and its text in that encoding.
 *
 * Decoding with the wrong label does not fail: it gives text that is wrong in
 * every non-ASCII character and looks fine everywhere else. So the label is
 * chosen by the platform's own precedence, written down here once:
 *
 *   page        BOM > the Content-Type header > a <meta> in the first 1024
 *               bytes > utf-8
 *   stylesheet  BOM > the Content-Type header > `@charset "…";` at byte 0 >
 *               the label of the document or sheet that linked it > utf-8
 *
 * The stylesheet's inheritance from its parent is what freeze-dry got wrong
 * (#46, #51): a Latin-1 page's unlabelled sheet is Latin-1 too.
 *
 * A label TextDecoder does not know is passed over, as a browser passes over
 * it, and the next source in the order decides; if none does, utf-8. Labels
 * come back as the encoding's canonical name (`latin1` is `windows-1252`).
 */

/** The canonical name of an encoding label, or null when it names none. */
export function canonical(label) {
  if (typeof label !== "string" || !label.trim()) return null
  try {
    return new TextDecoder(label.trim()).encoding
  } catch {
    return null
  }
}

/** The encoding a byte-order mark names, or null. */
export function bomCharset(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8"
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le"
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be"
  return null
}

/** The charset parameter of a Content-Type, canonical, or null. */
export function headerCharset(contentType) {
  const match = String(contentType ?? "").match(/;\s*charset\s*=\s*["']?([^"';\s]+)/i)
  return match ? canonical(match[1]) : null
}

/** Bytes as Latin-1 text: one character per byte, so ASCII markup is findable in any ASCII-compatible encoding. */
function latin1(bytes) {
  let text = ""
  for (const byte of bytes) text += String.fromCharCode(byte)
  return text
}

/**
 * A page's charset as its own markup declares it, from the first 1024 bytes:
 * `<meta charset=…>`, or `<meta http-equiv="content-type" content="…charset=…">`.
 * A declared UTF-16 is read as utf-8, as the HTML standard says, because a
 * page whose ASCII markup was readable this way is not UTF-16.
 */
export function metaCharset(bytes) {
  const text = latin1(bytes.subarray(0, 1024)).replace(/<!--[\s\S]*?-->/g, "")
  for (const [tag] of text.matchAll(/<meta\b[^>]*>/gi)) {
    const direct = tag.match(/\bcharset\s*=\s*["']?([^"'\s/>;]+)/i)
    const equiv = /http-equiv\s*=\s*["']?content-type/i.test(tag) && tag.match(/\bcontent\s*=\s*["']?[^"'>]*?charset\s*=\s*([^"'\s;>]+)/i)
    const label = canonical((/\bhttp-equiv\b/i.test(tag) ? equiv?.[1] : direct?.[1]) ?? "")
    if (label) return label.startsWith("utf-16") ? "utf-8" : label
  }
  return null
}

/** A stylesheet's `@charset "…";`, exactly at byte 0 as CSS requires, or null. */
export function atCharset(bytes) {
  const text = latin1(bytes.subarray(0, 1024))
  const match = text.match(/^@charset "([^"]*)";/)
  const label = match ? canonical(match[1]) : null
  return label?.startsWith("utf-16") ? "utf-8" : label
}

/** The label a page's bytes are decoded with. */
export function htmlCharset(bytes, contentType) {
  return bomCharset(bytes) ?? headerCharset(contentType) ?? metaCharset(bytes) ?? "utf-8"
}

/** The label a stylesheet's bytes are decoded with; `parent` is the linking document's or sheet's. */
export function cssCharset(bytes, contentType, parent = null) {
  return bomCharset(bytes) ?? headerCharset(contentType) ?? atCharset(bytes) ?? canonical(parent ?? "") ?? "utf-8"
}

/** Bytes as text in `label`, with a BOM dropped; an unknown label decodes as utf-8. */
export function decode(bytes, label) {
  let decoder
  try {
    decoder = new TextDecoder(label || "utf-8")
  } catch {
    decoder = new TextDecoder("utf-8")
  }
  return decoder.decode(bytes)
}
