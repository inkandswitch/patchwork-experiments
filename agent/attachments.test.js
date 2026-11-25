/**
 * Things attached to a message, and image files shown as images.
 *
 * A person drags a document in from the sidebar, drops a file, or pastes an
 * image; the agent is handed a link to each and is shown the images. And when
 * the agent reads an image file itself, it is shown the image, rather than a
 * summary of a byte array that sent it off to mount and screenshot the file.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { sniffImage, imageTypeOf, imageForModel, MAX_RAW_BYTES } from "./documents/images.js"
import { readDrop, carriesAttachments, pastedImages, attachmentTray } from "./ui/attachments.js"
import { initSession, CALL, _resetIds } from "./session/schema.js"
import { makeTurn, textBlock, attachmentBlock, resultBlock, callBlock } from "./session/blocks.js"
import { toRequest, rejectSentImages } from "./session/request.js"
import { say } from "./kernel/loop.js"
import { memoryStore } from "./kernel/store.js"
import { toOpenAIMessages } from "./providers/openrouter.js"
import { renderTranscript } from "./ui/transcript.js"
import { BUILTIN_TOOLS } from "./tools/index.js"
import { sourceRead } from "./tools/read-source.js"

beforeEach(_resetIds)

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1])
const GIF = new TextEncoder().encode("GIF89a.........")
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 9, 9])
const PDF = new TextEncoder().encode("%PDF-1.7 ........")

const imageDoc = (over = {}) => ({ "@patchwork": { type: "file" }, name: "hull.png", extension: "png", mimeType: "image/png", content: PNG, ...over })

describe("knowing an image", () => {
  it("by its bytes, whatever its name says", () => {
    expect([PNG, JPEG, GIF, WEBP, PDF, new Uint8Array(3)].map(sniffImage)).toEqual(["image/png", "image/jpeg", "image/gif", "image/webp", null, null])
    expect(imageTypeOf(imageDoc({ name: "x.pdf", mimeType: "application/pdf" }))).toBe("image/png")
  })

  it("or by what the document says it is, when it holds bytes", () => {
    const unknownBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(imageTypeOf({ content: unknownBytes, mimeType: "image/avif" })).toBe("image/avif")
    expect(imageTypeOf({ content: unknownBytes, name: "photo.jpeg" })).toBe("image/jpeg")
    expect(imageTypeOf({ content: unknownBytes, name: "drawing.svg" })).toBe(null) // vector text, read as text
    expect(imageTypeOf({ content: "a string", mimeType: "image/png" })).toBe(null)
    expect(imageTypeOf({ content: PDF, mimeType: "application/pdf" })).toBe(null)
  })

  it("is passed as it is where it cannot be redrawn, and not at all when that is too big", async () => {
    const shown = await imageForModel(PNG, "image/png")
    expect(shown).toEqual({ url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`, width: null, height: null })
    expect(await imageForModel(new Uint8Array(MAX_RAW_BYTES + 1), "image/png")).toBe(null)
  })
})

describe("reading an image file shows the image", () => {
  const ctxWith = (doc) => ({ repo: { find: async (url) => ({ url, doc: () => doc }) } })
  const docRead = BUILTIN_TOOLS.find((t) => t.id === "doc_read")

  it("doc_read of the file, or of its content, returns the image", async () => {
    for (const path of [undefined, ["content"]]) {
      const out = await docRead.execute({ url: "automerge:hull", path }, ctxWith(imageDoc()))
      expect(out.text).toMatch(/'hull\.png' \(image\/png, .*\)\. The image is attached to this result\./)
      expect(out.image.startsWith("data:image/png;base64,")).toBe(true)
    }
  })

  it("other paths read as before", async () => {
    const name = await docRead.execute({ url: "automerge:hull", path: ["name"] }, ctxWith(imageDoc()))
    expect(name).toMatch(/hull\.png/)
  })

  it("source_read of a kept image returns the image", async () => {
    const out = await sourceRead.execute({ source: "automerge:3bRKtaJ6tCZ7vXwze42qyo3RuATC" }, ctxWith(imageDoc({ role: "primary", text: null })))
    expect(out.image.startsWith("data:image/png;base64,")).toBe(true)
  })
})

describe("a message with attachments", () => {
  function session() {
    const doc = {}
    initSession(doc, {})
    return memoryStore(doc)
  }

  it("says what is attached, and shows the images, newest within the image budget", () => {
    const store = session()
    say(store, "look at these", null, null, [
      { url: "automerge:hull", name: "hull.png", docType: "file", mimeType: "image/png", image: "data:image/png;base64,AAAA", kept: true },
      { url: "automerge:plan", name: "Battery plan", docType: "markdown" },
    ])
    const turn = store.doc().turns.at(-1)
    expect(turn.blocks.map((b) => b.type)).toEqual(["text", "attachment", "attachment"])
    // A file kept from the computer is listed with what the session made.
    expect(store.doc().made.map((m) => [m.url, m.kind])).toEqual([["automerge:hull", "file"]])
    const content = toRequest(store.doc()).messages[0].content
    expect(content).toEqual([
      { type: "text", text: "look at these" },
      { type: "text", text: "[Attached: hull.png (file, image/png) — automerge:hull]" },
      { type: "image", image: "data:image/png;base64,AAAA" },
      { type: "text", text: "[Attached: Battery plan (markdown) — automerge:plan]" },
    ])
  })

  it("shares the image budget with screenshots: the older are named, not re-sent", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("one"), attachmentBlock({ url: "automerge:a", name: "a.png", image: "data:image/png;base64,A" })])]
    for (let i = 0; i < 2; i++) {
      doc.turns.push(makeTurn("assistant", [callBlock("view_screenshot", {}, { id: `c${i}`, status: CALL.done })]))
      doc.turns.push(makeTurn("tool", [resultBlock(`c${i}`, "shot", { image: `data:image/jpeg;base64,${i}` })]))
    }
    const request = toRequest(doc, { maxImages: 2 })
    const first = request.messages[0].content
    expect(first.some((p) => p.type === "image")).toBe(false)
    expect(first[1].text).toMatch(/an image, not re-sent — doc_read it to look again/)
  })

  it("a refused image is not sent again", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("see"), attachmentBlock({ url: "automerge:a", name: "a.png", image: "data:image/png;base64,A" })])]
    rejectSentImages(doc)
    expect(toRequest(doc).messages[0].content.some((p) => p.type === "image")).toBe(false)
  })

  it("reaches the model as words and images in one message, or words alone for a model that cannot see", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", image: "data:image/png;base64,A" }] }]
    expect(toOpenAIMessages("sys", messages)[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: "data:image/png;base64,A" } }],
    })
    expect(toOpenAIMessages("sys", messages, { dropImages: true })[1]).toEqual({ role: "user", content: "see" })
  })

  it("shows each attachment on the message, as a link, with the image", () => {
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("see"), attachmentBlock({ url: "automerge:hull", name: "hull.png", image: "data:image/png;base64,A" })])]
    const container = document.createElement("div")
    renderTranscript(container, doc, { open: new Set(), names: new Map(), subject: null, heads: {} }, {})
    const chip = container.querySelector(".agent-attachment-chip")
    expect([chip.dataset.docUrl, chip.textContent, chip.querySelector("img").src]).toEqual(["automerge:hull", "hull.png", "data:image/png;base64,A"])
  })
})

// ---------------------------------------------------------------- drops and pastes

function transfer(data = {}, files = []) {
  return {
    types: [...Object.keys(data), ...(files.length ? ["Files"] : [])],
    getData: (type) => data[type] ?? "",
    files,
    dropEffect: "none",
  }
}

describe("what a drop holds", () => {
  it("documents from the sidebar's rich payload, else its list of URLs; files from the computer", () => {
    const rich = transfer({ "text/x-patchwork-dnd": JSON.stringify({ source: "sideboard", items: [{ url: "automerge:a", name: "A", type: "markdown" }] }), "text/x-patchwork-urls": JSON.stringify(["automerge:a"]) })
    expect(readDrop(rich)).toEqual({ docs: [{ url: "automerge:a", name: "A", type: "markdown" }], files: [] })
    const plain = transfer({ "text/x-patchwork-urls": JSON.stringify(["automerge:a", "automerge:b", "automerge:a", "https://not.a.doc"]) })
    expect(readDrop(plain).docs.map((d) => d.url)).toEqual(["automerge:a", "automerge:b"])
    const file = new File([PNG], "hull.png", { type: "image/png" })
    expect(readDrop(transfer({}, [file])).files).toEqual([file])
    expect([rich, plain, transfer({}, [file]), transfer({ "text/plain": "hi" })].map(carriesAttachments)).toEqual([true, true, true, false])
  })

  it("the images in a paste, and nothing else", () => {
    const image = new File([PNG], "image.png", { type: "image/png" })
    const items = [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => image },
      { kind: "file", type: "application/pdf", getAsFile: () => new File([PDF], "a.pdf") },
    ]
    expect(pastedImages({ items })).toEqual([image])
  })
})

describe("the tray of what goes with the next message", () => {
  function fakeRepo(docs = {}) {
    let n = 0
    const all = { ...docs }
    return {
      all,
      async find(url) {
        if (!all[url]) throw new Error("missing")
        return { url, doc: () => all[url] }
      },
      async create2() {
        const url = `automerge:new${++n}`
        all[url] = {}
        return { url, change: (fn) => fn(all[url]), doc: () => all[url] }
      },
    }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

  it("takes a dragged image file as an image, and any other document as a link", async () => {
    const repo = fakeRepo({ "automerge:hull": imageDoc(), "automerge:plan": { "@patchwork": { type: "markdown" }, title: "Plan", content: "# Plan" } })
    const tray = attachmentTray({ repo })
    tray.addDrop(transfer({ "text/x-patchwork-urls": JSON.stringify(["automerge:hull", "automerge:plan"]) }))
    await settle()
    expect(tray.element.querySelectorAll(".agent-attachment-chip")).toHaveLength(2)
    const taken = tray.take()
    expect(taken.map((a) => [a.url, a.name, a.docType, !!a.image])).toEqual([
      ["automerge:hull", "hull.png", "file", true],
      ["automerge:plan", "Plan", "markdown", false],
    ])
    expect([tray.size(), tray.element.hidden]).toEqual([0, true])
  })

  it("keeps a pasted image as a file document first", async () => {
    const repo = fakeRepo()
    const tray = attachmentTray({ repo })
    tray.addFiles([new File([PNG], "", { type: "image/png" })])
    expect(tray.pending()).toBe(true)
    await settle()
    const [attachment] = tray.take()
    const kept = repo.all[attachment.url]
    expect(kept).toMatchObject({ "@patchwork": { type: "file" }, extension: "png", mimeType: "image/png" })
    expect([...kept.content]).toEqual([...PNG])
    expect(attachment).toMatchObject({ docType: "file", mimeType: "image/png", kept: true })
    expect(attachment.image.startsWith("data:image/png;base64,")).toBe(true)
  })

  it("lets each be taken back before sending", async () => {
    const repo = fakeRepo({ "automerge:plan": { title: "Plan" } })
    const tray = attachmentTray({ repo })
    tray.addDrop(transfer({ "text/x-patchwork-urls": JSON.stringify(["automerge:plan"]) }))
    await settle()
    tray.element.querySelector(".agent-attachment-remove").click()
    expect(tray.take()).toEqual([])
  })
})

import { AgentTool } from "./ui/session-view.js"
import { _reset as resetRunners } from "./runners/registry.js"

describe("in the session view", () => {
  it("a document dropped on the composer goes with the next message", async () => {
    resetRunners()
    document.body.replaceChildren()
    // Send is disabled without a key.
    localStorage.setItem("patchwork-agent:key:openrouter", "sk-or-test")
    const doc = {}
    initSession(doc, {})
    const listeners = new Set()
    const handle = {
      url: "automerge:dropsession",
      doc: () => doc,
      change(fn) {
        fn(doc)
        for (const l of [...listeners]) l({ doc })
      },
      on: (event, fn) => event === "change" && listeners.add(fn),
      off: (event, fn) => listeners.delete(fn),
    }
    const repo = { find: async (url) => ({ url, doc: () => (url === "automerge:plan" ? { "@patchwork": { type: "markdown" }, title: "Plan" } : {}) }) }
    const element = document.createElement("div")
    document.body.append(element)
    const cleanup = AgentTool(handle, element, { repo })
    const composer = element.querySelector(".agent-composer")
    const drop = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(drop, "dataTransfer", { value: transfer({ "text/x-patchwork-urls": JSON.stringify(["automerge:plan"]) }) })
    composer.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(composer.querySelector(".agent-attachment-name").textContent).toBe("Plan")
    element.querySelector(".agent-composer textarea").value = "what is in this?"
    ;[...element.querySelectorAll(".agent-composer button")].find((b) => b.textContent === "Send").click()
    // The first turn: once a key exists the runner may add its own after it.
    await vi.waitFor(() => expect(doc.turns.length).toBeGreaterThan(0))
    const sent = doc.turns[0]
    expect(sent.blocks.map((b) => [b.type, b.text ?? b.url])).toEqual([
      ["text", "what is in this?"],
      ["attachment", "automerge:plan"],
    ])
    cleanup()
    localStorage.clear()
  })
})

describe("a dropped text file", () => {
  it("is kept as text, as Patchwork's own files are, so it reads and edits as a file", async () => {
    const all = {}
    const repo = {
      async create2() {
        const url = "automerge:csvfile"
        all[url] = {}
        return { url, change: (fn) => fn(all[url]), doc: () => all[url] }
      },
    }
    const tray = attachmentTray({ repo })
    tray.addFiles([new File(["part,qty\nLF280K,112\n"], "parts.csv", { type: "text/csv" })])
    await new Promise((resolve) => setTimeout(resolve, 20))
    const [attachment] = tray.take()
    expect(all[attachment.url]).toMatchObject({ name: "parts.csv", extension: "csv", mimeType: "text/csv", content: "part,qty\nLF280K,112\n" })
    expect(attachment.image).toBe(null)
  })
})
