/**
 * The agent view.
 *
 * One render function serves both surfaces the design calls for: the sidebar
 * panel (`mode: "panel"`) and the full-window pop-out (`mode: "full"`, which
 * adds a live view of the subject document beside the transcript). They are
 * the same document and the same code — the difference is a data attribute and
 * a container query.
 */

import { STATUS, CALL, callsAwaitingApproval } from "./session.js"
import { handleStore } from "./store.js"
import { decide, say } from "./loop.js"
import { SessionRunner, heldElsewhere, needsWork } from "./runner.js"
import { ensureRunner as ensureSharedRunner, attachView } from "./runners.js"
import { connectWorkerRunner } from "./worker-client.js"
import { buildToolset } from "./tools/index.js"
import { getProvider, readKey, writeKey, loadCatalogue } from "./providers/index.js"
import { listSecrets, writeSecret } from "./secrets.js"
import { describeModel } from "./providers/openrouter.js"
import { hostImport } from "./tools/host.js"
import { getMount } from "./tools/checking.js"
import { renderTranscript } from "./ui/transcript.js"

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
  const subjectPane = el("div", "agent-subject-view")
  root.append(main, subjectPane)

  // ---- header ----------------------------------------------------------
  const header = el("div", "agent-header")
  const statusDot = el("span", "agent-status")
  const subjectLabel = el("span", "agent-subject", "Agent")
  const modelButton = el("button", "agent-model", "model")
  modelButton.title = "Change model or API key"
  header.append(statusDot, subjectLabel, modelButton)

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
  const uiState = { open: new Set(), names: new Map(), subject: null }
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
        buildToolset: (doc) => buildToolset(doc),
        getProvider: async () => getProvider(handle.doc()?.config?.providerId ?? "openrouter"),
        getKey: () => readKey(handle.doc()?.config?.providerId ?? "openrouter"),
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
    decide(store, callId, decision, subjectUrl())
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
  async function loadModels({ force = false } = {}) {
    const providerId = handle.doc()?.config?.providerId ?? "openrouter"
    modelStatus.textContent = force ? "Refreshing…" : "Loading models…"
    try {
      const { models, cached, error } = await loadCatalogue(providerId, {
        force,
        key: readKey(providerId),
      })
      catalogueLoaded = true

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

    uiState.subject = doc.subject ?? null
    renderTranscript(transcript, doc, uiState, { decide: onDecide, openDoc: onOpenDoc })

    // Header label: what this session is attached to.
    if (doc.subject) {
      titleOf(repo, doc.subject).then((title) => {
        if (!disposed) subjectLabel.textContent = title ?? "Agent"
      })
    } else {
      subjectLabel.textContent = doc.title || "Agent"
    }

    const busy = doc.status === STATUS.running
    stopButton.style.display = busy ? "" : "none"
    sendButton.disabled = !hasKey

    const pending = callsAwaitingApproval(doc).length
    const elsewhere = heldElsewhere(doc, runner?.runnerUrl)
    hint.textContent = !hasKey
      ? "Add an API key to start"
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

    // The pop-out's second pane: the live document, beside the transcript.
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
    // The worker parks host-tier calls; this is how the tab notices and takes
    // them. Cheap — `needsWork` is a scan of the transcript, and `tick` is a
    // no-op when this runner has nothing it can do.
    if (needsWork(handle.doc(), (where) => where === "host")) {
      ensureRunner().then((r) => r?.tick())
    }
  }
  handle.on("change", onChange)
  render()

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
    detachView?.()
    workerRunner?.close()
    root.remove()
  }
}

export default AgentTool
