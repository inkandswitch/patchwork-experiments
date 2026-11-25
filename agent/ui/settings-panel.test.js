/**
 * The settings panel on its own: what it shows of a session, worked out with
 * no DOM, and what it writes when a person changes something.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { settingsValue, createSettingsPanel } from "./settings-panel.js"
import { initSession } from "../session/schema.js"
import { memoryStore } from "../kernel/store.js"
import { writeCatalogue } from "../providers/catalogue.js"
import { readKey, readRelay, SEARCH_KEY_ID } from "../providers/keys.js"
import { TIERS } from "../workflow/plan.js"

const session = (config = {}) => {
  const doc = {}
  initSession(doc, {})
  Object.assign(doc.config, config)
  return doc
}

const THINKER = { id: "lab/thinker", label: "Thinker", efforts: ["low", "high"], defaultEffort: "medium", maxOutput: 64000, defaults: { temperature: 1 }, tools: true }
const PLAIN = { id: "lab/plain", label: "Plain", efforts: [], tools: true }

beforeEach(() => localStorage.clear())

describe("what the panel shows of a session", () => {
  it("offers effort levels only once it knows the model", () => {
    expect(settingsValue(session({ model: "lab/thinker" }), null).effort).toEqual({
      options: [["", "model default"]],
      chosen: "",
      disabled: true,
      note: "Open the model list to see which effort levels this model takes.",
    })
    expect(settingsValue(session({ model: "lab/thinker", params: { reasoning: { effort: "high" } } }), [THINKER]).effort).toEqual({
      options: [["", "model default (medium)"], ["low", "low"], ["high", "high"]],
      chosen: "high",
      disabled: false,
      note: "Higher thinks longer before acting: better on hard problems, slower and dearer.",
    })
  })

  it("keeps a level the model does not take in sight, and is off for a model with none", () => {
    const kept = settingsValue(session({ model: "lab/plain", params: { reasoning: { effort: "high" } } }), [PLAIN]).effort
    expect(kept).toEqual({
      options: [["", "model default"], ["high", "high (not taken by this model)"]],
      chosen: "high",
      disabled: false,
      note: "This model has no effort setting.",
    })
    expect(settingsValue(session({ model: "lab/plain" }), [PLAIN]).effort.disabled).toBe(true)
  })

  it("says what the model runs at, and what the session overrides, leaving out what has controls of its own", () => {
    const doc = session({ model: "lab/thinker", params: { temperature: 0.2, maxTokens: 5, reasoning: { effort: "low" } } })
    expect(settingsValue(doc, [THINKER]).defaults).toBe("Runs at its authors' defaults: temperature 1 · up to 64k output tokens · This session overrides: temperature 0.2")
    expect(settingsValue(session({ model: "lab/plain" }), [PLAIN]).defaults).toBe("")
    expect(settingsValue(doc, null).defaults).toBe("")
  })

  it("shows the workflow limits and tier models the session set, and blanks for the rest", () => {
    const v = settingsValue(session({ workflows: { enabled: true, parallel: 3, tiers: { deep: "lab/thinker" } } }))
    expect(v.workflows).toEqual({
      enabled: true,
      limits: { parallel: 3, steps: "", cost: "" },
      tiers: Object.fromEntries(TIERS.map((tier) => [tier, tier === "deep" ? "lab/thinker" : ""])),
    })
  })
})

describe("the panel", () => {
  function make(config = { model: "lab/thinker" }) {
    const store = memoryStore(session(config))
    const keys = []
    let changes = 0
    const panel = createSettingsPanel({ store, onKey: (key) => keys.push(key), onChange: () => changes++ })
    document.body.replaceChildren(panel.element)
    panel.render(store.doc())
    const q = (selector) => panel.element.querySelector(selector)
    return { store, panel, keys, q, changes: () => changes }
  }
  const change = (input, value) => {
    input.value = value
    input.dispatchEvent(new Event("change"))
  }

  it("opens and shuts from the model button, loading the catalogue once open", async () => {
    writeCatalogue("openrouter", [THINKER, PLAIN])
    const { panel, q } = make()
    expect(panel.element.style.display).toBe("none")
    panel.toggle()
    expect(panel.element.style.display).toBe("flex")
    await vi.waitFor(() => expect(q("datalist").children.length).toBe(2))
    expect([...q("select").options].map((o) => o.textContent)).toEqual(["model default (medium)", "low", "high"])
    panel.toggle()
    expect(panel.element.style.display).toBe("none")
  })

  it("writes the effort, and taking it away leaves no empty reasoning behind", async () => {
    writeCatalogue("openrouter", [THINKER])
    const { panel, store, q } = make()
    panel.toggle()
    await vi.waitFor(() => expect(q("select").disabled).toBe(false))
    change(q("select"), "high")
    expect(store.doc().config.params.reasoning).toEqual({ effort: "high" })
    panel.render(store.doc())
    change(q("select"), "")
    expect("reasoning" in store.doc().config.params).toBe(false)
  })

  it("writes a model chosen, and nothing for the one already in use", () => {
    const { store, q, changes } = make()
    const model = q("input[list=agent-model-list]")
    change(model, "lab/thinker")
    expect(changes()).toBe(0)
    change(model, "lab/plain")
    expect([store.doc().config.model, changes()]).toEqual(["lab/plain", 1])
  })

  it("does not overwrite the model being typed", () => {
    const { panel, store, q } = make()
    const model = q("input[list=agent-model-list]")
    model.focus()
    model.value = "lab/pl"
    store.change((d) => (d.config.model = "lab/other"))
    panel.render(store.doc())
    expect(model.value).toBe("lab/pl")
  })

  it("records workflow limits as numbers, and a blank as none", () => {
    const { store, q } = make({ workflows: { enabled: true } })
    change(q("input[data-key=cost]"), "2.5")
    change(q("input[data-key=parallel]"), "4")
    change(q("input[data-key=parallel]"), "")
    expect(store.doc().config.workflows).toEqual({ enabled: true, cost: 2.5 })
  })

  it("saves keys to this browser, hands the model key on, and shuts", () => {
    const { panel, keys, store, q } = make()
    panel.toggle()
    const [key, relayKey, searchKey] = panel.element.querySelectorAll("input[type=password]")
    key.value = "sk-or-new"
    q("input[type=url]").value = "https://relay.test"
    relayKey.value = "relay-secret"
    searchKey.value = "brave-key"
    ;[...panel.element.querySelectorAll("button")].find((b) => b.textContent === "Save").click()
    expect([readKey("openrouter"), readKey(SEARCH_KEY_ID), readRelay(), keys]).toEqual(["sk-or-new", "brave-key", { url: "https://relay.test", key: "relay-secret" }, ["sk-or-new"]])
    expect([key.value, relayKey.value, searchKey.value, panel.element.style.display]).toEqual(["", "", "", "none"])
    // Nothing of it is written to the session.
    expect(JSON.stringify(store.doc())).not.toMatch(/sk-or-new|relay-secret|brave-key/)
  })
})
