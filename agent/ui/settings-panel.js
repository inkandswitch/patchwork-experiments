/**
 * The session's settings: which provider runs it and how this browser pays
 * for it (a key, or a ChatGPT sign-in), its model and effort, whether it may
 * run workflows and with what, and the relay and search key this account
 * keeps.
 *
 * It opens as a dialog over the whole page, not inside the sidebar: a panel
 * the width of a sidebar was too narrow to use. A native modal `<dialog>`
 * sits above everything, closes on Escape and on a click outside it, and
 * gives focus back to the button that opened it.
 *
 * What the panel shows of the session is `settingsValue(doc, models)`, a pure
 * function of the session and the model catalogue; `createSettingsPanel`
 * draws it and writes what a person changes.
 *
 *   createSettingsPanel({ store, onKey, onChange })
 *     element      the dialog, shut until opened
 *     toggle()     open or shut it, as the header's model button does
 *     reveal()     open it once, as the view does for a session with no key
 *     render(doc)  bring the fields up to date with the session
 *
 * `onKey(key)` is told when this browser can now run the session (a key
 * saved, a sign-in finished); `onChange()` after anything written.
 */

import {
  readKey,
  writeKey,
  readRelay,
  writeRelay,
  freshCredential,
  hasCredential,
  onKeyChange,
  beginChatGPTSignIn,
  finishChatGPTSignIn,
  signOutChatGPT,
  forgetChatGPT,
  chatgptAuth,
  SEARCH_KEY_ID,
} from "../providers/keys.js"
import { loadCatalogue } from "../providers/catalogue.js"
import { getProvider, listProviders, defaultsOf } from "../providers/index.js"
import { USAGE_URL } from "../providers/chatgpt.js"
import { DEFAULT_CONFIG } from "../session/schema.js"
import { DEFAULT_LIMITS, TIERS, tierModelsFor } from "../workflow/plan.js"
import { morph } from "./morph.js"

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

const LIMIT_KEYS = ["parallel", "steps", "cost"]

/** What each provider is, said to a person choosing. */
const PROVIDER_BLURB = {
  openrouter: "Pay per token with an OpenRouter API key. Every model, from every lab.",
  chatgpt: "Use your ChatGPT plan (Plus, Pro, Go or Business). No API key; your plan's limits apply.",
}

/**
 * What the panel shows of the session. `models` is the catalogue, or null
 * before it has loaded.
 */
export function settingsValue(doc, models = null) {
  const config = doc?.config ?? {}
  const providerId = config.providerId ?? "openrouter"
  const info = (models ?? []).find((m) => m.id === config.model) ?? null
  const chosen = config.params?.reasoning?.effort ?? ""
  const efforts = info?.efforts ?? []
  const options = [["", info?.defaultEffort ? `model default (${info.defaultEffort})` : "model default"]]
  for (const effort of efforts) options.push([effort, effort])
  // A level kept from a previous model stays visible rather than vanishing
  // from the control; the request leaves it out while this model is in use.
  if (chosen && !efforts.includes(chosen)) options.push([chosen, `${chosen} (not taken by this model)`])

  const w = config.workflows ?? {}
  return {
    provider: {
      id: providerId,
      options: listProviders().map((p) => ({ id: p.id, name: p.name, blurb: PROVIDER_BLURB[p.id] ?? "", signIn: p.signIn })),
      signIn: !!listProviders().find((p) => p.id === providerId)?.signIn,
    },
    model: config.model ?? null,
    effort: {
      options,
      chosen,
      disabled: !info || (!efforts.length && !chosen),
      note: !info
        ? "Open the model list to see which effort levels this model takes."
        : efforts.length
          ? "Higher thinks longer before acting: better on hard problems, slower and dearer."
          : "This model has no effort setting.",
    },
    defaults: info ? defaultsNote(info, config.params) : "",
    workflows: {
      enabled: !!w.enabled,
      limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, w[key] ?? ""])),
      tiers: Object.fromEntries(TIERS.map((tier) => [tier, w.tiers?.[tier] ?? ""])),
      placeholders: tierModelsFor(providerId),
    },
  }
}

