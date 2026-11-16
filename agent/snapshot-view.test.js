/**
 * The snapshot view, under happy-dom: the frame's attributes exactly (and
 * never one that would let the page run or reach out), the header's account
 * of what was kept, a re-render when the document arrives, and an export
 * that is the same bytes every time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { ImmutableString } from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { SnapshotView, SANDBOX, exportSnapshot, exportName, renderedBy } from "./snapshot/view.js"
import { WebSnapshotDatatype } from "./snapshot/datatype.js"
import { freeze } from "./capture/freeze.js"

await initSubduction()

const text = (s) => new TextEncoder().encode(s)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9])

/** A snapshot as web_capture writes one: everything kept but one image, which was unreachable. */
function fill(d) {
  d["@patchwork"] = { type: "web-snapshot" }
  d.title = "Pack cells"
  d.source = "https://site.test/cells"
  d.capture = { at: Date.UTC(2026, 10, 16, 10, 2), finalUrl: "https://site.test/cells", via: "reader", engine: "reader-dom", status: null, contentType: null, sha256: "0123456789abcdef", bytes: 80, readerCache: "no-cache" }
  d.html = text(`<html><body><h1>Cells</h1><p>Body text.</p><img src="a.png"><img src="gone.png"><script>x()</script><iframe src="f.html"></iframe></body></html>`)
  d.charset = "utf-8"
  d.base = "https://site.test/cells"
  d.resources = {
    "https://site.test/a.png": { kind: "image", from: "page", order: "2.0", outcome: "ok", status: 200, mimeType: "image/png", sha256: "aa", bytes: 6, finalUrl: "https://site.test/a.png", via: "direct" },
    "https://site.test/gone.png": { kind: "image", from: "page", order: "2.1", outcome: "unreachable", detail: "CORS or network" },
    "https://site.test/f.html": { kind: "frame", from: "page", order: "3.3", outcome: "policy" },
  }
  d.blobs = { aa: PNG }
  d.budget = { maxResourceBytes: 5e6, maxTotalBytes: 2e7, maxCount: 150, maxDepth: 3, concurrency: 6, timeoutMs: 15000 }
  d.tally = { found: 3, kept: 1, keptBytes: 6, notKept: { unreachable: 1 }, policy: { frame: 1 } }
  d.complete = true
  d.text = new ImmutableString("# Cells\n\nBody text.")
  d.textVia = "html-to-text"
  d.marks = [{ at: 0, label: "# Cells" }]
  d.pages = null
  d.missing = null
}

let settings
beforeEach(() => {
  document.body.replaceChildren()
  // happy-dom honours neither a sandbox nor a CSP: it writes a srcdoc into a
  // child window and would load that page's frames over the real network.
  // A browser would not; here they are switched off. So whether showing a
  // snapshot reaches the network cannot be seen here at all: probe P5
  // (probes/snapshot-frame.mjs) counts the requests a real Chrome makes.
  settings = { ...window.happyDOM.settings }
  Object.assign(window.happyDOM.settings, {
    disableIframePageLoading: true,
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  })
})
afterEach(() => {
  Object.assign(window.happyDOM.settings, settings)
  vi.restoreAllMocks()
})

function mount(handle) {
  const element = document.createElement("div")
  document.body.append(element)
  const cleanup = SnapshotView(handle, element)
  return { element, cleanup }
}

