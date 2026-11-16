/**
 * cssLinks: every form a stylesheet writes a URL in, in every context a
 * stylesheet appears in, each giving the exact `{kind, url, start, end}` the
 * rule says — and nothing from inside a comment or an ordinary string.
 */
import { describe, it, expect } from "vitest"
import { cssLinks } from "./css.js"
import { scanHtml } from "./scan.js"
import { pageLinks } from "./links.js"

/**
 * Each form: the CSS, and what it links as [kind, the URL as written, the
 * exact text of the token that is replaced]. Written out from the rule, not
 * from the code.
 */
const FORMS = [
  ["url(x)", "a{background:url(x.png)}", [["image", "x.png", "url(x.png)"]]],
  ["url('x')", "a{background:url('x.png')}", [["image", "x.png", "url('x.png')"]]],
  ['url("x")', 'a{background:url("x.png")}', [["image", "x.png", 'url("x.png")']]],
  ["URL( x )", "a{background:URL( x.png )}", [["image", "x.png", "URL( x.png )"]]],
  ["url(x\\)y)", "a{background:url(x\\)y.png)}", [["image", "x)y.png", "url(x\\)y.png)"]]],
  ['@import "x"', '@import "x.css";', [["style", "x.css", '"x.css"']]],
  ["@import url(x) screen", "@import url(x.css) screen;", [["style", "x.css", "url(x.css)"]]],
  [
    "@font-face src",
    '@font-face{font-family:F;src:url(a.woff2) format("woff2"),url(b.woff)}',
    [["font", "a.woff2", "url(a.woff2)"], ["font", "b.woff", "url(b.woff)"]],
  ],
  ["url() after @font-face is an image again", "@font-face{src:url(a.woff)}b{background:url(c.png)}", [["font", "a.woff", "url(a.woff)"], ["image", "c.png", "url(c.png)"]]],
  ["image-set()", 'a{background:image-set("a.png" 1x, url(b.png) 2x)}', [["image", "a.png", '"a.png"'], ["image", "b.png", "url(b.png)"]]],
  ["-webkit-image-set()", 'a{background:-webkit-image-set("a.png" 1x)}', [["image", "a.png", '"a.png"']]],
  ["inside a comment", "/* url(x.png) @import 'y.css'; */a{}", []],
  ["inside a string", 'a{content:"url(x.png)"}', []],
  ["an ordinary string is not a URL", 'a{font-family:"x.png"}', []],
  ["a data: URL is not a link", "a{background:url(data:image/png;base64,AA)}", []],
  ["a fragment is not a link", "a{fill:url(#grad)}", []],
  ["a word ending in url( is not url(", "a{background:myurl(x.png)}", []],
  ["unterminated url", "a{background:url(x.png", []],
  ["unterminated string", 'a{background:url("x.png', []],
  ["unterminated comment", "a{} /* url(x.png)", []],
  ["a space inside an unquoted url is a bad url, not a link", "a{background:url(x y.png)}", []],
  ["escapes in a string", 'a{background:url("\\78 .png")}', [["image", "x.png", 'url("\\78 .png")']]],
]

/** The contexts a stylesheet appears in, and the base its URLs resolve against. */
const B1 = "https://site.test/css/"
const B2 = "https://cdn.test/deep/sheets/"
const CONTEXTS = {
  "<style> on the page": B1,
  'style="" on the page': B1,
  "a sheet at B1": B1,
  "a sheet @imported from it, at B2": B2,
}

describe("every form × every context", () => {
  for (const [name, css, expected] of FORMS) {
    for (const [context, base] of Object.entries(CONTEXTS)) {
      it(`${name} · ${context}`, () => {
        const want = expected.map(([kind, raw, token]) => ({
          kind,
          url: new URL(raw, base).href,
          token,
        }))
        if (context.startsWith("<style>") || context.startsWith("style=")) {
          // Through the page: the links pageLinks finds in the CSS, with their positions in that CSS.
          const html = context.startsWith("<style>") ? `<style>${css}</style>` : `<div style='${css.replace(/'/g, "&apos;")}'></div>`
          const tokens = scanHtml(html)
          const source = context.startsWith("<style>") ? tokens[1].text : tokens[0].attrs[0].value
          const got = pageLinks(tokens, base).map((l) => ({ kind: l.kind, url: l.url, token: source.slice(l.css.start, l.css.end) }))
          expect(got).toEqual(want)
        } else {
          const got = cssLinks(css, base).map((l) => ({ kind: l.kind, url: l.url, token: css.slice(l.start, l.end) }))
          expect(got).toEqual(want)
        }
      })
    }
  }
})

describe("cssLinks", () => {
  it("gives exact positions", () => {
    const css = `@import "a.css";\nb{background:url( 'i.png' )}`
    expect(cssLinks(css, B1)).toEqual([
      { kind: "style", url: `${B1}a.css`, raw: "a.css", start: 8, end: 15 },
      { kind: "image", url: `${B1}i.png`, raw: "i.png", start: 30, end: 44 },
    ])
  })

  it("marks a URL that does not parse as bad", () => {
    expect(cssLinks("a{background:url(http://[)}", B1)).toEqual([{ kind: "image", url: null, bad: true, raw: "http://[", start: 13, end: 26 }])
  })

  it("never throws, whatever it is given", () => {
    for (const css of ["", "url(", "@", "@import", '"', "\\", "/*", "image-set(", ")))", "{{{", "}}}", "url(\\", "a{b:url('x"]) {
      expect(() => cssLinks(css, B1)).not.toThrow()
    }
  })
})
