/**
 * The ambient agent — summoned from anywhere, about whatever you have open.
 *
 * `AmbientAgent` is a pop-over at the bottom centre of the window, mounted by a
 * frame into its overlay layer (components tagged `"overlay"`). Cmd/Ctrl+J
 * opens and closes it, and so does the frame's own button for it: the frame
 * sends `patchwork:toggle-overlay` to the overlay's `<patchwork-view>`, and the
 * pop-over answers with a bubbling `patchwork:overlay-state` `{ open }` so the
 * button can show it pressed. Escape closes it; it can be docked as an ordinary
 * panel. Cmd/Ctrl+Shift+Space, from anywhere, opens it already dictating
 * (ui/voice.js). Closed, it shows a pill while the agent works and peeks up
 * when something needs you (ui/attention.js), and can notify you when the tab
 * is in the background (ui/notify.js).
 *
 * The session belongs to the account, not to a document: it lives in the
 * agent's tool storage (`patchwork:tool-storage`, `{ sessionUrl, sessions }`),
 * has no subject, and so each message records what was focused and open when
 * it was sent (see ui/workspace.js and session.js `contextBlock`).
 */

import { AgentTool, isDictationShortcut } from "./tool.js"
import { initSession, sessionTitle } from "./session.js"
import { hostImport } from "./tools/host.js"
import { subscribe, openDocument } from "./ui/providers.js"
import { watchWorkspace } from "./ui/workspace.js"
import { watchAttention } from "./ui/attention.js"
import { renderWaitingItem } from "./ui/waiting.js"
import { createNotifier, notificationsEnabled, notificationsSupported, setNotifications } from "./ui/notify.js"
import { say } from "./loop.js"
import { handleStore } from "./store.js"

export const STORAGE_TOOL_ID = "agent-ambient"
const FALLBACK_KEY = "patchwork-agent:ambient"
const STORAGE_TIMEOUT_MS = 3000
const HISTORY_LIMIT = 20

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

const button = (text, title) => {
  const node = el("button", null, text)
  node.type = "button"
  node.title = title
  return node
}

const isMac = () => /mac|iphone|ipad/i.test(globalThis.navigator?.platform ?? "")
export const SHORTCUT_LABEL = () => (isMac() ? "⌘J" : "Ctrl+J")

export function isToggleShortcut(event) {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key?.toLowerCase() === "j"
}

// ---- where the session lives ---------------------------------------------

/**
 * A stand-in for the tool-storage document when no provider answers: the same
 * `{ doc, change, on, off }` surface over this device's localStorage. Only a
 * pointer is kept there — the sessions themselves are still documents.
 */
function localStorageDoc() {
  const listeners = new Set()
  let doc = {}
  try {
    doc = JSON.parse(globalThis.localStorage?.getItem(FALLBACK_KEY) ?? "{}") ?? {}
  } catch {
    doc = {}
  }
  return {
    doc: () => doc,
    change(fn) {
      fn(doc)
      try {
        globalThis.localStorage?.setItem(FALLBACK_KEY, JSON.stringify(doc))
      } catch {
        /* storage full or blocked: the pointer lasts as long as the page */
      }
      for (const listener of [...listeners]) listener({ doc })
    },
    on: (event, fn) => event === "change" && listeners.add(fn),
    off: (_event, fn) => listeners.delete(fn),
  }
}

/** The agent's tool-storage document, or the local stand-in if nobody answers. */
export function findStorage(element, repo, { timeoutMs = STORAGE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe = () => {}
    const settle = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const timer = setTimeout(() => settle(localStorageDoc()), timeoutMs)
    unsubscribe = subscribe(element, { type: "patchwork:tool-storage", toolId: STORAGE_TOOL_ID }, (url) => {
      if (!url) return
      repo.find(url).then(settle, () => settle(localStorageDoc()))
    })
  })
}

export async function createSession(repo) {
  const session = await repo.create2()
  session.change((doc) => {
    initSession(doc, { subject: null })
  })
  return session
}

/** Make `url` the current session, most recent first in the history. */
function remember(storage, url) {
  storage.change((d) => {
    d.sessionUrl = url
    const earlier = (d.sessions ?? []).filter((u) => u !== url)
    d.sessions = [url, ...earlier].slice(0, 100)
  })
}

