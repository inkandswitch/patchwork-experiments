/**
 * A document, a package or a running tool, inline in the transcript.
 *
 * Everything a session makes or opens is shown in one place, where it is
 * talked about: a view beside the call. For the agent's own view_mount it
 * adopts the live mount, so watching the agent work is reading the transcript.
 * For a document or package a call produced it offers to show it in its tool —
 * installed or not, the loader is the same one view_mount uses — and a package
 * carries its install controls in the header. What it does NOT do is run a
 * package the agent just wrote without a click: the agent's mounts were
 * granted; a person's are asked for by the Show button.
 *
 * Views are persistent elements keyed by call: the transcript rebuilds itself
 * on every change, and a mounted tool must not be torn down and re-mounted
 * because someone typed. The header is redrawn; the body, and whatever is
 * running in it, is moved.
 */

import { installState, shortHeads, pinIsBehind } from "./install.js"

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

const ICONS = { package: "📦", folder: "📁", file: "📄", document: "📄", mount: "🔍" }

export function iconFor(kind) {
  return ICONS[kind] ?? "📄"
}

export function isPackage(ref) {
  return ref?.kind === "package"
}

/** Is there a package here that is not installed — the end of a tool-building session? */
export function wantsInstall(refs, settings) {
  if (!settings) return false
  return refs.some((a) => isPackage(a) && !installState(settings, a.url).installed)
}

/**
 * The inline views for one transcript.
 *
 *   handlers.getMount(mountId)        → { container } | null   the agent's live mounts
 *   handlers.mountIdIn(output)        → mountId | null
 *   handlers.mountForPerson(ref)      → Promise<{ container, cleanup }>
 *   handlers.parkMount(container)     put an adopted mount back off-screen
 *   handlers.openDoc(url)             open elsewhere
 *   handlers.install(ref, { heads })  handlers.uninstall(ref)
 *
 * `state.open` is the transcript's open-set; `state.settings` the module
 * settings document (null hides install controls); `state.heads` current heads
 * per package, for the "behind" warning.
 */
export function createInlineViews(handlers = {}) {
  const views = new Map() // callId -> { root, body, shown: { container, cleanup } | null, adopted: container | null }

  function entry(callId) {
    let view = views.get(callId)
    if (!view) {
      const root = el("div", "agent-view")
      const header = el("div", "agent-view-header")
      const body = el("div", "agent-view-body")
      root.append(header, body)
      view = { root, header, body, shown: null, adopted: null, error: null, busy: false }
      views.set(callId, view)
    }
    return view
  }

  /** The element for a call, or null when there is nothing to show. */
  function elementFor(block, result, state) {
    const ref = result?.doc ?? null
    const mountId = handlers.mountIdIn?.(String(result?.output ?? "")) ?? null
    const mount = mountId ? handlers.getMount?.(mountId) : null
    if (!ref && !mountId) return null

    const view = entry(block.id)
    const openKey = `view:${block.id}`
    const kind = ref?.kind ?? "mount"
    view.root.dataset.kind = kind

    // The agent's mount: adopt it while it is live. Moving the node keeps the
    // tool running; the container is what the agent screenshots and drives.
    if (mount) {
      if (view.adopted !== mount.container) {
        view.body.replaceChildren(mount.container)
        view.adopted = mount.container
      }
    } else if (view.adopted) {
      // Unmounted or evicted since we last drew: nothing to show any more.
      view.adopted = null
      view.body.replaceChildren()
    }

    const live = !!view.adopted || !!view.shown
    const expanded = live && (state.open.has(openKey) || !state.open.has(`${openKey}:closed`))
    view.root.dataset.expanded = expanded ? "yes" : "no"
    view.root.dataset.live = live ? "yes" : "no"

    view.header.replaceChildren(...renderHeader({ view, ref, mountId, mount, kind, expanded, live, state, openKey, block }))
    return view.root
  }

  function renderHeader({ view, ref, mountId, mount, kind, expanded, live, state, openKey, block }) {
    const parts = []

    const name = el("button", "agent-view-name")
    name.append(el("span", "agent-view-icon", iconFor(kind)))
    name.append(
      el("span", "agent-view-title", ref?.name ?? (mount ? `${mount.toolId ?? "tool"} · open` : "view"))
    )
    if (ref?.url) {
      name.title = `Open ${ref.url}`
      name.addEventListener("click", (event) => {
        event.preventDefault()
        handlers.openDoc?.(ref.url)
      })
    } else {
      name.disabled = true
    }
    parts.push(name)

    if (mountId && !mount) parts.push(el("span", "agent-view-state", "closed"))
    if (view.error) parts.push(el("span", "agent-view-error", view.error))

    const actions = el("div", "agent-view-actions")

    // Show / hide: a person's own mount of the thing.
    if (ref?.url && !view.adopted) {
      if (view.shown) {
        actions.append(
          button("Hide", () => {
            view.shown.cleanup()
            view.shown = null
            view.body.replaceChildren()
            handlers.rerender?.()
          })
        )
      } else if (!view.busy) {
        actions.append(
          button(isPackage(ref) ? "Try it" : "Show", async () => {
            view.busy = true
            view.error = null
            handlers.rerender?.()
            try {
              const input = isPackage(ref) ? { url: ref.url } : { docUrl: ref.url }
              view.shown = await handlers.mountForPerson(input)
              view.body.replaceChildren(view.shown.container)
              state.open.delete(`${openKey}:closed`)
            } catch (err) {
              view.error = String(err?.message ?? err).split("\n")[0]
            } finally {
              view.busy = false
              handlers.rerender?.()
            }
          })
        )
      } else {
        actions.append(el("span", "agent-view-state", "loading…"))
      }
    }

    // Collapse a live view without closing it: the tool keeps running.
    if (live) {
      actions.append(
        button(expanded ? "Collapse" : "Expand", () => {
          if (expanded) state.open.add(`${openKey}:closed`)
          else state.open.delete(`${openKey}:closed`)
          handlers.rerender?.()
        })
      )
    }

    if (isPackage(ref) && state.settings) actions.append(...installControls(ref, state))

    if (actions.childElementCount) parts.push(actions)
    return parts
  }

  /** The install controls, on the package's own header. */
  function installControls(ref, state) {
    const out = []
    const status = installState(state.settings, ref.url)

    if (status.installed) {
      const pinned = shortHeads(status.pinned)
      const behind = pinIsBehind(status.pinned, state.heads?.[ref.url])
      const label = el("span", "agent-view-state", pinned ? `installed @ ${pinned}${behind ? " · behind" : ""}` : "installed · live")
      if (behind) {
        label.dataset.behind = "yes"
        label.title = "The agent has changed this package since you pinned it. What is installed is the older version."
      }
      out.push(label)
      if (behind) out.push(button("Update to current", () => handlers.install?.(ref, { heads: "current" }), "primary"))
      out.push(button(pinned ? "Follow edits" : "Pin this version", () => handlers.install?.(ref, { heads: pinned ? null : "current" })))
      out.push(button("Remove", () => handlers.uninstall?.(ref), "danger"))
    } else {
      out.push(button("Install", () => handlers.install?.(ref, { heads: null }), "primary"))
      out.push(button("Pin this version", () => handlers.install?.(ref, { heads: "current" })))
    }
    return out
  }

  /** Tear down a person's mounts and park the agent's. The agent's keep running. */
  function dispose() {
    for (const view of views.values()) {
      view.shown?.cleanup()
      view.shown = null
      if (view.adopted) handlers.parkMount?.(view.adopted)
      view.adopted = null
    }
    views.clear()
  }

  return { elementFor, dispose, _views: views }
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
