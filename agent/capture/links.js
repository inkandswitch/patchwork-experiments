/**
 * Where a page loads things from: one table, read by both the crawl (what to
 * fetch) and the freeze (what to rewrite), so the two can never disagree
 * about what a load position is.
 *
 * Every row says which element and attribute hold a URL, what kind of
 * resource it loads, and whether a capture fetches it. `policy` kinds are
 * recorded and never fetched: a capture keeps what a page looks like, not
 * what it runs (scripts), what it embeds from elsewhere (frames, objects), or
 * what would blow any budget (video and audio).
 *
 * Images have one more rule. A page that lazy-loads leaves `src` empty or a
 * data: placeholder and puts the real URL in `data-src` or `data-lazy-src`,
 * and a responsive one offers a `srcset` of sizes; exactly one image is
 * fetched for each <img> (and each <source> of a <picture>), chosen by
 * `chooseCandidate`, and the other candidates are recorded as policy.
 *
 * A link: `{ kind, url, raw, token, attr, bad?, policy?, nav?, place?, css? }`
 *
 *   kind    style | font | image | script | frame | media | object | navigation
 *   url     absolute, fragment kept; null when `bad` (it does not parse)
 *   token   the index of the token it is written in
 *   attr    the attribute, or null for a <style> element's text
 *   place   "src" when the chosen image of an <img> lives somewhere else
 *           (data-src, srcset) and must be written into src; "srcset" for a
 *           picture <source>'s chosen candidate
 *   css     `{start, end}` within the CSS text, for links in a style
 *           attribute or a <style> element
 */

import { cssLinks, notALink, resolveLink } from "./css.js"
import { attr } from "./scan.js"

export const TABLE = [
  { tags: ["link"], attr: "href", kind: "style", rel: "stylesheet" },
  { tags: ["link"], attr: "href", kind: "image", firstRel: ["icon", "apple-touch-icon", "mask-icon"] },
  { tags: ["input"], attr: "src", kind: "image", type: "image" },
  { tags: ["video"], attr: "poster", kind: "image" },
  { tags: ["body", "table", "td", "th"], attr: "background", kind: "image" },
  { tags: ["image", "feimage", "use"], attr: "href", kind: "image" },
  { tags: ["image", "feimage", "use"], attr: "xlink:href", kind: "image" },
  { tags: ["script"], attr: "src", kind: "script", policy: true },
  { tags: ["iframe", "frame"], attr: "src", kind: "frame", policy: true },
  { tags: ["video", "audio", "track", "source"], attr: "src", kind: "media", policy: true },
  { tags: ["object"], attr: "data", kind: "object", policy: true },
  { tags: ["embed"], attr: "src", kind: "object", policy: true },
  { tags: ["a", "area"], attr: "href", kind: "navigation" },
  // An svg <a> navigates by xlink:href as well as href.
  { tags: ["a"], attr: "xlink:href", kind: "navigation" },
]

/** The kinds a capture fetches; every other kind is policy. */
export const FETCHED_KINDS = ["style", "font", "image"]

/** A URL without its fragment: what is fetched, and the key a resource is kept under. */
export function withoutFragment(url) {
  const hash = url.indexOf("#")
  return hash < 0 ? url : url.slice(0, hash)
}

/**
 * The URL relative links resolve against: the first <base href> (resolved
 * against the page's own URL), or the page's URL. A base that is not http(s)
 * is ignored, as a browser ignores a data: or javascript: base.
 */
export function documentBase(tokens, pageUrl) {
  const base = tokens.find((t) => t.type === "start" && t.name === "base" && attr(t, "href"))
  if (!base) return pageUrl
  try {
    const url = new URL(attr(base, "href").value.trim(), pageUrl)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : pageUrl
  } catch {
    return pageUrl
  }
}

const relWords = (token) => String(attr(token, "rel")?.value ?? "").toLowerCase().split(/[\t\n\f\r ]+/).filter(Boolean)

/**
 * A srcset's candidates, in order: `{raw, x?, w?}`. A candidate with no
 * descriptor is 1x; a height descriptor is ignored.
 */
export function parseSrcset(value) {
  const text = String(value ?? "")
  const out = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++
    if (i >= text.length) break
    let j = i
    while (j < text.length && !/\s/.test(text[j])) j++
    let raw = text.slice(i, j)
    const descriptors = []
    if (raw.endsWith(",")) {
      raw = raw.replace(/,+$/, "")
    } else {
      let depth = 0
      let current = ""
      while (j < text.length) {
        const c = text[j]
        if (c === "(") depth++
        if (c === ")") depth = Math.max(0, depth - 1)
        if (c === "," && depth === 0) break
        if (/\s/.test(c) && depth === 0) {
          if (current) descriptors.push(current)
          current = ""
        } else current += c
        j++
      }
      if (current) descriptors.push(current)
    }
    const candidate = { raw }
    for (const d of descriptors) {
      const x = d.match(/^(\d+(?:\.\d+)?|\.\d+)x$/i)
      const w = d.match(/^(\d+)w$/i)
      if (x) candidate.x = Number(x[1])
      else if (w) candidate.w = Number(w[1])
    }
    if (raw) out.push(candidate)
    i = j + 1
  }
  return out
}

