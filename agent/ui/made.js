/**
 * "What did we just make?"
 *
 * Everything a session creates — a package, a document, a fetched page — used to
 * exist only inside the tool result that made it. Six calls later the thing you
 * asked for was somewhere above the scroll, identified by fifty characters of
 * base58, and the only way back to it was reading the transcript.
 *
 * So the session keeps a list, and this renders it as a strip under the header:
 * newest first, one click to open, and for a package the install controls right
 * there. It collapses to a single line when you are not using it, because a
 * transcript in a sidebar cannot spare the room.
 */

import { artifacts } from "../session.js"
import { installState, shortHeads, pinIsBehind } from "./install.js"

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

const ICONS = {
  package: "📦",
  folder: "📁",
  file: "📄",
  document: "📄",
}

export function iconFor(kind) {
  return ICONS[kind] ?? "📄"
}

/** Is there something here the user probably wants to install right now? */
export function wantsInstall(made, settings) {
  if (!settings) return false
  return made.some((a) => isPackage(a) && !installState(settings, a.url).installed)
}

/** A package is the thing you can install; everything else you just open. */
export function isPackage(artifact) {
  return artifact?.kind === "package"
}

/**
 * Render the strip into `container`.
 *
 * `handlers.openDoc(url)`, `handlers.install(artifact, {heads})`,
 * `handlers.uninstall(artifact)`. `settings` is the module-settings document,
 * or null when it cannot be read — in which case the install controls are
 * hidden rather than shown broken.
 */
export function renderMade(container, doc, state, handlers = {}) {
  container.replaceChildren()
  const made = artifacts(doc)
  if (!made.length) {
    container.hidden = true
    return
  }
  container.hidden = false

  // Open itself the first time a package appears that is not installed. That is
  // the end of a tool-building session, and the thing you want is the Install
  // button — having to find and expand a strip to reach it is the same
  // copy-a-URL chore in a nicer coat. Once you close it, it stays closed.
  if (state.madeOpen === undefined || (!state.madeTouched && wantsInstall(made, state.settings))) {
    state.madeOpen = true
  }

  const summary = el("button", "agent-made-toggle")
  const count = made.length
  summary.append(el("span", "agent-made-caret", state.madeOpen ? "▾" : "▸"))
  summary.append(el("span", null, `${count} thing${count === 1 ? "" : "s"} made here`))
  // The newest artifact is almost always the one you want, so name it even when
  // the list is closed.
  summary.append(el("span", "agent-made-latest", made[0].name ?? ""))
  summary.addEventListener("click", (event) => {
    event.preventDefault()
    state.madeOpen = !state.madeOpen
    state.madeTouched = true
    renderMade(container, doc, state, handlers)
  })
  container.append(summary)

  if (!state.madeOpen) return

  const list = el("div", "agent-made-list")
  for (const artifact of made) {
    list.append(renderArtifact(artifact, state, handlers))
  }
  container.append(list)
}

function renderArtifact(artifact, state, handlers) {
  const row = el("div", "agent-made-row")
  row.dataset.kind = artifact.kind ?? "document"

  const open = el("button", "agent-made-open")
  open.append(el("span", "agent-made-icon", iconFor(artifact.kind)))
  open.append(el("span", "agent-made-name", artifact.name ?? "document"))
  open.title = artifact.url
  open.addEventListener("click", (event) => {
    event.preventDefault()
    handlers.openDoc?.(artifact.url)
  })
  row.append(open)

  if (!isPackage(artifact) || !state.settings) return row

  const status = installState(state.settings, artifact.url)
  const actions = el("div", "agent-made-actions")

  if (status.installed) {
    const pinned = shortHeads(status.pinned)
    // Heads the view looked up for this package, when it has them.
    const behind = pinIsBehind(status.pinned, state.heads?.[artifact.url])

    const label = el(
      "span",
      "agent-made-state",
      pinned ? `installed @ ${pinned}${behind ? " · behind" : ""}` : "installed · live"
    )
    if (behind) {
      label.dataset.behind = "yes"
      label.title = "The agent has changed this package since you pinned it. What is installed is the older version."
    }
    actions.append(label)

    // The one you want is different when you are behind: update to what the
    // transcript is talking about.
    if (behind) actions.append(button("Update to current", () => handlers.install?.(artifact, { heads: "current" }), "primary"))
    actions.append(
      button(pinned ? "Follow edits" : "Pin this version", () =>
        handlers.install?.(artifact, { heads: pinned ? null : "current" })
      )
    )
    actions.append(button("Remove", () => handlers.uninstall?.(artifact), "danger"))
  } else {
    actions.append(button("Install", () => handlers.install?.(artifact, { heads: null }), "primary"))
    actions.append(button("Pin this version", () => handlers.install?.(artifact, { heads: "current" })))
  }

  row.append(actions)
  return row
}

function button(label, onClick, variant) {
  const node = el("button", null, label)
  if (variant) node.dataset.variant = variant
  node.addEventListener("click", (event) => {
    event.preventDefault()
    onClick()
  })
  return node
}
