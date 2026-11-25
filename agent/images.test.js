/**
 * An image too large for the provider must not stop a session.
 *
 * Seen in a real session: a screenshot of a long notebook was over 8000 pixels
 * tall, the provider refused every request that carried it, and the session
 * resent it on every retry — stuck for good.
 */
import { describe, it, expect } from "vitest"
import { fitWithin, MAX_IMAGE_SIDE } from "./tools/screenshot.js"
import { stream } from "./providers/openrouter.js"
import { initSession, makeTurn, textBlock, resultBlock, toRequest, rejectSentImages, _resetIds } from "./session/session.js"
import { SessionRunner } from "./kernel/runner.js"
import { memoryStore } from "./kernel/store.js"
import { makeMock } from "./providers/mock.js"

// The provider's own words, from the session that got stuck.
const TOO_BIG = JSON.stringify({
  error: {
    message: "Provider returned error",
    code: 400,
    metadata: { raw: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "messages.4.content.2.image.source.base64.data: At least one of the image dimensions exceed max allowed size: 8000 pixels" } }) },
  },
})

describe("shrinking a capture", () => {
  it.each([
    // [width, height] → [width, height]: no wider than 800, no side over 4000, never enlarged
    [[400, 300], [400, 300]],
    [[800, 600], [800, 600]],
    [[1600, 1200], [800, 600]],
    [[800, 4000], [800, 4000]],
    [[800, 9000], [356, 4000]], // the stuck notebook: tall, not wide
    [[1000, 20000], [200, 4000]],
    [[100, 100000], [4, 4000]],
    [[1, 1], [1, 1]],
  ])("%j fits as %j", ([w, h], expected) => {
    const out = fitWithin(w, h)
    expect([out.width, out.height]).toEqual(expected)
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(MAX_IMAGE_SIDE)
  })

  it("keeps every side within the limit for any maximum width asked for", () => {
    for (const maxWidth of [100, 800, 5000, 20000]) {
      for (const [w, h] of [[20000, 100], [100, 20000], [9000, 9000]]) {
        const out = fitWithin(w, h, { maxWidth })
        expect(out.width).toBeLessThanOrEqual(Math.min(maxWidth, MAX_IMAGE_SIDE))
        expect(out.height).toBeLessThanOrEqual(MAX_IMAGE_SIDE)
      }
    }
  })
})

const streamOf = (chunks) => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close() } })

describe("a provider that refuses an image as too large", () => {
  const withImage = [
    { role: "user", content: [{ type: "text", text: "look" }] },
    { role: "tool", content: [{ type: "result", callId: "c1", output: "mounted", image: "data:image/jpeg;base64,AAA" }] },
  ]

  it("is retried without images, and says the images were refused", async () => {
    const bodies = []
    const retries = []
    const fetchImpl = async (_url, options) => {
      bodies.push(options.body)
      if (bodies.length === 1) return { ok: false, status: 400, headers: { get: () => null }, text: async () => TOO_BIG }
      return { ok: true, status: 200, body: streamOf(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', "data: [DONE]\n\n"]) }
    }
    const events = []
    for await (const e of stream({ system: "", messages: withImage, model: "m", key: "k", fetchImpl, onRetry: (r) => retries.push(r) })) events.push(e)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toContain("image_url")
    expect(bodies[1]).not.toContain("image_url")
    expect(retries).toEqual([expect.objectContaining({ imagesRejected: true })])
    expect(events.some((e) => e.type === "text")).toBe(true)
  })
})

describe("the session, once an image is refused", () => {
  function sessionWithImages(n) {
    _resetIds()
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("user", [textBlock("look")]))
    for (let i = 0; i < n; i++) {
      doc.turns.push(makeTurn("assistant", [{ type: "call", id: `c${i}`, tool: "view_screenshot", input: {}, status: "done" }]))
      doc.turns.push(makeTurn("tool", [resultBlock(`c${i}`, `shot ${i}`, { image: `data:image/jpeg;base64,${i}` })]))
    }
    return doc
  }
  const imagesSent = (doc) => JSON.stringify(toRequest(doc).messages).match(/data:image/g)?.length ?? 0

  it("stops sending the refused images, and only those", () => {
    const doc = sessionWithImages(3)
    expect(imagesSent(doc)).toBe(2) // the newest two ride along
    rejectSentImages(doc)
    expect(imagesSent(doc)).toBe(1) // the oldest, never sent, may still go
    rejectSentImages(doc)
    expect(imagesSent(doc)).toBe(0)
    // The pictures are still in the document; only sending them stopped.
    expect(doc.turns.filter((t) => t.role === "tool").every((t) => t.blocks[0].image)).toBe(true)
  })

  it("the loop marks them when the provider says they were refused", async () => {
    const doc = sessionWithImages(1)
    const provider = makeMock([
      (request) => {
        request.onRetry?.({ attempt: 1, delay: 0, reason: "too large", imagesRejected: true })
        return [{ type: "text", delta: "carrying on" }]
      },
    ])
    const store = memoryStore(doc)
    await new SessionRunner({
      store,
      buildToolset: async () => ({ tools: [], schemas: [], get: () => null }),
      getProvider: async () => provider,
      canRun: () => true,
    }).tick()
    expect(imagesSent(store.doc())).toBe(0)
  })
})
