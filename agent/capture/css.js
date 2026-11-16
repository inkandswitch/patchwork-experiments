/**
 * The URLs a stylesheet loads, with where each one is written.
 *
 * A subset of CSS Syntax Level 3, just enough to know which text is a URL:
 * comments, strings with their escapes, `url(` with unquoted contents,
 * at-keywords and braces. Nothing inside a comment or a string is a link
 * unless the string is one of the places a string IS a URL:
 *
 *   @import "x" / @import url(x) media    -> style
 *   url() inside an @font-face block      -> font
 *   any other url()                       -> image
 *   a string argument of image-set() or -webkit-image-set()   -> image
 *
 * Each link is `{ kind, url, start, end, raw }`: `css[start, end)` is the
 * whole token to replace — `url(…)` or the quoted string — `raw` the URL as
 * written, unescaped, and `url` that made absolute against `base`, or null
 * with `bad: true` when it does not parse. Values that are never links
 * (data:, blob:, about:, javascript:, a bare fragment, nothing) are left out.
 *
 * Input that ends mid-token returns what was found so far. It never throws.
 */

/** Values that are never fetched: they name no resource, or one this page cannot share. */
export function notALink(raw) {
  const value = String(raw ?? "").trim()
  if (!value || value.startsWith("#")) return true
  return /^(data|blob|about|javascript):/i.test(value.replace(/[\t\n\r]/g, ""))
}

/** `raw` made absolute against `base`: `{url}`, `{bad: true}`, or null when it is never a link. */
export function resolveLink(raw, base) {
  if (notALink(raw)) return null
  try {
    return { url: new URL(String(raw).trim(), base).href }
  } catch {
    return { bad: true }
  }
}

const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f"
const isHex = (c) => /^[0-9a-fA-F]$/.test(c ?? "")
const isIdent = (c) => c !== undefined && /[A-Za-z0-9_\-\u0080-￿]/.test(c)

/** One escape at `i` (just past the backslash): [the character, the index after it]. */
function escape(css, i) {
  if (isHex(css[i])) {
    let j = i
    while (j < css.length && j - i < 6 && isHex(css[j])) j++
    const code = parseInt(css.slice(i, j), 16)
    if (isSpace(css[j])) j += css[j] === "\r" && css[j + 1] === "\n" ? 2 : 1
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    return [valid ? String.fromCodePoint(code) : "�", j]
  }
  if (i >= css.length) return ["�", i]
  return [css[i], i + 1]
}

/** Is the backslash at `i` an escape? Not when a newline follows it. */
const escapes = (css, i) => css[i] === "\\" && css[i + 1] !== "\n" && css[i + 1] !== "\r" && css[i + 1] !== "\f"

/**
 * A name from `i` — an identifier, a function's or an at-rule's — with its
 * escapes decoded: [its value, the index after it]. A stylesheet may spell
 * `url(` as `\75 rl(` and `@import` as `@\69mport`, and a browser reads both.
 */
function readName(css, i) {
  let value = ""
  let j = i
  while (j < css.length) {
    if (isIdent(css[j])) {
      value += css[j++]
    } else if (escapes(css, j)) {
      const [ch, after] = escape(css, j + 1)
      value += ch
      j = after
    } else break
  }
  return [value, j]
}

/** A string starting at the quote at `i`: [its value, the index after it]. An unescaped newline ends it. */
function readString(css, i) {
  const quote = css[i]
  let value = ""
  let j = i + 1
  while (j < css.length) {
    const c = css[j]
    if (c === quote) return [value, j + 1]
    if (c === "\n" || c === "\r" || c === "\f") return [value, j]
    if (c === "\\") {
      if (css[j + 1] === "\n") {
        j += 2
        continue
      }
      const [ch, after] = escape(css, j + 1)
      value += ch
      j = after
      continue
    }
    value += c
    j++
  }
  return [value, j]
}

/** Past whitespace and comments from `i`. */
function skip(css, i) {
  for (;;) {
    while (i < css.length && isSpace(css[i])) i++
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2)
      i = end < 0 ? css.length : end + 2
      continue
    }
    return i
  }
}

