/**
 * The session's settings: its model and effort, whether it may run workflows
 * and with what, and the keys and relay this browser keeps.
 *
 * What the panel shows of the session is `settingsValue(doc, models)`, a pure
 * function of the session and the model catalogue; `createSettingsPanel`
 * draws it and writes what a person changes.
 *
 *   createSettingsPanel({ store, onKey, onChange })
 *     element      the panel, shut until opened
 *     toggle()     open or shut it, as the header's model button does
 *     reveal()     open it, as the view does for a session with no key
 *     render(doc)  bring the fields up to date with the session
 *
 * `onKey(key)` is told a model key saved here, for a runner that cannot read
 * this page's storage; `onChange()` after anything written.
 */

import { readKey, writeKey, readRelay, writeRelay, SEARCH_KEY_ID } from "../providers/keys.js"
import { loadCatalogue } from "../providers/catalogue.js"
import { describeModel, describeDefaults } from "../providers/openrouter.js"
import { DEFAULT_LIMITS, DEFAULT_TIER_MODELS, TIERS } from "../workflow/plan.js"
import { morph } from "./morph.js"

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

const LIMIT_KEYS = ["parallel", "steps", "cost"]

/**
 * What the panel shows of the session. `models` is the catalogue, or null
 * before it has loaded.
 */
export function settingsValue(doc, models = null) {
  const config = doc?.config ?? {}
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
  const recommended = describeDefaults(info)
  const ceiling = info.maxOutput ? `up to ${Math.round(info.maxOutput / 1000)}k output tokens` : ""
  const parts = []
  if (recommended) parts.push(`Runs at its authors' defaults: ${recommended}`)
  if (ceiling) parts.push(ceiling)
  if (set.length) parts.push(`This session overrides: ${set.map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(", ")}`)
  return parts.join(" · ")
}

export function createSettingsPanel({ store, onKey = () => {}, onChange = () => {} }) {
  const element = el("div", "agent-setup")
  element.style.display = "none"
  const providerId = () => store.doc()?.config?.providerId ?? "openrouter"

  // Every model OpenRouter offers, not a hand-picked few. A datalist gives
  // native filter-as-you-type over several hundred entries, and free text still
  // works — so a model released this morning is usable before the catalogue
  // refreshes.
  const modelInput = document.createElement("input")
  modelInput.type = "text"
  modelInput.setAttribute("list", "agent-model-list")
  modelInput.placeholder = "search models, or paste any slug"
  modelInput.autocomplete = "off"
  modelInput.spellcheck = false
  const modelList = document.createElement("datalist")
  modelList.id = "agent-model-list"
  const modelStatus = el("p", null, "")
  const paramsNote = el("p", "agent-model-defaults", "")
  const refreshModels = el("button", null, "Refresh model list")

  // How hard the model thinks before it acts. Only the levels the chosen model
  // takes are offered — the catalogue says which — and "model default" sends
  // nothing, so the model runs at the effort its authors chose.
  const effortSelect = document.createElement("select")
  effortSelect.className = "agent-effort"
  const effortNote = el("p", "agent-model-defaults", "")

  // Workflows: off unless switched on here, because one is many sessions and
  // real cost. The limits and the tier models are what workflow_start copies
  // into each plan it makes.
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
    input.setAttribute("list", "agent-model-list")
    input.placeholder = DEFAULT_TIER_MODELS[tier]
    input.dataset.tier = tier
    input.spellcheck = false
    return input
  })
  const workflowsBox = el("div", "agent-wf-settings")
  workflowsBox.append(
    workflowsLabel,
    el("p", "agent-model-defaults", "The agent can split big jobs across several sessions, each on the model its tier names. Watch them in the workflow view."),
    ...limitInputs.map(({ label, input }) => field(label, input)),
    ...tierInputs.map((input) => field(input.dataset.tier, input))
  )

  const keyInput = document.createElement("input")
  keyInput.type = "password"
  keyInput.placeholder = "OpenRouter API key (sk-or-…)"
  keyInput.autocomplete = "off"
  const saveKey = el("button", null, "Save")
  saveKey.dataset.variant = "primary"
  const keyNote = el(
    "p",
    null,
    "Stored with your account's LLM settings, shared with your other LLM tools — never written to this session, so it is not synced to anyone you share it with."
  )
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
  const relayNote = el(
    "p",
    null,
    "Most sites will not let a browser page read them, so without a relay the agent keeps a reader's text of each page and a PDF only when the site allows. A relay fetches for it, and the PDF or page itself is kept as the source. Stored with your API key."
  )
  // web_search is Brave's Search API: it needs a key, and in a browser the relay.
  const searchKeyInput = document.createElement("input")
  searchKeyInput.type = "password"
  searchKeyInput.autocomplete = "off"
  const searchNote = el(
    "p",
    null,
    "Searches go to Brave's Search API (api-dashboard.search.brave.com), which needs a key and, in a browser, the fetch relay above. Stored with your API key."
  )

  element.append(
    el("p", null, "Model"),
    modelInput,
    modelList,
    modelStatus,
    paramsNote,
    refreshModels,
    el("p", null, "Effort"),
    effortSelect,
    effortNote,
    el("p", null, "Workflows"),
    workflowsBox,
    el("p", null, "API key"),
    keyInput,
    keyNote,
    el("p", null, "Fetch relay"),
    relayInput,
    relayKeyInput,
    relayNote,
    el("p", null, "Web search"),
    searchKeyInput,
    searchNote,
    saveKey
  )

  // The catalogue, once loaded: null until then.
  let models = null

  const shown = () => element.style.display !== "none"
  const write = (fn) => {
    store.change((d) => {
      if (!d.config) d.config = {}
      fn(d.config)
    })
    onChange()
  }

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
    modelStatus.textContent = force ? "Refreshing…" : "Loading models…"
    try {
      const { models: loaded, cached, error } = await loadCatalogue(providerId(), { force, key: readKey(providerId()) })
      models = loaded
      render(store.doc())
      modelList.replaceChildren(
        ...loaded.map((model) => {
          const option = document.createElement("option")
          option.value = model.id
          // The label is what the browser shows beside the id while filtering.
          option.label = describeModel(model)
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

  saveKey.addEventListener("click", (event) => {
    event.preventDefault()
    const value = keyInput.value.trim()
    if (value) {
      writeKey(providerId(), value)
      onKey(value)
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
    element.style.display = "none"
    onChange()
  })

  function render(doc) {
    const v = settingsValue(doc, models)
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
  }

  return {
    element,
    toggle() {
      if (shown()) {
        element.style.display = "none"
        return
      }
      element.style.display = "flex"
      keyInput.focus()
      if (!models) loadModels()
      // The relay's address, not its key: a key is never shown back.
      relayInput.value = readRelay()?.url ?? ""
      searchKeyInput.placeholder = readKey(SEARCH_KEY_ID) ? "Brave Search API key — saved; type to replace" : "Brave Search API key"
    },
    reveal() {
      element.style.display = "flex"
    },
    render,
  }
}
