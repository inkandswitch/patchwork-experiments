/**
 * The snapshot view, under happy-dom: the frame's attributes exactly (and
 * never one that would let the page run or reach out), the header's account
 * of what was kept, a re-render when the document arrives, an export that is
 * the same bytes every time — and, for an empty snapshot, a person's capture
 * into it: empty, capturing, failed (and tried again), captured, and never a
 * second capture over the first.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as A from "@automerge/automerge"
import { ImmutableString } from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { SnapshotView, SANDBOX, CAPTURED_TWICE, capturedTwice, exportSnapshot, exportName, renderedBy } from "./view.js"
import { WebSnapshotDatatype, isCaptured } from "./datatype.js"
import { render, freezePage } from "../capture/freeze.js"
import { sha256Hex } from "../capture/bytes.js"
import { guardedFetch } from "../guard.js"

await initSubduction()

const text = (s) => new TextEncoder().encode(s)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9])
const PNG_SHA = await sha256Hex(PNG)
const RESOURCES = {
  "https://site.test/a.png": { kind: "image", from: "page", order: "2.0", outcome: "ok", status: 200, mimeType: "image/png", sha256: PNG_SHA, bytes: 6, finalUrl: "https://site.test/a.png", via: "direct" },
  "https://site.test/gone.png": { kind: "image", from: "page", order: "2.1", outcome: "unreachable", detail: "CORS or network" },
  "https://site.test/f.html": { kind: "frame", from: "page", order: "3.3", outcome: "policy" },
}
/** The page as web_capture stores it: frozen at capture. */
const FROZEN = await freezePage({
  text: `<html><body><h1>Cells</h1><p>Body text.</p><img src="a.png"><img src="gone.png"><script>x()</script><iframe src="f.html"></iframe></body></html>`,
  base: "https://site.test/cells",
  resources: RESOURCES,
  blobs: { [PNG_SHA]: PNG },
})

