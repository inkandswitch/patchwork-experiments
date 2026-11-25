import { describe, it, expect, beforeEach } from "vitest"
import { describeModel } from "./openrouter.js"
import { readCatalogue, writeCatalogue, loadCatalogue, modelInfo, _resetModelInfo } from "./index.js"

const MODELS = [
  { id: "anthropic/claude-opus-4.1", label: "Claude Opus 4.1", context: 200000, promptPerM: 15, tools: true },
  { id: "meta/free-thing", label: "Free Thing", context: 8000, promptPerM: 0, tools: false },
]

beforeEach(() => {
  localStorage.clear()
  _resetModelInfo()
})

describe("describeModel", () => {
  it("says what it is, how big, and what it costs", () => {
    expect(describeModel(MODELS[0])).toBe("Claude Opus 4.1 · 200k ctx · $15.00/M in")
  })

  it("calls free models free, and flags what cannot use tools", () => {
    expect(describeModel(MODELS[1])).toBe("Free Thing · 8k ctx · free · no tool use")
  })

  it("degrades when the catalogue omits fields", () => {
    expect(describeModel({ id: "x", label: "X", tools: true })).toBe("X")
  })
})

describe("the catalogue cache", () => {
  it("round-trips and reports freshness", () => {
    writeCatalogue("openrouter", MODELS)
    const cached = readCatalogue("openrouter")
    expect(cached.models).toHaveLength(2)
    expect(cached.stale).toBe(false)
  })

  it("marks a day-old cache stale", () => {
    localStorage.setItem(
      "patchwork-agent:models:openrouter",
      JSON.stringify({ at: Date.now() - 48 * 60 * 60 * 1000, models: MODELS })
    )
    expect(readCatalogue("openrouter").stale).toBe(true)
  })

  it("ignores an empty or corrupt cache", () => {
    localStorage.setItem("patchwork-agent:models:openrouter", "{not json")
    expect(readCatalogue("openrouter")).toBeNull()
    localStorage.setItem("patchwork-agent:models:openrouter", JSON.stringify({ at: Date.now(), models: [] }))
    expect(readCatalogue("openrouter")).toBeNull()
  })
})

describe("loadCatalogue", () => {
  it("serves a fresh cache without touching the network", async () => {
    writeCatalogue("openrouter", MODELS)
    const { models, cached } = await loadCatalogue("openrouter")
    expect(cached).toBe(true)
    expect(models).toHaveLength(2)
  })

  it("keeps a stale list when the network fails, rather than showing nothing", async () => {
    localStorage.setItem(
      "patchwork-agent:models:openrouter",
      JSON.stringify({ at: 0, models: MODELS })
    )
    // getProvider("openrouter").models will really try to fetch; stub global fetch.
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error("offline") }
    try {
      const { models, cached, error } = await loadCatalogue("openrouter", { force: true })
      expect(cached).toBe(true)
      expect(models).toHaveLength(2)
      expect(error).toMatch(/offline/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("throws only when there is no cache and no network", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error("offline") }
    try {
      await expect(loadCatalogue("openrouter")).rejects.toThrow(/offline/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("modelInfo", () => {
  const WITH_INFO = [
    { ...MODELS[0], supports: ["temperature", "tools"], maxOutput: 32000, defaults: { temperature: 1 }, efforts: ["high", "low"], defaultEffort: "high" },
    { ...MODELS[1], supports: null, maxOutput: null, defaults: {}, efforts: [], defaultEffort: null },
  ]

  it("answers from a fresh cache without touching the network", async () => {
    writeCatalogue("openrouter", WITH_INFO)
    const info = await modelInfo("openrouter", "anthropic/claude-opus-4.1")
    expect(info.supports).toEqual(["temperature", "tools"])
    expect(info.maxOutput).toBe(32000)
  })

  it("has no opinion about a model it has never heard of, or no model at all", async () => {
    writeCatalogue("openrouter", WITH_INFO)
    expect(await modelInfo("openrouter", "brand/new-this-morning")).toBeNull()
    expect(await modelInfo("openrouter", null)).toBeNull()
  })

  it("remembers what it found, so a worker does not refetch every turn", async () => {
    writeCatalogue("openrouter", WITH_INFO)
    const first = await modelInfo("openrouter", "anthropic/claude-opus-4.1")
    localStorage.clear()
    const second = await modelInfo("openrouter", "anthropic/claude-opus-4.1")
    expect(second).toBe(first)
  })
})
