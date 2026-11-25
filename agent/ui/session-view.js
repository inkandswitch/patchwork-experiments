/**
 * The agent view.
 *
 * One view serves both surfaces the design calls for: the sidebar panel
 * (`mode: "panel"`) and the full-window pop-out (`mode: "full"`, which adds a
 * live view of the subject document beside the transcript). They are the same
 * document and the same code — the difference is a data attribute and a
 * container query.
 *
 * `AgentTool` makes the view's parts and connects them. What it shows is a
 * value (ui/session-value.js) worked out from the session and the little this
 * view knows; each part copies its share of that value onto the page:
 *
 *   ui/session-runners.js  the tab and SharedWorker runners
 *   ui/settings-panel.js   model, effort, workflows, keys
 *   ui/composer.js         the box, attachments, dictation, sending
 *   ui/install.js          installing what the session made
 *   ui/names.js            who people and documents are
 *   ui/standing.js         where the session stands in its workflow
 *   ui/waiting.js          what workflow steps wait on a person for
 *   ui/transcript.js       the conversation, with ui/views.js inline
 */

import { handleStore } from "../kernel/store.js"
import { decide, answerQuestion } from "../kernel/loop.js"
import { needsWork } from "../kernel/runner.js"
import { accountContext } from "../runners/tab.js"
import { workflowOf } from "../workflow/plan.js"
import { getMount, mountForPerson, parkMount } from "../tools/checking.js"
import { readKey, onKeyChange, connectAccountKeys } from "../providers/keys.js"
import { watchWaiting, renderWaiting, renderWaitingItem } from "./waiting.js"
import { watchStanding, renderStandingLine } from "./standing.js"
import { markCitations } from "./citations.js"
import { renderTranscript } from "./transcript.js"
import { createGuidesButton } from "./guides.js"
import { createInlineViews } from "./views.js"
import { watchInstalls } from "./install.js"
import { watchWorkspace } from "./workspace.js"
import { createComposer } from "./composer.js"
import { sessionRunners } from "./session-runners.js"
import { createSettingsPanel } from "./settings-panel.js"
import { sessionValue } from "./session-value.js"
import { watchNames, myContactUrl } from "./names.js"
import { ensureStyles } from "./styles.js"

ensureStyles()

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/** The header: long-lived nodes whose few properties are set from the value. */
function sessionHeader(guides) {
  const element = el("div", "agent-header")
  const status = el("span", "agent-status")
  const title = el("span", "agent-subject", "Agent")
  // The workflow this session started, or is a step of: one click to its view
  // (a `data-doc-url`, opened by the root's delegated click).
  const workflow = el("button", "agent-workflow-link", "Workflow")
  workflow.hidden = true
  // What this session has spent, as OpenRouter reports it.
  const cost = el("span", "agent-cost", "")
  const model = el("button", "agent-model", "model")
  model.title = "Change model or API key"
  element.append(status, title, workflow, guides.button, cost, model)
  return {
    element,
    model,
    render(v) {
      status.dataset.status = v.status
      status.title = v.status
      title.textContent = v.title.text
      title.title = v.title.tooltip
      workflow.hidden = !v.workflow
      if (v.workflow) {
        workflow.dataset.docUrl = v.workflow.url
        workflow.textContent = v.workflow.label
        workflow.title = v.workflow.tooltip
      } else delete workflow.dataset.docUrl
      cost.textContent = v.cost?.text ?? ""
      cost.hidden = !v.cost
      cost.title = v.cost?.tooltip ?? ""
      model.textContent = v.model
    },
  }
}

/**
 * The pop-out's second pane: the subject document, live in its own tool. A
 * `<patchwork-view>` is a long-lived island, replaced only when the subject
 * is another document. What the agent makes and opens is not here but in the
 * transcript, beside the call that made or opened it (ui/views.js).
 */
