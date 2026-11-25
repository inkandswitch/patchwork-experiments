/**
 * What the person has open, as the frame reports it.
 *
 * Two provider selectors feed this. `patchwork:selected-doc` is the focused
 * document, and every frame answers it. `patchwork:open-views` is everything
 * on screen — `[{ url, toolId, selected }]` — and only a frame with several
 * documents visible at once (the tiling frame) answers it; elsewhere it stays
 * silent and the context is just the focused document.
 *
 * `exclude` names documents that never count as focused — the session itself,
 * when it is docked as a panel and clicking into it would otherwise make the
 * agent the subject of its own conversation. Focusing an excluded document
 * keeps whatever was focused before, which is what "this" still means.
 */

import { subscribe, selectedDocUrl } from "../host/context.js"

const TITLE_TIMEOUT_MS = 1500

async function titleOf(repo, url) {
  if (!repo || !url) return null
  try {
    const handle = await Promise.race([
      repo.find(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TITLE_TIMEOUT_MS)),
    ])
    const doc = handle.doc()
    const title = doc?.title ?? doc?.name ?? null
    return typeof title === "string" && title ? title : null
  } catch {
    return null
  }
}

/**
 * @returns {{ focused: () => string|null, snapshot: () => Promise<object>, dispose: () => void }}
 */
export function watchWorkspace(element, { repo, exclude = () => [], onChange = null } = {}) {
  let focused = null
  let open = []
  const excluded = (url) => exclude().includes(url)
  const notify = () => {
    try {
      onChange?.()
    } catch {
      /* an observer's failure is its own */
    }
  }

  const unsubscribeSelected = selectedDocUrl(element, (url) => {
    if (url && excluded(url)) return
    if (url === focused) return
    focused = url
    notify()
  })
  const unsubscribeOpen = subscribe(element, { type: "patchwork:open-views" }, (views) => {
    open = Array.isArray(views) ? views.filter((v) => v?.url) : []
    notify()
  })

  /** The context block's input (session/session.js `contextBlock`), titles resolved. */
  async function snapshot() {
    const views = open.filter((v) => !excluded(v.url))
    const focusedView = focused ? (views.find((v) => v.url === focused) ?? { url: focused, toolId: null }) : null
    const withTitle = async (v) => ({ url: v.url, toolId: v.toolId ?? null, title: await titleOf(repo, v.url) })
    return {
      focused: focusedView ? await withTitle(focusedView) : null,
      open: await Promise.all(views.filter((v) => v.url !== focused).map(withTitle)),
    }
  }

  return {
    focused: () => focused,
    /** Every document open in a view right now, focused or not. */
    openUrls: () => [...new Set([focused, ...open.map((v) => v.url)].filter(Boolean))],
    snapshot,
    title: (url) => titleOf(repo, url),
    dispose() {
      unsubscribeSelected()
      unsubscribeOpen()
    },
  }
}
