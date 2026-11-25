import { describe, it, expect } from "vitest"
import { initSession } from "./session/schema.js"
import { makeTurn, callBlock, resultBlock } from "./session/blocks.js"
import { toRequest, MAX_IMAGES_IN_REQUEST } from "./session/request.js"
import { toOpenAIMessages } from "./providers/openrouter.js"
import { runTool } from "./kernel/tool.js"
import { canvasWithin, viewScreenshot, layOut } from "./tools/screenshot.js"

const IMAGE = "data:image/jpeg;base64,AAAA"

describe("a tool that answers with a picture", () => {
  it("separates the image from the text", async () => {
    const tool = { id: "view_screenshot", execute: async () => ({ image: IMAGE, text: "Captured 800×600" }) }
    const result = await runTool(tool, {}, {})
    expect(result.image).toBe(IMAGE)
    expect(result.output).toBe("Captured 800×600")
  })

  it("leaves ordinary string results alone", async () => {
    const result = await runTool({ id: "x", execute: async () => "just words" }, {}, {})
    expect(result.image).toBeNull()
    expect(result.output).toBe("just words")
  })
})

describe("images in the request", () => {
  const withScreenshots = (count) => {
    const doc = {}
    initSession(doc, {})
    for (let i = 0; i < count; i++) {
      doc.turns.push(makeTurn("assistant", [callBlock("view_screenshot", {}, { id: `c${i}` })]))
      doc.turns.push(
        makeTurn("tool", [resultBlock(`c${i}`, `shot ${i}`, { image: `${IMAGE}${i}`, id: `r${i}` })])
      )
    }
    return doc
  }

  it("carries a recent screenshot through", () => {
    const { messages } = toRequest(withScreenshots(1))
    const result = messages.flatMap((m) => m.content).find((p) => p.type === "result")
    expect(result.image).toBe(`${IMAGE}0`)
  })

  it("only carries the most recent few, because images cost every turn", () => {
    const { messages } = toRequest(withScreenshots(5))
    const results = messages.flatMap((m) => m.content).filter((p) => p.type === "result")

    const carried = results.filter((r) => r.image)
    expect(carried).toHaveLength(MAX_IMAGES_IN_REQUEST)
    // the newest ones survive
    expect(carried.at(-1).image).toBe(`${IMAGE}4`)
  })

  it("tells the model an older screenshot was dropped rather than hiding it", () => {
    const { messages } = toRequest(withScreenshots(5))
    const dropped = messages
      .flatMap((m) => m.content)
      .filter((p) => p.type === "result" && !p.image)
    expect(dropped[0].output).toMatch(/screenshot from earlier, not re-sent/)
  })

  it("respects an explicit limit", () => {
    const { messages } = toRequest(withScreenshots(3), { maxImages: 1 })
    const carried = messages.flatMap((m) => m.content).filter((p) => p.type === "result" && p.image)
    expect(carried).toHaveLength(1)
  })
})

describe("the provider sends images the way vision models expect", () => {
  it("follows the tool message with a user message carrying the image", () => {
    const out = toOpenAIMessages("", [
      { role: "tool", content: [{ type: "result", callId: "c1", output: "Captured", image: IMAGE }] },
    ])

    expect(out[0]).toEqual({ role: "tool", tool_call_id: "c1", content: "Captured" })
    expect(out[1].role).toBe("user")
    expect(out[1].content[1]).toEqual({ type: "image_url", image_url: { url: IMAGE } })
  })

  it("does not invent a user message when there is no image", () => {
    const out = toOpenAIMessages("", [
      { role: "tool", content: [{ type: "result", callId: "c1", output: "text only" }] },
    ])
    expect(out).toHaveLength(1)
  })
})

describe("canvasWithin", () => {
  it("finds a lone canvas, and declines an ambiguous one", () => {
    const holder = document.createElement("div")
    expect(canvasWithin(holder)).toBeNull()

    const canvas = document.createElement("canvas")
    holder.append(canvas)
    expect(canvasWithin(holder)).toBe(canvas)

    holder.append(document.createElement("canvas"))
    expect(canvasWithin(holder)).toBeNull() // two canvases: rasterize the DOM instead
  })

  it("recognises a canvas passed directly", () => {
    const canvas = document.createElement("canvas")
    expect(canvasWithin(canvas)).toBe(canvas)
  })
})

