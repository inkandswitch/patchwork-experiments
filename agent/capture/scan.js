/**
 * An HTML tokenizer with positions, and nothing else.
 *
 * Capture has to run in a tab, a worker and node, and only the tab has
 * DOMParser; so pages are read with this instead. It does what the
 * WHATWG tokenizer does for the parts that decide where a URL is and what
 * is markup, and keeps the position of everything, so the page can be
 * rewritten by splicing its own text rather than by re-serialising a tree
 * (which would change every page in ways nobody asked for).
 *
 * Tokens:
 *
 *   { type: "doctype", text, start, end }
 *   { type: "comment", text, start, end }      bogus ones ("<!x>", "<?x>", "</ x>") too
 *   { type: "start", name, ns, attrs, dups, selfClosing, start, end, nameEnd }
 *   { type: "end", name, start, end }
 *   { type: "text", text, start, end, raw, of? }
 *
 * A start tag's `ns` is the namespace of the element it makes: "html", "svg"
 * or "math". A text token is `raw` when its text is not entity-decoded, and
 * `of` names what holds it when that is not ordinary markup: the raw-text
 * or RCDATA element ("style", "title", "plaintext"…), or "cdata".
 *
 * Every attribute is `{ name, value, start, end, vStart, vEnd }`: the whole
 * attribute is text[start, end), and its value as written (quotes excluded)
 * is text[vStart, vEnd). A valueless attribute has vStart === vEnd === end.
 * Offsets are positions in the decoded string the scanner was given.
 *
 * Rules, as the platform has them:
 *
 *   - Names are lowercased, ASCII letters only, as a browser lowercases them. Of duplicate attributes the first wins, as in a
 *     browser; the later ones are listed in `dups` so a rewrite can remove
 *     them too. (Removing only the first `onclick` would promote the second.)
 *   - Raw text — no tags inside, ended only by the matching end tag — for
 *     script, style, xmp, iframe, noembed, noframes and noscript (as a
 *     browser with scripting on reads it), and plaintext to the end; RCDATA
 *     (entities decoded, no tags) for title and textarea.
 *   - Inside svg and math none of that applies (a `<style>` there is an
 *     ordinary element) and `<![CDATA[…]]>` is text, until an end tag, an
 *     HTML element that breaks out of foreign content, or an integration
 *     point brings HTML rules back: svg foreignObject, desc and title;
 *     MathML mi, mo, mn, ms and mtext; an annotation-xml declared as HTML.
 *   - A comment ends at the first "-->" or "--!>".
 *   - Outside foreign content <image> is <img>, as the tree builder has it.
 *   - A tag still open at the end of the input is dropped, as a browser drops it.
 *
 * Values decode numeric references, `&amp; &lt; &gt; &quot; &apos; &nbsp;`,
 * and the three that can spell a scheme, as in "java&Tab;script&colon;":
 * `&Tab; &NewLine; &colon;`. Other named references stay as written: the
 * full table is two thousand entries, and a URL attribute almost never uses one.
 */

const RAW_TEXT = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript"])
const RCDATA = new Set(["title", "textarea"])
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", Tab: "\t", NewLine: "\n", colon: ":" }

/** HTML elements that, opened inside svg or math, end the foreign content (HTML §13.2.6.5). */
const BREAKOUT = new Set([
  "b", "big", "blockquote", "body", "br", "center", "code", "dd", "div", "dl", "dt", "em", "embed",
  "h1", "h2", "h3", "h4", "h5", "h6", "head", "hr", "i", "img", "li", "listing", "menu", "meta",
  "nobr", "ol", "p", "pre", "ruby", "s", "small", "span", "strong", "strike", "sub", "sup", "table",
  "tt", "u", "ul", "var",
])
/** SVG elements that are HTML integration points. In MathML, title and desc are not. */
const INTEGRATION = new Set(["foreignobject", "desc", "title"])
/** MathML text integration points. */
const MATHML_TEXT = new Set(["mi", "mo", "mn", "ms", "mtext"])

