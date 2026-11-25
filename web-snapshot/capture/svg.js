/**
 * An SVG image read as the XML it is, for the freeze (freeze.js).
 *
 * The freeze reads every document with the HTML scanner, and two things an
 * XML parser does with an SVG image are invisible to it. A DOCTYPE's
 * internal subset can declare entities, whose replacement text is markup —
 * `<!ENTITY e "<script>…</script>">` and then `&e;` — and attribute
 * defaults, which add attributes to elements whose tags do not show them.
 * So an SVG image is frozen without its DOCTYPE, and with every entity its
 * internal subset declares written out where it is used, so the scanner sees
 * all the markup an XML parser would. Illustrator writes its namespace URLs
 * as such entities, which is why they are written out rather than dropped.
 *
 * Whatever is not understood here fails safe: the DOCTYPE goes all the same,
 * and an entity left unwritten is then undeclared, which an XML parser
 * treats as a fatal error — the image shows nothing, and runs nothing.
 *
 * And an SVG image can be written into a page as a data: URL, which is read
 * here so that it can be frozen like any other.
 */

import { parsedForm, schemeOf } from "./css.js"
import { decode } from "./charset.js"

/** The five entities XML predefines: a subset cannot change them. */
const PREDEFINED = new Set(["lt", "gt", "amp", "apos", "quot"])
/** How long one entity's replacement, or the whole text, may grow: past that it is a billion laughs, and nothing is written out. */
const GROWTH = 1 << 20

/** The index just past what starts at `i` and ends with `close`, or -1 when nothing ends it. */
const past = (text, i, close) => {
  const at = text.indexOf(close, i)
  return at < 0 ? -1 : at + close.length
}

/** The index just past a declaration starting at `i`: its ">", quoted strings skipped. -1 when nothing ends it. */
function pastDeclaration(text, i) {
  let j = i
  while (j < text.length) {
    const c = text[j]
    if (c === '"' || c === "'") {
      const close = text.indexOf(c, j + 1)
      if (close < 0) return -1
      j = close + 1
    } else if (c === ">") {
      return j + 1
    } else j++
  }
  return -1
}

/** Character references decoded, as an entity's literal value has them when it is declared. */
const charRefs = (value) =>
  value.replace(/&#(?:x([0-9a-fA-F]+)|([0-9]+));/g, (whole, hex, dec) => {
    const code = hex != null ? parseInt(hex, 16) : parseInt(dec, 10)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
  })

/** The general entities an internal subset declares with a literal value; the first declaration of a name binds it. */
function entitiesOf(subset) {
  const entities = new Map()
  let i = 0
  while (i < subset.length) {
    let next
    if (subset.startsWith("<!--", i)) next = past(subset, i + 4, "-->")
    else if (subset.startsWith("<?", i)) next = past(subset, i + 2, "?>")
    else if (subset[i] === "<") {
      const m = /^<!ENTITY\s+([A-Za-z_:][\w.:-]*)\s+(?:"([^"]*)"|'([^']*)')\s*>/.exec(subset.slice(i))
      if (m && !PREDEFINED.has(m[1]) && !entities.has(m[1])) entities.set(m[1], charRefs(m[2] ?? m[3]))
      next = pastDeclaration(subset, i)
    } else if (subset[i] === '"' || subset[i] === "'") {
      next = past(subset, i + 1, subset[i])
    } else next = i + 1
    if (next < 0) break
    i = next
  }
  return entities
}

/**
 * Every use of a declared entity in `text` written out, recursively — but
 * not in comments, CDATA sections or processing instructions, where XML
 * does not read one. Null when that grows past GROWTH.
 */
function writeOut(text, entities) {
  const pattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|&([A-Za-z_:][\w.:-]*);/g
  const memo = new Map()
  const tooBig = {}
  const expand = (s, path) =>
    s.replace(pattern, (whole, name) => {
      // A cycle is an XML error; left unwritten, it stays one.
      if (name == null || !entities.has(name) || path.includes(name)) return whole
      if (!memo.has(name)) {
        const value = expand(entities.get(name), [...path, name])
        if (value.length > GROWTH) throw tooBig
        memo.set(name, value)
      }
      return memo.get(name)
    })
  try {
    const out = expand(text, [])
    return out.length > text.length + GROWTH ? null : out
  } catch (err) {
    if (err === tooBig) return null
    throw err
  }
}