describe("view_screenshot", () => {
  it("needs a real mount when given a mountId", async () => {
    await expect(
      viewScreenshot.execute({ mountId: "nope" }, { getMount: () => null })
    ).rejects.toThrow(/No mount 'nope'/)
  })

  it("refuses an element with no size, and says why", async () => {
    const element = document.createElement("div")
    document.body.append(element)
    await expect(
      viewScreenshot.execute({ mountId: "m" }, { getMount: () => ({ container: element }) })
    ).rejects.toThrow(/no size/)
  })
})

describe("a mount whose transcript view is collapsed", () => {
  /** A container that has a size only where a browser would give it one: in the off-screen holder. */
  function collapsed() {
    const hidden = document.createElement("div") // the transcript's display:none body
    const after = document.createElement("span")
    const container = document.createElement("div")
    hidden.append(container, after)
    document.body.append(hidden)
    const laidOut = () => container.parentElement?.classList.contains("agent-mount-holder")
    Object.defineProperties(container, {
      clientWidth: { get: () => (laidOut() ? 600 : 0) },
      clientHeight: { get: () => (laidOut() ? 400 : 0) },
    })
    return { hidden, container, after, laidOut }
  }

  it("is laid out for the capture and put back exactly where it was", async () => {
    const { hidden, container, after, laidOut } = collapsed()
    const putBack = await layOut(container, document)
    expect(laidOut()).toBe(true)
    putBack()
    expect([...hidden.children]).toEqual([container, after])
    expect(document.querySelector(".agent-mount-holder")).toBeNull()
  })

  it("view_screenshot measures it laid out instead of failing with 0×0", async () => {
    const { hidden, container, laidOut } = collapsed()
    let measuredLaidOut = null
    const canvas = document.createElement("canvas")
    canvas.toDataURL = () => (measuredLaidOut = laidOut(), "x") // too short to be a picture: stops after the size check
    container.append(canvas)
    const attempt = viewScreenshot.execute({ mountId: "m" }, { getMount: () => ({ container }) })
    await expect(attempt).rejects.toThrow(/canvas read back empty/)
    expect(measuredLaidOut).toBe(true)
    expect(container.parentElement).toBe(hidden)
  })

  it("leaves a container that already has a size where it is", async () => {
    const container = document.createElement("div")
    Object.defineProperties(container, { clientWidth: { value: 300 }, clientHeight: { value: 200 } })
    document.body.append(container)
    const putBack = await layOut(container, document)
    expect(container.parentElement).toBe(document.body)
    putBack()
    expect(container.parentElement).toBe(document.body)
  })
})

describe("a picture of a view with images in it", () => {
  /** A document whose canvases draw by recording, since happy-dom has no 2D context. */
  function drawingDoc() {
    const drawn = []
    const doc = {
      createElement(tag) {
        const node = document.createElement(tag)
        if (tag === "canvas") {
          node.getContext = () => ({ drawImage: (img) => drawn.push(img.getAttribute("src")) })
          node.toDataURL = () => `data:image/png;base64,PIXELS${drawn.length}`
        }
        return node
      },
    }
    return { doc, drawn }
  }

  const loadedImage = (src, { complete = true } = {}) => {
    const img = document.createElement("img")
    img.setAttribute("src", src)
    Object.defineProperties(img, {
      complete: { value: complete },
      naturalWidth: { value: complete ? 40 : 0 },
      naturalHeight: { value: complete ? 30 : 0 },
    })
    return img
  }

  it("carries each loaded image's pixels, which the SVG could not fetch from a blob: URL", async () => {
    const { inlineImages } = await import("./tools/screenshot.js")
    const view = document.createElement("div")
    view.append(loadedImage("blob:https://patchwork/abc"), loadedImage("data:image/png;base64,KEPT"), loadedImage("blob:https://patchwork/late", { complete: false }))
    const clone = view.cloneNode(true)
    const { doc, drawn } = drawingDoc()
    inlineImages(view, clone, doc)
    expect([...clone.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
      "data:image/png;base64,PIXELS1",
      "data:image/png;base64,KEPT",
      "blob:https://patchwork/late",
    ])
    expect(drawn).toEqual(["blob:https://patchwork/abc"])
  })

  it("and when the element photographed is itself the image", async () => {
    const { inlineImages } = await import("./tools/screenshot.js")
    const img = loadedImage("blob:https://patchwork/only")
    const clone = img.cloneNode(true)
    inlineImages(img, clone, drawingDoc().doc)
    expect(clone.getAttribute("src")).toBe("data:image/png;base64,PIXELS1")
  })
})