/** Character references in `text` decoded: numeric ones, and the named ones above. */
export function decodeEntities(text) {
  if (!text.includes("&")) return text
  return text.replace(/&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|(amp|lt|gt|quot|apos|nbsp|Tab|NewLine|colon);)/g, (whole, hex, dec, name) => {
    if (name) return NAMED[name]
    const code = hex != null ? parseInt(hex, 16) : parseInt(dec, 10)
    // What the platform substitutes for a reference to nothing: NUL, a
    // surrogate on its own, or past the last code point.
    if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�"
    return String.fromCodePoint(code)
  })
}

const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f"
const isAlpha = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z")
/** ASCII letters lowercased, and nothing else: String#toLowerCase also changes "İ", and the string's length with it. */
const asciiLower = (s) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase())

/**
 * Read one tag from `<` at `i`. Returns the token and where it ends, or null
 * when the input ends inside it (a browser drops such a tag).
 */
function readTag(text, i, closing) {
  const n = text.length
  let p = i + (closing ? 2 : 1)
  const nameStart = p
  while (p < n && !isSpace(text[p]) && text[p] !== "/" && text[p] !== ">") p++
  const name = asciiLower(text.slice(nameStart, p))
  const nameEnd = p
  const attrs = []
  const dups = []
  const seen = new Set()
  let selfClosing = false
  for (;;) {
    while (p < n && (isSpace(text[p]) || text[p] === "/")) {
      selfClosing = text[p] === "/" && text[p + 1] === ">"
      p++
    }
    if (p >= n) return null
    if (text[p] === ">") {
      p++
      break
    }
    selfClosing = false
    const aStart = p
    // An attribute name may begin with "=", and runs to space, "/", ">" or "=".
    p++
    while (p < n && !isSpace(text[p]) && text[p] !== "/" && text[p] !== ">" && text[p] !== "=") p++
    const aName = asciiLower(text.slice(aStart, p))
    let q = p
    while (q < n && isSpace(text[q])) q++
    let vStart = p
    let vEnd = p
    let value = ""
    let aEnd = p
    if (text[q] === "=") {
      q++
      while (q < n && isSpace(text[q])) q++
      if (q >= n) return null
      const quote = text[q]
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, q + 1)
        if (close < 0) return null
        vStart = q + 1
        vEnd = close
        aEnd = close + 1
      } else {
        vStart = q
        while (q < n && !isSpace(text[q]) && text[q] !== ">") q++
        vEnd = q
        aEnd = q
      }
      value = decodeEntities(text.slice(vStart, vEnd))
      p = aEnd
    } else {
      vStart = vEnd = aEnd = p
    }
    const attr = { name: aName, value, start: aStart, end: aEnd, vStart, vEnd }
    if (seen.has(aName)) dups.push(attr)
    else {
      seen.add(aName)
      attrs.push(attr)
    }
  }
  if (closing) return { token: { type: "end", name, start: i, end: p }, end: p }
  return { token: { type: "start", name, attrs, dups, selfClosing, start: i, end: p, nameEnd }, end: p }
}

/**
 * Where raw text or RCDATA for `name` ends: the next `</name` followed by
 * space, "/" or ">". Matched in place, case-insensitively for ASCII only, as
 * a browser matches it: lowercasing the page first would move every index
 * after a character whose lowercase is longer ("İ" is two code units).
 */
function rawEnd(text, from, name) {
  const pattern = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, "gi")
  pattern.lastIndex = from
  const match = pattern.exec(text)
  return match ? match.index : text.length
}

/**
 * Which elements an end tag in HTML content does not reach past: the
 * boundaries of "has an element in scope". An end tag whose element is only
 * open beyond one is ignored.
 */
const SCOPE = new Set(["applet", "caption", "html", "table", "td", "th", "marquee", "object", "template"])
/** HTML elements with no end tag, which are never open. */
const VOID = new Set(["area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"])

