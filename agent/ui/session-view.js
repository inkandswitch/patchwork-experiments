/**
 * The agent view.
 *
 * One render function serves both surfaces the design calls for: the sidebar
 * panel (`mode: "panel"`) and the full-window pop-out (`mode: "full"`, which
 * adds a live view of the subject document beside the transcript). They are
 * the same document and the same code — the difference is a data attribute and
 * a container query.
 */

import { handleStore } from "../kernel/store.js"
import { decide, say, answerQuestion } from "../kernel/loop.js"
import { needsWork } from "../kernel/runner.js"
import { accountContext, drivePlanHere } from "../runners/tab.js"
import { getDriver } from "../workflow/driver.js"
import { watchWaiting, renderWaiting, renderWaitingItem } from "./waiting.js"
import { markCitations } from "./citations.js"
import { attachmentTray, carriesAttachments, pastedImages } from "./attachments.js"
import { workflowOf } from "../workflow/plan.js"
import { watchStanding, renderStandingLine, gateOf, renderChoices, placeOf } from "./standing.js"
import { askAside } from "../workflow/aside.js"
import { readKey, writeKey, readRelay, writeRelay, SEARCH_KEY_ID, onKeyChange, connectAccountKeys } from "../providers/keys.js"
import { loadCatalogue, modelInfo } from "../providers/catalogue.js"
import { describeModel, describeDefaults } from "../providers/openrouter.js"
import { DEFAULT_LIMITS, DEFAULT_TIER_MODELS, TIERS } from "../workflow/plan.js"
import { renderTranscript } from "./transcript.js"
import { createGuidesButton } from "./guides.js"
import { createInlineViews } from "./views.js"
import { getMount, mountForPerson, parkMount } from "../tools/checking.js"
import { applyInstall, applyUninstall } from "./install.js"
import { watchWorkspace } from "./workspace.js"
import { createDictation } from "./dictation.js"
import { ensureStyles } from "./styles.js"
import { morph } from "./morph.js"
import { sessionRunners } from "./session-runners.js"
import { sessionValue } from "./session-value.js"
import { watchNames, myContactUrl } from "./names.js"

ensureStyles()

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

