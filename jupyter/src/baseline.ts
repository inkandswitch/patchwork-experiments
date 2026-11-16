import { getHeads, load, type Heads } from "@automerge/automerge"
import { subscribe } from "@inkandswitch/patchwork-providers"
import type { Baseline } from "../extension/src/bridge"

// The compare view the panel showing the notebook answers with, as this reads it.
type CompareView = {
  mode: string | null
  options: unknown
  other: Uint8Array | null
  missing: boolean
}

const MODES = ["inline", "changes-only"]

/**
 * What the notebook is diffed against, in the "inline" and "changes only"
 * compare modes: the heads of the other draft's version, which the
 * notebook's history has when that draft's changes are all in this one, or
 * none at all when that draft doesn't have the notebook. Null in any other
 * mode, and outside anything answering `compare:view`.
 */
export function compareBaseline(element: HTMLElement): Baseline & { dispose(): void } {
  const listeners = new Set<() => void>()
  let heads: Heads | null = null
  let collapsed = false

  const unsubscribe = subscribe(
    element,
    { type: "compare:view", modes: { inline: true, "changes-only": true }, prefers: "inline" },
    value => {
      const view = value as unknown as CompareView
      const shown = !!view.mode && MODES.includes(view.mode)
      const next = shown ? otherHeads(view) : null
      const fold = shown && view.mode === "changes-only"
      if (sameHeads(heads, next) && fold === collapsed) return
      heads = next
      collapsed = fold
      for (const listener of listeners) listener()
    }
  )

  return {
    current: () => heads,
    collapsed: () => collapsed,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      unsubscribe()
      listeners.clear()
    },
  }
}

function otherHeads(view: CompareView): Heads | null {
  if (view.missing) return []
  if (!view.other) return null
  try {
    return getHeads(load(view.other))
  } catch (error) {
    console.warn("[jupyter] couldn't read the version compared with", error)
    return null
  }
}

function sameHeads(a: Heads | null, b: Heads | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every(head => b.includes(head))
}