/**
 * An element as the scanner keeps it open: its name, its namespace, and
 * whether it is an integration point — `html` where HTML rules hold
 * (svg foreignObject, desc and title; MathML annotation-xml declared as
 * HTML), `text` where they hold for every start tag but mglyph and
 * malignmark (MathML mi, mo, mn, ms, mtext).
 */
function foreignElement(token, ns) {
  const name = token.name
  if (ns === "svg" && INTEGRATION.has(name)) return { name, ns, point: "html", scope: true }
  if (ns === "math" && MATHML_TEXT.has(name)) return { name, ns, point: "text", scope: true }
  if (ns === "math" && name === "annotation-xml") {
    const encoding = asciiLower(attr(token, "encoding")?.value ?? "")
    return { name, ns, point: encoding === "text/html" || encoding === "application/xhtml+xml" ? "html" : null, scope: true }
  }
  return { name, ns, point: null, scope: false }
}

/**
 * Scan a page into tokens. Never throws.
 *
 * Whether a tag opens raw text depends on the tree, not on the tag: a
 * `<style>` in svg is an element with children, the same `<style>` in an
 * svg's foreignObject is raw text. So the scanner keeps a stack of open
 * elements and decides as the tree builder's dispatcher does (HTML
 * §13.2.6): HTML rules when the current node is HTML or an integration
 * point, foreign content's otherwise. It does not do the rest of the tree
 * builder — no implied end tags, no adoption agency — so on contrived markup
 * it can still disagree with a browser about which mode it is in;
 * capture/freeze.js escapes every `<` the scanner read as text, so that a
 * disagreement only ever turns markup into text.
 */
