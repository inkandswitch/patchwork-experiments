/**
 * The scanner and the link table, against the rules written out by hand.
 *
 * Every load position of the table × every way of writing the attribute ×
 * every shape of URL × with and without a <base>: each gives exactly the
 * (kind, absolute URL) the rule says, `bad-url`, or nothing. Then the cases
 * where markup is not markup (raw text, RCDATA, comments, CDATA, foreign
 * content), and the srcset choice over every short srcset.
 */
import { describe, it, expect } from "vitest"
import { scanHtml, decodeEntities } from "./scan.js"
import { pageLinks, documentBase, parseSrcset, chooseCandidate } from "./links.js"

const PAGE = "https://site.test/dir/page.html"
const BASE_TAG = `<base href="https://cdn.test/b/">`

/** What each URL form resolves to: [without <base>, with <base>]; null is "never a link", "bad" is bad-url. */
const URLS = {
  absolute: ["https://other.test/x.png", "https://other.test/x.png", "https://other.test/x.png"],
  relative: ["x.png", "https://site.test/dir/x.png", "https://cdn.test/b/x.png"],
  parent: ["../x.png", "https://site.test/x.png", "https://cdn.test/x.png"],
  "scheme-relative": ["//host.test/x.png", "https://host.test/x.png", "https://host.test/x.png"],
  root: ["/root.png", "https://site.test/root.png", "https://cdn.test/root.png"],
  query: ["x.png?a=1&b=2", "https://site.test/dir/x.png?a=1&b=2", "https://cdn.test/b/x.png?a=1&b=2"],
  data: ["data:image/png;base64,AA", null, null],
  javascript: [" JavaScript:alert(1)", null, null],
  fragment: ["#frag", null, null],
  empty: ["", null, null],
  bad: ["http://[", "bad", "bad"],
}

/** Each load position: markup with the attribute at A, the attribute's name, and the kind it loads. */
const ROWS = [
  ["link stylesheet", (a) => `<link rel="stylesheet" ${a}>`, "href", "style"],
  ["link icon", (a) => `<link rel="icon" ${a}>`, "href", "image"],
  ["link apple-touch-icon", (a) => `<link rel="apple-touch-icon" ${a}>`, "href", "image"],
  ["link mask-icon", (a) => `<link rel="mask-icon" ${a}>`, "href", "image"],
  ["img src", (a) => `<img ${a}>`, "src", "image"],
  ["picture source srcset", (a) => `<picture><source ${a}></picture>`, "srcset", "image"],
  ["input type=image", (a) => `<input type="image" ${a}>`, "src", "image"],
  ["video poster", (a) => `<video ${a}></video>`, "poster", "image"],
  ["body background", (a) => `<body ${a}>`, "background", "image"],
  ["table background", (a) => `<table ${a}></table>`, "background", "image"],
  ["td background", (a) => `<table><tr><td ${a}></td></tr></table>`, "background", "image"],
  ["th background", (a) => `<table><tr><th ${a}></th></tr></table>`, "background", "image"],
  ["svg image href", (a) => `<svg><image ${a} /></svg>`, "href", "image"],
  ["svg image xlink:href", (a) => `<svg><image ${a} /></svg>`, "xlink:href", "image"],
  ["feImage href", (a) => `<svg><filter><feImage ${a} /></filter></svg>`, "href", "image"],
  ["use href", (a) => `<svg><use ${a} /></svg>`, "href", "image"],
  ["use xlink:href", (a) => `<svg><use ${a} /></svg>`, "xlink:href", "image"],
  ["script src", (a) => `<script ${a}></script>`, "src", "script"],
  ["iframe src", (a) => `<iframe ${a}></iframe>`, "src", "frame"],
  ["frame src", (a) => `<frameset><frame ${a}></frameset>`, "src", "frame"],
  ["video src", (a) => `<video ${a}></video>`, "src", "media"],
  ["audio src", (a) => `<audio ${a}></audio>`, "src", "media"],
  ["source src in media", (a) => `<video><source ${a}></video>`, "src", "media"],
  ["track src", (a) => `<video><track ${a}></video>`, "src", "media"],
  ["object data", (a) => `<object ${a}></object>`, "data", "object"],
  ["embed src", (a) => `<embed ${a}>`, "src", "object"],
  ["a href", (a) => `<a ${a}>x</a>`, "href", "navigation"],
  ["area href", (a) => `<map><area ${a}></map>`, "href", "navigation"],
  ["svg a xlink:href", (a) => `<svg><a ${a}>x</a></svg>`, "xlink:href", "navigation"],
]

