/**
 * Spending less to do the same work: prompt caching, a compact registry, room
 * for a long tool call, and questions that are asked rather than mentioned.
 */
import { describe, it, expect } from "vitest"
import { buildBody, isClaude } from "../providers/openrouter.js"
import { sessionKey } from "../kernel/loop.js"
import { listRegistries } from "./environment.js"
import { initSession, DEFAULT_CONFIG } from "../session/schema.js"
import { addUsage } from "../session/usage.js"
import { makeTurn, textBlock } from "../session/blocks.js"
import { SessionRunner } from "../kernel/runner.js"
import { memoryStore } from "../kernel/store.js"
import { makeMock } from "../fixtures/mock-provider.js"

describe("prompt caching", () => {
  it("asks Claude to cache the conversation, and leaves other models to cache on their own", () => {
    expect(buildBody({ messages: [], model: "~anthropic/claude-opus-latest" }).cache_control).toEqual({ type: "ephemeral" })
    expect(buildBody({ messages: [], model: "anthropic/claude-sonnet-4.5" }).cache_control).toEqual({ type: "ephemeral" })
    expect("cache_control" in buildBody({ messages: [], model: "openai/gpt-4.1" })).toBe(false)
    expect("cache_control" in buildBody({ messages: [], model: "~anthropic/claude-opus-latest", params: { cache: false } })).toBe(false)
  })

  it("keeps a session on one provider with a key that does not reveal the session", () => {
    const url = "automerge:3PUwC3z8DGeurLS8KAxU7kYQEYkb"
    const key = sessionKey(url)
    expect(key).toBe(sessionKey(url)) // stable
    expect(key).not.toBe(sessionKey("automerge:somethingElse"))
    expect(key).not.toContain("4GaG7") // the URL is a key to the document; it must not leave
    expect(key.length).toBeLessThanOrEqual(256)
    expect(buildBody({ messages: [], model: "x", cacheKey: key }).session_id).toBe(key)
    expect(sessionKey(null)).toBeNull()
  })

  it("the loop sends the session's key with every request", async () => {
    const doc = {}
    initSession(doc, {})
    doc.turns.push(makeTurn("user", [textBlock("hi")]))
    const provider = makeMock([[{ type: "text", delta: "hello" }]])
    const runner = new SessionRunner({
      store: memoryStore(doc),
      ctx: { sessionUrl: "automerge:abc" },
      buildToolset: async () => ({ tools: [], schemas: [], get: () => null }),
      getProvider: async () => provider,
      canRun: () => true,
    })
    await runner.tick()
    expect(provider.requests[0].cacheKey).toBe(sessionKey("automerge:abc"))
  })

  it("counts what came from the cache", () => {
    const doc = {}
    initSession(doc, {})
    addUsage(doc, { in: 40_000, out: 500, cached: 38_000 })
    addUsage(doc, { in: 41_000, out: 400, cached: 40_000 })
    expect(doc.usage.cached).toBe(78_000)
  })

  it.each([
    ["~anthropic/claude-opus-latest", true],
    ["anthropic/claude-haiku-4.5", true],
    ["openai/gpt-4.1", false],
    ["~google/gemini-pro-latest", false],
  ])("%s is Claude: %s", (model, claude) => expect(isClaude(model)).toBe(claude))
})

describe("the registry, listed", () => {
  const registry = (plugins) => ({ all: () => plugins })
  const many = Array.from({ length: 66 }, (_, i) => ({
    id: `tool-${i}`,
    name: `Tool number ${i}`,
    supportedDatatypes: [`type-${i}`],
    importUrl: `automerge:2hxs22RX4yeX4Asn8RpzZ5fhSnzR/dist/index.js#A2gPEpH3XWBCehbB38t6R77ifTgV5H96CPDz4jUxKF39S7kCN`,
  }))
  const registries = new Map([
    ["patchwork:tool", registry([...many, { id: "openscad", name: "OpenSCAD", supportedDatatypes: ["openscad"] }])],
    ["patchwork:datatype", registry([{ id: "openscad", name: "OpenSCAD model" }, { id: "kicad-board", name: "KiCad board" }])],
  ])

  it("is one short line per plugin, without import URLs unless asked", () => {
    const out = listRegistries(registries)
    expect(out.startsWith("69 plugins:")).toBe(true)
    expect(out).toContain("  openscad — OpenSCAD (for openscad)")
    expect(out).not.toContain("automerge:2hxs")
    expect(out.length).toBeLessThan(4000) // was 16,000 for 66 plugins
    expect(listRegistries(registries, { urls: true })).toContain("automerge:2hxs")
  })

  it("finds any of several things in one search", () => {
    const out = listRegistries(registries, { search: "pcb|kicad|scad" })
    expect(out).toMatch(/^3 plugins matching/)
    expect(out).toContain("kicad-board")
    expect(out).toContain("openscad")
  })

  it("matches the datatypes a tool is for, and the registry type", () => {
    expect(listRegistries(registries, { search: "type-12$" })).toContain("tool-12")
    expect(listRegistries(registries, { search: "datatype" })).toMatch(/^2 plugins/)
  })

  it("treats a search that is not a valid regex as plain text, and says when nothing matched", () => {
    expect(listRegistries(registries, { search: "kicad(" })).toBe("0 plugins matched /kicad(/.")
    expect(listRegistries(registries, { type: "patchwork:datatype", search: "nope" })).toBe("0 plugins matched /nope/ in patchwork:datatype.")
  })
})

describe("defaults", () => {
  it("leave room for a long tool call", () => {
    expect(DEFAULT_CONFIG.params.maxTokens).toBe(16000)
  })
})