describe("the snapshot view", () => {
  it("shows the page in a frame sandboxed for popups and nothing else, as srcdoc", () => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change(fill)
    const { element, cleanup } = mount(handle)
    const frame = element.querySelector("iframe")
    expect(SANDBOX).toBe("allow-popups allow-popups-to-escape-sandbox")
    expect(frame.getAttribute("sandbox")).toBe(SANDBOX)
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer")
    expect(frame.srcdoc).toBe(freeze(handle.doc()))
    expect(frame.getAttributeNames().sort()).toEqual(["class", "referrerpolicy", "sandbox", "srcdoc", "title"])
    for (const never of ["allow-scripts", "allow-same-origin", "allow-forms", "allow-modals", "allow-top-navigation"]) {
      expect(frame.getAttribute("sandbox")).not.toContain(never)
    }
    expect(frame.hasAttribute("src")).toBe(false)
    expect(frame.hasAttribute("csp")).toBe(false)
    cleanup()
  })

  it("says where the page came from, who rendered it, and what was and was not kept", () => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change(fill)
    const { element, cleanup } = mount(handle)
    expect(element.querySelector("h2").textContent).toBe("Pack cells")
    const source = element.querySelector(".agent-snap-source")
    expect([source.getAttribute("href"), source.getAttribute("target"), source.getAttribute("rel")]).toEqual(["https://site.test/cells", "_blank", "noopener noreferrer"])
    expect(element.querySelector("time").textContent).toBe("2026-11-16 10:02 UTC")
    expect(element.querySelector(".agent-snap-via").textContent).toBe("rendered by the reader service (a third party), after the page's scripts ran")
    expect(element.querySelector(".agent-snap-hash").textContent).toBe("sha256 0123456789ab…")
    expect(element.querySelector(".agent-snap-resources summary").textContent).toBe("1 of 2 resources kept · 6 B")
    expect(element.querySelector(".agent-snap-resources p").textContent).toBe("Not kept: 1 unreachable (CORS or network) · by policy: 1 frame.")
    const groups = [...element.querySelectorAll(".agent-snap-missing h4")].map((h) => h.textContent)
    expect(groups).toEqual(["not fetched by policy (frame) · 1", "unreachable · 1"])
    expect(element.querySelector(".agent-snap-missing li").textContent).toBe("https://site.test/f.html")
    cleanup()
  })

  // The header is in Patchwork's own page, outside the sandbox, and a
  // snapshot is a document any collaborator can edit: its source is a link
  // only when it is a web address.
  it.each([
    ["https://site.test/cells", "https://site.test/cells"],
    ["http://site.test/cells", "http://site.test/cells"],
    ["javascript:alert(1)", null],
    [" JavaScript:alert(1)", null],
    ["data:text/html,<script>alert(1)</script>", null],
    ["not a url", null],
  ])("links the source %j only if it is http(s)", (source, href) => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change((d) => {
      fill(d)
      d.source = source
    })
    const { element, cleanup } = mount(handle)
    const link = element.querySelector(".agent-snap-source")
    expect(link.textContent).toBe(source)
    expect(link.getAttribute("href")).toBe(href)
    cleanup()
  })

  it("shows the text, with its headings to jump to, when asked", () => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change(fill)
    const { element, cleanup } = mount(handle)
    const panel = element.querySelector(".agent-snap-text")
    expect(panel.hidden).toBe(true)
    const [toggle] = element.querySelectorAll(".agent-snap-actions button")
    toggle.click()
    expect(panel.hidden).toBe(false)
    expect(panel.querySelector("pre").textContent).toBe("# Cells\n\nBody text.")
    expect([...panel.querySelectorAll(".agent-snap-jumps button")].map((b) => b.textContent)).toEqual(["# Cells"])
    cleanup()
  })

  it("re-renders when the document arrives, and stops listening when closed", () => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change((d) => WebSnapshotDatatype.init(d))
    const { element, cleanup } = mount(handle)
    expect(element.querySelector(".agent-snap-empty").textContent).toMatch(/empty/)
    expect(element.querySelector("iframe")).toBe(null)
    handle.change(fill)
    expect(element.querySelector("iframe").srcdoc).toBe(freeze(handle.doc()))
    cleanup()
    expect(element.children).toHaveLength(0)
    handle.change((d) => {
      d.title = "after close"
    })
    expect(element.children).toHaveLength(0)
  })

  it("exports one self-contained file, the same bytes every time", async () => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change(fill)
    const { element, cleanup } = mount(handle)
    const blobs = []
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => (blobs.push(blob), `blob:${blobs.length}`))
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    const saved = []
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      saved.push([this.download, this.href])
    })
    const [, exporter] = element.querySelectorAll(".agent-snap-actions button")
    exporter.click()
    exporter.click()
    expect(saved).toEqual([["Pack cells.html", "blob:1"], ["Pack cells.html", "blob:2"]])
    const [first, second] = await Promise.all(blobs.map((b) => b.text()))
    expect(second).toBe(first)
    expect(first).toBe(exportSnapshot(handle.doc()).html)
    expect(first).toContain(`<meta http-equiv="Memento-Datetime" content="Mon, 16 Nov 2026 10:02:00 GMT">`)
    expect(first).toContain(`<link rel="original" href="https://site.test/cells">`)
    expect(first).toContain(`<img src="data:image/png;base64,iVBORwkJ">`)
    expect(first).toContain(`<img src="https://site.test/gone.png">`)
    expect(first).not.toContain("<script")
    cleanup()
  })
})

describe("naming and wording", () => {
  it("names an export after the title, made safe for a file system", () => {
    expect(exportName({ title: 'a/b: "c"?' })).toBe("a b c.html")
    expect(exportName({ source: "https://x.test/" })).toBe("https x.test.html")
    expect(exportName({})).toBe("snapshot.html")
  })

  it("says plainly whose rendering the HTML is", () => {
    expect(renderedBy({ engine: "raw" })).toBe("the raw response, before the page's scripts ran")
  })

  it("titles a snapshot by its title, else its source", () => {
    expect(WebSnapshotDatatype.getTitle({ title: "T", source: "s" })).toBe("T")
    expect(WebSnapshotDatatype.getTitle({ title: null, source: "s" })).toBe("s")
    expect(WebSnapshotDatatype.getTitle({})).toBe("Web snapshot")
  })
})