/** The current session's handle, making one the first time. */
export async function currentSession(storage, repo) {
  const url = storage.doc()?.sessionUrl
  if (url) {
    try {
      return await repo.find(url)
    } catch {
      // Gone or unreachable: start a fresh one rather than staying broken.
    }
  }
  const session = await createSession(repo)
  remember(storage, session.url)
  return session
}

// ---- the pop-over --------------------------------------------------------

/** How many recent sessions the pill and the peek keep an eye on. */
export const WATCHED_SESSIONS = 10

/**
 * The agent, at the bottom centre of the window.
 *
 * Three ways to be there, and only one at a time:
 *
 *   open    the session itself, growing up from the bottom edge (⌘J)
 *   peek    something needs you — a question, a permission, a long run that
 *           finished — answered right there, without opening anything
 *   pill    the agent is working, and on what
 *
 * and nothing at all when it is idle. It stays where it is: a box that could be
 * dragged anywhere mostly got dragged out of the way and forgotten.
 */
export function AmbientAgent(element, options = {}) {
  const repo = options.repo ?? globalThis.repo
  // The frame addresses its overlay by the view hosting it.
  const hostView = element.closest?.("patchwork-view") ?? element

  const setOpen = (open) =>
    element.dispatchEvent(new CustomEvent("patchwork:overlay-state", { detail: { open }, bubbles: true }))

  // The overlay layer lets pointer events through, so each surface takes them
  // back for itself, inline: an older stylesheet must not leave them unclickable.
  const pop = el("div", "agent-pop")
  pop.style.pointerEvents = "none"
  const takePointer = (node) => {
    node.style.pointerEvents = "auto"
    return node
  }

  const box = takePointer(el("div", "agent-float"))
  box.hidden = true
  box.setAttribute("role", "dialog")
  box.setAttribute("aria-label", "Agent")

  const bar = el("div", "agent-float-bar")
  const on = el("span", "agent-float-on", "Agent")
  const history = document.createElement("select")
  history.className = "agent-float-history"
  history.title = "Earlier sessions"
  const newButton = button("New", "Start a new session")
  const dockButton = button("Dock", "Open this session as a panel")
  const bellButton = button("🔔", "")
  bellButton.className = "agent-float-bell"
  const closeButton = button("×", `Close (Esc, or ${SHORTCUT_LABEL()})`)
  closeButton.className = "agent-float-close"
  bar.append(on, history, newButton, dockButton, bellButton, closeButton)

  const body = el("div", "agent-float-body")
  box.append(bar, body)

  const pill = takePointer(button("", `Open the agent (${SHORTCUT_LABEL()})`))
  pill.className = "agent-pill"
  pill.hidden = true
  const peek = takePointer(el("div", "agent-peek"))
  peek.hidden = true
  peek.setAttribute("role", "status")
  peek.setAttribute("aria-live", "polite")

  pop.append(peek, pill, box)
  element.append(pop)

  let disposed = false
  let storage = null
  let sessionUrl = null
  let cleanupTool = null
  let mounting = null
  let returnFocus = null
  let generation = 0

  // ---- what you are looking at -----------------------------------------
  const workspace = watchWorkspace(element, {
    repo,
    exclude: () => (sessionUrl ? [sessionUrl] : []),
    onChange: () => labelFocus(),
  })

  async function labelFocus() {
    const url = workspace.focused()
    if (!url) {
      on.textContent = "Agent"
      on.title = "Nothing focused"
      return
    }
    const title = (await workspace.title(url)) ?? "untitled"
    if (disposed || workspace.focused() !== url) return
    on.textContent = `on ${title}`
    on.title = `Messages are sent with "${title}" as the focused document`
  }

  // ---- the session -----------------------------------------------------
  async function ensureStorage() {
    if (!storage) {
      storage = await findStorage(element, repo)
      storage.on("change", onStorageChange)
      // The sessions to follow are listed here: start following them now, not
      // at the list's next change.
      onStorageChange()
    }
    return storage
  }

  function onStorageChange() {
    renderHistory()
    attention?.refresh()
    renderAttention()
  }

  async function mount(handle) {
    const mine = ++generation
    const { splice } = await hostImport("automerge").catch(() => ({ splice: null }))
    if (disposed || mine !== generation) return
    cleanupTool?.()
    body.replaceChildren()
    sessionUrl = handle.url
    cleanupTool = AgentTool(handle, body, { mode: "panel", repo, splice })
    renderHistory()
    attention?.refresh()
  }

  function ensureMounted() {
    mounting ??= (async () => {
      const store = await ensureStorage()
      await mount(await currentSession(store, repo))
    })().catch((err) => {
      mounting = null
      body.replaceChildren(el("div", "agent-empty", `Could not open the agent: ${err?.message ?? err}`))
    })
    return mounting
  }

  async function switchTo(url) {
    if (!url || url === sessionUrl) return
    const store = await ensureStorage()
    remember(store, url)
    await mount(await repo.find(url))
  }

  async function renderHistory() {
    const urls = (storage?.doc()?.sessions ?? []).slice(0, HISTORY_LIMIT)
    const titled = await Promise.all(
      urls.map(async (url) => {
        try {
          const doc = (await repo.find(url)).doc()
          const when = doc?.turns?.[0]?.at ? new Date(doc.turns[0].at).toLocaleDateString() : "empty"
          return { url, label: sessionTitle(doc) ?? `Untitled · ${when}` }
        } catch {
          return null
        }
      })
    )
    if (disposed) return
    history.replaceChildren()
    for (const entry of titled.filter(Boolean)) {
      const option = el("option", null, entry.label)
      option.value = entry.url
      option.selected = entry.url === sessionUrl
      history.append(option)
    }
    history.hidden = history.options.length < 2
  }

  // ---- showing and hiding ----------------------------------------------
  function focusComposer() {
    body.querySelector(".agent-composer textarea")?.focus()
  }

  async function show() {
    if (disposed) return
    const active = element.ownerDocument.activeElement
    returnFocus = active && !pop.contains(active) ? active : null
    box.hidden = false
    setOpen(true)
    renderAttention()
    await ensureMounted()
    if (!box.hidden) focusComposer()
  }

  /** Ask the mounted session view to start, stop or toggle dictation. */
  function dictate(on) {
    body
      .querySelector(".patchwork-agent")
      ?.dispatchEvent(new CustomEvent("patchwork-agent:dictate", { detail: { on } }))
  }

  function hide() {
    if (box.hidden) return
    // A hidden box must not go on listening.
    dictate(false)
    box.hidden = true
    setOpen(false)
    renderAttention()
    if (returnFocus?.isConnected) returnFocus.focus?.()
    returnFocus = null
  }

  const toggle = () => (box.hidden ? show() : hide())

  /** Open on a session: one of yours here, a workflow step as a panel of its own. */
  async function openAt(item) {
    if (item.step) {
      openDocument(pop, item.sessionUrl, "agent-session")
      return
    }
    await ensureStorage()
    await show()
    await switchTo(item.sessionUrl)
  }

  const onKey = (event) => {
    if (isToggleShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      toggle()
    } else if (isDictationShortcut(event)) {
      // From anywhere: summon the box and start talking to it.
      event.preventDefault()
      event.stopPropagation()
      if (box.hidden) show().then(() => dictate(true))
      else dictate(null)
    } else if (event.key === "Escape" && !box.hidden && box.contains(element.ownerDocument.activeElement)) {
      event.preventDefault()
      hide()
    }
  }
  const view = element.ownerDocument.defaultView
  view.addEventListener("keydown", onKey, true)
  hostView.addEventListener("patchwork:toggle-overlay", toggle)

  closeButton.addEventListener("click", hide)
  newButton.addEventListener("click", async () => {
    const store = await ensureStorage()
    const session = await createSession(repo)
    remember(store, session.url)
    await mount(session)
    focusComposer()
  })
  dockButton.addEventListener("click", () => {
    if (!sessionUrl) return
    openDocument(box, sessionUrl, "agent-session")
    hide()
  })
  history.addEventListener("change", () => switchTo(history.value))
  pill.addEventListener("click", (event) => {
    event.preventDefault()
    show()
  })

  // ---- notifications ---------------------------------------------------
  function renderBell() {
    const enabled = notificationsEnabled()
    bellButton.hidden = !notificationsSupported()
    bellButton.setAttribute("aria-pressed", String(enabled))
    bellButton.title = enabled
      ? "Notifying you when the agent needs you or finishes a long run, while this tab is in the background. Click to stop."
      : "Notify me when the agent needs me or finishes a long run, while this tab is in the background"
  }
  bellButton.addEventListener("click", async (event) => {
    event.preventDefault()
    await setNotifications(!notificationsEnabled())
    renderBell()
  })
  renderBell()
  const notifier = createNotifier({ onClick: (item) => openAt(item) })

  // ---- what needs you --------------------------------------------------
  const dismissed = new Set() // keys put off with "Later"
  const notices = [] // long runs that finished, until dismissed or opened
  let peekShown = ""

  const followed = () => {
    const store = storage?.doc() ?? {}
    return [sessionUrl ?? store.sessionUrl, ...(store.sessions ?? [])].slice(0, WATCHED_SESSIONS)
  }
  const attention = repo ? watchAttention(repo, followed, () => renderAttention()) : null
  // Follow the account's sessions from the start, not only once the box has
  // been opened: what needs you is the point of the peek.
  ensureStorage().catch(() => {})

  function peekItem(item, rest) {
    const card = el("div", "agent-peek-card")
    card.dataset.kind = item.kind
    const head = el("div", "agent-peek-head")
    head.append(
      el("span", "agent-peek-dot"),
      el(
        "strong",
        null,
        item.kind === "finished" ? `${item.title} finished` : item.kind === "approval" ? `${item.title} needs your permission` : `${item.title} asks`
      )
    )
    if (rest) head.append(el("span", "agent-peek-more", `+${rest} more`))
    card.append(head)

    if (item.kind === "question" || item.kind === "approval") {
      card.append(renderWaitingItem(item, { showStep: false }))
    } else if (item.kind === "asked") {
      card.append(el("p", "agent-peek-question", item.question))
      const row = el("div", "cluster")
      const input = document.createElement("input")
      input.type = "text"
      input.placeholder = "Answer…"
      const send = button("Answer", "Send your answer to the session")
      const submit = () => {
        const text = input.value.trim()
        if (!text || !item.handle) return
        say(handleStore(item.handle, null), text)
      }
      send.addEventListener("click", (event) => {
        event.preventDefault()
        submit()
      })
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          submit()
        }
      })
      row.append(input, send)
      card.append(row)
    } else if (item.kind === "finished" && item.summary) {
      card.append(el("p", "agent-peek-question", item.summary))
    }

    const actions = el("div", "agent-peek-actions")
    const open = button("Open", "Open the session")
    open.addEventListener("click", (event) => {
      event.preventDefault()
      if (item.kind === "finished") notices.splice(notices.indexOf(item), 1)
      openAt(item)
    })
    const later = button(item.kind === "finished" ? "Dismiss" : "Later", "Put this away")
    later.addEventListener("click", (event) => {
      event.preventDefault()
      if (item.kind === "finished") notices.splice(notices.indexOf(item), 1)
      else dismissed.add(item.key)
      peekShown = ""
      renderAttention()
    })
    actions.append(open, later)
    card.append(actions)
    return card
  }

  function renderAttention() {
    if (disposed || !attention) return
    const { working, needs, finished } = attention.snapshot()
    for (const event of finished) {
      notices.push(event)
      notifier.notify(event)
    }
    for (const item of needs) notifier.notify(item)

    const waiting = [...needs.filter((item) => !dismissed.has(item.key)), ...notices]
    const open = !box.hidden

    // The peek is rebuilt only when what it shows changes, so an answer being
    // typed into it is not wiped by every edit to the sessions behind it.
    peek.hidden = open || !waiting.length
    const signature = peek.hidden ? "" : `${waiting[0].key}|${waiting.length}`
    if (signature !== peekShown) {
      peekShown = signature
      peek.replaceChildren(...(peek.hidden ? [] : [peekItem(waiting[0], waiting.length - 1)]))
    }

    pill.hidden = open || !peek.hidden || !working.length
    if (!pill.hidden) {
      const first = working[0]
      pill.replaceChildren(
        el("span", "agent-pill-dot"),
        el("span", "agent-pill-text", `${first.title}: ${first.activity}`),
        ...(working.length > 1 ? [el("span", "agent-pill-more", `+${working.length - 1}`)] : []),
        el("kbd", "agent-pill-key", SHORTCUT_LABEL())
      )
    }
  }

  return () => {
    disposed = true
    if (!box.hidden) setOpen(false)
    view.removeEventListener("keydown", onKey, true)
    hostView.removeEventListener("patchwork:toggle-overlay", toggle)
    storage?.off("change", onStorageChange)
    attention?.dispose()
    workspace.dispose()
    cleanupTool?.()
    pop.remove()
  }
}