/**
 * What the chosen model runs at when the session sets nothing. The harness
 * hardcodes no temperature; this is where a person sees what the model's
 * authors recommend, and what an override in config.params replaces.
 */
function defaultsNote(info, params) {
  // maxTokens and effort have controls of their own.
  const set = Object.entries(params ?? {}).filter(([name]) => name !== "maxTokens" && name !== "reasoning")
  const recommended = Object.entries(info?.defaults ?? {})
    .map(([name, value]) => `${name} ${value}`)
    .join(" · ")
  const ceiling = info.maxOutput ? `up to ${Math.round(info.maxOutput / 1000)}k output tokens` : ""
  const parts = []
  if (recommended) parts.push(`Runs at its authors' defaults: ${recommended}`)
  if (ceiling) parts.push(ceiling)
  if (set.length) parts.push(`This session overrides: ${set.map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(", ")}`)
  return parts.join(" · ")
}

/**
 * Move a session to another provider, inside a change of its config. A
 * model is a provider's, so each provider's last model is kept under
 * `config.models` and comes back when the session returns to it: moving
 * between OpenRouter and a ChatGPT plan and back keeps both choices.
 */
export function switchProvider(config, next) {
  const from = config.providerId ?? "openrouter"
  if (from === next) return false
  if (!config.models) config.models = {}
  if (config.model) config.models[from] = config.model
  config.providerId = next
  config.model = config.models[next] ?? defaultsOf(next).model ?? DEFAULT_CONFIG.model
  return true
}

/**
 * What the ChatGPT part of the panel shows: one of "signed-out", "waiting"
 * (a sign-in begun, the address not pasted yet), "no-plan" (signed in,
 * plan use not granted) or "signed-in".
 */
export function chatGPTState(status) {
  if (status.signedIn && status.planEnabled) return "signed-in"
  if (status.pending) return "waiting"
  if (status.signedIn) return "no-plan"
  return "signed-out"
}

