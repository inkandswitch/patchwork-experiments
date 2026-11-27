/**
 * The settings panel on its own: what it shows of a session, worked out with
 * no DOM, and what it writes when a person changes something.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { settingsValue, createSettingsPanel, chatGPTState, switchProvider } from "./settings-panel.js"
import chatgpt from "../providers/chatgpt.js"
import { initSession } from "../session/schema.js"
import { memoryStore } from "../kernel/store.js"
import { writeCatalogue } from "../providers/catalogue.js"
import { readKey, readRelay, SEARCH_KEY_ID } from "../providers/keys.js"
import { TIERS, DEFAULT_TIER_MODELS } from "../workflow/plan.js"

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
      placeholders: DEFAULT_TIER_MODELS,
    })
  })

  it("offers each provider, and the tier models of the one in use", () => {
    const v = settingsValue(session({ providerId: "chatgpt", model: "gpt-6.2-sol" }))
    expect(v.provider.id).toBe("chatgpt")
    expect(v.provider.signIn).toBe(true)
    expect(v.provider.options.map((p) => [p.id, p.signIn])).toEqual([["openrouter", false], ["chatgpt", true]])
    expect(v.workflows.placeholders).toEqual(chatgpt.TIER_MODELS)
  })
})

describe("moving a session between providers", () => {
  it("starts a provider on its default, and brings back each provider's last model on return", () => {
    const config = { providerId: "openrouter", model: "lab/thinker" }
    expect(switchProvider(config, "chatgpt")).toBe(true)
    expect([config.providerId, config.model]).toEqual(["chatgpt", chatgpt.DEFAULT_MODEL])
    config.model = "gpt-6-luna"
    switchProvider(config, "openrouter")
    expect(config.model).toBe("lab/thinker")
    switchProvider(config, "chatgpt")
    expect(config.model).toBe("gpt-6-luna")
    expect(config.models).toEqual({ openrouter: "lab/thinker", chatgpt: "gpt-6-luna" })
    expect(switchProvider(config, "chatgpt")).toBe(false)
  })
})

describe("the ChatGPT part's state", () => {
  it("is signed in only with plan use granted, and waiting only once gone to ChatGPT", () => {
    expect(chatGPTState({ signedIn: false, planEnabled: false, pending: false })).toBe("signed-out")
    expect(chatGPTState({ signedIn: false, planEnabled: false, pending: true })).toBe("waiting")
    expect(chatGPTState({ signedIn: true, planEnabled: false, pending: false })).toBe("no-plan")
    expect(chatGPTState({ signedIn: true, planEnabled: false, pending: true })).toBe("waiting")
    expect(chatGPTState({ signedIn: true, planEnabled: true, pending: true })).toBe("signed-in")
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
  const isOpen = (panel) => panel.element.open || panel.element.hasAttribute("open")
  const button = (panel, text) => [...panel.element.querySelectorAll("button")].find((b) => b.textContent === text)

  it("is a dialog, opened and shut from the model button, loading the catalogue once open", async () => {
    writeCatalogue("openrouter", [THINKER, PLAIN])
    const { panel, q } = make()
    expect(panel.element.tagName).toBe("DIALOG")
    expect(isOpen(panel)).toBe(false)
    panel.toggle()
    expect(isOpen(panel)).toBe(true)
    await vi.waitFor(() => expect(q("datalist").children.length).toBe(2))
    expect([...q("select").options].map((o) => o.textContent)).toEqual(["model default (medium)", "low", "high"])
    panel.toggle()
    expect(isOpen(panel)).toBe(false)
  })

  it("shuts from its close button and Cancel, and reveal() opens it only once", () => {
    const { panel } = make()
    panel.reveal()
    expect(isOpen(panel)).toBe(true)
    button(panel, "×").click()
    expect(isOpen(panel)).toBe(false)
    panel.reveal()
    expect(isOpen(panel)).toBe(false)
    panel.toggle()
    button(panel, "Cancel").click()
    expect(isOpen(panel)).toBe(false)
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
    const model = q("input.agent-model-input")
    change(model, "lab/thinker")
    expect(changes()).toBe(0)
    change(model, "lab/plain")
    expect([store.doc().config.model, changes()]).toEqual(["lab/plain", 1])
  })

  it("does not overwrite the model being typed", () => {
    const { panel, store, q } = make()
    const model = q("input.agent-model-input")
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
    q("input[type=url][placeholder^=https]").value = "https://relay.test"
    relayKey.value = "relay-secret"
    searchKey.value = "brave-key"
    button(panel, "Save").click()
    expect([readKey("openrouter"), readKey(SEARCH_KEY_ID), readRelay(), keys]).toEqual(["sk-or-new", "brave-key", { url: "https://relay.test", key: "relay-secret" }, ["sk-or-new"]])
    expect([key.value, relayKey.value, searchKey.value, isOpen(panel)]).toEqual(["", "", "", false])
    // Nothing of it is written to the session.
    expect(JSON.stringify(store.doc())).not.toMatch(/sk-or-new|relay-secret|brave-key/)
  })

  it("moves the session to another provider on its default model, and shows that provider's credential", () => {
    const { panel, store, q } = make()
    panel.toggle()
    const radio = q("input[type=radio][value=chatgpt]")
    radio.checked = true
    radio.dispatchEvent(new Event("change"))
    expect([store.doc().config.providerId, store.doc().config.model]).toEqual(["chatgpt", chatgpt.DEFAULT_MODEL])
    expect(q(".agent-chatgpt").hidden).toBe(false)
    expect(q("input[type=password]").closest(".agent-credential").hidden).toBe(true)
    expect(q("input[data-tier=deep]").placeholder).toBe(chatgpt.TIER_MODELS.deep)
  })
})

describe("signing in to ChatGPT from the panel", () => {
  const b64 = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const jwt = (claims) => `${b64({ alg: "RS256" })}.${b64(claims)}.c2ln`

  afterEach(() => vi.unstubAllGlobals())
  const button = (panel, text) => [...panel.element.querySelectorAll("button")].find((b) => b.textContent === text)

  it("says a browser needs the fetch relay for ChatGPT until one is set", () => {
    localStorage.removeItem("patchwork-agent:relay")
    const store = memoryStore(session({ providerId: "chatgpt", model: "gpt-6.2-sol" }))
    const panel = createSettingsPanel({ store })
    document.body.replaceChildren(panel.element)
    panel.render(store.doc())
    panel.toggle()
    const relayNote = panel.element.querySelector(".agent-chatgpt-relay")
    expect(relayNote.hidden).toBe(false)
    expect(relayNote.textContent).toMatch(/fetch relay/)
    localStorage.setItem("patchwork-agent:relay", JSON.stringify({ url: "https://relay.test", key: "" }))
    panel.toggle()
    panel.toggle()
    expect(relayNote.hidden).toBe(true)
    localStorage.removeItem("patchwork-agent:relay")
  })

  it("opens ChatGPT with a link made ahead, takes the pasted address, and shows the plan in use", async () => {
    const store = memoryStore(session({ providerId: "chatgpt", model: "gpt-6.2-sol" }))
    const told = []
    const panel = createSettingsPanel({ store, onKey: () => told.push("key") })
    document.body.replaceChildren(panel.element)
    panel.render(store.doc())
    panel.toggle()
    const q = (selector) => panel.element.querySelector(selector)
    const link = q("a.agent-chatgpt-button")
    await vi.waitFor(() => expect(link.getAttribute("href")).toMatch(/^https:\/\/auth\.openai\.com\/api\/accounts\/authorize\?/))
    const sent = new URL(link.href).searchParams
    expect([sent.get("client_id"), sent.get("agent_name_hint"), sent.get("redirect_uri")]).toEqual(["dynamic_agent_client", "Patchwork", "http://127.0.0.1:1455/auth/callback"])
    expect(link.target).toBe("_blank")

    link.addEventListener("click", (event) => event.preventDefault(), { once: true })
    link.click()
    await vi.waitFor(() => expect(q(".agent-chatgpt-waiting").hidden).toBe(false))

    const fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            refresh_token: "refresh-1",
            id_token: jwt({ iss: "https://auth.openai.com", aud: "oaiapp_made_up", sub: "user-1", email: "someone@example.test", exp: Math.floor(Date.now() / 1000) + 600, nonce: JSON.parse(localStorage.getItem("patchwork-agent:chatgpt-pending")).nonce }),
            expires_in: 3600,
            scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }
      return new Response(JSON.stringify({ models: [] }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetch)
    q(".agent-chatgpt-waiting input").value = `http://127.0.0.1:1455/auth/callback?code=made-up-code&state=${sent.get("state")}&client_id=oaiapp_made_up`
    button(panel, "Connect").click()
    await vi.waitFor(() => expect(q(".agent-chatgpt-status").textContent).toBe("Signed in as someone@example.test. Requests use your ChatGPT plan."))
    expect(q(".agent-chatgpt-welcome").hidden).toBe(false)
    expect([...panel.element.querySelectorAll("a")].find((a) => a.textContent.startsWith("Manage usage")).href).toBe("https://chatgpt.com/settings/usage")
    expect(told).toEqual(["key"])
    // The tokens are this device's; nothing of them is in the session.
    expect(JSON.stringify(store.doc())).not.toMatch(/refresh-1|made-up-code/)
  })

  it("says what went wrong with an address from another attempt", async () => {
    const store = memoryStore(session({ providerId: "chatgpt", model: "gpt-6.2-sol" }))
    const panel = createSettingsPanel({ store })
    document.body.replaceChildren(panel.element)
    panel.render(store.doc())
    panel.toggle()
    const q = (selector) => panel.element.querySelector(selector)
    await vi.waitFor(() => expect(q("a.agent-chatgpt-button").getAttribute("href")).toBeTruthy())
    q("a.agent-chatgpt-button").addEventListener("click", (event) => event.preventDefault(), { once: true })
    q("a.agent-chatgpt-button").click()
    await vi.waitFor(() => expect(q(".agent-chatgpt-waiting").hidden).toBe(false))
    q(".agent-chatgpt-waiting input").value = "http://127.0.0.1:1455/auth/callback?code=x&state=not-this-one"
    button(panel, "Connect").click()
    await vi.waitFor(() => expect(q(".agent-error").textContent).toMatch(/state does not match/))
  })
})
