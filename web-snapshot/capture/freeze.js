/**
 * Freezing a page: what a snapshot stores, and what is shown and exported.
 *
 * A snapshot keeps a page frozen. At capture, `freezePage` turns the page as
 * received — usually the reader's DOM after the page's scripts ran — into a
 * page that runs nothing and reaches nothing, and that is what the document
 * stores: no script, no event handler, no javascript: URL, no refresh, no
 * <base>, no preload, no live frame. Every load position names the kept
 * bytes it shows by their hash (an `ni:` URI, capture/bytes.js), or, when
 * nothing was kept, the absolute URL it had; the stylesheets it loads are
 * stored frozen the same way, and so are SVG images, which can hold script.
 *
 * On the way out, `render` runs the same pass again over what is stored —
 * a snapshot is a shared document, and a collaborator can edit it — and
 * writes every stored blob it names into a data: URL, so what the view shows
 * and Export saves is one self-contained string.
 *
 * Inert means it runs no code and reaches no network, whoever opens it. Four
 * things make that so, and each would hold without the others:
 *
 *   1. The view puts it in an iframe sandboxed without allow-scripts,
 *      allow-same-origin or allow-forms (snapshot/view.js).
 *   2. Our Content-Security-Policy comes first in it, and allows nothing but
 *      data: images, media, styles and fonts — so whatever is left pointing
 *      at the web is blocked — and no frame, no form submission and no
 *      <base>, which form-action and base-uri must say, since they do not
 *      fall back to default-src. A stored CSP cannot loosen it: every policy
 *      on a page applies. The stored page starts with it too.
 *   3. Every `http-equiv` is renamed `data-x-http-equiv`, as text, after
 *      everything else. A refresh is navigation, which CSP does not govern,
 *      and attribute names are never entity-decoded, so no scanning mistake
 *      can leave a working one. (The cost: page text that contains the
 *      literal word shows it altered.) A name already renamed is left as it
 *      is, so freezing a frozen page renames nothing twice.
 *   4. Scripts, event handlers, <base>, preloads and the rest are removed,
 *      and every load position is rewritten: to the kept bytes when the
 *      resource was kept, else to its absolute URL, which (2) blocks. A
 *      relative URL left alone would resolve against the page showing the
 *      frame — Patchwork's own origin.
 *
 * (4) rests on the scanner finding every tag a browser finds, and the
 * scanner does not build the tree, so on contrived markup it can disagree
 * with a browser about whether a region is markup or text. So every `<` the
 * scanner read as text — in an attribute value, a comment, a CDATA section,
 * raw text or RCDATA — is escaped, and a tag the input ends inside is
 * dropped. Then a browser that reads a region differently can only find
 * text where the scanner found tags, never a tag the scanner did not
 * rewrite. Each escape reads back as the same characters — in CSS a `<` is
 * written `\3c `, the same in a string and never valid outside one — except
 * in the obsolete <xmp> and <plaintext>, which show a `<` in them as "&lt;".
 *
 * The page is rewritten by splicing its own text at the scanner's positions,
 * so everything not named here is exactly as it was received. Both passes
 * are pure functions of what they are given, so a capture of the same
 * responses stores the same bytes, and exporting twice gives the same bytes.
 */

import { scanHtml } from "./scan.js"
import { pageLinks, withoutFragment } from "./links.js"
import { cssLinks, schemeOf } from "./css.js"
import { decode } from "./charset.js"
import { dataUrl, niUrl, parseNi, sha256Hex } from "./bytes.js"
import { orderOf } from "./crawl.js"
import { formatOf, looksSvg } from "./sniff.js"
import { svgOfDataUrl, withoutDoctype } from "./svg.js"

export const CSP =
  "default-src 'none'; img-src data:; media-src data:; style-src data: 'unsafe-inline'; font-src data:; frame-src 'none'; form-action 'none'; base-uri 'none'"

/**
 * What every frozen page starts with. The CSP is the very first element, so
 * nothing in the page is parsed before it applies.
 */
