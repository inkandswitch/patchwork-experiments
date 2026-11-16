/**
 * A kept page as one inert HTML string: what the snapshot view shows, and
 * what Export saves.
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
 *      on a page applies.
 *   3. Every `http-equiv` in the output is renamed `data-x-http-equiv`, as
 *      text, after everything else. A refresh is navigation, which CSP does
 *      not govern, and attribute names are never entity-decoded, so no
 *      scanning mistake can leave a working one. (The cost: page text that
 *      contains the literal word shows it altered.)
 *   4. Scripts, event handlers, <base>, preloads and the rest are removed,
 *      and every load position is rewritten: to a data: URL of the kept
 *      bytes when the resource was kept, else to its absolute URL, which (2)
 *      blocks. A relative URL left alone would resolve against the page
 *      showing the frame — Patchwork's own origin.
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
 * so everything not named here is exactly as it was received. `freeze` is a
 * pure function of the document, so exporting twice gives the same bytes.
 */

import { scanHtml } from "./scan.js"
import { pageLinks, documentBase, withoutFragment } from "./links.js"
import { cssLinks } from "./css.js"
import { decode } from "./charset.js"
import { dataUrl } from "./bytes.js"

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
/** A value the URL parser would read as javascript: (it drops tabs and newlines anywhere, and leading controls). */
const scriptish = (value) => /^(javascript|vbscript):/i.test(String(value).replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+/, ""))
/** A value naming no place on the web: a link to it goes nowhere, and a frame or embed of it loads nothing. */
const local = (value) => /^(data|blob|about):/i.test(String(value).replace(/[\t\n\r]/g, "").trim())
const utf8 = (text) => new TextEncoder().encode(text)

/**
 * Rewrite a stylesheet's URLs: kept resources become data: URLs (a kept
 * @import its own frozen sheet, recursively), everything else its absolute
 * URL, always as a quoted string. `seen` holds the sheets being frozen above
 * this one, so an import cycle ends in an absolute URL instead of recursing
 * forever.
 */
export function freezeCss(css, base, resources, blobs, seen = new Set(), memo = new Map()) {
  const text = String(css ?? "")
  let out = ""
  let at = 0
  for (const link of cssLinks(text, base)) {
    if (link.bad) continue
    out += text.slice(at, link.start) + `url(${cssString(loadValue(link.url, resources, blobs, seen, memo))})`
    at = link.end
  }
  return out + text.slice(at)
}

/** Was this URL kept, bytes and all? */
const isKept = (url, resources, blobs) => {
  const kept = resources?.[withoutFragment(url)]
  return kept?.outcome === "ok" && !!blobs?.[kept.sha256]
}

/** What a load position becomes: a data: URL of the kept bytes and the URL's fragment, or the absolute URL. */
function loadValue(url, resources, blobs, seen, memo) {
  const key = withoutFragment(url)
  const fragment = url.slice(key.length)
  const kept = resources?.[key]
  if (!isKept(url, resources, blobs) || (kept.kind === "style" && seen.has(key))) return url
  const bytes = blobs[kept.sha256]
  if (kept.kind === "style") {
    if (!memo.has(key)) {
      const sheet = freezeCss(decode(bytes, kept.charset ?? "utf-8"), kept.finalUrl ?? key, resources, blobs, new Set([...seen, key]), memo)
      // Re-encoded as UTF-8, and labelled so: a charset in the data: URL
      // outranks the sheet's own @charset rule, which still names the
      // encoding it was fetched in.
      memo.set(key, dataUrl("text/css;charset=utf-8", utf8(sheet)))
    }
    return memo.get(key)
  }
  const memoKey = `blob:${kept.sha256}:${kept.mimeType}`
  if (!memo.has(memoKey)) memo.set(memoKey, dataUrl(kept.mimeType, bytes))
  return memo.get(memoKey) + fragment
}

/** The RFC 1123 date a Memento-Datetime header carries. */
export const rfc1123 = (ms) => new Date(ms).toUTCString()

/**
 * The page, frozen. `{export: true}` adds the Memento tags an archived page
 * carries — when it was captured, from where, and our marker (the page's
 * sha256), by which a capture of an exported file is recognised.
 */
export function freeze(doc, { export: exporting = false } = {}) {
  const text = decode(doc.html ?? new Uint8Array(0), doc.charset ?? "utf-8")
  const tokens = scanHtml(text)
  const pageUrl = doc.capture?.finalUrl ?? doc.source ?? "about:blank"
  const base = doc.base ?? documentBase(tokens, pageUrl)
  const resources = doc.resources ?? {}
  const blobs = doc.blobs ?? {}
  const memo = new Map()
  const value = (url) => loadValue(url, resources, blobs, new Set(), memo)
  const css = (cssText) => freezeCss(cssText, base, resources, blobs, new Set(), memo)

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

    if (token.type === "doctype" && !seenTag && !doctype) {
      doctype = token.text
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
    const name = token.name

    if (name === "script" || name === "noscript") {
      // The element and everything in it, to its end tag or the end of the page.
      let j = i + 1
      while (j < tokens.length && !(tokens[j].type === "end" && tokens[j].name === name)) j++
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
      (icon && (icon.policy || icon.bad || !isKept(icon.url, resources, blobs)))
    ) {
      edits.push({ start: token.start, end: token.end, text: "" })
      continue
    }
    if (name === "style" && token.ns !== "html" && !token.selfClosing) styleOpen = true

    // What becomes of each attribute: a new value, or null to remove it.
    const changes = new Map()
    const inserts = []
    for (const a of token.attrs) {
      if (a.name.startsWith("on") || REMOVED.has(a.name) || (name === "html" && a.name === "manifest")) changes.set(a.name, null)
      else if (URL_ATTRS.has(a.name) && scriptish(a.value)) changes.set(a.name, "#")
      // A link to data:, blob: or about: is no page of the web's, and a
      // popup escapes the sandbox: it goes nowhere instead.
      else if ((name === "a" || name === "area") && (a.name === "href" || a.name === "xlink:href") && local(a.value)) changes.set(a.name, "#")
      else if (EMBEDDED[name] === a.name && local(a.value)) changes.set(a.name, null)
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
        if (!changes.has("target")) inserts.push(`target="_blank" rel="noopener noreferrer"`)
        changes.set("target", null)
        changes.set("rel", null)
        continue
      }
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
        changes.set("srcset", isKept(link.url, resources, blobs) ? value(link.url) : null)
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

  const neutral = (s) => s.replace(/http-equiv/gi, "data-x-http-equiv")
  let head = PREFIX
  if (exporting) {
    head +=
      `<meta http-equiv="Memento-Datetime" content="${rfc1123(doc.capture?.at ?? 0)}">` +
      `<link rel="original" href="${escapeAttr(doc.source ?? "")}">` +
      `<meta name="patchwork-snapshot" content="${escapeAttr(doc.capture?.sha256 ?? "")}">`
  }
  return (doctype ? neutral(doctype) : "") + head + neutral(body)
}