export function scanHtml(text) {
  text = String(text ?? "")
  const n = text.length
  const tokens = []
  const stack = []
  const current = () => stack[stack.length - 1]
  let i = 0
  let textStart = 0
  let stop = n

  const flush = (to) => {
    if (to > textStart) tokens.push({ type: "text", text: decodeEntities(text.slice(textStart, to)), start: textStart, end: to, raw: false })
  }
  /** Does a start tag go by HTML rules (true) or as foreign content? */
  const htmlRules = (name) => {
    const node = current()
    if (!node || node.ns === "html" || node.point === "html") return true
    if (node.point === "text") return name !== "mglyph" && name !== "malignmark"
    return node.ns === "math" && node.name === "annotation-xml" && name === "svg"
  }
  /** Out of foreign content: pop to an HTML element or an integration point. */
  const breakOut = () => {
    while (stack.length && current().ns !== "html" && !current().point) stack.pop()
  }
  /** An end tag by HTML rules: close the nearest such HTML element, unless a scope boundary comes first. */
  const htmlEnd = (name) => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].ns === "html" && stack[k].name === name) {
        stack.length = k
        return
      }
      if (stack[k].scope) return
    }
  }
  /** An end tag in foreign content (HTML §13.2.6.5, "any other end tag"). */
  const foreignEnd = (name) => {
    if (name === "p" || name === "br") {
      breakOut()
      htmlEnd(name)
      return
    }
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].name === name) {
        stack.length = k
        return
      }
      if (k > 0 && stack[k - 1].ns === "html") {
        htmlEnd(name)
        return
      }
    }
  }

  while (i < n) {
    const lt = text.indexOf("<", i)
    if (lt < 0) break
    i = lt
    const next = text[i + 1]

    if (text.startsWith("<!--", i)) {
      flush(i)
      // "<!-->" and "<!--->" end at once; otherwise the first "-->" or
      // "--!>" ends it, as the tokenizer has it.
      let close
      if (text.startsWith("<!-->", i)) close = i + 5
      else if (text.startsWith("<!--->", i)) close = i + 6
      else {
        const plain = text.indexOf("-->", i + 4)
        const bang = text.indexOf("--!>", i + 4)
        if (plain < 0 && bang < 0) close = n
        else if (bang < 0 || (plain >= 0 && plain < bang)) close = plain + 3
        else close = bang + 4
      }
      tokens.push({ type: "comment", text: text.slice(i, close), start: i, end: close })
      i = textStart = close
      continue
    }
    // CDATA is read where the current node is not HTML: in foreign content
    // and at its integration points (a foreignObject is an SVG element).
    if (stack.length && current().ns !== "html" && text.startsWith("<![CDATA[", i)) {
      flush(i)
      const at = text.indexOf("]]>", i + 9)
      const close = at < 0 ? n : at + 3
      tokens.push({ type: "text", text: text.slice(i + 9, at < 0 ? n : at), start: i, end: close, raw: true, of: "cdata" })
      i = textStart = close
      continue
    }
    // "<!", "<?", and "</" followed by anything but a letter or ">", are
    // bogus comments, to the first ">".
    if (next === "!" || next === "?" || (next === "/" && i + 2 < n && text[i + 2] !== ">" && !isAlpha(text[i + 2]))) {
      flush(i)
      const at = text.indexOf(">", i + 2)
      const close = at < 0 ? n : at + 1
      const body = text.slice(i, close)
      tokens.push({ type: /^<!doctype/i.test(body) ? "doctype" : "comment", text: body, start: i, end: close })
      i = textStart = close
      continue
    }
    if (next === "/" && text[i + 2] === ">") {
      // "</>" is dropped.
      flush(i)
      i = textStart = i + 3
      continue
    }
    const closing = next === "/"
    if (!(closing ? isAlpha(text[i + 2] ?? "") : isAlpha(next ?? ""))) {
      i++
      continue
    }

    const read = readTag(text, i, closing)
    if (!read) {
      // The input ends inside a tag: a browser drops it.
      stop = i
      break
    }
    flush(i)
    const { token } = read
    tokens.push(token)
    i = textStart = read.end

    if (closing) {
      if (stack.length && current().ns !== "html") foreignEnd(token.name)
      else htmlEnd(token.name)
      continue
    }

    if (!htmlRules(token.name)) {
      if (BREAKOUT.has(token.name) || (token.name === "font" && token.attrs.some((a) => ["color", "face", "size"].includes(a.name)))) {
        // Back to HTML: the token is then read by HTML rules, below.
        breakOut()
      } else {
        // A foreign element, in its parent's namespace: a <svg> inside
        // <math> is MathML's, and so is a <title> inside that.
        const ns = current().ns
        token.ns = ns
        if (!token.selfClosing) stack.push(foreignElement(token, ns))
        continue
      }
    }

    // HTML rules. The tree builder reads <image> as <img>.
    if (token.name === "image") token.name = "img"
    if (token.name === "svg" || token.name === "math") {
      token.ns = token.name
      if (!token.selfClosing) stack.push(foreignElement(token, token.name))
      continue
    }
    token.ns = "html"
    if (token.name === "plaintext") {
      tokens.push({ type: "text", text: text.slice(i), start: i, end: n, raw: true, of: "plaintext" })
      i = textStart = n
      break
    }
    if (RAW_TEXT.has(token.name) || RCDATA.has(token.name)) {
      const end = rawEnd(text, i, token.name)
      if (end > i) {
        const body = text.slice(i, end)
        const rcdata = RCDATA.has(token.name)
        tokens.push({ type: "text", text: rcdata ? decodeEntities(body) : body, start: i, end, raw: !rcdata, of: token.name })
      }
      i = textStart = end
      continue
    }
    // A self-closing slash on an HTML element is ignored: it is open.
    if (!VOID.has(token.name)) stack.push({ name: token.name, ns: "html", point: null, scope: SCOPE.has(token.name) })
  }
  flush(stop)
  return tokens
}

/** An attribute of a start tag, by name, or null. */
export function attr(token, name) {
  return token.attrs?.find((a) => a.name === name) ?? null
}