/** Ways to write attribute `name` with value `v`; null where the form cannot hold the value. */
const FORMS = {
  double: (name, v) => `${name}="${v}"`,
  single: (name, v) => `${name}='${v}'`,
  unquoted: (name, v) => (v && !/[\s"'=<>`]/.test(v) ? `${name}=${v}` : null),
  uppercase: (name, v) => `${name.toUpperCase()}="${v}"`,
  "&amp;": (name, v) => `${name}="${v.replace(/&/g, "&amp;")}"`,
}

const linksOf = (html) => {
  const tokens = scanHtml(html)
  return pageLinks(tokens, documentBase(tokens, PAGE)).map((l) => (l.bad ? [l.kind, "bad-url"] : [l.kind, l.url]))
}

describe("every load position × value form × URL form × <base>", () => {
  const cases = []
  for (const [row, markup, name, kind] of ROWS) {
    for (const [formName, form] of Object.entries(FORMS)) {
      for (const [urlName, [value, plain, based]] of Object.entries(URLS)) {
        for (const withBase of [false, true]) {
          const written = form(name, value)
          if (written == null) continue
          const expected = withBase ? based : plain
          cases.push([`${row} · ${formName} · ${urlName} · ${withBase ? "base" : "no base"}`, (withBase ? BASE_TAG : "") + markup(written), expected == null ? [] : [[kind, expected === "bad" ? "bad-url" : expected]]])
        }
      }
    }
    // Valueless: an attribute with no value is the empty string, never a link.
    cases.push([`${row} · valueless`, markup(name), []])
  }

  it("covers the product", () => {
    expect(cases.length).toBeGreaterThan(1500)
  })

  it.each(cases)("%s", (_, html, expected) => {
    expect(linksOf(html)).toEqual(expected)
  })
})

describe("text that is not markup", () => {
  const CASES = [
    // A script ends at the first </script, even inside a string: the img after it is markup.
    ["</script inside a string", `<script>var s = "</script><img src=a.png>"</script>`, [["image", "https://site.test/dir/a.png"]]],
    ["<img> inside textarea", `<textarea><img src=a.png></textarea>`, []],
    ["<img> inside title", `<title><img src=a.png></title>`, []],
    ["<img> inside a comment", `<!-- <img src=a.png> -->`, []],
    ["<img> inside noscript (scripting on)", `<noscript><img src=a.png></noscript>`, []],
    ["<img> inside a style element", `<style><img src=a.png></style>`, []],
    ["<svg><style> is CSS, not raw text", `<svg><style>.x{background:url(a.png)}</style></svg>`, [["image", "https://site.test/dir/a.png"]]],
    // In foreign content an HTML element like <img> breaks out, so it is a tag.
    ["<img> inside <svg><style> breaks out", `<svg><style><img src=b.png></style></svg>`, [["image", "https://site.test/dir/b.png"]]],
    ["<svg><![CDATA[ is text", `<svg><![CDATA[<img src=a.png>]]></svg>`, []],
    ["<![CDATA[ outside svg is a bogus comment to the first >", `<![CDATA[<img src=a.png>]]><img src=c.png>`, [["image", "https://site.test/dir/c.png"]]],
    ["<foreignObject> brings HTML back", `<svg><foreignObject><style>.x{background:url(f.png)}</style><textarea><img src=t.png></textarea></foreignObject></svg>`, [["image", "https://site.test/dir/f.png"]]],
    ["the first <base> only", `<base href="https://one.test/"><base href="https://two.test/"><img src=x.png>`, [["image", "https://one.test/x.png"]]],
    ["a <base> without href is not the first", `<base target="_top"><base href="https://two.test/"><img src=x.png>`, [["image", "https://two.test/x.png"]]],
    ["a javascript: <base> is ignored", `<base href="javascript:alert(1)"><img src=x.png>`, [["image", "https://site.test/dir/x.png"]]],
    ["unterminated tag at EOF", `<p>text<img src=a.png`, []],
    ["unterminated value at EOF", `<img src="a.png`, []],
    ["unterminated script runs to EOF", `<script><img src=a.png>`, []],
    ["a tag after an unterminated comment is in the comment", `<!-- <img src=a.png>`, []],
    ["uppercase tag", `<IMG SRC=a.png>`, [["image", "https://site.test/dir/a.png"]]],
    ["< not starting a tag", `a < b <img src=a.png> c<3`, [["image", "https://site.test/dir/a.png"]]],
    ["the first of duplicate attributes", `<img src=a.png src=b.png>`, [["image", "https://site.test/dir/a.png"]]],
    ["style attribute", `<div style="background: url('d.png')"></div>`, [["image", "https://site.test/dir/d.png"]]],
    ["entity in a URL", `<img src="x.png?a=1&amp;b=&#50;">`, [["image", "https://site.test/dir/x.png?a=1&b=2"]]],
    ["entity spelling javascript: is not a link", `<a href="&#106;avascript:alert(1)">x</a>`, []],
    ["a second icon is policy", `<link rel=icon href=a.ico><link rel="shortcut icon" href=b.ico><link rel=icon href=c.ico>`, [["image", "https://site.test/dir/a.ico"], ["image", "https://site.test/dir/c.ico"]]],
  ]
  it.each(CASES)("%s", (_, html, expected) => {
    expect(linksOf(html)).toEqual(expected)
  })

  it("marks every icon after the first as policy", () => {
    const tokens = scanHtml(`<link rel=icon href=a.ico><link rel=apple-touch-icon href=b.png>`)
    expect(pageLinks(tokens, PAGE).map((l) => !!l.policy)).toEqual([false, true])
  })
})

describe("where markup is, as a browser's tokenizer and tree builder have it", () => {
  const A = [["image", "https://site.test/dir/a.png"]]
  const CASES = [
    // A comment ends at the first "-->" or "--!>", whichever comes first.
    ["a comment ends at --!>", `<!-- x --!><img src=a.png> -->`, A],
    ["a comment ends at -->, before a later --!>", `<!-- x --><img src=a.png> --!>`, A],
    ["--! without > does not end a comment", `<!-- x --! <img src=a.png> -->`, []],
    // "</" then anything but a letter or ">" is a bogus comment, to the first ">".
    ["</ then a space is a comment to the first >", `</ <img src=a.png>`, []],
    ["</ then a digit is a comment", `</3 <img src=a.png>`, []],
    ["after a </ comment, markup again", `</ x><img src=a.png>`, A],
    ["</ at the very end is text", `<img src=a.png></`, A],
    // MathML text integration points read their children as HTML.
    ...["mi", "mo", "mn", "ms", "mtext"].map((point) => [`<math><${point}><style> is raw text`, `<math><${point}><style><img src=a.png></style></${point}></math>`, []]),
    ["mglyph inside mi stays foreign", `<math><mi><mglyph><style><img src=a.png></style></mglyph></mi></math>`, A],
    ["annotation-xml with encoding text/html is an HTML integration point", `<math><annotation-xml encoding="text/html"><style><img src=a.png></style></annotation-xml></math>`, []],
    ["annotation-xml with encoding application/xhtml+xml", `<math><annotation-xml encoding="application/xhtml+xml"><style><img src=a.png></style></annotation-xml></math>`, []],
    ["annotation-xml encoding is ASCII case-insensitive", `<math><annotation-xml encoding="TEXT/HTML"><style><img src=a.png></style></annotation-xml></math>`, []],
    ["annotation-xml without an encoding is foreign", `<math><annotation-xml><style><img src=a.png></style></annotation-xml></math>`, A],
    ["svg in annotation-xml is SVG, whose foreignObject is HTML", `<math><annotation-xml><svg><foreignObject><style><img src=a.png></style></foreignObject></svg></annotation-xml></math>`, []],
    // title and desc are HTML integration points in SVG only.
    ["svg desc is an HTML integration point", `<svg><desc><style><img src=a.png></style></desc></svg>`, []],
    ["math title is not an integration point", `<math><title><style><img src=a.png></style></title></math>`, A],
    ["math desc is not an integration point", `<math><desc><style><img src=a.png></style></desc></math>`, A],
    ["an svg inside math is a MathML element, so its title is not one either", `<math><svg><title><style><img src=a.png></style></title></svg></math>`, A],
    // An end tag in foreign content that closes an HTML ancestor leaves foreign content.
    ["</div> closes the div and the svg in it", `<div><svg></div><style><img src=a.png></style>`, []],
    ["</span> closes the span and the svg in it", `<span><svg></span><style><img src=a.png></style>`, []],
    ["</p> in foreign content breaks out", `<svg></p><style><img src=a.png></style>`, []],
    ["</br> in foreign content breaks out", `<svg></br><style><img src=a.png></style>`, []],
    ["an end tag for nothing open leaves svg open", `<svg></foo><style><img src=a.png></style>`, A],
    // An HTML end tag does not reach past an integration point.
    ["</svg> inside foreignObject's HTML is ignored", `<svg><foreignObject><p></svg></p></foreignObject><style><img src=a.png></style></svg>`, A],
    // CDATA is read wherever the current node is foreign, integration points included.
    ["CDATA inside foreignObject", `<svg><foreignObject><![CDATA[ > <img src=a.png> ]]></foreignObject></svg>`, []],
    // The tree builder makes <image> an <img>, outside foreign content.
    ["<image> is an img", `<image src=a.png>`, A],
    ["<image> in svg is SVG's, which has no src", `<svg><image src=a.png /></svg>`, []],
  ]
  it.each(CASES)("%s", (_, html, expected) => {
    expect(linksOf(html)).toEqual(expected)
  })

  // "İ" lowercases to two code units: whatever precedes an end tag must not move where it is found.
  const LONG = ["İ", "İİİ", "ẞİ", "\u{1F600}İ"]
  const RAW = [
    ["script", (x) => `<script>${x}</script>`],
    ["style", (x) => `<style>${x}</style>`],
    ["title", (x) => `<title>${x}</title>`],
    ["textarea", (x) => `<textarea>${x}</textarea>`],
    ["noscript", (x) => `<noscript>${x}</noscript>`],
    ["iframe", (x) => `<iframe>${x}</iframe>`],
    ["xmp", (x) => `<xmp>${x}</xmp>`],
  ]
  const turkish = []
  for (const long of LONG) {
    for (const [name, wrap] of RAW) {
      turkish.push([`${JSON.stringify(long)} before ${name}`, `<p>${long}</p>${wrap("x")}<img src=a.png>`, name])
      turkish.push([`${JSON.stringify(long)} inside ${name}`, `${wrap(`${long}x`)}<img src=a.png>`, name])
    }
  }
  it.each(turkish)("%s: the raw text ends at its end tag", (_, html, name) => {
    expect(linksOf(html)).toEqual(A)
    const tokens = scanHtml(html)
    expect(tokens.filter((t) => t.type === "end" && t.name === name)).toHaveLength(1)
  })
})

describe("the scanner's tokens", () => {
  it("keeps the position of every attribute and its value", () => {
    const html = `<img  src="a.png" alt=x hidden data-q='y'>`
    const [img] = scanHtml(html)
    expect(img).toMatchObject({ type: "start", name: "img", start: 0, end: html.length, nameEnd: 4, selfClosing: false })
    expect(img.attrs.map((a) => [a.name, a.value, html.slice(a.start, a.end), html.slice(a.vStart, a.vEnd)])).toEqual([
      ["src", "a.png", `src="a.png"`, "a.png"],
      ["alt", "x", "alt=x", "x"],
      ["hidden", "", "hidden", ""],
      ["data-q", "y", "data-q='y'", "y"],
    ])
  })

  it("lists repeated attributes as dups, first one winning", () => {
    const [a] = scanHtml(`<a onclick=one ONCLICK=two href=x onclick=three>`)
    expect(a.attrs.map((x) => [x.name, x.value])).toEqual([["onclick", "one"], ["href", "x"]])
    expect(a.dups.map((x) => [x.name, x.value])).toEqual([["onclick", "two"], ["onclick", "three"]])
  })

  it("knows a self-closing tag", () => {
    expect(scanHtml(`<br/>`)[0].selfClosing).toBe(true)
    expect(scanHtml(`<img src=a/>`)[0].attrs[0].value).toBe("a/")
  })

  it("reads doctype, comments and text", () => {
    expect(scanHtml(`<!DOCTYPE html><!--c-->hi &amp; bye</p>`).map((t) => [t.type, t.text ?? t.name])).toEqual([
      ["doctype", "<!DOCTYPE html>"],
      ["comment", "<!--c-->"],
      ["text", "hi & bye"],
      ["end", "p"],
    ])
  })

  it("decodes numeric references and the nine named ones, and leaves the rest", () => {
    // The three that can spell a scheme, so "java&Tab;script&colon;" is seen for what it is.
    expect(decodeEntities("java&Tab;script&colon;x&NewLine;&Tab")).toBe("java\tscript:x\n&Tab")
    expect(decodeEntities("&amp;&lt;&gt;&quot;&apos;&nbsp;&#65;&#x42;&#x43&#0;&#xD800;&#x110000;&copy;&amp")).toBe(
      "&<>\"' ABC���&copy;&amp"
    )
  })
})

describe("img: lazy loading", () => {
  const CASES = [
    ["src usable", `<img src=s.png data-src=d.png>`, "s.png", "src"],
    ["data: placeholder, data-src", `<img src="data:image/gif;base64,R0" data-src=d.png>`, "d.png", "data-src"],
    ["no src, data-lazy-src", `<img data-lazy-src=l.png>`, "l.png", "data-lazy-src"],
    ["data-src before data-lazy-src", `<img data-lazy-src=l.png data-src=d.png>`, "d.png", "data-src"],
    ["no src, srcset", `<img srcset="a.png 1x, b.png 2x">`, "b.png", "srcset"],
    ["data-src before srcset", `<img data-src=d.png srcset="a.png 1x">`, "d.png", "data-src"],
  ]
  it.each(CASES)("%s", (_, html, file, attr) => {
    const fetched = pageLinks(scanHtml(html), PAGE).filter((l) => !l.policy)
    expect(fetched.map((l) => [l.url, l.attr, l.place ?? null])).toEqual([[`https://site.test/dir/${file}`, attr, attr === "src" ? null : "src"]])
  })
})

describe("srcset: one candidate, by the rule", () => {
  const DESCRIPTORS = ["", "1x", "2x", "100w", "800w", "2000w"]

  /**
   * The rule, restated: the src when there is one; else the largest density
   * at most 2x (no descriptor is 1x); else the largest width at most 1600w;
   * else the first. Ties go to the earlier candidate.
   */
  function expectedChoice(descriptors, hasSrc) {
    if (hasSrc) return "src.png"
    const density = (d) => (d === "" ? 1 : d.endsWith("x") ? Number(d.slice(0, -1)) : null)
    const width = (d) => (d.endsWith("w") ? Number(d.slice(0, -1)) : null)
    let best = null
    descriptors.forEach((d, i) => {
      const x = density(d)
      if (x != null && x <= 2 && (best == null || x > density(descriptors[best]))) best = i
    })
    if (best == null) {
      descriptors.forEach((d, i) => {
        const w = width(d)
        if (w != null && w <= 1600 && (best == null || w > width(descriptors[best]))) best = i
      })
    }
    return `c${best ?? 0}.png`
  }

  const cases = []
  const lists = []
  for (const a of DESCRIPTORS) {
    lists.push([a])
    for (const b of DESCRIPTORS) {
      lists.push([a, b])
      for (const c of DESCRIPTORS) lists.push([a, b, c])
    }
  }
  for (const list of lists) {
    for (const hasSrc of [false, true]) cases.push([`${list.map((d) => d || "none").join(", ")} · src ${hasSrc ? "present" : "absent"}`, list, hasSrc])
  }

  it("covers every srcset of up to three candidates", () => {
    expect(cases).toHaveLength((6 + 36 + 216) * 2)
  })

  it.each(cases)("%s", (_, list, hasSrc) => {
    const srcset = list.map((d, i) => `c${i}.png${d ? ` ${d}` : ""}`).join(", ")
    const html = `<img ${hasSrc ? "src=src.png " : ""}srcset="${srcset}">`
    const links = pageLinks(scanHtml(html), PAGE)
    const fetched = links.filter((l) => !l.policy)
    expect(fetched.map((l) => l.url)).toEqual([`https://site.test/dir/${expectedChoice(list, hasSrc)}`])
    // Every other candidate is recorded, as policy.
    const passed = links.filter((l) => l.policy).map((l) => l.url)
    const all = list.map((_, i) => `https://site.test/dir/c${i}.png`)
    expect(passed).toEqual(all.filter((u) => u !== fetched[0].url))
  })

  it("a picture's <source> chooses the same way, to stay in its srcset", () => {
    const links = pageLinks(scanHtml(`<picture><source srcset="a.png 1x, b.png 2x, c.png 3x"><img src=i.png></picture>`), PAGE)
    expect(links.filter((l) => !l.policy).map((l) => [l.url, l.place ?? null])).toEqual([
      ["https://site.test/dir/b.png", "srcset"],
      ["https://site.test/dir/i.png", null],
    ])
  })

  it("parses descriptors, commas in URLs, and trailing commas", () => {
    expect(parseSrcset("a.png 1.5x,b.png  800w 600h , data:x,y 2x, c.png,")).toEqual([
      { raw: "a.png", x: 1.5 },
      { raw: "b.png", w: 800 },
      { raw: "data:x,y", x: 2 },
      { raw: "c.png" },
    ])
    expect(chooseCandidate([{ raw: "a", w: 2000 }, { raw: "b", x: 3 }])).toBe(0)
  })
})
