// Comparing the notebook with another draft's version of it, as strand's
// panels ask any view to (packages/projects/src/compare.ts there): the view
// subscribes to `compare:view`, says which modes it takes, and is told the
// mode, the other draft's version (saved), and whether to fold what's
// unchanged away.
//
// - Stacked, the panel lays the two drafts' views out itself, each told
//   about the other's version. Each marks what its own draft changed since
//   the two parted: added cells, changed sources and outputs, removed cells
//   where they were.
// - Side by side, the notebook draws both versions, a row per cell, so they
//   line up and scroll together: cells and lines that differ in amber, a
//   cell only one side has in green where its draft added it and in red
//   where the other draft took it out.
// - Combined (`inline`), the notebook draws both versions in one, read-only:
//   where they differ, this draft's cells and lines in its colour and the
//   other's alongside in theirs. Merging, it's the merge's result against
//   the target before it, in green and red.

import type { Doc, Heads } from "@automerge/automerge"
import { subscribe } from "@inkandswitch/patchwork-providers"
import { type Accessor, createEffect, createSignal, on, onCleanup } from "solid-js"
import { automerge } from "../../../shared/automerge"
import { readString } from "../../../shared/json"
import type { NotebookDoc } from "../../../shared/schema"
import type { NotebookStore } from "../doc"
import { commonAncestor } from "./ancestor"
import { type DeletedCell, notebookDiff, type NotebookDiff } from "./notebook-diff"
import { type VersionDiff, versionDiff } from "./versions"

export type CompareMode = "inline" | "side-by-side" | "stacked"

const MODES: readonly CompareMode[] = ["inline", "side-by-side", "stacked"]

/** The two drafts' names: this view's, and the other's. */
export type Names = { ours: string; theirs: string }

/** What the panel answers `compare:view` with, as this reads it. */
type CompareView = {
  mode: string | null
  options: unknown
  other: Uint8Array | null
  missing: boolean
  collapsed?: boolean
  editable?: boolean
  names?: Names | null
  merging?: boolean
}

/** What's compared, while it is in a mode the notebook shows. */
export type Compared = {
  mode: CompareMode
  collapsed: boolean
  merging: boolean
  names: Names | null
  /** The other draft's version; null when that draft doesn't have the notebook. */
  theirs: Doc<NotebookDoc> | null
}

/**
 * Asks the panel around `element` what the notebook is compared with. Null
 * while nothing is, or the mode is one the notebook doesn't take. Call
 * inside a Solid owner.
 */
export function watchCompare(element: HTMLElement): Accessor<Compared | null> {
  const [compared, setCompared] = createSignal<Compared | null>(null)
  let lastOther: Uint8Array | null = null
  let lastTheirs: Doc<NotebookDoc> | null = null
  const unsubscribe = subscribe(
    element,
    {
      type: "compare:view",
      modes: { inline: true, "side-by-side": true, stacked: true },
      draws: ["side-by-side"],
      collapses: [...MODES],
      prefers: "inline",
    },
    value => {
      const view = value as unknown as CompareView
      const mode = MODES.find(each => each === view.mode)
      if (!mode) return setCompared(null)
      let theirs: Doc<NotebookDoc> | null = null
      if (!view.missing) {
        if (!view.other) return setCompared(null)
        if (view.other !== lastOther) {
          try {
            lastTheirs = automerge().load<NotebookDoc>(view.other)
            lastOther = view.other
          } catch (error) {
            console.warn("[jupyter] couldn't read the version compared with", error)
            return setCompared(null)
          }
        }
        theirs = lastTheirs
      }
      setCompared({
        mode,
        collapsed: !!view.collapsed,
        merging: !!view.merging,
        names: view.names ?? null,
        theirs,
      })
    },
  )
  onCleanup(unsubscribe)
  return compared
}

