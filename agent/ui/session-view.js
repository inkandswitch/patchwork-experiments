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
import { decide, answerQuestion } from "../kernel/loop.js"
import { needsWork } from "../kernel/runner.js"
import { accountContext } from "../runners/tab.js"
import { watchWaiting, renderWaiting, renderWaitingItem } from "./waiting.js"
import { markCitations } from "./citations.js"
import { workflowOf } from "../workflow/plan.js"
import { watchStanding, renderStandingLine } from "./standing.js"
import { readKey, onKeyChange, connectAccountKeys } from "../providers/keys.js"
import { renderTranscript } from "./transcript.js"
import { createGuidesButton } from "./guides.js"
import { createInlineViews } from "./views.js"
import { getMount, mountForPerson, parkMount } from "../tools/checking.js"
import { watchInstalls } from "./install.js"
import { watchWorkspace } from "./workspace.js"
import { createComposer } from "./composer.js"
import { ensureStyles } from "./styles.js"
import { sessionRunners } from "./session-runners.js"
import { createSettingsPanel } from "./settings-panel.js"
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
  const store = handleStore(handle, options.splice ?? null)

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
  main.append(header, guides.panel, transcript)

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

  // The model, effort, workflows and keys (ui/settings-panel.js).
  const settings = createSettingsPanel({ store, onKey: (key) => runners.setKey(key), onChange: () => render() })
  main.insertBefore(settings.element, transcript)

  // ---- state -----------------------------------------------------------
  // What the person opened in the transcript, kept across renders.
  const open = new Set()
  // The install controls' view of the account (ui/install.js).
  const installs = watchInstalls({ repo, onChange: () => render() })
  const names = watchNames({ repo, onChange: () => render() })

  // The inline views: what each call made or opened, live, beside the call.
  // A person's own mount goes through the same loader as the agent's, with a
  // context of its own — it needs a repo and a page, nothing of the runner's.
  const views = createInlineViews({
    getMount,
    parkMount,
    mountForPerson: (input) => mountForPerson(input, { repo, element: root }),
    openDoc: (url) => onOpenDoc(url),
    install: (ref, opts) => installs.install(ref, opts),
    uninstall: (ref) => installs.uninstall(ref),
    rerender: () => render(),
  })
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

  // What a person writes to the session, and sending it (ui/composer.js).
  const composer = createComposer({
    handle,
    store,
    repo,
    root,
    place: () => standing?.current() ?? null,
    contextFor,
    openDoc: (url) => onOpenDoc(url),
    onSent: kick,
    onStop: () => runners.stop(),
    onChange: () => render(),
  })
  main.append(composer.element)

  function onDecide(callId, decision) {
    // One "yes" answers every waiting call the grant covers, not one per call.
    decide(store, callId, decision)
    render()
    kick()
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

  modelButton.addEventListener("click", (event) => {
    event.preventDefault()
    settings.toggle()
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
      voiceStatus: composer.dictation.status(),
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
    settings.render(doc)
    renderStrip(v.strip)

    renderStandingLine(standingLine, v.place)
    const state = { open, names: names.authors(doc), subject: doc.subject ?? null, settings: installs.settings(), heads: installs.heads() }
    renderTranscript(transcript, doc, state, {
      decide: onDecide,
      answer: onAnswer,
      openDoc: onOpenDoc,
      view: (block, result) => views.elementFor(block, result, state),
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

    composer.render(v)

    if (v.openSettings) settings.reveal()

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
  if (needsWork(handle.doc())) kick()

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
    runners.dispose()
    root.remove()
  }
}

export default AgentTool