export const PREFIX =
  `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
  `<meta charset="utf-8">` +
  `<meta http-equiv="x-dns-prefetch-control" content="off">`

/** link rel words that fetch something nobody sees. */
const PREFETCH = ["preload", "prefetch", "modulepreload", "dns-prefetch", "preconnect", "prerender", "manifest"]
/**
 * Attributes removed wherever they are. `srcdoc` too: it is a whole page we
 * did not freeze, and though its frame would inherit our sandbox and CSP,
 * there is no reason to hand it either.
 */
const REMOVED = new Set(["integrity", "nonce", "ping", "srcset", "sizes", "imagesrcset", "imagesizes", "action", "formaction", "srcdoc"])
/** Attributes that hold a URL, where a javascript: one becomes "#". */
const URL_ATTRS = new Set(["href", "src", "xlink:href", "data", "poster", "background", "cite", "longdesc", "lowsrc", "dynsrc", "codebase", "usemap"])
/** Where a link may take a person: anything else in an <a> or <area> becomes "#". */
const NAVIGABLE = ["http:", "https:", "mailto:", "tel:"]
/**
 * Where a frame or an embed loads a document from. One written into the
 * page itself (data:, blob:) is removed: whether a browser carries our CSP
 * into such a document, opened outside the sandbox, is not ours to rely on.
 */
const EMBEDDED = { iframe: "src", frame: "src", object: "data", embed: "src" }
/** SVG animation, which can set an attribute — an <a>'s href — to any URL, after we rewrote it. */
const ANIMATION = new Set(["set", "animate", "animatemotion", "animatetransform", "animatecolor"])

const escapeAttr = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
const escapeText = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
/** A CSS string of `value`, quoted: nothing in it can end the url() it is in. */
const cssString = (value) => `"${String(value).replace(/[\\"]/g, "\\$&").replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`
/** A value the URL parser reads as javascript: or vbscript:. */
const scriptish = (value) => ["javascript", "vbscript"].includes(schemeOf(value))
/** A value naming no place on the web: a link to it goes nowhere, and a frame or embed of it loads nothing. */
const local = (value) => ["data", "blob", "about"].includes(schemeOf(value))
/**
 * The schemes a load position may be written back with: the web's, which
 * our CSP blocks, and `ni:`, which nothing fetches. Anything else a URL
 * resolves to is no resource of the web's, and its position keeps what the
 * rules above made of it.
 */
const WRITABLE = ["http:", "https:", "ni:"]
const utf8 = (text) => new TextEncoder().encode(text)

/** The RFC 1123 date a Memento-Datetime header carries. */
export const rfc1123 = (ms) => new Date(ms).toUTCString()

/**
 * Rewrite a stylesheet's URLs, each as a quoted string: nothing in it can
 * end the url() it is in.
 *
 * Both passes say what a load position becomes through `ref(url)`: the
 * value that shows the kept bytes of `url` (with its fragment, where that
 * means something), or null when nothing of it was kept, and then the
 * position keeps its absolute URL.
 */
export function freezeCss(css, base, ref) {
  const text = String(css ?? "")
  let out = ""
  let at = 0
  for (const link of cssLinks(text, base, { inline: true })) {
    if (link.bad) continue
    const next = link.inline ? frozenSvgUrl(link.raw, base) : ref(link.url) ?? link.url
    if (next == null) continue
    out += text.slice(at, link.start) + `url(${cssString(next)})`
    at = link.end
  }
  return out + text.slice(at)
}

/** What an SVG image that is shown as nothing becomes. */
const NO_SVG = "data:image/svg+xml;base64,"

/**
 * A data:image/svg+xml URL written into a page, frozen as an SVG image is:
 * a data: URL of its frozen self, or NO_SVG when it does not decode. Null
 * when `value` is not one, or freezing it changes nothing, and then it is
 * left as it was written.
 */
function frozenSvgUrl(value, base) {
  const svg = svgOfDataUrl(value)
  if (svg === undefined) return null
  if (svg === null) return value === NO_SVG ? null : NO_SVG
  const frozen = freezeSvg(svg, base)
  return frozen === svg ? null : dataUrl("image/svg+xml", utf8(frozen))
}

/**
 * An SVG image frozen. It loads nothing of its own: whatever it names keeps
 * its absolute URL. It is read as XML (capture/svg.js): without its DOCTYPE,
 * with the entities it declares written out.
 */
const freezeSvg = (text, base) => freezeMarkup(withoutDoctype(text), base, () => null, "", { xml: true })

/** Every `http-equiv` not already renamed, renamed. */
const neutral = (s) => s.replace(/(?<!data-x-)http-equiv/gi, "data-x-http-equiv")

/** An XML name without its prefix: `s:script` is a script wherever `s` is bound to a namespace that has one. */
const localName = (name) => name.slice(name.lastIndexOf(":") + 1)

/**
 * The pass both freezes run: `text` with everything that runs or reaches
 * out removed, and every load position rewritten through `ref`. The output
 * is the doctype (if any), then `head`, then the rest.
 *
 * With `xml`, `text` is an SVG image, which an XML parser reads: elements
 * and attributes are known by their local names, whatever prefix they are
 * written with, every tag that closes itself is a whole element, and a
 * doctype is removed rather than moved — it has no place before an XML
 * declaration, and none is needed.
 */
function freezeMarkup(text, base, ref, head, { xml = false } = {}) {
  const tokens = scanHtml(text)
  const value = (url) => ref(url) ?? url
  const css = (cssText) => freezeCss(cssText, base, ref)

  const byToken = new Map()
  for (const link of pageLinks(tokens, base)) {
    if (!byToken.has(link.token)) byToken.set(link.token, [])
    byToken.get(link.token).push(link)
  }

  const edits = [] // { start, end, text }, applied last
  let doctype = null
  let seenTag = false
  let skipTo = -1 // tokens up to this index were removed with their element
  let styleOpen = false // a foreign <style>, whose children are its CSS

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (i <= skipTo) continue
    const source = text.slice(token.start, token.end)

    if (token.type === "doctype" && (xml || (!seenTag && !doctype))) {
      if (!xml) doctype = token.text
      edits.push({ start: token.start, end: token.end, text: "" })
      continue
    }
    if (token.type === "comment") {
      if (source.includes("<", 1)) edits.push({ start: token.start, end: token.end, text: source[0] + source.slice(1).replace(/</g, "&lt;") })
      continue
    }
    if (token.type === "end") {
      if (token.name === "style") styleOpen = false
      // An end tag's attributes mean nothing, and a value could hold a "<".
      if (source.includes("<", 1)) edits.push({ start: token.start, end: token.end, text: `</${token.name.replace(/</g, "&lt;")}>` })
      continue
    }
    if (token.type === "text") {
      const isCss = token.of === "style" || (styleOpen && (!token.of || token.of === "cdata"))
      let out
      // A CDATA section becomes text: the same characters, in foreign content, and no markup in any reading.
      if (token.of === "cdata") out = escapeText(isCss ? css(token.text) : token.text)
      // In CSS a "<" is written as an escape, which a CSS string reads the same.
      else if (token.of === "style") out = css(token.text).replace(/</g, "\\3c ")
      // Raw text and RCDATA as written, every "<" as a reference.
      else if (token.of) out = source.replace(/</g, "&lt;")
      else if (isCss) out = escapeText(css(token.text))
      else continue
      if (out !== source) edits.push({ start: token.start, end: token.end, text: out })
      continue
    }
    if (token.type !== "start") continue
    seenTag = true
    const name = xml ? localName(token.name) : token.name

    if (name === "script" || name === "noscript") {
      // In svg and math, and anywhere in XML, a tag that closes itself is
      // the whole element, and everything after it is the page's: only the
      // tag goes. Were a browser to read it as an HTML script instead, what
      // follows is still frozen as markup, and there is no tag left to run it.
      if (token.selfClosing && (xml || token.ns !== "html")) {
        edits.push({ start: token.start, end: token.end, text: "" })
        continue
      }
      // The element and everything in it, to its end tag or the end of the page.
      let j = i + 1
      while (j < tokens.length && !(tokens[j].type === "end" && tokens[j].name === token.name)) j++
      const end = j < tokens.length ? tokens[j].end : text.length
      edits.push({ start: token.start, end, text: "" })
      skipTo = j
      continue
    }
    const has = (attrName) => token.attrs.some((a) => a.name === attrName)
    const valueOf = (attrName) => token.attrs.find((a) => a.name === attrName)?.value ?? ""
    const rels = valueOf("rel").toLowerCase().split(/\s+/)
    const links = byToken.get(i) ?? []
    // An icon that was not kept is removed, extra ones included: a browser
    // fetches a favicon from outside the page, where our CSP may not reach.
    const icon = name === "link" && links.find((l) => l.kind === "image" && l.attr === "href")
    if (
      name === "base" ||
      (name === "meta" && (has("http-equiv") || has("charset"))) ||
      (name === "link" && rels.some((r) => PREFETCH.includes(r))) ||
      (icon && (icon.policy || icon.bad || ref(icon.url) == null))
    ) {
      edits.push({ start: token.start, end: token.end, text: "" })
      continue
    }
    if (name === "style" && token.ns !== "html" && !token.selfClosing) styleOpen = true

    // What becomes of each attribute: a new value, or null to remove it.
    const changes = new Map()
    const inserts = []
    for (const a of token.attrs) {
      const key = xml ? localName(a.name) : a.name
      if (a.name.startsWith("on") || REMOVED.has(key) || (name === "html" && key === "manifest")) changes.set(a.name, null)
      else if ((URL_ATTRS.has(a.name) || URL_ATTRS.has(key)) && scriptish(a.value)) changes.set(a.name, "#")
      // A link to data:, blob: or about: is no page of the web's, and a
      // popup escapes the sandbox: it goes nowhere instead. Any MathML
      // element with an href is a link.
      else if ((name === "a" || name === "area" || token.ns === "math") && (key === "href" || key === "xlink:href") && local(a.value)) changes.set(a.name, "#")
      else if (EMBEDDED[name] === key && local(a.value)) changes.set(a.name, null)
      // An SVG image written into the page is frozen as a kept one is.
      else if (URL_ATTRS.has(a.name) || URL_ATTRS.has(key)) {
        const svg = frozenSvgUrl(a.value, base)
        if (svg != null) changes.set(a.name, svg)
      }
    }
    if (ANIMATION.has(name) && ["href", "xlink:href"].includes(valueOf("attributename").trim())) {
      for (const attrName of ["attributename", "to", "from", "by", "values"]) changes.set(attrName, null)
    }
    // The lazy-load attributes go from every image: whatever it shows is in
    // src now, and a capture of the export must not find them and fetch.
    if (name === "img") {
      changes.set("data-src", null)
      changes.set("data-lazy-src", null)
    }
    for (const link of links) {
      if (link.bad || link.css) continue
      if (link.nav) {
        const target = new URL(link.url)
        if (!NAVIGABLE.includes(target.protocol)) {
          changes.set(link.attr, "#")
          continue
        }
        changes.set(link.attr, link.url)
        // Left as it is when it already says so, so a frozen page frozen
        // again comes out the same.
        if (valueOf("target") !== "_blank" || valueOf("rel") !== "noopener noreferrer") {
          if (!changes.has("target")) inserts.push(`target="_blank" rel="noopener noreferrer"`)
          changes.set("target", null)
          changes.set("rel", null)
        }
        continue
      }
      // Anything else is written back only as a URL of the web's or as kept
      // bytes: a value the rules above made "#", or removed, stays so.
      if (ref(link.url) == null && !WRITABLE.includes(new URL(link.url).protocol)) continue
      if (link.policy) {
        if (link.attr !== "srcset") changes.set(link.attr, link.url)
        continue
      }
      if (link.place === "src") {
        if (has("src")) changes.set("src", value(link.url))
        else inserts.push(`src="${escapeAttr(value(link.url))}"`)
      } else if (link.place === "srcset") {
        // A picture's <source> whose image was not kept goes out of the
        // running, so the <img> after it shows instead of a broken load.
        changes.set("srcset", ref(link.url) != null ? value(link.url) : null)
      } else {
        changes.set(link.attr, value(link.url))
      }
    }
    const style = token.attrs.find((a) => a.name === "style")
    if (style && !changes.has("style")) changes.set("style", css(style.value))

    for (const a of token.attrs) {
      if (changes.has(a.name)) {
        const next = changes.get(a.name)
        edits.push({ start: a.start, end: a.end, text: next == null ? "" : `${a.name}="${escapeAttr(next)}"` })
      } else if (text.slice(a.vStart, a.vEnd).includes("<")) {
        // As written, references and all, with every "<" as one.
        edits.push({ start: a.vStart, end: a.vEnd, text: text.slice(a.vStart, a.vEnd).replace(/</g, "&lt;") })
      }
    }
    // A browser ignores every repeat of an attribute, so removing them all
    // changes nothing it shows — and leaves none to take the first one's
    // place when that is removed.
    for (const a of token.dups) edits.push({ start: a.start, end: a.end, text: "" })
    if (inserts.length) edits.push({ start: token.nameEnd, end: token.nameEnd, text: ` ${inserts.join(" ")}` })
  }

  edits.sort((a, b) => a.start - b.start || a.end - b.end)
  // A tag the input ends inside is dropped, as a browser drops it: past the
  // last token there is only that.
  const end = tokens.length ? tokens[tokens.length - 1].end : 0
  let body = ""
  let at = 0
  for (const edit of edits) {
    if (edit.start < at) continue
    body += text.slice(at, edit.start) + edit.text
    at = edit.end
  }
  body += text.slice(at, Math.max(at, end))
  return (doctype ? neutral(doctype) : "") + head + neutral(body)
}

const isStylesheet = (mimeType) => /^text\/css\b/i.test(String(mimeType ?? ""))
const isSvg = (mimeType) => /^image\/svg\+xml\b/i.test(String(mimeType ?? ""))

/**
 * The page as a snapshot stores it, frozen at capture.
 *
 *   text        the page as received, decoded
 *   base        what its relative URLs resolve against
 *   resources   the crawl's table: every URL found, with its outcome
 *   blobs       the bytes of each kept resource, by the sha256 of what was
 *               received (and of a frozen page, what it already names)
 *
 * Returns `{ html, blobs, stored }`: the frozen page as UTF-8 bytes; the
 * bytes it shows, by their own sha256 — images and fonts exactly as
 * received, stylesheets and SVG images frozen in turn; and, for each kept
 * URL, the blob that holds it. Every `ni:` URI in the page or in a stored
 * sheet names one of those blobs.
 *
 * Each kept stylesheet is frozen once, after the kept sheets it imports, in
 * the order of the crawl's keys, so the same table always gives the same
 * bytes. An @import back into a sheet still being frozen (a cycle) keeps its
 * absolute URL.
 */
export async function freezePage({ text, base, resources = {}, blobs = {} }) {
  const kept = Object.entries(resources)
    .filter(([, r]) => r?.outcome === "ok" && blobs[r.sha256] instanceof Uint8Array)
    .sort(([, a], [, b]) => compareOrder(orderOf(a.order ?? ""), orderOf(b.order ?? "")))
  const keptAt = new Map(kept)
  const stored = {}
  const storedAs = {}
  const refs = new Map()
  const keep = (url, bytes, sha256, mimeType) => {
    stored[sha256] = bytes
    storedAs[url] = sha256
    refs.set(url, niUrl(sha256, mimeType))
  }
  const ref = (url) => {
    const key = withoutFragment(url)
    const named = refs.get(key)
    // A page already frozen names what it shows by hash: what it names among
    // `blobs` is kept as it is, so freezing a frozen page changes nothing.
    if (named == null) return blobs[parseNi(key)?.sha256] instanceof Uint8Array ? url : null
    // A stylesheet's fragment means nothing; an image's names a part of it.
    return keptAt.get(key)?.kind === "style" ? named : named + url.slice(key.length)
  }

  for (const [url, r] of kept) {
    if (r.kind === "style") continue
    if (isSvg(r.mimeType) || (!formatOf(blobs[r.sha256]) && looksSvg(blobs[r.sha256]))) {
      // An SVG image can carry script and event handlers, which no browser
      // runs in an <img> — but the snapshot should not hold them at all.
      // Whatever type it was served as: a server's word does not change
      // what the bytes are, and an ni: URI can name them as SVG.
      const frozen = utf8(freezeSvg(decode(blobs[r.sha256], "utf-8"), r.finalUrl ?? url))
      keep(url, frozen, await sha256Hex(frozen), r.mimeType)
    } else {
      keep(url, blobs[r.sha256], r.sha256, r.mimeType)
    }
  }

  const isKeptSheet = (url) => keptAt.get(url)?.kind === "style"
  async function sheet(url, above) {
    if (refs.has(url)) return
    const r = keptAt.get(url)
    const sheetBase = r.finalUrl ?? url
    const css = decode(blobs[r.sha256], r.charset ?? "utf-8")
    const path = new Set([...above, url])
    for (const link of cssLinks(css, sheetBase)) {
      if (link.bad) continue
      const key = withoutFragment(link.url)
      if (isKeptSheet(key) && !path.has(key)) await sheet(key, path)
    }
    // Re-encoded as UTF-8; the type says so when it is shown, which outranks
    // the sheet's own @charset rule, still naming what it was fetched in.
    const frozen = utf8(freezeCss(css, sheetBase, (u) => (path.has(withoutFragment(u)) ? null : ref(u))))
    keep(url, frozen, await sha256Hex(frozen), "text/css")
  }
  for (const [url, r] of kept) if (r.kind === "style") await sheet(url, new Set())

  const html = utf8(freezeMarkup(String(text ?? ""), base, ref, PREFIX))
  return { html, blobs: stored, stored: storedAs }
}

function compareOrder(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1
    if (b[i] === undefined) return 1
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/**
 * A stored snapshot as one self-contained, inert string: what the view
 * shows and Export saves. The stored page is frozen again — whatever a
 * collaborator wrote into it — and every `ni:` URI that names one of its
 * blobs becomes a data: URL of those bytes; a stylesheet's own URIs too,
 * recursively. Anything else keeps the absolute URL it has, which the CSP
 * blocks.
 *
 * `{export: true}` adds the Memento tags an archived page carries — when it
 * was captured, from where, and our marker (the stored page's sha256), by
 * which a capture of an exported file is recognised.
 */
export function render(doc, { export: exporting = false } = {}) {
  const text = doc?.html instanceof Uint8Array ? decode(doc.html, "utf-8") : ""
  const base = doc?.base ?? doc?.capture?.finalUrl ?? doc?.source ?? "about:blank"
  const blobs = doc?.blobs ?? {}
  const memo = new Map()
  const ref = (url, above = new Set()) => {
    const key = withoutFragment(url)
    const named = parseNi(key)
    const bytes = named && blobs[named.sha256]
    if (!(bytes instanceof Uint8Array)) return null
    if (!isStylesheet(named.mimeType)) {
      // Whatever an ni: URI names as SVG is shown frozen as SVG: a
      // collaborator can name any blob so.
      if (!memo.has(key)) memo.set(key, dataUrl(named.mimeType, isSvg(named.mimeType) ? utf8(freezeSvg(decode(bytes, "utf-8"), base)) : bytes))
      return memo.get(key) + url.slice(key.length)
    }
    // A sheet that imports itself, however indirectly, is left as it is.
    if (above.has(named.sha256)) return null
    if (!memo.has(key)) {
      const path = new Set([...above, named.sha256])
      memo.set(key, dataUrl("text/css;charset=utf-8", utf8(freezeCss(decode(bytes, "utf-8"), base, (u) => ref(u, path)))))
    }
    return memo.get(key)
  }
  let head = PREFIX
  if (exporting) {
    head +=
      `<meta http-equiv="Memento-Datetime" content="${rfc1123(doc.capture?.at ?? 0)}">` +
      `<link rel="original" href="${escapeAttr(doc.source ?? "")}">` +
      `<meta name="patchwork-snapshot" content="${escapeAttr(doc.capture?.sha256 ?? "")}">`
  }
  return freezeMarkup(text, base, (url) => ref(url), head)
}