export type CompareState = {
  mode: Accessor<CompareMode | null>
  collapsed: Accessor<boolean>
  merging: Accessor<boolean>
  names: Accessor<Names | null>
  /** Stacked: what this draft changed since the drafts parted. */
  own: Accessor<NotebookDiff | null>
  /** Combined and side by side: how this version differs from the other. */
  versions: Accessor<VersionDiff | null>
  /** Side by side: the other version. */
  theirs: Accessor<NotebookDoc | null>
  /** Side by side: the cells the drafts had where they parted, to tell who added or removed a cell. */
  parted: Accessor<ReadonlySet<string>>
  /**
   * Cells this version doesn't have, shown where they'd be: the ones this
   * draft removed (stacked) or the other version's (combined, side by side).
   * Keyed by the cell they come before; null after the last.
   */
  ghosts: Accessor<Map<string | null, DeletedCell[]>>
}

/** Long enough to coalesce a burst of typing into one comparison. */
const RECOMPUTE_DELAY_MS = 150

/** Keeps the comparison current as either version changes. Call inside a Solid owner. */
export function trackCompare(store: NotebookStore, compared: Accessor<Compared | null>): CompareState {
  const [own, setOwn] = createSignal<NotebookDiff | null>(null)
  const [versions, setVersions] = createSignal<VersionDiff | null>(null)
  const [ghosts, setGhosts] = createSignal(new Map<string | null, DeletedCell[]>())
  const [parted, setParted] = createSignal<ReadonlySet<string>>(new Set())
  const [shown, setShown] = createSignal<Compared | null>(null)

  const recompute = () => {
    const current = compared()
    const doc = store.current() as Doc<NotebookDoc> | undefined
    let nextOwn: NotebookDiff | null = null
    let nextVersions: VersionDiff | null = null
    let nextParted: ReadonlySet<string> = new Set()
    try {
      if (current && doc) {
        if (current.mode === "stacked") nextOwn = notebookDiff(doc, baseOf(doc, current))
        else nextVersions = combined(doc, current)
        if (current.mode === "side-by-side") nextParted = cellsAt(doc, baseOf(doc, current))
      }
    } catch (error) {
      console.warn("[jupyter] couldn't compare the notebook", error)
    }
    const placed = new Map<string | null, DeletedCell[]>()
    for (const cell of nextOwn?.deleted ?? nextVersions?.theirs ?? []) {
      placed.set(cell.before, [...(placed.get(cell.before) ?? []), cell])
    }
    setOwn(nextOwn)
    setVersions(nextVersions)
    setParted(nextParted)
    setGhosts(placed)
    setShown(current && (nextOwn || nextVersions) ? current : null)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(recompute, RECOMPUTE_DELAY_MS)
  }
  createEffect(on(compared, recompute))
  createEffect(on(store.doc, schedule, { defer: true }))
  onCleanup(() => clearTimeout(timer))

  return {
    mode: () => shown()?.mode ?? null,
    collapsed: () => !!shown()?.collapsed,
    merging: () => !!shown()?.merging,
    names: () => shown()?.names ?? null,
    own,
    versions,
    theirs: () => shown()?.theirs ?? null,
    parted,
    ghosts,
  }
}

/**
 * What this draft's changes are marked against: where the drafts parted.
 * When the other draft doesn't have the notebook, all of it is new here,
 * unless a merge takes it out, which leaves this side as it was.
 */
function baseOf(doc: Doc<NotebookDoc>, current: Compared): Heads {
  if (!current.theirs) return current.merging ? automerge().getHeads(doc) : []
  return commonAncestor(doc, current.theirs)
}

/** The ids of the cells `doc` had at `heads`. */
function cellsAt(doc: Doc<NotebookDoc>, heads: Heads): ReadonlySet<string> {
  return new Set((automerge().view(doc, heads).cells ?? []).map(cell => readString(cell.id)))
}

function combined(doc: Doc<NotebookDoc>, current: Compared): VersionDiff {
  if (current.theirs) return versionDiff(doc, current.theirs)
  // The other draft doesn't have it: all of it is this draft's, unless a
  // merge takes it out, which leaves nothing to mark.
  const cells = new Map(
    current.merging ? [] : (doc.cells ?? []).map(cell => [readString(cell.id), { type: "ours" as const }]),
  )
  return { cells, theirs: [] }
}
