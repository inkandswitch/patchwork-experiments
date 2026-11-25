// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { morph } from "./morph.js"

const html = (markup) => {
  const div = document.createElement("div")
  div.innerHTML = markup
  return div
}

describe("morph", () => {
  // Every pair of these, morphed one into the other, must leave the live tree
  // with exactly the new markup.
  const shapes = [
    "",
    "text",
    "<p>a</p>",
    "<p class=x>a</p>",
    "<p>a</p><p>b</p>",
    "<span>a</span>",
    '<p data-key="1">a</p><p data-key="2">b</p>',
    '<p data-key="2">b</p><p data-key="1">a</p>',
    '<p data-key="2">b</p>',
    "<details><summary>s</summary><pre>r</pre></details>",
    '<div data-morph="whole"><button>x</button></div>',
    '<div data-morph="whole"><button>y</button></div>',
    "<ul><li>1</li><li>2</li></ul><!-- c -->",
  ]
  const pairs = shapes.flatMap((a) => shapes.map((b) => [a, b]))
  it.each(pairs)("%j → %j gives the new markup", (from, to) => {
    const live = html(from)
    morph(live, html(to))
    expect(live.innerHTML).toBe(html(to).innerHTML)
  })

  it("keeps the nodes that still fit, with what the person did to them", () => {
    const live = html("<p>old</p><details><summary>s</summary><pre>r</pre></details>")
    const [p, details] = live.children
    details.open = true
    const pre = details.querySelector("pre")
    morph(live, html('<p class="now">new</p><details><summary>s2</summary><pre>r</pre></details>'))
    expect(live.children[0]).toBe(p)
    expect(p.className).toBe("now")
    expect(p.textContent).toBe("new")
    expect(live.children[1]).toBe(details)
    expect(details.open).toBe(true)
    expect(details.querySelector("pre")).toBe(pre)
    expect(details.querySelector("summary").textContent).toBe("s2")
  })

  it("moves a keyed element to its place instead of morphing another into it", () => {
    const live = html('<p data-key="a">A</p><p data-key="b">B</p>')
    const [a, b] = live.children
    morph(live, html('<p data-key="c">C</p><p data-key="b">B</p><p data-key="a">A</p>'))
    expect(live.children[1]).toBe(b)
    expect(live.children[2]).toBe(a)
    expect(live.children[0].textContent).toBe("C")
  })

  it("keeps a whole element, listeners and all, only while its markup is the same", () => {
    const live = html('<div data-morph="whole"><button>x</button></div>')
    const whole = live.firstChild
    let clicks = 0
    whole.querySelector("button").addEventListener("click", () => clicks++)
    morph(live, html('<div data-morph="whole"><button>x</button></div>'))
    expect(live.firstChild).toBe(whole)
    live.querySelector("button").click()
    expect(clicks).toBe(1)
    morph(live, html('<div data-morph="whole"><button>changed</button></div>'))
    expect(live.firstChild).not.toBe(whole)
  })
})