export function AgentTool(handle, element, options = {}) {
  const mode = options.mode ?? "full"
  const repo = options.repo ?? globalThis.repo

  const root = el("div", "patchwork-agent")
  root.dataset.mode = mode
  element.append(root)

  const main = el("div", "agent-main")

  /**
   * The second pane: what the agent is looking at.
   *
   * Two things want it, and only one at a time. A live mount wins — if the
   * agent has a tool open and is clicking around in it, THAT is what you want
   * to see, and watching it happen is most of the difference between trusting
   * the work and taking its word for it. Otherwise it shows the subject
   * document, which is what it always did.
   */
  const sidePane = el("div", "agent-subject-view")
  const subjectPane = el("div", "agent-subject-pane")
  sidePane.append(subjectPane)

  root.append(main, sidePane)

  // ---- header ----------------------------------------------------------
  const header = el("div", "agent-header")
  const statusDot = el("span", "agent-status")
  const subjectLabel = el("span", "agent-subject", "Agent")
  const modelButton = el("button", "agent-model", "model")
  modelButton.title = "Change model or API key"
  // What this session has spent, as OpenRouter reports it.
  const costLabel = el("span", "agent-cost", "")
  // The workflow this session started, or is a step of: one click to its view.
  const workflowButton = el("button", "agent-workflow-link", "Workflow")
  workflowButton.hidden = true
  // The usage guides the agent keeps, and whether each is up to date.
  const guides = createGuidesButton({ repo, rootFolderUrl: accountContext().rootFolderUrl, openDoc: (url) => onOpenDoc(url) })
  header.append(statusDot, subjectLabel, workflowButton, guides.button, costLabel, modelButton)
  guides.refresh()

  // What the session makes and opens lives IN the transcript, beside the call
  // that made or opened it (ui/views.js), and nowhere else: a strip of things
  // made, or a pane for the agent's mounts, would be a place to look other
  // than where the thing is talked about.
  const transcript = el("div", "agent-transcript")
  const composer = el("div", "agent-composer")
  main.append(header, guides.panel, transcript, composer)

  // Workflow steps run in sessions nobody has open; what they wait on a person
  // for — a permission, a question — is shown here, above the transcript, and
  // answered in place.
  const waitingStrip = el("div", "agent-waiting")
  waitingStrip.hidden = true
  main.insertBefore(waitingStrip, transcript)
  function renderStrip(items) {
    if (waiting) renderWaiting(waitingStrip, items, { onOpen: (url) => onOpenDoc(url), subject: handle.doc()?.subject ?? null })
  }
  const waiting = repo ? watchWaiting(repo, handle, () => !disposed && handle.doc() && renderStrip(value(handle.doc()).strip)) : null

  // Where this session stands in its workflow, kept up with the plan: a
  // step's state, a workflow at a glance, or the step a side thread is about.
  const standingLine = el("div", "agent-standing")
  standingLine.hidden = true
  header.after(standingLine)
  const standing = repo ? watchStanding({ repo, handle, onChange: () => render() }) : null

  // ---- composer --------------------------------------------------------
  const input = document.createElement("textarea")
  input.placeholder = "Ask for a change…"
  input.rows = 2
  const sendButton = el("button", null, "Send")
  sendButton.dataset.variant = "primary"
  const stopButton = el("button", null, "Stop")
  stopButton.dataset.variant = "danger"
  stopButton.style.display = "none"
  const hint = el("span", "agent-hint", "")
  // Speech into the box (ui/dictation.js).
  const dictation = createDictation({ field: input, root, onChange: () => render() })
  const row = el("div", "agent-composer-row")
  row.append(hint, dictation.button, stopButton, sendButton)
  // What is waiting to go with the next message: documents dragged in,
  // files dropped, images pasted (ui/attachments.js).
  const tray = attachmentTray({ repo, onChange: () => render() })
  // A message to a step that is not running needs a choice before it goes:
  // a question in a side thread, or reopening the step (ui/standing.js).
  const choices = el("div", "agent-send-choices")
  choices.hidden = true
  composer.append(tray.element, input, choices, row)
  composer.addEventListener("dragover", (event) => {
    if (!carriesAttachments(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    composer.dataset.dropping = "true"
  })
  composer.addEventListener("dragleave", () => delete composer.dataset.dropping)
  composer.addEventListener("drop", (event) => {
    delete composer.dataset.dropping
    if (!carriesAttachments(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    if (tray.addDrop(event.dataTransfer)) input.focus()
  })
  input.addEventListener("paste", (event) => {
    const images = pastedImages(event.clipboardData)
    if (!images.length) return
    event.preventDefault()
    tray.addFiles(images)
  })

  // ---- settings panel --------------------------------------------------
  const settings = el("div", "agent-setup")
  settings.style.display = "none"
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
  // What the chosen model runs at when the session sets nothing. The harness
  // no longer hardcodes a temperature; this is where a person sees what the
  // model's authors recommend, and what an override in config.params replaces.
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
  const numberField = (label, key, fallback) => {
    const input = document.createElement("input")
    input.type = "number"
    input.min = "1"
    input.dataset.key = key
    input.placeholder = String(fallback)
    const field = el("label", "agent-wf-field")
    field.append(el("span", null, label), input)
    return { field, input }
  }
  const wfParallel = numberField("At once", "parallel", DEFAULT_LIMITS.parallel)
  const wfSteps = numberField("Steps in all", "steps", DEFAULT_LIMITS.steps)
  // Dollars, so cents are allowed.
  const wfBudget = numberField("Budget ($)", "cost", DEFAULT_LIMITS.cost)
  wfBudget.input.step = "any"
  const tierInputs = TIERS.map((tier) => {
    const input = document.createElement("input")
    input.type = "text"
    input.setAttribute("list", "agent-model-list")
    input.placeholder = DEFAULT_TIER_MODELS[tier]
    input.dataset.tier = tier
    input.spellcheck = false
    const field = el("label", "agent-wf-field")
    field.append(el("span", null, tier), input)
    return input
  })
  const workflowsBox = el("div", "agent-wf-settings")
  workflowsBox.append(
    workflowsLabel,
    el("p", "agent-model-defaults", "The agent can split big jobs across several sessions, each on the model its tier names. Watch them in the workflow view."),
    wfParallel.field,
    wfSteps.field,
    wfBudget.field,
    ...tierInputs.map((input) => input.parentElement)
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

  settings.append(
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
  main.insertBefore(settings, transcript)

  // ---- state -----------------------------------------------------------
  const uiState = { open: new Set(), names: new Map(), subject: null, settings: null, heads: {} }
  const names = watchNames({ repo, onChange: () => render() })

  // The inline views: what each call made or opened, live, beside the call.
  // A person's own mount goes through the same loader as the agent's, with a
  // context of its own — it needs a repo and a page, nothing of the runner's.
  const views = createInlineViews({
    getMount,
    parkMount,
    mountForPerson: (input) => mountForPerson(input, { repo, element: root }),
    openDoc: (url) => onOpenDoc(url),
    install: (ref, opts) => onInstall(ref, opts),
    uninstall: (ref) => onUninstall(ref),
    rerender: () => render(),
  })
  const store = handleStore(handle, options.splice ?? null)
  let disposed = false
  // Whether the account's LLM settings have answered, or failed to.
  let keysSettled = false

  const subjectUrl = () => handle.doc()?.subject ?? options.subject ?? null

  // A session about no one document is about whatever you have open. Each
  // message records that (session/blocks.js `contextBlock`), so "this" means what was
  // focused when you said it — in the floating box, or docked as a panel.
  const workspace =
    !options.context && !subjectUrl() ? watchWorkspace(element, { repo, exclude: () => [handle.url] }) : null
  const contextFor = options.context ?? (workspace ? () => workspace.snapshot() : null)

  const runners = sessionRunners({ handle, store, repo, element: root, subject: subjectUrl, onEvent: () => render() })
  const kick = () => runners.kick()

  // The place a gated message's choice was offered for, and what the choice
  // row says when it is not offering one.
  let gatedAt = null
  const choicesSay = (text) => {
    const out = document.createDocumentFragment()
    out.append(el("span", "agent-choices-say", text))
    morph(choices, out)
  }
  choices.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-choice]")
    if (!button || button.disabled) return
    event.preventDefault()
    sendAs(button.dataset.choice, gatedAt)
  })

  async function send() {
    if (dictation.listening()) dictation.stop()
    const text = input.value.trim()
    if (!text && !tray.size()) return
    // A step's session takes a message straight only while its step runs.
    // Until its plan has loaded, nothing is sent: the message waits in the box.
    const now = standing?.current() ?? null
    if (placeOf(handle.doc())?.role === "step" && !now) {
      choicesSay("Loading this step's workflow… send again in a moment.")
      choices.hidden = false
      return
    }
    const gate = gateOf(now)
    if (gate) {
      gatedAt = now
      renderChoices(choices, gate, { attachments: tray.size() > 0 })
      choices.hidden = false
      return
    }
    input.value = ""
    // An attachment still being read or kept is waited for, briefly: it was
    // dropped to go with this message.
    for (let waited = 0; tray.pending() && waited < 10_000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100))
    const attachments = tray.take()
    // What was open when this was sent, for a session with no subject.
    const context = (await contextFor?.().catch(() => null)) ?? null
    say(store, text || "(attached)", await myContactUrl(), context, attachments)
    render()
    kick()
  }

  /** Send what is in the box as the choice made for a gated step. */
  async function sendAs(choice, now) {
    choices.hidden = true
    if (choice === "cancel") return input.focus()
    const text = input.value.trim()
    try {
      if (choice === "ask") {
        for (let waited = 0; tray.pending() && waited < 10_000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100))
        const attachments = tray.take()
        const context = (await contextFor?.().catch(() => null)) ?? null
        input.value = ""
        onOpenDoc(await askAside(repo, handle, text || "(attached)", { author: await myContactUrl(), context, attachments }))
      } else {
        const driver = getDriver(now.planUrl) ?? (await drivePlanHere(now.planUrl, { repo }))
        await driver.reopen([now.stepId], { note: text, cascade: choice === "reopen-later", by: "person" })
        input.value = ""
      }
    } catch (err) {
      // Said where the choice was made, which stays up while the step still
      // takes no message straight; the message is still in the box.
      render()
      choicesSay(`Could not send: ${err?.message ?? err}`)
      choices.hidden = false
      return
    }
    render()
  }

  function onDecide(callId, decision) {
    // One "yes" answers every waiting call the grant covers, not one per call.
    decide(store, callId, decision)
    render()
    kick()
  }

  // ---- installing what the session built --------------------------------

  /**
   * The account's module-settings document.
   *
   * Read once and kept watched, so the install controls show what is actually
   * installed — including a change made in another tab.
   */
  let settingsHandle = null
  async function ensureSettings() {
    if (settingsHandle) return settingsHandle
    const url = globalThis.accountDocHandle?.doc()?.moduleSettingsUrl
    if (!url || !repo) return null
    try {
      settingsHandle = await repo.find(url)
      uiState.settings = settingsHandle.doc() ?? null
      settingsHandle.on("change", () => {
        uiState.settings = settingsHandle.doc() ?? null
        render()
      })
      render()
    } catch {
      settingsHandle = null // no settings document reachable; hide the controls
    }
    return settingsHandle
  }

  /**
   * Current heads for each package this session made.
   *
   * Only so the install strip can say when a pinned version has fallen behind.
   * Cheap — the documents are already in the repo — and refreshed whenever the
   * session changes, which is whenever the agent has edited something.
   */
  async function refreshHeads(doc) {
    const packages = (doc?.made ?? []).filter((a) => a.kind === "package")
    if (!packages.length || !repo) return
    let changed = false
    for (const artifact of packages) {
      try {
        const handle = await repo.find(artifact.url)
        const heads = handle.heads?.() ?? []
        const key = heads.join("|")
        if (uiState.heads[artifact.url]?.join("|") !== key) {
          uiState.heads[artifact.url] = heads
          changed = true
        }
      } catch {
        /* an unreadable package simply has no version to compare */
      }
    }
    if (changed && !disposed) render()
  }

  async function onInstall(artifact, { heads = null } = {}) {
    const settings = await ensureSettings()
    if (!settings) return
    // "current" means pin to whatever this package is right now, which has to
    // be read at the moment of clicking — not when the artifact was recorded.
    let pin = null
    if (heads === "current") {
      const pkg = await repo.find(artifact.url)
      pin = pkg.heads?.() ?? null
      if (!pin?.length) return
    }
    applyInstall(settings, artifact.url, { heads: pin })
    uiState.settings = settings.doc() ?? null
    render()
  }

  async function onUninstall(artifact) {
    const settings = await ensureSettings()
    if (!settings) return
    applyUninstall(settings, artifact.url)
    uiState.settings = settings.doc() ?? null
    render()
  }

  async function onAnswer(callId, text) {
    answerQuestion(store, callId, text, await myContactUrl())
    render()
    kick()
  }

  /**
   * Open another document in Patchwork.
   *
   * A custom event rather than an import: `@inkandswitch/patchwork-elements`
   * resolves through the importmap, and this module also runs where there is
   * none. The event is the actual contract; the helper is a convenience.
   */
  function onOpenDoc(url) {
    if (!url) return
    root.dispatchEvent(
      new CustomEvent("patchwork:open-document", { detail: { url }, bubbles: true, composed: true })
    )
  }

  // Anything naming a document in `data-doc-url` opens it: links in rendered
  // markdown, attachments, the standing line's link back to a step, the
  // workflow button. Delegated from the root, so re-rendering never leaves a
  // dead link behind.
  root.addEventListener("click", (event) => {
    const link = event.target.closest?.("[data-doc-url]")
    if (!link || !root.contains(link)) return
    event.preventDefault()
    onOpenDoc(link.dataset.docUrl)
  })

  sendButton.addEventListener("click", (event) => {
    event.preventDefault()
    send()
  })

  stopButton.addEventListener("click", (event) => {
    event.preventDefault()
    runners.stop()
  })

  input.addEventListener("keydown", (event) => {
    // Enter sends; Shift-Enter and the modifier chords insert a newline.
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      send()
    }
  })

  modelButton.addEventListener("click", (event) => {
    event.preventDefault()
    const showing = settings.style.display !== "none"
    settings.style.display = showing ? "none" : "flex"
    if (!showing) {
      keyInput.focus()
      if (!catalogueLoaded) loadModels()
      // The relay's address, not its key: a key is never shown back.
      relayInput.value = readRelay()?.url ?? ""
      searchKeyInput.placeholder = readKey(SEARCH_KEY_ID) ? "Brave Search API key — saved; type to replace" : "Brave Search API key"
    }
  })

  function commitModel() {
    const chosen = modelInput.value.trim()
    if (!chosen || chosen === handle.doc()?.config?.model) return
    store.change((d) => {
      if (!d.config) d.config = {}
      d.config.model = chosen
    })
    render()
  }

  modelInput.addEventListener("change", commitModel)
  modelInput.addEventListener("blur", commitModel)

  effortSelect.addEventListener("change", () => {
    const effort = effortSelect.value
    store.change((d) => {
      if (!d.config) d.config = {}
      if (!d.config.params) d.config.params = {}
      const params = d.config.params
      if (effort) {
        if (!params.reasoning) params.reasoning = {}
        params.reasoning.effort = effort
      } else if (params.reasoning) {
        delete params.reasoning.effort
        if (!Object.keys(params.reasoning).length) delete params.reasoning
      }
    })
    render()
  })

  function writeWorkflows(fn) {
    store.change((d) => {
      if (!d.config) d.config = {}
      if (!d.config.workflows) d.config.workflows = {}
      fn(d.config.workflows)
    })
    render()
  }

  workflowsToggle.addEventListener("change", () => writeWorkflows((w) => { w.enabled = workflowsToggle.checked }))
  for (const { input } of [wfParallel, wfSteps, wfBudget]) {
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

  function renderWorkflows() {
    const w = handle.doc()?.config?.workflows ?? {}
    workflowsToggle.checked = !!w.enabled
    const focused = workflowsBox.ownerDocument?.activeElement
    for (const { input } of [wfParallel, wfSteps, wfBudget]) {
      if (focused !== input) input.value = w[input.dataset.key] ?? ""
      input.disabled = !w.enabled
    }
    for (const input of tierInputs) {
      if (focused !== input) input.value = w.tiers?.[input.dataset.tier] ?? ""
      input.disabled = !w.enabled
    }
  }

  function renderEffort() {
    renderWorkflows()
    const doc = handle.doc()
    const info = catalogueModels.find((m) => m.id === doc?.config?.model)
    const chosen = doc?.config?.params?.reasoning?.effort ?? ""
    const efforts = info?.efforts ?? []
    const options = [["", info?.defaultEffort ? `model default (${info.defaultEffort})` : "model default"]]
    for (const effort of efforts) options.push([effort, effort])
    // A level kept from a previous model stays visible rather than vanishing
    // from the control; the request leaves it out while this model is in use.
    if (chosen && !efforts.includes(chosen)) options.push([chosen, `${chosen} (not taken by this model)`])

    const signature = JSON.stringify(options)
    if (effortSelect.dataset.options !== signature) {
      effortSelect.dataset.options = signature
      effortSelect.replaceChildren(
        ...options.map(([value, label]) => {
          const option = document.createElement("option")
          option.value = value
          option.textContent = label
          return option
        })
      )
    }
    if (effortSelect.value !== chosen) effortSelect.value = chosen
    effortSelect.disabled = !info || (!efforts.length && !chosen)
    effortNote.textContent = !info
      ? "Open the model list to see which effort levels this model takes."
      : efforts.length
        ? "Higher thinks longer before acting: better on hard problems, slower and dearer."
        : "This model has no effort setting."
  }

  let catalogueLoaded = false
  let catalogueModels = []

  function renderDefaults() {
    renderEffort()
    const doc = handle.doc()
    const info = catalogueModels.find((m) => m.id === doc?.config?.model)
    if (!info) {
      paramsNote.textContent = ""
      return
    }
    // maxTokens and effort have controls of their own.
    const set = Object.entries(doc?.config?.params ?? {}).filter(([name]) => name !== "maxTokens" && name !== "reasoning")
    const recommended = describeDefaults(info)
    const ceiling = info.maxOutput ? `up to ${Math.round(info.maxOutput / 1000)}k output tokens` : ""
    const parts = []
    if (recommended) parts.push(`Runs at its authors' defaults: ${recommended}`)
    if (ceiling) parts.push(ceiling)
    if (set.length) parts.push(`This session overrides: ${set.map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(", ")}`)
    paramsNote.textContent = parts.join(" · ")
  }

  async function loadModels({ force = false } = {}) {
    const providerId = handle.doc()?.config?.providerId ?? "openrouter"
    modelStatus.textContent = force ? "Refreshing…" : "Loading models…"
    try {
      const { models, cached, error } = await loadCatalogue(providerId, {
        force,
        key: readKey(providerId),
      })
      catalogueLoaded = true
      catalogueModels = models
      renderDefaults()

      modelList.replaceChildren()
      for (const model of models) {
        const option = document.createElement("option")
        option.value = model.id
        // The label is what the browser shows beside the id while filtering.
        option.label = describeModel(model)
        modelList.append(option)
      }

      const withTools = models.filter((m) => m.tools).length
      modelStatus.textContent = error
        ? `${models.length} models (cached — ${error})`
        : `${models.length} models, ${withTools} support tool use${cached ? " (cached)" : ""}`
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
      const providerId = handle.doc()?.config?.providerId ?? "openrouter"
      writeKey(providerId, value)
      // The worker cannot read this page's localStorage, so hand it over.
      runners.setKey(value)
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
    settings.style.display = "none"
    render()
  })

  // ---- rendering -------------------------------------------------------
  let subjectViewUrl = null

  /** What the view shows now (ui/session-value.js). */
  function value(doc) {
    return sessionValue(doc, {
      mode,
      hasKey: !!readKey(doc.config?.providerId ?? "openrouter"),
      keysSettled,
      runner: runners.kind(),
      elsewhere: runners.elsewhere(doc),
      voiceStatus: dictation.status(),
      place: standing?.current() ?? null,
      waiting: waiting?.items() ?? [],
      subjectTitle: names.title(doc.subject),
      workflowTitle: names.title(workflowOf(doc)?.url),
    })
  }

  function render() {
    if (disposed) return
    const doc = handle.doc()
    if (!doc) return

    waiting?.refresh()
    standing?.refresh(doc)
    const v = value(doc)

    root.dataset.runner = v.runner
    statusDot.dataset.status = v.status
    statusDot.title = v.status
    subjectLabel.textContent = v.title.text
    subjectLabel.title = v.title.tooltip
    workflowButton.hidden = !v.workflow
    if (v.workflow) {
      workflowButton.dataset.docUrl = v.workflow.url
      workflowButton.textContent = v.workflow.label
      workflowButton.title = v.workflow.tooltip
    }
    costLabel.textContent = v.cost?.text ?? ""
    costLabel.hidden = !v.cost
    costLabel.title = v.cost?.tooltip ?? ""
    modelButton.textContent = v.model
    // `doc` is the session document; the focused element lives on the DOM one.
    // Never overwrite the field while it is being typed in.
    const focused = modelInput.ownerDocument?.activeElement
    if (doc.config?.model && modelInput.value !== doc.config.model && focused !== modelInput) {
      modelInput.value = doc.config.model
    }
    renderDefaults()
    renderStrip(v.strip)

    renderStandingLine(standingLine, v.place)
    input.placeholder = v.placeholder
    // The step started running again meanwhile: a message goes straight to it.
    if (!v.gate) choices.hidden = true
    uiState.subject = doc.subject ?? null
    uiState.names = names.authors(doc)
    renderTranscript(transcript, doc, uiState, {
      decide: onDecide,
      answer: onAnswer,
      openDoc: onOpenDoc,
      view: (block, result) => views.elementFor(block, result, uiState),
      inline: () => [
        ...v.inline.session.map((item) => renderWaitingItem({ ...item, handle }, { showStep: false })),
        ...v.inline.workflows.map((item) => renderWaitingItem(item, { showStep: false, onOpen: onOpenDoc })),
      ].map((card) => {
        card.classList.add("agent-inline-waiting")
        return card
      }),
    })
    // Each citation's quote, looked up in the document it cites.
    markCitations(transcript, async (url) => (await repo.find(url))?.doc?.() ?? null)

    stopButton.style.display = v.canStop ? "" : "none"
    sendButton.disabled = !v.canSend
    hint.textContent = v.hint

    if (v.openSettings && settings.style.display === "none") settings.style.display = "flex"

    if (v.side && v.side !== subjectViewUrl) {
      subjectViewUrl = v.side
      subjectPane.replaceChildren()
      const view = document.createElement("patchwork-view")
      view.setAttribute("doc-url", v.side)
      subjectPane.append(view)
    }
  }

  const onChange = () => {
    render()
    if (handle.doc()?.made?.length) {
    ensureSettings()
    refreshHeads(handle.doc())
  }
    runners.wake()
  }
  handle.on("change", onChange)

  // The key can change under us — found in the account a moment after mount,
  // or replaced from another LLM tool or device — and the worker cannot read
  // the account for itself, so it is handed each new one.
  const offKeys = onKeyChange(() => {
    if (disposed) return
    runners.setKey(readKey(handle.doc()?.config?.providerId ?? "openrouter"))
    render()
  })
  connectAccountKeys(element, repo).then(() => {
    keysSettled = true
    render()
  })

  render()
  // Only needed once there is something installable; reading it eagerly would
  // fetch a document most sessions never touch.
  if (handle.doc()?.made?.length) {
    ensureSettings()
    refreshHeads(handle.doc())
  }

  // A session that already has work (reloaded mid-turn, or handed over) starts
  // immediately rather than waiting for someone to type.
  if (needsWork(handle.doc())) kick()

  return () => {
    disposed = true
    handle.off("change", onChange)
    offKeys()
    views.dispose()
    dictation.dispose()
    workspace?.dispose()
    names.dispose()
    waiting?.dispose()
    standing?.dispose()
    runners.dispose()
    root.remove()
  }
}

export default AgentTool
