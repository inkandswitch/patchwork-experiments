/**
 * The agent view.
 *
 * One render function serves both surfaces the design calls for: the sidebar
 * panel (`mode: "panel"`) and the full-window pop-out (`mode: "full"`, which
 * adds a live view of the subject document beside the transcript). They are
 * the same document and the same code — the difference is a data attribute and
 * a container query.
 */

import {
  STATUS,
  CALL,
  callsAwaitingApproval,
  questionsAwaitingAnswer,
  sessionTitle,
  asksEveryTime,
  callScope,
} from "./session.js"
import { handleStore } from "./store.js"
import { decide, say, answerQuestion } from "./loop.js"
import { SessionRunner, heldElsewhere, needsWork } from "./runner.js"
import { ensureRunner as ensureSharedRunner, attachView } from "./runners.js"
import { connectWorkerRunner } from "./worker-client.js"
import { buildToolset } from "./tools/index.js"
import { getProvider, readKey, writeKey, loadCatalogue, modelInfo } from "./providers/index.js"
import { listSecrets, writeSecret } from "./secrets.js"
import { describeModel, describeDefaults } from "./providers/openrouter.js"
import { hostImport } from "./tools/host.js"
import { renderTranscript } from "./ui/transcript.js"
import { createInlineViews } from "./ui/views.js"
import { getMount, mountForPerson, mountIdIn, parkMount } from "./tools/checking.js"
import { applyInstall, applyUninstall } from "./ui/install.js"

const STYLE_ID = "patchwork-agent-styles"
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  try {
    const link = document.createElement("link")
    link.id = STYLE_ID
    link.rel = "stylesheet"
    link.href = new URL("./styles.css", import.meta.url).href
    document.head.appendChild(link)
  } catch {
    // happy-dom refuses external stylesheets in tests; styling is not what
    // those assert on, so a failure to load CSS must not fail the mount.
  }
}

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/** The current user's contact URL, for attributing what they say. */
async function myContactUrl() {
  try {
    return globalThis.accountDocHandle?.doc()?.contactUrl ?? null
  } catch {
    return null
  }
}