function sidePane() {
  const element = el("div", "agent-subject-view")
  const pane = el("div", "agent-subject-pane")
  element.append(pane)
  let shown = null
  return {
    element,
    render(url) {
      if (!url || url === shown) return
      shown = url
      const view = document.createElement("patchwork-view")
      view.setAttribute("doc-url", url)
      pane.replaceChildren(view)
    },
  }
}

export function AgentTool(handle, element, options = {}) {
  const mode = options.mode ?? "full"
  const repo = options.repo ?? globalThis.repo
  const store = handleStore(handle, options.splice ?? null)
  const subjectUrl = () => handle.doc()?.subject ?? options.subject ?? null
  let disposed = false
  // Whether the account's LLM settings have answered, or failed to.
  let keysSettled = false
  // What the person opened in the transcript, kept across renders.
  const open = new Set()

  const root = el("div", "patchwork-agent")
  root.dataset.mode = mode
  element.append(root)

  /**
   * Open another document in Patchwork.
   *
   * A custom event rather than an import: `@inkandswitch/patchwork-elements`
   * resolves through the importmap, and this module also runs where there is
   * none. The event is the actual contract; the helper is a convenience.
   */
  function openDoc(url) {
    if (!url) return
    root.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url }, bubbles: true, composed: true }))
  }

  // ---- the parts -------------------------------------------------------
  const runners = sessionRunners({ handle, store, repo, element: root, subject: subjectUrl, onEvent: () => render() })
  const names = watchNames({ repo, onChange: () => render() })
  const installs = watchInstalls({ repo, onChange: () => render() })
  // Where this session stands in its workflow, kept up with the plan: a
  // step's state, a workflow at a glance, or the step a side thread is about.
  const standing = repo ? watchStanding({ repo, handle, onChange: () => render() }) : null
  // Workflow steps run in sessions nobody has open; what they wait on a person
  // for — a permission, a question — is shown above the transcript, and
  // answered in place. Only the strip is redrawn when that changes.
  const waiting = repo ? watchWaiting(repo, handle, () => renderStrip()) : null
  // A session about no one document is about whatever you have open. Each
  // message records that (session/blocks.js `contextBlock`), so "this" means
  // what was focused when you said it — in the floating box, or docked as a
  // panel.
  const workspace = !options.context && !subjectUrl() ? watchWorkspace(element, { repo, exclude: () => [handle.url] }) : null
  const contextFor = options.context ?? (workspace ? () => workspace.snapshot() : null)

  // The usage guides the agent keeps, and whether each is up to date.
  const guides = createGuidesButton({ repo, rootFolderUrl: accountContext().rootFolderUrl, openDoc })
  guides.refresh()
  const header = sessionHeader(guides)
  const standingLine = el("div", "agent-standing")
  standingLine.hidden = true
  const strip = el("div", "agent-waiting")
  strip.hidden = true
  const settings = createSettingsPanel({ store, onKey: (key) => runners.setKey(key), onChange: () => render() })
  // What the session makes and opens lives IN the transcript, beside the call
  // that made or opened it (ui/views.js), and nowhere else: a strip of things
  // made, or a pane for the agent's mounts, would be a place to look other
  // than where the thing is talked about.
  const transcript = el("div", "agent-transcript")
  const composer = createComposer({
    handle,
    store,
    repo,
    root,
    place: () => standing?.current() ?? null,
    contextFor,
    openDoc,
    onSent: () => runners.kick(),
    onStop: () => runners.stop(),
    onChange: () => render(),
  })
  const side = sidePane()
  // The inline views: what each call made or opened, live, beside the call.
  // A person's own mount goes through the same loader as the agent's, with a
  // context of its own — it needs a repo and a page, nothing of the runner's.
  const views = createInlineViews({
    getMount,
    parkMount,
    mountForPerson: (input) => mountForPerson(input, { repo, element: root }),
    openDoc,
    install: (ref, opts) => installs.install(ref, opts),
    uninstall: (ref) => installs.uninstall(ref),
    rerender: () => render(),
  })

  const main = el("div", "agent-main")
  main.append(header.element, standingLine, guides.panel, strip, settings.element, transcript, composer.element)
  root.append(main, side.element)

  // ---- what a person does ----------------------------------------------
  // Anything naming a document in `data-doc-url` opens it: links in rendered
  // markdown, attachments, the standing line's link back to a step, the
  // workflow button. Delegated from the root, so re-rendering never leaves a
  // dead link behind.
  root.addEventListener("click", (event) => {
    const link = event.target.closest?.("[data-doc-url]")
    if (!link || !root.contains(link)) return
    event.preventDefault()
    openDoc(link.dataset.docUrl)
  })
  header.model.addEventListener("click", (event) => {
    event.preventDefault()
    settings.toggle()
  })
  const answers = {
    // One "yes" answers every waiting call the grant covers, not one per call.
    decide(callId, decision) {
      decide(store, callId, decision)
      render()
      runners.kick()
    },
    async answer(callId, text) {
      answerQuestion(store, callId, text, await myContactUrl())
      render()
      runners.kick()
    },
  }

  // ---- rendering -------------------------------------------------------
  /** What the view shows now (ui/session-value.js). */
  function value(doc) {
    return sessionValue(doc, {
      mode,
      hasKey: !!readKey(doc.config?.providerId ?? "openrouter"),
      keysSettled,
      runner: runners.kind(),
      elsewhere: runners.elsewhere(doc),
      voiceStatus: composer.dictation.status(),
      place: standing?.current() ?? null,
      waiting: waiting?.items() ?? [],
      subjectTitle: names.title(doc.subject),
      workflowTitle: names.title(workflowOf(doc)?.url),
    })
  }

  function renderStrip(v = !disposed && handle.doc() ? value(handle.doc()) : null) {
    if (v && waiting) renderWaiting(strip, v.strip, { onOpen: openDoc, subject: handle.doc()?.subject ?? null })
  }

  function render() {
    if (disposed) return
    const doc = handle.doc()
    if (!doc) return
    waiting?.refresh()
    standing?.refresh(doc)
    const v = value(doc)

    root.dataset.runner = v.runner
    header.render(v)
    renderStandingLine(standingLine, v.place)
    renderStrip(v)
    settings.render(doc)
    if (v.openSettings) settings.reveal()

    const state = { open, names: names.authors(doc), subject: doc.subject ?? null, settings: installs.settings(), heads: installs.heads() }
    renderTranscript(transcript, doc, state, {
      ...answers,
      openDoc,
      view: (block, result) => views.elementFor(block, result, state),
      // A spent budget, the session's or its workflow's, answered at the end
      // of the conversation as a permission is.
      inline: () =>
        [
          ...v.inline.session.map((item) => renderWaitingItem({ ...item, handle }, { showStep: false })),
          ...v.inline.workflows.map((item) => renderWaitingItem(item, { showStep: false, onOpen: openDoc })),
        ].map((card) => {
          card.classList.add("agent-inline-waiting")
          return card
        }),
    })
    // Each citation's quote, looked up in the document it cites.
    markCitations(transcript, async (url) => (await repo.find(url))?.doc?.() ?? null)

    composer.render(v)
    side.render(v.side)
  }

  // ---- connecting it up ------------------------------------------------
  const onChange = () => {
    render()
    installs.refresh(handle.doc())
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
  installs.refresh(handle.doc())
  // A session that already has work (reloaded mid-turn, or handed over) starts
  // immediately rather than waiting for someone to type.
  if (needsWork(handle.doc())) runners.kick()

  return () => {
    disposed = true
    handle.off("change", onChange)
    offKeys()
    views.dispose()
    composer.dispose()
    workspace?.dispose()
    names.dispose()
    installs.dispose()
    waiting?.dispose()
    standing?.dispose()
    // The runners carry on: closing a view never aborts the work it shows.
    runners.dispose()
    root.remove()
  }
}

export default AgentTool