export function createSettingsPanel({ store, onKey = () => {}, onChange = () => {} }) {
  const element = el("dialog", "agent-settings")
  element.setAttribute("aria-label", "Agent settings")
  const providerId = () => store.doc()?.config?.providerId ?? "openrouter"

  const head = el("header", "agent-settings-head")
  const close = el("button", "agent-settings-close", "×")
  close.type = "button"
  close.title = "Close"
  close.setAttribute("aria-label", "Close")
  head.append(el("h2", null, "Agent settings"), close)

  const section = (title, ...children) => {
    const node = el("section", "agent-settings-section")
    node.append(el("h3", null, title), ...children)
    return node
  }
  const note = (text, className = "agent-note") => el("p", className, text)

  // ---- provider -----------------------------------------------------------
  const providerChoices = el("div", "agent-provider-choices")
  providerChoices.setAttribute("role", "radiogroup")
  const providerRadios = listProviders().map((p) => {
    const label = el("label", "agent-provider-choice")
    const radio = document.createElement("input")
    radio.type = "radio"
    radio.name = `agent-provider-${Math.random().toString(36).slice(2, 8)}`
    radio.value = p.id
    const text = el("span", "agent-provider-text")
    text.append(el("strong", null, p.name), el("span", null, PROVIDER_BLURB[p.id] ?? ""))
    label.append(radio, text)
    providerChoices.append(label)
    return radio
  })
  for (const radio of providerRadios) radio.name = providerRadios[0].name

  // OpenRouter: a key.
  const keyInput = document.createElement("input")
  keyInput.type = "password"
  keyInput.placeholder = "OpenRouter API key (sk-or-…)"
  keyInput.autocomplete = "off"
  const keyBox = el("div", "agent-credential")
  keyBox.append(
    keyInput,
    note("Stored with your account's LLM settings, shared with your other LLM tools — never written to this session, so it is not synced to anyone you share it with.")
  )

  // ChatGPT: a sign-in.
  const chatgptBox = el("div", "agent-credential agent-chatgpt")
  const signInLink = el("a", "agent-chatgpt-button", "Continue with ChatGPT")
  signInLink.target = "_blank"
  signInLink.rel = "noopener noreferrer"
  const pasteInput = document.createElement("input")
  pasteInput.type = "url"
  pasteInput.placeholder = "http://127.0.0.1:1455/auth/callback?code=…"
  pasteInput.autocomplete = "off"
  pasteInput.spellcheck = false
  const connect = el("button", null, "Connect")
  connect.type = "button"
  connect.dataset.variant = "primary"
  const startOver = el("button", null, "Start over")
  startOver.type = "button"
  const signOut = el("button", null, "Sign out")
  signOut.type = "button"
  const forget = el("button", "agent-link-button", "Use a different ChatGPT account")
  forget.type = "button"
  const usageLink = el("a", null, "Manage usage ↗")
  usageLink.href = USAGE_URL
  usageLink.target = "_blank"
  usageLink.rel = "noopener noreferrer"
  const chatgptStatus = el("p", "agent-chatgpt-status", "")
  const chatgptError = el("p", "agent-error", "")
  chatgptError.setAttribute("role", "alert")
  // Shown once, the first time this device signs in: what using the plan means.
  const welcome = el("p", "agent-chatgpt-welcome", "")
  welcome.hidden = true

  const waitingSteps = el("ol", "agent-chatgpt-steps")
  waitingSteps.append(
    el("li", null, "Approve Patchwork in the ChatGPT tab that opened."),
    el("li", null, "ChatGPT then sends your browser to an address starting http://127.0.0.1:1455 that does not load. That is expected."),
    el("li", null, "Copy that whole address from the address bar and paste it here.")
  )
  const pasteRow = el("div", "agent-row")
  pasteRow.append(pasteInput, connect)
  const waitingBox = el("div", "agent-chatgpt-waiting")
  waitingBox.append(waitingSteps, pasteRow, startOver)
  const signedInRow = el("div", "agent-row")
  signedInRow.append(usageLink, signOut)
  chatgptBox.append(chatgptStatus, signInLink, waitingBox, signedInRow, forget, welcome, chatgptError)

  const credentialBox = el("div", "agent-credentials")
  credentialBox.append(keyBox, chatgptBox)

  // ---- model --------------------------------------------------------------
  // Every model the provider offers, not a hand-picked few. A datalist gives
  // native filter-as-you-type over several hundred entries, and free text
  // still works — so a model released this morning is usable before the
  // catalogue refreshes.
  const listId = `agent-model-list-${Math.random().toString(36).slice(2, 8)}`
  const modelInput = document.createElement("input")
  modelInput.type = "text"
  modelInput.setAttribute("list", listId)
  modelInput.className = "agent-model-input"
  modelInput.placeholder = "search models, or paste any slug"
  modelInput.autocomplete = "off"
  modelInput.spellcheck = false
  const modelList = document.createElement("datalist")
  modelList.id = listId
  const modelStatus = note("")
  const paramsNote = note("", "agent-model-defaults")
  const refreshModels = el("button", null, "Refresh model list")
  refreshModels.type = "button"

  // How hard the model thinks before it acts. Only the levels the chosen model
  // takes are offered — the catalogue says which — and "model default" sends
  // nothing, so the model runs at the effort its authors chose.
  const effortSelect = document.createElement("select")
  effortSelect.className = "agent-effort"
  const effortNote = note("", "agent-model-defaults")
  const effortLabel = el("label", "agent-field")
  effortLabel.append(el("span", null, "Effort"), effortSelect)

  // ---- workflows ----------------------------------------------------------
  // Off unless switched on here, because one is many sessions and real cost.
  // The limits and the tier models are what workflow_start copies into each
  // plan it makes.
  const workflowsToggle = document.createElement("input")
  workflowsToggle.type = "checkbox"
  const workflowsLabel = el("label", "cluster")
  workflowsLabel.append(workflowsToggle, el("span", null, "Let this session run workflows"))
  const field = (label, input) => {
    const node = el("label", "agent-wf-field")
    node.append(el("span", null, label), input)
    return node
  }
  const limitInputs = [
    ["At once", "parallel"],
    ["Steps in all", "steps"],
    // Dollars, so cents are allowed.
    ["Budget ($)", "cost"],
  ].map(([label, key]) => {
    const input = document.createElement("input")
    input.type = "number"
    input.min = "1"
    input.dataset.key = key
    input.placeholder = String(DEFAULT_LIMITS[key])
    if (key === "cost") input.step = "any"
    return { label, input }
  })
  const tierInputs = TIERS.map((tier) => {
    const input = document.createElement("input")
    input.type = "text"
    input.setAttribute("list", listId)
    input.dataset.tier = tier
    input.spellcheck = false
    return input
  })
  const workflowsBox = el("div", "agent-wf-settings")
  workflowsBox.append(
    workflowsLabel,
    note("The agent can split big jobs across several sessions, each on the model its tier names. Watch them in the workflow view.", "agent-model-defaults"),
    ...limitInputs.map(({ label, input }) => field(label, input)),
    ...tierInputs.map((input) => field(input.dataset.tier, input))
  )

  // ---- the web ------------------------------------------------------------
  // Without a relay, a browser keeps a reader's text of what it reads.
  const relayInput = document.createElement("input")
  relayInput.type = "url"
  relayInput.placeholder = "https://relay.example (fetch-relay)"
  relayInput.autocomplete = "off"
  relayInput.spellcheck = false
  const relayKeyInput = document.createElement("input")
  relayKeyInput.type = "password"
  relayKeyInput.placeholder = "Relay key, if it has one"
  relayKeyInput.autocomplete = "off"
  // web_search is Brave's Search API: it needs a key, and in a browser the relay.
  const searchKeyInput = document.createElement("input")
  searchKeyInput.type = "password"
  searchKeyInput.autocomplete = "off"

  const body = el("div", "agent-settings-body")
  body.append(
    section("Model provider", providerChoices, credentialBox),
    section("Model", modelInput, modelList, modelStatus, paramsNote, refreshModels, effortLabel, effortNote),
    section("Workflows", workflowsBox),
    section(
      "The web",
      el("span", "agent-field-label", "Fetch relay"),
      relayInput,
      relayKeyInput,
      note("Most sites will not let a browser page read them, so without a relay the agent keeps a reader's text of each page and a PDF only when the site allows. A relay fetches for it, and the PDF or page itself is kept as the source. Stored with your API keys."),
      el("span", "agent-field-label", "Web search"),
      searchKeyInput,
      note("Searches go to Brave's Search API (api-dashboard.search.brave.com), which needs a key and, in a browser, the fetch relay above. Stored with your API keys.")
    )
  )

  const foot = el("footer", "agent-settings-foot")
  const cancel = el("button", null, "Cancel")
  cancel.type = "button"
  const save = el("button", null, "Save")
  save.type = "button"
  save.dataset.variant = "primary"
  foot.append(note("Keys and the relay are saved when you press Save. Everything else is saved as you change it."), cancel, save)

  element.append(head, body, foot)

  // The catalogue, once loaded, and for which provider: null until then.
  let models = null
  let modelsFor = null
  // Whether the person has had the dialog open in this view: reveal() opens it once, never again.
  let revealed = false
  let firstSignIn = false

  const shown = () => element.open || element.hasAttribute("open")
  function open() {
    revealed = true
    if (shown()) return
    try {
      if (typeof element.showModal === "function" && element.isConnected) element.showModal()
      else element.setAttribute("open", "")
    } catch {
      element.setAttribute("open", "")
    }
    if (!models || modelsFor !== providerId()) loadModels()
    // The relay's address, not its key: a key is never shown back.
    relayInput.value = readRelay()?.url ?? ""
    searchKeyInput.placeholder = readKey(SEARCH_KEY_ID) ? "Brave Search API key — saved; type to replace" : "Brave Search API key"
    keyInput.placeholder = readKey("openrouter") ? "OpenRouter API key — saved; type to replace" : "OpenRouter API key (sk-or-…)"
    renderCredentials()
    ;(providerRadios.find((r) => r.checked) ?? close).focus?.()
  }
  function shut() {
    if (!shown()) return
    try {
      if (typeof element.close === "function") element.close()
      else element.removeAttribute("open")
    } catch {
      element.removeAttribute("open")
    }
    element.removeAttribute("open")
    keyInput.value = ""
    relayKeyInput.value = ""
    searchKeyInput.value = ""
  }

  close.addEventListener("click", shut)
  cancel.addEventListener("click", shut)
  // A click on the backdrop lands on the dialog itself, outside its content.
  element.addEventListener("click", (event) => {
    if (event.target !== element) return
    const box = element.getBoundingClientRect?.()
    if (!box || !box.width) return
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
    if (!inside) shut()
  })

  const write = (fn) => {
    store.change((d) => {
      if (!d.config) d.config = {}
      fn(d.config)
    })
    onChange()
  }

  // ---- provider and credentials ------------------------------------------
  for (const radio of providerRadios) {
    radio.addEventListener("change", () => {
      if (!radio.checked || radio.value === providerId()) return
      const next = radio.value
      write((config) => switchProvider(config, next))
      models = null
      loadModels()
      render(store.doc())
      if (hasCredential(next)) onKey(null)
    })
  }

  // A sign-in begun ahead of the click, so the link opens at once: a tab
  // opened after an `await` is a popup a browser may block.
  let preparing = null
  async function prepareSignIn() {
    if (preparing) return preparing
    preparing = beginChatGPTSignIn()
      .then((url) => {
        signInLink.href = url
        signInLink.removeAttribute("aria-disabled")
      })
      .catch((err) => {
        chatgptError.textContent = `Could not start the sign-in: ${err?.message ?? err}`
      })
      .finally(() => (preparing = null))
    return preparing
  }
  signInLink.addEventListener("click", (event) => {
    if (!signInLink.getAttribute("href")) {
      event.preventDefault()
      return
    }
    chatgptError.textContent = ""
    // The attempt is in this browser's storage, marked as gone to ChatGPT, so
    // the steps show until it is finished — after a reload too.
    chatgptAuth.opened()
    // Gone meanwhile (finished or started over in another tab): a new link, and nothing opened.
    if (!chatgptAuth.status().pending) {
      event.preventDefault()
      signInLink.removeAttribute("href")
      chatgptError.textContent = "That sign-in had ended. Click Continue with ChatGPT again."
      renderCredentials()
      return
    }
    setTimeout(() => {
      renderCredentials()
      pasteInput.focus()
    }, 0)
  })

  connect.addEventListener("click", async () => {
    chatgptError.textContent = ""
    connect.disabled = true
    try {
      const status = chatgptAuth.status()
      const hadPlan = status.signedIn && status.planEnabled
      const record = await finishChatGPTSignIn(pasteInput.value)
      pasteInput.value = ""
      signInLink.removeAttribute("href")
      firstSignIn = !hadPlan && record.scopes?.includes(chatgptAuth.PLAN_SCOPE)
      renderCredentials()
      if (record.scopes?.includes(chatgptAuth.PLAN_SCOPE)) {
        models = null
        loadModels()
        onKey(null)
      }
      onChange()
    } catch (err) {
      chatgptError.textContent = String(err?.message ?? err)
    } finally {
      connect.disabled = false
    }
  })
  pasteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      connect.click()
    }
  })
  startOver.addEventListener("click", () => {
    chatgptAuth.cancel()
    signInLink.removeAttribute("href")
    chatgptError.textContent = ""
    renderCredentials()
  })
  signOut.addEventListener("click", async () => {
    signOut.disabled = true
    const { confirmed } = await signOutChatGPT().catch(() => ({ confirmed: false }))
    signOut.disabled = false
    firstSignIn = false
    signInLink.removeAttribute("href")
    chatgptError.textContent = confirmed ? "" : "Signed out here, but ChatGPT did not confirm it ended the sign-in. You can disconnect Patchwork in ChatGPT's settings."
    renderCredentials()
    onChange()
  })
  forget.addEventListener("click", async () => {
    await forgetChatGPT().catch(() => {})
    firstSignIn = false
    signInLink.removeAttribute("href")
    renderCredentials()
    onChange()
  })

  function renderCredentials() {
    const chosen = providerId()
    for (const radio of providerRadios) radio.checked = radio.value === chosen
    keyBox.hidden = chosen !== "openrouter"
    chatgptBox.hidden = chosen !== "chatgpt"
    if (chosen !== "chatgpt") return
    const status = chatgptAuth.status()
    const state = chatGPTState(status)
    signInLink.hidden = state === "signed-in" || state === "waiting"
    waitingBox.hidden = state !== "waiting"
    signedInRow.hidden = state !== "signed-in"
    forget.hidden = !(state === "signed-in" || state === "no-plan")
    chatgptStatus.textContent =
      state === "signed-in"
        ? `Signed in${status.email ? ` as ${status.email}` : ""}. Requests use your ChatGPT plan.`
        : state === "no-plan"
          ? `Signed in${status.email ? ` as ${status.email}` : ""}, but ChatGPT plan use was not allowed. Continue with ChatGPT again and allow it.`
          : state === "waiting"
            ? "Finish signing in:"
            : "Sign in with your ChatGPT account. Its plan pays for this session's requests, within its limits; you can cap what Patchwork uses in ChatGPT's settings."
    welcome.hidden = !(state === "signed-in" && firstSignIn)
    welcome.textContent = "You're using your ChatGPT plan. Requests from the agent count toward its usage; see and limit them under Manage usage."
    if ((state === "signed-out" || state === "no-plan") && !signInLink.getAttribute("href")) {
      signInLink.setAttribute("aria-disabled", "true")
      prepareSignIn()
    }
  }
  const offKeys = onKeyChange(() => {
    if (shown()) renderCredentials()
  })

  // ---- model --------------------------------------------------------------
  function commitModel() {
    const chosen = modelInput.value.trim()
    if (!chosen || chosen === store.doc()?.config?.model) return
    write((config) => {
      config.model = chosen
    })
  }
  modelInput.addEventListener("change", commitModel)
  modelInput.addEventListener("blur", commitModel)

  effortSelect.addEventListener("change", () => {
    const effort = effortSelect.value
    write((config) => {
      if (!config.params) config.params = {}
      const params = config.params
      if (effort) {
        if (!params.reasoning) params.reasoning = {}
        params.reasoning.effort = effort
      } else if (params.reasoning) {
        delete params.reasoning.effort
        if (!Object.keys(params.reasoning).length) delete params.reasoning
      }
    })
  })

  const writeWorkflows = (fn) =>
    write((config) => {
      if (!config.workflows) config.workflows = {}
      fn(config.workflows)
    })
  workflowsToggle.addEventListener("change", () => writeWorkflows((w) => (w.enabled = workflowsToggle.checked)))
  for (const { input } of limitInputs) {
    input.addEventListener("change", () => {
      const value = input.dataset.key === "cost" ? Number.parseFloat(input.value) : Number.parseInt(input.value, 10)
      writeWorkflows((w) => {
        if (Number.isFinite(value) && value > 0) w[input.dataset.key] = value
        else delete w[input.dataset.key]
      })
    })
  }
  for (const input of tierInputs) {
    input.addEventListener("change", () => {
      const model = input.value.trim()
      writeWorkflows((w) => {
        if (!w.tiers) w.tiers = {}
        if (model) w.tiers[input.dataset.tier] = model
        else delete w.tiers[input.dataset.tier]
      })
    })
  }

  async function loadModels({ force = false } = {}) {
    const id = providerId()
    const provider = getProvider(id)
    modelStatus.textContent = force ? "Refreshing…" : "Loading models…"
    let key = null
    try {
      key = await freshCredential(id)
    } catch {
      key = null
    }
    if (provider.signIn && !key) {
      models = null
      modelsFor = id
      modelList.replaceChildren(...(provider.SUGGESTED_MODELS ?? []).map((m) => Object.assign(document.createElement("option"), { value: m.id, label: m.label })))
      modelStatus.textContent = "Sign in to see the models your plan has. Any slug still works."
      render(store.doc())
      return
    }
    try {
      const { models: loaded, cached, error } = await loadCatalogue(id, { force, key })
      if (id !== providerId()) return
      models = loaded
      modelsFor = id
      render(store.doc())
      modelList.replaceChildren(
        ...loaded.map((model) => {
          const option = document.createElement("option")
          option.value = model.id
          // The label is what the browser shows beside the id while filtering.
          option.label = provider.describeModel(model)
          return option
        })
      )
      const withTools = loaded.filter((m) => m.tools).length
      modelStatus.textContent = error
        ? `${loaded.length} models (cached — ${error})`
        : `${loaded.length} models, ${withTools} support tool use${cached ? " (cached)" : ""}`
    } catch (err) {
      modelStatus.textContent = `Could not load the model list: ${err?.message ?? err}. Any slug still works.`
    }
  }
  refreshModels.addEventListener("click", (event) => {
    event.preventDefault()
    loadModels({ force: true })
  })

  save.addEventListener("click", (event) => {
    event.preventDefault()
    const value = keyInput.value.trim()
    if (value) {
      writeKey("openrouter", value)
      if (providerId() === "openrouter") onKey(value)
      keyInput.value = ""
    }
    // The relay: saved as typed, cleared by emptying its address.
    const relayUrl = relayInput.value.trim()
    const current = readRelay()
    if (relayUrl !== (current?.url ?? "") || (relayKeyInput.value && relayKeyInput.value !== current?.key)) {
      writeRelay(relayUrl ? { url: relayUrl, key: relayKeyInput.value || current?.key || "" } : null)
    }
    relayKeyInput.value = ""
    const searchKey = searchKeyInput.value.trim()
    if (searchKey) writeKey(SEARCH_KEY_ID, searchKey)
    searchKeyInput.value = ""
    shut()
    onChange()
  })

  function render(doc) {
    const v = settingsValue(doc, modelsFor === (doc?.config?.providerId ?? "openrouter") ? models : null)
    // `doc` is the session document; the focused element lives on the DOM one.
    // Never overwrite a field while it is being typed in.
    const focused = element.ownerDocument?.activeElement
    if (v.model && modelInput.value !== v.model && focused !== modelInput) modelInput.value = v.model

    workflowsToggle.checked = v.workflows.enabled
    for (const { input } of limitInputs) {
      if (focused !== input) input.value = v.workflows.limits[input.dataset.key]
      input.disabled = !v.workflows.enabled
    }
    for (const input of tierInputs) {
      if (focused !== input) input.value = v.workflows.tiers[input.dataset.tier]
      input.placeholder = v.workflows.placeholders[input.dataset.tier] ?? ""
      input.disabled = !v.workflows.enabled
    }

    const options = document.createDocumentFragment()
    for (const [value, label] of v.effort.options) {
      const option = document.createElement("option")
      option.value = value
      option.textContent = label
      options.append(option)
    }
    morph(effortSelect, options)
    if (effortSelect.value !== v.effort.chosen) effortSelect.value = v.effort.chosen
    effortSelect.disabled = v.effort.disabled
    effortNote.textContent = v.effort.note
    paramsNote.textContent = v.defaults
    if (shown()) renderCredentials()
    else for (const radio of providerRadios) radio.checked = radio.value === v.provider.id
  }

  return {
    element,
    toggle() {
      if (shown()) shut()
      else open()
    },
    reveal({ force = false } = {}) {
      if (!revealed || force) open()
    },
    render,
    destroy() {
      offKeys()
    },
  }
}
