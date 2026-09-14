import { describe, it, expect } from "vitest"
import { initSession, makeTurn, callBlock, resultBlock, toRequest, MAX_IMAGES_IN_REQUEST } from "./session.js"
import { toOpenAIMessages } from "./providers/openrouter.js"
import { runTool } from "./tools/index.js"
import { canvasWithin, viewScreenshot } from "./tools/screenshot.js"
import { changeMessage, contactFromMessage, isAgentChange, applyChange } from "./identity.js"

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

describe("identity", () => {
  it("stamps and recovers a contact from a change message", () => {
    const message = changeMessage("automerge:contact1")
    expect(contactFromMessage(message)).toBe("automerge:contact1")
    expect(isAgentChange(message)).toBe(true)
  })

  it("does not claim a human change", () => {
    expect(contactFromMessage(null)).toBeNull()
    expect(contactFromMessage("edited the title")).toBeNull()
    expect(isAgentChange(undefined)).toBe(false)
  })

  it("passes the message through to automerge when one exists", () => {
    const calls = []
    const handle = { change: (fn, options) => calls.push(options) }
    applyChange(handle, () => {}, { changeMessage: "patchwork-agent:x" })
    applyChange(handle, () => {}, {})
    expect(calls).toEqual([{ message: "patchwork-agent:x" }, undefined])
  })
})
