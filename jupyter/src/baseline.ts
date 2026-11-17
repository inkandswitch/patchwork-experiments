import * as Automerge from "@automerge/automerge"
import { getHeads, load, type Doc, type Heads } from "@automerge/automerge"
import type { DocHandle } from "@automerge/automerge-repo"
import { subscribe } from "@inkandswitch/patchwork-providers"
import { ancestorHolds, commonAncestor } from "../extension/src/ancestor"
import type { Baseline, Comparison } from "../extension/src/bridge"
import type { NotebookDoc } from "../extension/src/model"

// The compare view the panel showing the notebook answers with, as this reads it.
type CompareView = {
  mode: string | null
  options: unknown
  other: Uint8Array | null
  missing: boolean
  collapsed: boolean
  names: { ours: string; theirs: string } | null
}

/** The modes that mark anything: the panel lays out the first two, the notebook draws "inline". */
const MARKS: Record<string, Comparison["marks"]> = {
  "side-by-side": "changes",
  stacked: "changes",
  inline: "drafts",
}

/** Long enough to coalesce a burst of typing before checking where the drafts forked again. */
const RECHECK_DELAY_MS = 150

/**
 * How the notebook in `handle` is compared with the other draft's version
 * of it, from the panel's `compare:view`: both are diffed against where they
 * forked, worked out again as either changes. Null in modes that mark
 * nothing (onion skin, swipe), and outside anything answering `compare:view`.
 */
export function compareBaseline(
  element: HTMLElement,
  handle: DocHandle<NotebookDoc>,
): Baseline & { dispose(): void } {
  const listeners = new Set<() => void>()
  let view: CompareView | null = null
  let otherBytes: Uint8Array | null = null
  let other: Doc<NotebookDoc> | null = null
  let ancestor: { heads: Heads; ours: Heads } | null = null
  let comparison: Comparison | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const update = (recheck: boolean) => {
    const marks = view?.mode ? MARKS[view.mode] : undefined
    const ours = handle.doc()
    let next: Comparison | null = null
    if (view && marks && ours) {
      if (view.missing) {
        ancestor = null
        next = compared(view, marks, [], null)
      } else if (other) {
        if (recheck || !ancestor || !ancestorHolds(Automerge, ours, other, ancestor.ours)) {
          ancestor = { heads: commonAncestor(Automerge, ours, other), ours: getHeads(ours) }
        } else {
          ancestor.ours = getHeads(ours)
        }
        next = compared(view, marks, ancestor.heads, other)
      }
    }
    if (sameComparison(comparison, next)) return
    comparison = next
    for (const listener of listeners) listener()
  }

  const compared = (
    view: CompareView,
    marks: Comparison["marks"],
    heads: Heads,
    other: Doc<NotebookDoc> | null,
  ): Comparison => ({
    marks,
    ancestor: heads,
    other,
    collapsed: !!view.collapsed,
    names: view.names ?? null,
    colors: draftColors(element),
  })

  const unsubscribe = subscribe(
    element,
    {
      type: "compare:view",
      modes: { inline: true, "side-by-side": true, stacked: true, "onion-skin": true, swipe: true },
      collapses: ["inline", "side-by-side", "stacked"],
      prefers: "inline",
    },
    value => {
      view = value as unknown as CompareView
      const bytes = view.mode && !view.missing ? view.other : null
      const changed = bytes !== otherBytes
      if (changed) {
        otherBytes = bytes
        other = loadOther(bytes)
      }
      try {
        update(changed)
      } catch (error) {
        console.warn("[jupyter] couldn't work out where the drafts forked", error)
      }
    },
  )

  const onChange = () => {
    if (!comparison) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        update(false)
      } catch (error) {
        console.warn("[jupyter] couldn't work out where the drafts forked", error)
      }
    }, RECHECK_DELAY_MS)
  }
  handle.on("change", onChange)

  return {
    current: () => comparison,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      clearTimeout(timer)
      handle.off("change", onChange)
      unsubscribe()
      listeners.clear()
    },
  }
}

function loadOther(bytes: Uint8Array | null): Doc<NotebookDoc> | null {
  if (!bytes) return null
  try {
    return load<NotebookDoc>(bytes)
  } catch (error) {
    console.warn("[jupyter] couldn't read the version compared with", error)
    return null
  }
}

/** The page around the tool sets the drafts' colours, which the notebook's iframe doesn't inherit. */
function draftColors(element: HTMLElement): Comparison["colors"] {
  const style = getComputedStyle(element)
  const color = (name: string) => style.getPropertyValue(name).trim() || undefined
  return { ours: color("--compare-ours"), theirs: color("--compare-theirs") }
}

function sameComparison(a: Comparison | null, b: Comparison | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.marks === b.marks &&
    a.other === b.other &&
    a.collapsed === b.collapsed &&
    sameHeads(a.ancestor, b.ancestor) &&
    a.names?.ours === b.names?.ours &&
    a.names?.theirs === b.names?.theirs &&
    a.colors.ours === b.colors.ours &&
    a.colors.theirs === b.colors.theirs
  )
}

function sameHeads(a: Heads, b: Heads): boolean {
  return a.length === b.length && a.every(head => b.includes(head))
}