/**
 * `text` without its DOCTYPE, the entities its internal subset declares
 * written out. The DOCTYPE is found where XML allows one: after an XML
 * declaration, comments, processing instructions and white space. A
 * document that has none there is returned as it is.
 */
export function withoutDoctype(text) {
  let i = text.startsWith("﻿") ? 1 : 0
  for (;;) {
    while (i < text.length && " \t\r\n".includes(text[i])) i++
    let next = -1
    if (text.startsWith("<?", i)) next = past(text, i + 2, "?>")
    else if (text.startsWith("<!--", i)) next = past(text, i + 4, "-->")
    else break
    if (next < 0) return text
    i = next
  }
  if (!/^<!DOCTYPE/i.test(text.slice(i, i + 9))) return text
  const start = i
  let j = i + 9
  let subset = ""
  for (;;) {
    if (j >= text.length) return text
    const c = text[j]
    if (c === '"' || c === "'") {
      j = past(text, j + 1, c)
      if (j < 0) return text
    } else if (c === "[") {
      // The internal subset: declarations, comments and processing
      // instructions, whose quoted strings and comments may hold a "]".
      let k = j + 1
      while (k < text.length && text[k] !== "]") {
        let next
        if (text.startsWith("<!--", k)) next = past(text, k + 4, "-->")
        else if (text.startsWith("<?", k)) next = past(text, k + 2, "?>")
        else if (text[k] === '"' || text[k] === "'") next = past(text, k + 1, text[k])
        else next = k + 1
        if (next < 0) return text
        k = next
      }
      subset = text.slice(j + 1, k)
      j = k + 1
    } else if (c === ">") {
      j++
      break
    } else j++
  }
  const rest = text.slice(j)
  const entities = entitiesOf(subset)
  return text.slice(0, start) + ((entities.size && writeOut(rest, entities)) || rest)
}

/** Percent-decoded bytes of a URL's text: "%XX" a byte, anything else its UTF-8. */
function percentDecode(text) {
  const out = []
  const encoder = new TextEncoder()
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "%" && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      const code = text.codePointAt(i)
      if (code > 0xffff) i++
      out.push(...encoder.encode(String.fromCodePoint(code)))
    }
  }
  return new Uint8Array(out)
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** Forgiving base64 (the Infra standard's), of bytes read as Latin-1: the bytes, or null when it fails. */
function forgivingBase64(bytes) {
  let text = ""
  for (const byte of bytes) text += String.fromCharCode(byte)
  text = text.replace(/[\t\n\f\r ]/g, "")
  if (text.length % 4 === 0) text = text.replace(/==?$/, "")
  if (text.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(text)) return null
  const out = []
  let value = 0
  let bits = 0
  for (const ch of text) {
    value = ((value << 6) | ALPHABET.indexOf(ch)) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((value >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

/**
 * The text of a data:image/svg+xml URL, read as the Fetch standard reads a
 * data: URL — its body up to any fragment, percent-decoded, then base64-
 * decoded when its type says so. Undefined when `value` is not such a URL;
 * null when it is one that does not decode, which a browser shows as
 * nothing.
 */
export function svgOfDataUrl(value) {
  if (schemeOf(value) !== "data") return undefined
  const url = parsedForm(value)
  const comma = url.indexOf(",")
  if (comma < 0) return undefined
  let type = url.slice(5, comma).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "")
  const base64 = /;[ ]*base64$/i.test(type)
  if (base64) type = type.replace(/;[ ]*base64$/i, "")
  if (type.split(";")[0].replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "").toLowerCase() !== "image/svg+xml") return undefined
  const hash = url.indexOf("#", comma)
  let bytes = percentDecode(url.slice(comma + 1, hash < 0 ? url.length : hash))
  if (base64) bytes = forgivingBase64(bytes)
  return bytes == null ? null : decode(bytes, "utf-8")
}
