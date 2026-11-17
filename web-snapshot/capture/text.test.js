/**
 * outlineText over a fixed table: the readable text exactly, and a mark at
 * the exact offset where each heading's line starts.
 */
import { describe, it, expect } from "vitest"
import { outlineText, fewest } from "./text.js"
import { scanHtml } from "./scan.js"

const outline = (html) => outlineText(scanHtml(html))

describe("outlineText", () => {
  const CASES = [
    [
      "headings h1, h2, h6; head, script, noscript, template and style left out",
      `<html><head><title>T</title><style>x{}</style></head><body><h1>One</h1><p>Para <b>bold</b> text.</p><script>no()</script>` +
        `<h2>Two <em>sub</em></h2><ul><li>a</li><li>b</li></ul><noscript>ns</noscript><template>tp</template><h6>Six</h6></body></html>`,
      "# One\n\nPara bold text.\n\n## Two sub\n\na\nb\n\n###### Six",
      [{ at: 0, label: "# One" }, { at: 24, label: "## Two sub" }, { at: 41, label: "###### Six" }],
    ],
    ["every level", `<h3>c</h3><h4>d</h4><h5>e</h5>`, "### c\n\n#### d\n\n##### e", [{ at: 0, label: "### c" }, { at: 7, label: "#### d" }, { at: 15, label: "##### e" }]],
    ["pre keeps its whitespace", `<pre>a  b\n c</pre><p>x</p>`, "a  b\n c\n\nx", []],
    ["entities", `<p>a &amp; b&nbsp;c &lt;d&gt;</p>`, "a & b c <d>", []],
    ["table cells", `<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>`, "a b\nc", []],
    ["no <head> tag: the title is still not text", `<title>T</title><p>x</p>`, "x", []],
    ["an empty heading is no mark", `<h1></h1><p>x</p>`, "x", []],
    ["whitespace in a heading collapses", `<p>before</p><h2>\n  Spaced   out\n</h2>`, "before\n\n## Spaced out", [{ at: 8, label: "## Spaced out" }]],
    ["br", `a<br>b`, "a\nb", []],
    ["inline whitespace between elements", `<span>a</span> <span>b</span>`, "a b", []],
    // A title in an svg is a tooltip and its style is CSS: neither is shown as text.
    ["svg title and style are not text", `<svg><title>pic</title><style>.a{}</style><text>label</text></svg>`, "label", []],
    ["nothing", ``, "", []],
    // </head> is optional: head ends at <body>, at a start tag that is not
    // head content, or at text that is not whitespace.
    ["an omitted </head>, closed by <body>", `<!doctype html><html><head><title>x</title><meta charset=utf-8><body><h1>Hi</h1><p>text</p>`, "# Hi\n\ntext", [{ at: 0, label: "# Hi" }]],
    ["an omitted </head> and <body>, closed by body content", `<head><title>x</title><h1>Hi</h1>`, "# Hi", [{ at: 0, label: "# Hi" }]],
    ["an omitted </head>, closed by text", `<head><title>x</title>Hello <b>there</b>`, "Hello there", []],
    ["whitespace does not close head", `<head> <title>x</title>\n</head><p>a</p>`, "a", []],
    [
      "head content does not close head",
      `<head><title>x</title><meta name=a><link rel=x href=y><style>s{}</style><script>s()</script><base href=x><noscript><h1>n</h1></noscript><template><p>t</p></template><p>a</p>`,
      "a",
      [],
    ],
  ]
  it.each(CASES)("%s", (_, html, text, marks) => {
    const out = outline(html)
    expect(out.text).toBe(text)
    expect(out.marks).toEqual(marks)
    // Every mark points at its own line.
    for (const mark of out.marks) expect(out.text.slice(mark.at, mark.at + mark.label.length)).toBe(mark.label)
  })

  it("takes time in proportion to the page", () => {
    // 40,000 blocks, 3 MB: once quadratic (23 s), now a fraction of a second.
    // The bound is loose so that a slow machine passes and a quadratic one cannot.
    const html = `<div><span>word word</span> <a href="x">a link</a></div>`.repeat(40000)
    const tokens = scanHtml(html)
    const started = performance.now()
    const { text } = outlineText(tokens)
    expect(performance.now() - started).toBeLessThan(3000)
    expect(text.split("\n\n")).toHaveLength(40000)
    expect(text.slice(0, 32)).toBe("word word a link\n\nword word a li")
  })

  it("keeps at most 200 marks, the outline's top first", () => {
    const html = Array.from({ length: 150 }, (_, i) => `<h1>a${i}</h1><h2>b${i}</h2>`).join("")
    const { marks } = outline(html)
    expect(marks).toHaveLength(150)
    expect(marks.every((m) => m.label.startsWith("# "))).toBe(true)
    expect(fewest(marks, 3).map((m) => m.label)).toEqual(["# a0", "# a1", "# a2"])
  })
})