async function titleOf(repo, url) {
  if (!url) return null
  try {
    const doc = (await repo.find(url)).doc()
    return doc?.title ?? doc?.name ?? url.replace(/^automerge:/, "").slice(0, 8)
  } catch {
    return url.replace(/^automerge:/, "").slice(0, 8)
  }
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
  header.append(statusDot, subjectLabel, modelButton)

  // What the session makes and opens lives IN the transcript, beside the call
  // that made or opened it (ui/views.js). There used to be a strip of "things
  // made here" under the header and a workbench pane for the agent's mounts;
  // both were places to look other than where the thing was talked about.
  const transcript = el("div", "agent-transcript")
  const composer = el("div", "agent-composer")
  main.append(header, transcript, composer)

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
  const row = el("div", "agent-composer-row")
  row.append(hint, stopButton, sendButton)
  composer.append(input, row)

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
  const keyInput = document.createElement("input")
  keyInput.type = "password"
  keyInput.placeholder = "OpenRouter API key (sk-or-…)"
  keyInput.autocomplete = "off"
  const saveKey = el("button", null, "Save")
  saveKey.dataset.variant = "primary"
  const keyNote = el("p", null, "Stored in this browser only — never written to the document, so it is not synced to anyone you share this session with.")

  // Credentials for authenticated sources. Same rule as the API key: this
  // device only, never the document, and the agent only ever learns the name.
  const secretsList = el("div", "agent-secrets")
  const secretName = document.createElement("input")
  secretName.type = "text"
  secretName.placeholder = "name (e.g. github)"
  const secretValue = document.createElement("input")
  secretValue.type = "password"
  secretValue.placeholder = "token"
  secretValue.autocomplete = "off"
  const addSecret = el("button", null, "Add credential")
  const secretsNote = el("p", null, "The agent sees only the name and asks before every request that uses one.")

  settings.append(
    el("p", null, "Model"),
    modelInput,
    modelList,
    modelStatus,
    paramsNote,
    refreshModels,
    el("p", null, "API key"),
    keyInput,
    keyNote,
    saveKey,
    el("p", null, "Credentials"),
    secretsList,
    secretName,
    secretValue,
    addSecret,
    secretsNote
  )
  main.insertBefore(settings, transcript)

  function renderSecrets() {
    secretsList.replaceChildren()
    const names = listSecrets()
    if (!names.length) {
      secretsList.append(el("p", null, "None stored."))
      return
    }
    for (const name of names) {
      const row = el("div", "cluster")
      row.append(el("span", "agent-hint", name))
      const remove = el("button", null, "Remove")
      remove.dataset.variant = "danger"
      remove.addEventListener("click", (event) => {
        event.preventDefault()
        writeSecret(name, null)
        renderSecrets()
      })
      row.append(remove)
      secretsList.append(row)
    }
  }

  addSecret.addEventListener("click", (event) => {
    event.preventDefault()
    const name = secretName.value.trim()
    const value = secretValue.value
    if (!name || !value) return
    writeSecret(name, value)
    secretName.value = ""
    secretValue.value = ""
    renderSecrets()
  })

  renderSecrets()

  // ---- state -----------------------------------------------------------
  const uiState = { open: new Set(), names: new Map(), subject: null, settings: null, heads: {} }
  // The toolset the runner built, so the view can ask it about a call.
  let toolsetRef = null

  // The inline views: what each call made or opened, live, beside the call.
  // A person's own mount goes through the same loader as the agent's, with a
  // context of its own — it needs a repo and a page, nothing of the runner's.
  const views = createInlineViews({
    getMount,
    mountIdIn,
    parkMount,
    mountForPerson: (input) => mountForPerson(input, { repo, element: root }),
    openDoc: (url) => onOpenDoc(url),
    install: (ref, opts) => onInstall(ref, opts),
    uninstall: (ref) => onUninstall(ref),
    rerender: () => render(),
  })
  const sensitiveDocs = () =>
    [
      globalThis.accountDocHandle?.doc()?.moduleSettingsUrl,
      globalThis.accountDocHandle?.url,
    ].filter(Boolean)
  const store = handleStore(handle, options.splice ?? null)
  let runner = null
  let detachView = null
  let disposed = false

  const subjectUrl = () => handle.doc()?.subject ?? options.subject ?? null

  // ---- runners ---------------------------------------------------------
  //
  // Two of them, and that is deliberate. The SharedWorker runs the session —
  // one runner across every tab, surviving navigation. But a worker has no DOM
  // and no plugin registry, so host-tier calls (dom_snapshot, doc_create,
  // installing) park there; the in-tab runner exists to pick exactly those
  // up. `needsWork` is runner-aware, so each one only claims the lease for work
  // it can actually do, and the lease keeps them from colliding.
  let workerRunner = null
  let workerTried = false

  /**
   * Opt-in for now: `localStorage["patchwork-agent:worker"] = "on"`.
   *
   * The worker demonstrably boots, imports automerge, builds a repo over the
   * donated port, and finds and writes the page's documents
   * (probes/worker-repo.mjs, 8/8). What is not yet proven is *ongoing* sync:
   * when the page writes an approval into the session, the worker's copy does
   * not reliably see it, and the turn stalls. The page's `window.repo` is
   * itself a client of Patchwork's own automerge worker, so attaching another
   * network adapter to it may not relay changes the way a plain Repo would.
   * Until that is understood, the in-tab runner stays the default.
   */
  function workerEnabled() {
    try {
      return globalThis.localStorage?.getItem("patchwork-agent:worker") === "on"
    } catch {
      return false
    }
  }

  async function ensureWorkerRunner() {
    if (workerRunner || workerTried || disposed) return workerRunner
    workerTried = true
    if (!workerEnabled()) return null
    try {
      workerRunner = await connectWorkerRunner({
        repo,
        sessionUrl: handle.url,
        subject: subjectUrl(),
        key: readKey(handle.doc()?.config?.providerId ?? "openrouter"),
        providerId: handle.doc()?.config?.providerId ?? "openrouter",
        onEvent: () => render(),
      })
    } catch {
      workerRunner = null // the tab runner covers everything it would have done
    }
    return workerRunner
  }

  /**
   * The runner for this session — shared, and deliberately NOT owned by this
   * view. Two views of one session share one runner, and closing a view does
   * not stop it: navigating away should never abort work you asked for.
   */
  async function ensureRunner() {
    if (runner || disposed) return runner

    const entry = await ensureSharedRunner(handle.url, async (emit) => {
      // Snapshot the worker's presence now and hold it for this runner's life.
      const tabCanRun = workerRunner
        ? (where) => where === "host"
        : (where) => where === "worker" || where === "host"

      const { splice } = await hostImport("automerge").catch(() => ({ splice: null }))
      const liveStore = handleStore(handle, splice)

      // Mutable on purpose: `element` is swapped as views come and go, so
      // host-tier tools always mount into something actually on the page, and
      // becomes null when nothing is watching.
      const sharedCtx = {
        repo,
        subject: subjectUrl(),
        // So the agent can name its own conversation. Nothing else may be
        // reached through this — it is the session's own document.
        sessionUrl: handle.url,
        splice,
        element: root,
        // Installing a module means editing the account's module-settings
        // document, and discovery needs the root folder — the entry point to
        // everything the user has.
        accountDocHandle: globalThis.accountDocHandle ?? null,
        rootFolderUrl: globalThis.accountDocHandle?.doc()?.rootFolderUrl ?? null,
        contactUrl: globalThis.accountDocHandle?.doc()?.contactUrl ?? null,
        moduleSettingsUrl: globalThis.accountDocHandle?.doc()?.moduleSettingsUrl ?? null,
        skillsFolderUrl: handle.doc()?.config?.skillsFolderUrl ?? null,
        // So view_screenshot can photograph a view that view_mount opened.
        getMount,
        // Documents that always require an explicit yes, whatever touches them.
        sensitiveDocs: [
          globalThis.accountDocHandle?.doc()?.moduleSettingsUrl,
          globalThis.accountDocHandle?.url,
        ].filter(Boolean),
      }

      const made = new SessionRunner({
        store: liveStore,
        runnerUrl: `tab-${Math.random().toString(36).slice(2, 10)}`,
        ctx: sharedCtx,
        buildToolset: async (doc) => {
          toolsetRef = await buildToolset(doc)
          return toolsetRef
        },
        getProvider: async () => getProvider(handle.doc()?.config?.providerId ?? "openrouter"),
        getKey: () => readKey(handle.doc()?.config?.providerId ?? "openrouter"),
        getModelInfo: (model, providerId) => modelInfo(providerId, model, { key: readKey(providerId) }),
        // Fixed at construction, NOT read live. A `canRun` that consults
        // `workerRunner` flips mid-run the moment the worker finishes
        // connecting, and the turn in flight then parks on its own worker-tier
        // call. The lease keeps two runners from colliding; this only decides
        // what each is willing to pick up.
        canRun: tabCanRun,
        onEvent: emit,
      })
      // The runner watches the document itself. Previously this subscription
      // lived in the view, so unmounting the tool left the runner alive but
      // with nothing to wake it — and an approval written from anywhere else
      // would never be picked up. A runner that outlives its view has to hear
      // about changes on its own.
      const onDocChange = () => made.tick()
      handle.on("change", onDocChange)

      made.start()
      return {
        runner: made,
        ctx: sharedCtx,
        dispose: () => handle.off("change", onDocChange),
      }
    })

    runner = entry?.runner ?? null
    detachView = attachView(handle.url, { element: root, onEvent: () => render() })
    return runner
  }

  // ---- actions ---------------------------------------------------------

  /**
   * Nudge whoever should be working.
   *
   * The worker is preferred, so it gets first refusal; the tab is only woken
   * for host-tier work it alone can do. Kicking both indiscriminately means the
   * tab wins the race for the lease every time — it is already running, while
   * the worker still has to boot, resolve the importmap and shake hands — and
   * the SharedWorker would never actually be used.
   */
  async function kick() {
    const worker = await ensureWorkerRunner()
    if (worker) {
      worker.tick()
      if (needsWork(handle.doc(), (where) => where === "host")) {
        ensureRunner().then((r) => r?.tick())
      }
      return
    }
    ensureRunner().then((r) => r?.tick())
  }

  async function send() {
    const text = input.value.trim()
    if (!text) return
    input.value = ""
    say(store, text, await myContactUrl())
    render()
    kick()
  }

  function onDecide(callId, decision) {
    // The toolset decides which other pending calls a new grant releases, so
    // one "yes" answers every call it covers instead of one per call.
    decide(store, callId, decision, subjectUrl(), { toolset: toolsetRef, sensitive: sensitiveDocs() })
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

  // Document links inside rendered markdown navigate too. Delegated from the
  // transcript, so re-rendering never leaves a dead link behind.
  transcript.addEventListener("click", (event) => {
    const link = event.target.closest?.("[data-doc-url]")
    if (!link) return
    event.preventDefault()
    onOpenDoc(link.dataset.docUrl)
  })

  sendButton.addEventListener("click", (event) => {
    event.preventDefault()
    send()
  })

  stopButton.addEventListener("click", (event) => {
    event.preventDefault()
    runner?.interrupt()
    workerRunner?.interrupt()
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

  let catalogueLoaded = false
  let catalogueModels = []

  function renderDefaults() {
    const doc = handle.doc()
    const info = catalogueModels.find((m) => m.id === doc?.config?.model)
    if (!info) {
      paramsNote.textContent = ""
      return
    }
    const set = Object.entries(doc?.config?.params ?? {}).filter(([name]) => name !== "maxTokens")
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
      workerRunner?.setKey(value)
      keyInput.value = ""
    }
    settings.style.display = "none"
    render()
  })

  // ---- rendering -------------------------------------------------------
  let subjectViewUrl = null

  function render() {
    if (disposed) return
    const doc = handle.doc()
    if (!doc) return

    const providerId = doc.config?.providerId ?? "openrouter"
    const hasKey = !!readKey(providerId)

    root.dataset.runner = workerRunner ? "worker" : workerTried ? "tab" : "pending"
    statusDot.dataset.status = doc.status ?? STATUS.idle
    statusDot.title = doc.status ?? "idle"
    modelButton.textContent = (doc.config?.model ?? "no model").split("/").pop()
    // `doc` is the session document; the focused element lives on the DOM one.
    // Never overwrite the field while it is being typed in.
    const focused = modelInput.ownerDocument?.activeElement
    if (doc.config?.model && modelInput.value !== doc.config.model && focused !== modelInput) {
      modelInput.value = doc.config.model
    }
    renderDefaults()

    uiState.subject = doc.subject ?? null
    renderTranscript(transcript, doc, uiState, {
      decide: onDecide,
      answer: onAnswer,
      openDoc: onOpenDoc,
      // The view has the session document; only the toolset knows which calls
      // ignore grants, so it answers that question for the card.
      alwaysAsks: (block) => asksEveryTime(toolsetRef?.get(block.tool), block.input),
      scopeOf: (block) => callScope(block, subjectUrl(), toolsetRef?.get(block.tool) ?? null),
      view: (block, result) => views.elementFor(block, result, uiState),
    })

    // Header label: what this session IS, not what it is docked beside.
    //
    // It used to show the subject's title, which in a sidebar is the document
    // you are already looking at — so the one row of chrome the session gets
    // was spent telling you something you could see. Once the agent names its
    // own work, that name belongs here; the subject moves to the tooltip, which
    // is where "and which document is this about" belongs.
    const named = sessionTitle(doc)
    if (named) {
      subjectLabel.textContent = named
      subjectLabel.title = named
      if (doc.subject) {
        titleOf(repo, doc.subject).then((title) => {
          if (!disposed && title) subjectLabel.title = `${named} — on ${title}`
        })
      }
    } else if (doc.subject) {
      titleOf(repo, doc.subject).then((title) => {
        if (!disposed) {
          subjectLabel.textContent = title ?? "Agent"
          subjectLabel.title = title ? `on ${title}` : ""
        }
      })
    } else {
      subjectLabel.textContent = "Agent"
      subjectLabel.title = ""
    }

    const busy = doc.status === STATUS.running
    stopButton.style.display = busy ? "" : "none"
    sendButton.disabled = !hasKey

    const pending = callsAwaitingApproval(doc).length
    const asking = questionsAwaitingAnswer(doc).length
    const elsewhere = heldElsewhere(doc, runner?.runnerUrl)
    hint.textContent = !hasKey
      ? "Add an API key to start"
      : asking
        ? asking === 1
          ? "Waiting on your answer"
          : `Waiting on ${asking} answers`
        : pending
          ? `${pending} call${pending === 1 ? " needs" : "s need"} approval`
          : elsewhere
            ? "Another runner is working on this session"
            : doc.status === STATUS.parked
              ? "Waiting for a tab to run a page tool"
              : busy
                ? "Working… Enter to steer, Stop to interrupt"
                : ""

    if (!hasKey && settings.style.display === "none" && !doc.turns?.length) {
      settings.style.display = "flex"
    }

    // The pop-out's second pane shows the subject document.
    if (mode === "full" && doc.subject && doc.subject !== subjectViewUrl) {
      subjectViewUrl = doc.subject
      subjectPane.replaceChildren()
      const view = document.createElement("patchwork-view")
      view.setAttribute("doc-url", doc.subject)
      subjectPane.append(view)
    }
  }

  const onChange = () => {
    render()
    if (handle.doc()?.made?.length) {
    ensureSettings()
    refreshHeads(handle.doc())
  }
    // The worker parks host-tier calls; this is how the tab notices and takes
    // them. Cheap — `needsWork` is a scan of the transcript, and `tick` is a
    // no-op when this runner has nothing it can do.
    if (needsWork(handle.doc(), (where) => where === "host")) {
      ensureRunner().then((r) => r?.tick())
    }
  }
  handle.on("change", onChange)
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
    // Detach this view; deliberately NOT runner.stop(). Navigating away from a
    // session must not abort the work it is doing. The runner keeps its lease
    // and keeps writing to the document, so reopening the session — here or in
    // another tab — picks up whatever happened while you were gone.
    views.dispose()
    detachView?.()
    workerRunner?.close()
    root.remove()
  }
}

export default AgentTool