/** A snapshot as web_capture writes one: everything kept but one image, which was unreachable. */
function fill(d) {
  d["@patchwork"] = { type: "web-snapshot" }
  d.title = "Pack cells"
  d.source = "https://site.test/cells"
  d.capture = { at: Date.UTC(2026, 10, 16, 10, 2), finalUrl: "https://site.test/cells", via: "reader", engine: "reader-dom", status: null, contentType: null, sha256: "0123456789abcdef", bytes: 80, readerCache: "no-cache" }
  d.html = FROZEN.html
  d.base = "https://site.test/cells"
  d.resources = { ...RESOURCES, "https://site.test/a.png": { ...RESOURCES["https://site.test/a.png"], stored: PNG_SHA } }
  d.blobs = FROZEN.blobs
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

function mount(handle, options) {
  const element = document.createElement("div")
  document.body.append(element)
  const cleanup = SnapshotView(handle, element, options)
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
    expect(frame.srcdoc).toBe(render(handle.doc()))
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
    const source = element.querySelector(".ws-source")
    expect([source.getAttribute("href"), source.getAttribute("target"), source.getAttribute("rel")]).toEqual(["https://site.test/cells", "_blank", "noopener noreferrer"])
    expect(element.querySelector("time").textContent).toBe("2026-11-16 10:02 UTC")
    expect(element.querySelector(".ws-via").textContent).toBe("rendered by the reader service (a third party), after the page's scripts ran")
    expect(element.querySelector(".ws-hash").textContent).toBe("sha256 0123456789ab…")
    expect(element.querySelector(".ws-resources summary").textContent).toBe("1 of 2 resources kept · 6 B")
    expect(element.querySelector(".ws-resources p").textContent).toBe("Not kept: 1 unreachable (CORS or network) · by policy: 1 frame.")
    const groups = [...element.querySelectorAll(".ws-missing h4")].map((h) => h.textContent)
    expect(groups).toEqual(["not fetched by policy (frame) · 1", "unreachable · 1"])
    expect(element.querySelector(".ws-missing li").textContent).toBe("https://site.test/f.html")
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
    const link = element.querySelector(".ws-source")
    expect(link.textContent).toBe(source)
    expect(link.getAttribute("href")).toBe(href)
    cleanup()
  })

  it("shows the text, with its headings to jump to, when asked", () => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change(fill)
    const { element, cleanup } = mount(handle)
    const panel = element.querySelector(".ws-text")
    expect(panel.hidden).toBe(true)
    const [toggle] = element.querySelectorAll(".ws-actions button")
    toggle.click()
    expect(panel.hidden).toBe(false)
    expect(panel.querySelector("pre").textContent).toBe("# Cells\n\nBody text.")
    expect([...panel.querySelectorAll(".ws-jumps button")].map((b) => b.textContent)).toEqual(["# Cells"])
    cleanup()
  })

  it("re-renders when the document arrives, and stops listening when closed", () => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change((d) => WebSnapshotDatatype.init(d))
    const { element, cleanup } = mount(handle)
    expect(element.querySelector(".ws-empty").textContent).toMatch(/empty/)
    expect(element.querySelector("iframe")).toBe(null)
    handle.change(fill)
    expect(element.querySelector("iframe").srcdoc).toBe(render(handle.doc()))
    cleanup()
    expect(element.children).toHaveLength(0)
    handle.change((d) => {
      d.title = "after close"
    })
    expect(element.children).toHaveLength(0)
  })

  // Two captures into one empty snapshot from two peers, each having found
  // it empty, merged: in either order, by either actor first, the view shows
  // neither and offers nothing. One capture alone is shown as ever.
  it.each([
    ["aa", "bb"],
    ["bb", "aa"],
  ])("shows neither of two captures written at once from two peers (%s, then %s)", (first, second) => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change((d) => WebSnapshotDatatype.init(d))
    const peer = (actor, title) => {
      const doc = A.clone(handle.doc(), { actor: actor.repeat(16) })
      return A.change(doc, (d) => {
        if (isCaptured(d)) throw new Error("already")
        fill(d)
        d.title = title
      })
    }
    const [a, b] = [peer(first, "A"), peer(second, "B")]
    expect(capturedTwice(a)).toBe(false)
    handle.update((d) => A.merge(A.merge(d, a), b))
    expect(capturedTwice(handle.doc())).toBe(true)
    const { element, cleanup } = mount(handle)
    expect(element.querySelector(".ws-empty").textContent).toBe(CAPTURED_TWICE)
    expect(element.querySelector("iframe")).toBe(null)
    expect(element.querySelector("form")).toBe(null)
    expect(element.querySelectorAll("button")).toHaveLength(0)
    cleanup()
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
    const [, exporter] = element.querySelectorAll(".ws-actions button")
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

describe("capturing a page into an empty snapshot, by hand", () => {
  const READER = "https://reader.test/"
  const PAGE_URL = "https://site.test/cells"
  const PAGE = `<html><head><title>Cells</title></head><body><h1>Cells</h1><script>x()</script><img src=a.png></body></html>`
  const respond = (body, { status = 200, type = "text/plain", url = "" } = {}) => {
    const bytes = typeof body === "string" ? text(body) : body
    return {
      ok: status >= 200 && status < 300,
      status,
      url,
      headers: { get: (n) => (n.toLowerCase() === "content-type" ? type : null) },
      body: { cancel() {} },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => new TextDecoder().decode(bytes),
    }
  }
  /** The web: the reader renders the page (or answers `reader`), the page itself fails CORS, its image arrives. */
  const web = (state) => async (url, init = {}) => {
    state.sent.push(url)
    if (url.startsWith(READER)) {
      if (state.reader === "hang") {
        return new Promise((_, fail) => init.signal?.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError"))))
      }
      if (state.reader !== "ok") return respond("busy", { status: Number(state.reader) })
      return respond(JSON.stringify({ code: 200, data: { title: "Cells", url: PAGE_URL, html: PAGE } }), { type: "application/json" })
    }
    if (url === PAGE_URL) throw new TypeError("Failed to fetch")
    if (url === "https://site.test/a.png") return respond(PNG, { type: "image/png", url })
    return respond("", { status: 404, url })
  }
  function setup(reader = "ok") {
    const state = { reader, sent: [] }
    const repo = new Repo({ network: [] })
    const handle = repo.create({})
    handle.change((d) => WebSnapshotDatatype.init(d))
    const mounted = mount(handle, { fetchImpl: guardedFetch({ fetch: web(state) }), reader: READER })
    return { state, repo, handle, ...mounted }
  }
  const submit = (element, url) => {
    element.querySelector(".ws-capture input").value = url
    element.querySelector(".ws-capture").dispatchEvent(new Event("submit", { cancelable: true }))
  }
  const statusOf = (element) => element.querySelector(".ws-status")

  it("empty: offers an address and Capture, and nothing else", () => {
    const { element, cleanup } = setup()
    expect(element.querySelector(".ws-empty").textContent).toMatch(/^This snapshot is empty\./)
    expect([...element.querySelectorAll(".ws-capture button")].map((b) => b.textContent)).toEqual(["Capture"])
    expect(element.querySelector("iframe")).toBe(null)
    expect(statusOf(element).textContent).toBe("")
    cleanup()
  })

  it("capturing, then captured: the page fills this document, and no capture is offered over it", async () => {
    const { element, handle, repo, cleanup } = setup()
    submit(element, PAGE_URL)
    // At once: capturing, with the step under way and a way to stop it.
    expect(statusOf(element).dataset.state).toBe("capturing")
    expect(element.querySelector(".ws-capture input").disabled).toBe(true)
    expect([...element.querySelectorAll(".ws-capture button")].map((b) => b.textContent)).toEqual(["Capture", "Cancel"])
    await vi.waitFor(() => expect(element.querySelector("iframe")).not.toBe(null))
    const doc = handle.doc()
    expect(isCaptured(doc)).toBe(true)
    expect([doc.title, doc.source, doc.tally.kept]).toEqual(["Cells", PAGE_URL, 1])
    expect(new TextDecoder().decode(doc.html)).not.toContain("<script")
    // The same document, and no other.
    expect(Object.keys(repo.handles)).toEqual([handle.documentId])
    expect(element.querySelector("iframe").srcdoc).toBe(render(doc))
    expect(element.querySelector(".ws-capture")).toBe(null)
    cleanup()
  })

  it("failed: says why, keeps the address, and captures when tried again", async () => {
    const { element, handle, state, cleanup } = setup("429")
    submit(element, PAGE_URL)
    await vi.waitFor(() => expect(statusOf(element).dataset.state).toBe("failed"))
    expect(statusOf(element).textContent).toBe(
      `Could not capture ${PAGE_URL}: the reader was unavailable (429) and the page could not be fetched from here (unreachable: CORS or network). You can try again.`
    )
    expect(element.querySelector(".ws-capture input").value).toBe(PAGE_URL)
    expect(element.querySelector(".ws-capture input").disabled).toBe(false)
    expect(isCaptured(handle.doc())).toBe(false)
    state.reader = "ok"
    element.querySelector(".ws-capture").dispatchEvent(new Event("submit", { cancelable: true }))
    await vi.waitFor(() => expect(element.querySelector("iframe")).not.toBe(null))
    expect(handle.doc().title).toBe("Cells")
    cleanup()
  })

  it("cancelled: stops, keeps nothing, and can be tried again", async () => {
    const { element, handle, cleanup } = setup("hang")
    submit(element, PAGE_URL)
    await vi.waitFor(() => expect(statusOf(element).textContent).toMatch(/^Asking reader\.test to render the page/))
    ;[...element.querySelectorAll(".ws-capture button")].find((b) => b.textContent === "Cancel").click()
    await vi.waitFor(() => expect(statusOf(element).dataset.state).toBe("failed"))
    expect(statusOf(element).textContent).toBe("Cancelled; nothing was kept. You can try again.")
    expect(isCaptured(handle.doc())).toBe(false)
    cleanup()
  })

  it.each([["", "nothing"], ["site.test/cells", "no scheme"], ["javascript:alert(1)", "javascript:"], ["file:///etc/passwd", "file:"]])(
    "refuses the address %j (%s) before asking anyone",
    (url) => {
      const { element, state, cleanup } = setup()
      submit(element, url)
      expect(statusOf(element).textContent).toBe("Give the page's full address, starting with https:// or http://. You can try again.")
      expect(state.sent).toEqual([])
      cleanup()
    }
  )

  it("refuses an address the guard refuses, saying so, having asked no one", async () => {
    const { element, state, handle, cleanup } = setup()
    submit(element, "http://localhost:8080/")
    await vi.waitFor(() => expect(statusOf(element).dataset.state).toBe("failed"))
    expect(statusOf(element).textContent).toMatch(/^Refused to fetch http:\/\/localhost:8080\//)
    expect(state.sent).toEqual([])
    expect(isCaptured(handle.doc())).toBe(false)
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
