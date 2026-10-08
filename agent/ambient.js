/**
 * The ambient agent — summoned from anywhere, about whatever you have open.
 *
 * `AmbientAgent` is a floating box, mounted by a frame into its overlay layer
 * (components tagged `"overlay"`). Cmd/Ctrl+J summons and dismisses it, and so
 * does the frame's own button for it: the frame sends `patchwork:toggle-overlay`
 * to the overlay's `<patchwork-view>`, and the box answers with a bubbling
 * `patchwork:overlay-state` `{ open }` so the button can show it pressed.
 * Escape dismisses it. It can be dragged by its bar, resized from its corner,
 * and docked as an ordinary panel. Cmd/Ctrl+Shift+Space, from anywhere, opens
 * it already dictating (ui/voice.js).
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

export const STORAGE_TOOL_ID = "agent-ambient"
const GEOMETRY_KEY = "patchwork-agent:float"
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
    doc["@patchwork"] = { type: "agent-session" }
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

// ---- geometry ------------------------------------------------------------

function readGeometry() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(GEOMETRY_KEY) ?? "null")
    return value && typeof value === "object" ? value : null
  } catch {
    return null
  }
}

function writeGeometry(value) {
  try {
    globalThis.localStorage?.setItem(GEOMETRY_KEY, JSON.stringify(value))
  } catch {
    /* a position is not worth an error */
  }
}

// ---- the floating box ----------------------------------------------------

export function AmbientAgent(element, options = {}) {
  const repo = options.repo ?? globalThis.repo
  // The frame addresses its overlay by the view hosting it.
  const hostView = element.closest?.("patchwork-view") ?? element

  const setOpen = (open) =>
    element.dispatchEvent(new CustomEvent("patchwork:overlay-state", { detail: { open }, bubbles: true }))

  const box = el("div", "agent-float")
  // Inline, not only in styles.css: the overlay layer lets pointer events
  // through, so a box without these is drawn but cannot be clicked. That is
  // exactly what an older copy of the stylesheet produced.
  box.style.position = "absolute"
  box.style.pointerEvents = "auto"
  box.hidden = true
  box.setAttribute("role", "dialog")
  box.setAttribute("aria-label", "Agent")

  const bar = el("div", "agent-float-bar")
  const grip = el("span", "agent-float-grip", "⠿")
  const on = el("span", "agent-float-on", "Agent")
  const history = document.createElement("select")
  history.className = "agent-float-history"
  history.title = "Earlier sessions"
  const newButton = button("New", "Start a new session")
  const dockButton = button("Dock", "Open this session as a panel")
  const closeButton = button("×", `Close (Esc, or ${SHORTCUT_LABEL()})`)
  closeButton.className = "agent-float-close"
  bar.append(grip, on, history, newButton, dockButton, closeButton)

  const body = el("div", "agent-float-body")
  box.append(bar, body)
  element.append(box)

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
      storage.on("change", renderHistory)
    }
    return storage
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
    returnFocus = active && !box.contains(active) ? active : null
    box.hidden = false
    setOpen(true)
    clampIntoView()
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
    if (returnFocus?.isConnected) returnFocus.focus?.()
    returnFocus = null
  }

  const toggle = () => (box.hidden ? show() : hide())

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

  // ---- position and size -----------------------------------------------
  //
  // Anchored bottom-right until it is moved; after that, left/top within the
  // overlay layer. Both survive reloads, per device.
  const saved = readGeometry()
  if (saved?.width) box.style.width = `${saved.width}px`
  if (saved?.height) box.style.height = `${saved.height}px`
  if (saved?.left != null && saved?.top != null) placeAt(saved.left, saved.top)

  function placeAt(left, top) {
    box.style.left = `${Math.round(left)}px`
    box.style.top = `${Math.round(top)}px`
    box.style.right = "auto"
    box.style.bottom = "auto"
  }

  function clampIntoView() {
    if (box.style.left === "" || box.style.left === "auto") return
    const bounds = element.getBoundingClientRect()
    const width = box.offsetWidth
    const height = box.offsetHeight
    if (!bounds.width || !bounds.height) return
    const left = Math.min(Math.max(0, parseFloat(box.style.left)), Math.max(0, bounds.width - width))
    const top = Math.min(Math.max(0, parseFloat(box.style.top)), Math.max(0, bounds.height - height))
    placeAt(left, top)
  }

  function saveGeometry() {
    const left = parseFloat(box.style.left)
    const top = parseFloat(box.style.top)
    writeGeometry({
      width: box.offsetWidth || null,
      height: box.offsetHeight || null,
      left: Number.isFinite(left) ? left : null,
      top: Number.isFinite(top) ? top : null,
    })
  }

  bar.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button, select")) return
    event.preventDefault()
    const bounds = element.getBoundingClientRect()
    const start = box.getBoundingClientRect()
    const dx = event.clientX - start.left
    const dy = event.clientY - start.top
    const move = (e) => {
      const left = Math.min(Math.max(0, e.clientX - bounds.left - dx), Math.max(0, bounds.width - start.width))
      const top = Math.min(Math.max(0, e.clientY - bounds.top - dy), Math.max(0, bounds.height - start.height))
      placeAt(left, top)
    }
    const up = () => {
      view.removeEventListener("pointermove", move)
      view.removeEventListener("pointerup", up)
      saveGeometry()
    }
    view.addEventListener("pointermove", move)
    view.addEventListener("pointerup", up)
  })

  // CSS `resize` has no event; a pointerup on the box after a resize is the
  // cheapest moment to notice the new size.
  box.addEventListener("pointerup", () => {
    const saved = readGeometry()
    if (saved?.width !== box.offsetWidth || saved?.height !== box.offsetHeight) saveGeometry()
  })
  view.addEventListener("resize", clampIntoView)

  return () => {
    disposed = true
    if (!box.hidden) setOpen(false)
    view.removeEventListener("keydown", onKey, true)
    view.removeEventListener("resize", clampIntoView)
    hostView.removeEventListener("patchwork:toggle-overlay", toggle)
    storage?.off("change", renderHistory)
    workspace.dispose()
    cleanupTool?.()
    box.remove()
  }
}
