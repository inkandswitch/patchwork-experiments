import { describe, it, expect, beforeEach } from "vitest"
import { readKey, writeKey, onKeyChange, connectAccountKeys, _resetAccountKeys } from "./providers/index.js"

const SETTINGS = "automerge:llm-settings"
const LOCAL = "patchwork-agent:key:openrouter"

/** A settings document with just enough of a DocHandle: doc, change, on, off. */
function fakeHandle(initial = {}) {
  let doc = structuredClone(initial)
  const listeners = new Set()
  return {
    doc: () => doc,
    change(fn) {
      fn(doc)
      doc = structuredClone(doc)
      for (const listener of [...listeners]) listener({ doc })
    },
    on: (event, fn) => event === "change" && listeners.add(fn),
    off: (_event, fn) => listeners.delete(fn),
  }
}

/** Something above the view that answers tool storage for the `llm` id only. */
function frame({ answer = true } = {}) {
  const element = document.createElement("div")
  document.body.append(element)
  const asked = []
  element.addEventListener("patchwork:subscribe", (event) => {
    const { selector, port } = event.detail
    if (selector.type !== "patchwork:tool-storage") return
    asked.push(selector.toolId)
    if (answer && selector.toolId === "llm") port.postMessage({ type: "change", value: SETTINGS })
  })
  return { element, asked }
}

function repoWith(handle) {
  return { find: async (url) => (url === SETTINGS ? handle : null) }
}

beforeEach(() => {
  _resetAccountKeys()
  localStorage.clear()
  document.body.replaceChildren()
})

describe("API keys", () => {
  it("live on this device until the account answers", () => {
    writeKey("openrouter", "sk-or-local")
    expect(localStorage.getItem(LOCAL)).toBe("sk-or-local")
    expect(readKey("openrouter")).toBe("sk-or-local")
  })

  it("are read from the llm library's settings, under its own id", async () => {
    const settings = fakeHandle({ openrouter: { apiKey: "sk-or-account", model: "x" } })
    const { element, asked } = frame()
    expect(await connectAccountKeys(element, repoWith(settings))).toBe(true)
    expect(asked).toEqual(["llm"])
    expect(readKey("openrouter")).toBe("sk-or-account")
  })

  it("move a device's key into the account when the account has none", async () => {
    localStorage.setItem(LOCAL, "sk-or-local")
    // The library writes "" for no key, so that has to count as none.
    const settings = fakeHandle({ openrouter: { apiKey: "", model: "x" } })
    await connectAccountKeys(frame().element, repoWith(settings))
    expect(settings.doc().openrouter).toEqual({ apiKey: "sk-or-local", model: "x" })
    expect(localStorage.getItem(LOCAL)).toBeNull()
  })

  it("prefer the account's key and leave a different local one alone", async () => {
    localStorage.setItem(LOCAL, "sk-or-local")
    const settings = fakeHandle({ openrouter: { apiKey: "sk-or-account" } })
    await connectAccountKeys(frame().element, repoWith(settings))
    expect(readKey("openrouter")).toBe("sk-or-account")
    expect(settings.doc().openrouter.apiKey).toBe("sk-or-account")
  })

  it("are written to the account, beside the model, once it has answered", async () => {
    const settings = fakeHandle({ openrouter: { model: "x" } })
    await connectAccountKeys(frame().element, repoWith(settings))
    writeKey("openrouter", "sk-or-new")
    expect(settings.doc().openrouter).toEqual({ model: "x", apiKey: "sk-or-new" })
    expect(localStorage.getItem(LOCAL)).toBeNull()
  })

  it("create the provider's group in a settings document that has none", async () => {
    const settings = fakeHandle({})
    await connectAccountKeys(frame().element, repoWith(settings))
    writeKey("openrouter", "sk-or-new")
    expect(settings.doc().openrouter.apiKey).toBe("sk-or-new")
  })

  it("report a change made from elsewhere", async () => {
    const settings = fakeHandle({ openrouter: { apiKey: "sk-or-old" } })
    await connectAccountKeys(frame().element, repoWith(settings))
    const seen = []
    onKeyChange(() => seen.push(readKey("openrouter")))
    settings.change((d) => {
      d.openrouter.apiKey = "sk-or-picker"
    })
    expect(seen).toEqual(["sk-or-picker"])
  })

  it("stay local when nothing answers, and the next caller tries again", async () => {
    writeKey("openrouter", "sk-or-local")
    const silent = frame({ answer: false })
    expect(await connectAccountKeys(silent.element, repoWith(null), { timeoutMs: 10 })).toBe(false)
    expect(readKey("openrouter")).toBe("sk-or-local")

    const settings = fakeHandle({})
    expect(await connectAccountKeys(frame().element, repoWith(settings))).toBe(true)
    expect(settings.doc().openrouter.apiKey).toBe("sk-or-local")
  })
})