/** The largest density a capture takes, and the widest image. */
export const MAX_DENSITY = 2
export const MAX_WIDTH = 1600

/**
 * The index of the one srcset candidate a capture fetches: the largest
 * density at most 2x (no descriptor is 1x); else the largest width at most
 * 1600w; else the first. Ties go to the earlier candidate.
 */
export function chooseCandidate(candidates) {
  let best = -1
  candidates.forEach((c, i) => {
    if (c.w != null) return
    const d = c.x ?? 1
    if (d <= MAX_DENSITY && (best < 0 || d > (candidates[best].x ?? 1))) best = i
  })
  if (best >= 0) return best
  candidates.forEach((c, i) => {
    if (c.w != null && c.w <= MAX_WIDTH && (best < 0 || c.w > candidates[best].w)) best = i
  })
  return best >= 0 ? best : 0
}

/** One link for `raw` in a token's attribute, or null when the value is never a link. */
function linkOf(raw, base, fields) {
  const resolved = resolveLink(raw, base)
  if (!resolved) return null
  return resolved.bad ? { ...fields, raw, url: null, bad: true } : { ...fields, raw, url: resolved.url }
}

/** What an <img> or a picture's <source> loads: the one image fetched and the candidates passed over. */
function imageLinks(token, index, base, inPicture) {
  const out = []
  const srcset = attr(token, "srcset")
  const candidates = srcset ? parseSrcset(srcset.value) : []
  let chosen = null // { attr, raw, place, candidate }

  if (token.name === "img") {
    for (const name of ["src", "data-src", "data-lazy-src"]) {
      const a = attr(token, name)
      if (a && !notALink(a.value)) {
        chosen = { attr: name, raw: a.value, place: name === "src" ? null : "src" }
        break
      }
    }
  } else if (!inPicture) {
    return out
  }
  if (!chosen && candidates.length) {
    const at = chooseCandidate(candidates)
    chosen = { attr: "srcset", raw: candidates[at].raw, place: token.name === "img" ? "src" : "srcset", candidate: at }
  }
  if (chosen) {
    const link = linkOf(chosen.raw, base, { kind: "image", token: index, attr: chosen.attr })
    if (link) out.push(chosen.place ? { ...link, place: chosen.place } : link)
  }
  candidates.forEach((c, i) => {
    if (chosen?.candidate === i) return
    const link = linkOf(c.raw, base, { kind: "image", token: index, attr: "srcset", policy: true })
    if (link) out.push(link)
  })
  return out
}

/** Does a TABLE row apply to this token? */
function applies(row, token) {
  if (!row.tags.includes(token.name)) return false
  if (row.rel) return relWords(token).includes(row.rel)
  if (row.firstRel) return row.firstRel.includes(relWords(token)[0]) && !relWords(token).includes("stylesheet")
  if (row.type) return String(attr(token, "type")?.value ?? "").trim().toLowerCase() === row.type
  return true
}

/**
 * Every link a page has, in document order: each tag's attributes by the
 * TABLE (row order within a tag), its image choice, and the URLs in its style
 * attribute and in <style> elements.
 */
export function pageLinks(tokens, base) {
  const links = []
  let pictures = 0
  let styleOpen = false // a foreign <style>, whose children are its CSS
  let iconSeen = false
  tokens.forEach((token, index) => {
    if (token.type === "end") {
      if (token.name === "picture") pictures = Math.max(0, pictures - 1)
      if (token.name === "style") styleOpen = false
      return
    }
    if (token.type === "text") {
      // An HTML <style>'s raw text, or a foreign one's text and CDATA.
      const isCss = token.of === "style" || (styleOpen && (!token.of || token.of === "cdata"))
      if (isCss) for (const l of cssLinks(token.text, base)) links.push(cssLink(l, index, null))
      return
    }
    if (token.type !== "start") return
    if (token.name === "picture" && !token.selfClosing) pictures++
    if (token.name === "style") styleOpen = token.ns !== "html" && !token.selfClosing

    for (const row of TABLE) {
      if (!applies(row, token)) continue
      const a = attr(token, row.attr)
      if (!a) continue
      const fields = { kind: row.kind, token: index, attr: row.attr }
      if (row.policy) fields.policy = true
      if (row.kind === "navigation") fields.nav = true
      if (row.firstRel) {
        // Only the first icon is fetched; a page lists a dozen sizes of it.
        if (iconSeen) fields.policy = true
      }
      const link = linkOf(a.value, base, fields)
      if (!link) continue
      if (row.firstRel && !link.bad) iconSeen = true
      links.push(link)
    }
    if (token.name === "img" || token.name === "source") links.push(...imageLinks(token, index, base, pictures > 0))
    const style = attr(token, "style")
    if (style) for (const l of cssLinks(style.value, base)) links.push(cssLink(l, index, "style"))
  })
  return links
}

function cssLink(l, token, attrName) {
  const out = { kind: l.kind, url: l.url, raw: l.raw, token, attr: attrName, css: { start: l.start, end: l.end } }
  if (l.bad) out.bad = true
  return out
}
