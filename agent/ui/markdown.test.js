import { describe, it, expect } from "vitest"
import { renderMarkdown, renderInline, safeHref, safeImageSrc } from "./markdown.js"

/** Render and hand back the element, plus a couple of ways to look at it. */
function md(source) {
  const root = renderMarkdown(source)
  return {
    root,
    tags: [...root.children].map((child) => child.tagName.toLowerCase()),
    text: root.textContent,
    find: (selector) => root.querySelector(selector),
    all: (selector) => [...root.querySelectorAll(selector)],
  }
}

function inline(source) {
  const holder = document.createElement("div")
  renderInline(holder, source)
  return holder
}

describe("blocks", () => {
  it("renders headings at their level", () => {
    const out = md("# One\n## Two\n###### Six")
    expect(out.tags).toEqual(["h1", "h2", "h6"])
    expect(out.find("h2").textContent).toBe("Two")
  })

  it("does not treat a hash without a space as a heading", () => {
    expect(md("#hashtag").tags).toEqual(["p"])
  })

  it("separates paragraphs on blank lines and keeps soft breaks inside one", () => {
    const out = md("first line\nsecond line\n\nnew paragraph")
    expect(out.tags).toEqual(["p", "p"])
    expect(out.root.children[0].querySelectorAll("br")).toHaveLength(1)
  })

  it("renders a fenced code block, with its language", () => {
    const out = md("before\n\n```js\nconst x = 1\n# not a heading\n```\n\nafter")
    expect(out.tags).toEqual(["p", "pre", "p"])
    const code = out.find("pre code")
    expect(code.textContent).toBe("const x = 1\n# not a heading")
    expect(code.dataset.language).toBe("js")
  })

  it("keeps markdown inside a fence as literal text", () => {
    const out = md("```\n**bold** and [a link](https://x.test/)\n```")
    expect(out.find("strong")).toBeNull()
    expect(out.find("a")).toBeNull()
    expect(out.find("code").textContent).toContain("**bold**")
  })

  it("closes an unterminated fence at the end of the input", () => {
    const out = md("```\nstill code")
    expect(out.find("pre code").textContent).toBe("still code")
  })

  it("renders bullet and numbered lists", () => {
    const bullets = md("- one\n- two\n- three")
    expect(bullets.tags).toEqual(["ul"])
    expect(bullets.all("li").map((li) => li.textContent)).toEqual(["one", "two", "three"])

    const numbers = md("1. one\n2. two")
    expect(numbers.tags).toEqual(["ol"])
    expect(numbers.all("li")).toHaveLength(2)
  })

  it("starts an ordered list where it says it does", () => {
    expect(md("3. three\n4. four").find("ol").getAttribute("start")).toBe("3")
  })

  it("nests a list by indentation", () => {
    const out = md("- outer\n  - inner\n  - inner two\n- outer two")
    const top = out.find("ul")
    expect(top.children).toHaveLength(2)
    expect(top.children[0].querySelector("ul").children).toHaveLength(2)
  })

  it("starts a new list when the marker changes kind", () => {
    const out = md("- bullet\n1. number")
    expect(out.tags).toEqual(["ul", "ol"])
  })

  it("renders a blockquote, with markdown inside it", () => {
    const out = md("> quoted **text**\n> still quoted")
    expect(out.tags).toEqual(["blockquote"])
    expect(out.find("blockquote strong").textContent).toBe("text")
  })

  it("renders a horizontal rule, and does not mistake a list for one", () => {
    expect(md("---").tags).toEqual(["hr"])
    expect(md("***").tags).toEqual(["hr"])
    expect(md("- item").tags).toEqual(["ul"])
  })

  it("renders a table when a divider row says so", () => {
    const out = md("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |")
    expect(out.tags).toEqual(["table"])
    expect(out.all("th").map((c) => c.textContent)).toEqual(["a", "b"])
    expect(out.all("tbody tr")).toHaveLength(2)
    expect(out.all("tbody td").map((c) => c.textContent)).toEqual(["1", "2", "3", "4"])
  })

  it("leaves prose containing a pipe as prose", () => {
    expect(md("use a | b to pipe things").tags).toEqual(["p"])
  })

  it("survives an empty document", () => {
    expect(md("").root.children).toHaveLength(0)
    expect(md(null).root.children).toHaveLength(0)
  })
})