/**
 * A `url(`'s contents, from `open` just after its "(": `{raw, end}` for its
 * contents and the index after its ")", or null for a malformed unquoted
 * one, consumed to its ")".
 */
function readUrl(css, open) {
  let j = skip(css, open)
  if (css[j] === '"' || css[j] === "'") {
    const [value, after] = readString(css, j)
    j = skip(css, after)
    if (css[j] === ")") return { raw: value, end: j + 1 }
    // Something after the string: a function whose argument is not a URL.
    const close = css.indexOf(")", j)
    return { raw: null, end: close < 0 ? css.length : close + 1 }
  }
  let value = ""
  while (j < css.length) {
    const c = css[j]
    if (c === ")") return { raw: value, end: j + 1 }
    if (isSpace(c)) {
      const k = skip(css, j)
      if (css[k] === ")") return { raw: value, end: k + 1 }
      break
    }
    if (c === '"' || c === "'" || c === "(") break
    if (c === "\\") {
      const [ch, after] = escape(css, j + 1)
      value += ch
      j = after
      continue
    }
    value += c
    j++
  }
  // A bad url: consumed to the next ")", escapes respected, and not a link.
  while (j < css.length && css[j] !== ")") j += css[j] === "\\" ? 2 : 1
  return { raw: null, end: Math.min(j + 1, css.length) }
}

/** Every URL a stylesheet loads, in order. */
export function cssLinks(css, base) {
  css = String(css ?? "")
  const links = []
  let depth = 0
  let fontFace = null // the brace depth of an open @font-face block
  let fontFacePending = false
  let importPending = false
  const imageSets = [] // paren depths at which an image-set( is open
  let parens = 0

  const add = (kind, raw, start, end) => {
    const resolved = resolveLink(raw, base)
    if (!resolved) return
    links.push(resolved.bad ? { kind, url: null, bad: true, raw, start, end } : { kind, url: resolved.url, raw, start, end })
  }
  const urlKind = () => (importPending ? "style" : fontFace !== null ? "font" : "image")

  let i = 0
  while (i < css.length) {
    const c = css[i]
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2)
      i = end < 0 ? css.length : end + 2
      continue
    }
    if (isSpace(c)) {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      const [value, after] = readString(css, i)
      if (importPending) add("style", value, i, after)
      else if (imageSets.length && imageSets[imageSets.length - 1] === parens) add("image", value, i, after)
      importPending = false
      i = after
      continue
    }
    if (c === "\\" && !escapes(css, i)) {
      i++
      importPending = false
      continue
    }
    if (c === "@") {
      const [raw, j] = readName(css, i + 1)
      const name = raw.toLowerCase()
      importPending = name === "import"
      fontFacePending = name === "font-face"
      i = j
      continue
    }
    if (c === "{") {
      depth++
      if (fontFacePending) {
        fontFace = depth
        fontFacePending = false
      }
      importPending = false
      i++
      continue
    }
    if (c === "}") {
      if (fontFace === depth) fontFace = null
      depth = Math.max(0, depth - 1)
      importPending = false
      i++
      continue
    }
    if (c === ";") {
      importPending = false
      fontFacePending = false
      i++
      continue
    }
    if (c === ")") {
      if (imageSets.length && imageSets[imageSets.length - 1] === parens) imageSets.pop()
      parens = Math.max(0, parens - 1)
      i++
      continue
    }
    if (c === "(") {
      parens++
      i++
      continue
    }
    if ((isIdent(c) || escapes(css, i)) && !isIdent(css[i - 1] ?? "")) {
      const [name, j] = readName(css, i)
      const word = name.toLowerCase()
      if (css[j] === "(" && word === "url") {
        const { raw, end } = readUrl(css, j + 1)
        if (raw != null) add(urlKind(), raw, i, end)
        importPending = false
        i = end
        continue
      }
      if (css[j] === "(" && (word === "image-set" || word === "-webkit-image-set")) {
        parens++
        imageSets.push(parens)
        i = j + 1
        continue
      }
      importPending = false
      i = j
      continue
    }
    i++
  }
  return links
}