describe("inline", () => {
  it("renders code, bold, italic and strikethrough", () => {
    expect(inline("`code`").querySelector("code").textContent).toBe("code")
    expect(inline("**b**").querySelector("strong").textContent).toBe("b")
    expect(inline("__b__").querySelector("strong").textContent).toBe("b")
    expect(inline("*i*").querySelector("em").textContent).toBe("i")
    expect(inline("_i_").querySelector("em").textContent).toBe("i")
    expect(inline("~~gone~~").querySelector("s").textContent).toBe("gone")
  })

  it("lets code win over everything inside it", () => {
    const out = inline("`**not bold**`")
    expect(out.querySelector("strong")).toBeNull()
    expect(out.querySelector("code").textContent).toBe("**not bold**")
  })

  it("does not italicize an underscore inside a word", () => {
    const out = inline("some_variable_name and snake_case_thing")
    expect(out.querySelector("em")).toBeNull()
    expect(out.textContent).toBe("some_variable_name and snake_case_thing")
  })

  it("keeps the surrounding text", () => {
    expect(inline("a **b** c").textContent).toBe("a b c")
  })

  it("renders a link with a safe target", () => {
    const link = inline("[docs](https://example.test/a)").querySelector("a")
    expect(link.getAttribute("href")).toBe("https://example.test/a")
    expect(link.textContent).toBe("docs")
    expect(link.rel).toBe("noopener noreferrer")
    expect(link.target).toBe("_blank")
  })

  it("turns a bare URL into a link", () => {
    expect(inline("see https://example.test/x for more").querySelector("a").getAttribute("href")).toBe(
      "https://example.test/x"
    )
  })

  it("does not swallow the punctuation after a bare URL", () => {
    expect(inline("see https://example.test/x.").querySelector("a").getAttribute("href")).toBe(
      "https://example.test/x"
    )
  })

  it("makes an automerge link navigable rather than an href", () => {
    const link = inline("[that doc](automerge:abc123)").querySelector("a")
    expect(link.dataset.docUrl).toBe("automerge:abc123")
    expect(link.hasAttribute("href")).toBe(false)
    expect(link.tabIndex).toBe(0)
  })

  it("renders an image from a safe source", () => {
    const image = inline("![a cube](https://example.test/cube.png)").querySelector("img")
    expect(image.getAttribute("src")).toBe("https://example.test/cube.png")
    expect(image.alt).toBe("a cube")
  })
})

describe("what it refuses to render", () => {
  it("never builds markup out of HTML in the source", () => {
    // The whole reason this file uses DOM calls: a model that emits a script
    // tag has written six words, not a script tag.
    const out = md('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')
    expect(out.find("script")).toBeNull()
    expect(out.find("img")).toBeNull()
    expect(out.text).toContain("<script>alert(1)</script>")
  })

  it("drops a javascript: link but keeps its words", () => {
    const out = inline("[click me](javascript:alert(1))")
    expect(out.querySelector("a")).toBeNull()
    expect(out.textContent).toBe("click me")
  })

  it("refuses the schemes people forget about", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull()
    expect(safeHref("JaVaScRiPt:alert(1)")).toBeNull()
    expect(safeHref("vbscript:msgbox")).toBeNull()
    expect(safeHref("data:text/html,<script>")).toBeNull()
    expect(safeHref("file:///etc/passwd")).toBeNull()
  })

  it("refuses a scheme hidden behind whitespace or a control character", () => {
    expect(safeHref("java\tscript:alert(1)")).toBeNull()
    expect(safeHref("java\nscript:alert(1)")).toBeNull()
    expect(safeHref("java\x00script:alert(1)")).toBeNull()
  })

  it("allows the schemes a conversation actually needs", () => {
    expect(safeHref("https://example.test/")).toBe("https://example.test/")
    expect(safeHref("http://example.test/")).toBe("http://example.test/")
    expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test")
    expect(safeHref("automerge:abc")).toBe("automerge:abc")
    expect(safeHref("#anchor")).toBe("#anchor")
  })

  it("allows only real image sources", () => {
    expect(safeImageSrc("https://x.test/a.png")).toBe("https://x.test/a.png")
    expect(safeImageSrc("data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA")
    expect(safeImageSrc("data:text/html,<script>")).toBeNull()
    expect(safeImageSrc("javascript:alert(1)")).toBeNull()
  })

  it("leaves an unsafe image as the text it was written as", () => {
    const out = inline("![x](javascript:alert(1))")
    expect(out.querySelector("img")).toBeNull()
    expect(out.textContent).toBe("![x](javascript:alert(1))")
  })
})

describe("links with parentheses in them", () => {
  it("keeps a Wikipedia-style URL whole", () => {
    const link = inline("[Foo](https://en.wikipedia.org/wiki/Foo_(bar))").querySelector("a")
    expect(link.getAttribute("href")).toBe("https://en.wikipedia.org/wiki/Foo_(bar)")
    expect(link.textContent).toBe("Foo")
  })

  it("leaves no stray bracket behind after a refused link", () => {
    expect(inline("[click me](javascript:alert(1))").textContent).toBe("click me")
  })
})
