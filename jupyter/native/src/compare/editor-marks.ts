// What a cell's source shows while the notebook is compared: what this
// draft changed since the drafts parted (stacked), where its lines and the
// other version's differ, both shown (combined), or which of its lines
// differ from the other's beside it (side by side).

import { type EditorState, type Range, StateEffect, StateField, type Text } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view"
import type { SourceChange } from "./notebook-diff"
import { lineDiff } from "./versions"

export type EditorMarks =
  /** Text this draft added, and where it took text out. */
  | { kind: "own"; changes: SourceChange[] }
  /** The other version's source, shown among this one's where they differ. */
  | { kind: "theirs"; source: string }
  /** The other version's source, beside this one: only the lines that differ are marked. */
  | { kind: "versus"; source: string }
  | null

export const setMarks = StateEffect.define<EditorMarks>()

type Marked = { marks: EditorMarks; deco: DecorationSet }

/** The marks, kept where they belong as the text changes until new ones are set. */
export const compareMarks = [
  StateField.define<Marked>({
    create: () => ({ marks: null, deco: Decoration.none }),
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setMarks)) return { marks: effect.value, deco: decorate(effect.value, tr.state) }
      }
      if (!tr.docChanged) return value
      // Their lines are marked against this text, so they're worked out again;
      // own changes are moved along until the next comparison replaces them.
      return value.marks?.kind === "theirs" || value.marks?.kind === "versus"
        ? { marks: value.marks, deco: decorate(value.marks, tr.state) }
        : { marks: value.marks, deco: value.deco.map(tr.changes) }
    },
    provide: field => EditorView.decorations.from(field, value => value.deco),
  }),
  EditorView.baseTheme({
    ".pwnb-diff-insertion": {
      backgroundColor: "color-mix(in srgb, var(--pwnb-c-inserted) 16%, transparent)",
      boxShadow: "inset 0 -2px color-mix(in srgb, var(--pwnb-c-inserted) 60%, transparent)",
    },
    ".pwnb-diff-deletion": {
      backgroundColor: "color-mix(in srgb, var(--pwnb-c-deleted) 10%, transparent)",
      textDecoration: "line-through color-mix(in srgb, var(--pwnb-c-deleted) 70%, transparent)",
      opacity: "0.8",
      whiteSpace: "pre-wrap",
    },
    "&.cm-editor .cm-line.pwnb-ours-line": {
      backgroundColor: "color-mix(in srgb, var(--pwnb-c-ours) 12%, transparent)",
      boxShadow: "inset 3px 0 var(--pwnb-c-ours)",
    },
    "&.cm-editor .cm-line.pwnb-differs-line": {
      backgroundColor: "color-mix(in srgb, var(--pwnb-c-modified) 18%, transparent)",
      boxShadow: "inset 3px 0 var(--pwnb-c-modified)",
    },
    ".pwnb-theirs-lines": {
      padding: "0 2px 0 6px",
      whiteSpace: "pre-wrap",
      backgroundColor: "color-mix(in srgb, var(--pwnb-c-theirs) 12%, transparent)",
      boxShadow: "inset 3px 0 var(--pwnb-c-theirs)",
    },
  }),
]

function decorate(marks: EditorMarks, state: EditorState): DecorationSet {
  if (!marks) return Decoration.none
  const ranges =
    marks.kind === "own"
      ? ownRanges(marks.changes, state.doc.length)
      : marks.kind === "theirs"
        ? theirRanges(state.doc, marks.source)
        : versusRanges(state.doc, marks.source)
  return Decoration.set(ranges, true)
}

const insertion = Decoration.mark({ class: "pwnb-diff-insertion" })

function ownRanges(changes: SourceChange[], length: number): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = []
  for (const change of changes) {
    if (change.type === "added") {
      const from = Math.min(change.from, length)
      const to = Math.min(change.to, length)
      if (from < to) ranges.push(insertion.range(from, to))
    } else {
      const widget = new Ghost(change.text, "pwnb-diff-deletion", false)
      ranges.push(Decoration.widget({ widget, side: -1 }).range(Math.min(change.at, length)))
    }
  }
  return ranges
}

const oursLine = Decoration.line({ class: "pwnb-ours-line" })

/**
 * Where this text and `theirs` differ, line by line: this version's lines
 * where they are, and the other's as lines of their own right after them
 * (or where they'd be). Nothing's struck out; both are alternatives.
 */
function theirRanges(ours: Text, theirs: string): Range<Decoration>[] {
  const theirLines = theirs.split("\n")
  const ranges: Range<Decoration>[] = []
  for (const change of lineDiff(theirLines, ours.toString().split("\n"))) {
    for (let line = change.fromB; line < change.toB; line++) ranges.push(oursLine.range(ours.line(line + 1).from))
    if (change.fromA >= change.toA) continue
    const widget = new Ghost(theirLines.slice(change.fromA, change.toA).join("\n"), "pwnb-theirs-lines", true)
    ranges.push(
      change.toB > change.fromB
        ? Decoration.widget({ widget, block: true, side: 1 }).range(ours.line(change.toB).to)
        : change.fromB < ours.lines
          ? Decoration.widget({ widget, block: true, side: -1 }).range(ours.line(change.fromB + 1).from)
          : Decoration.widget({ widget, block: true, side: 1 }).range(ours.length),
    )
  }
  return ranges
}

const differsLine = Decoration.line({ class: "pwnb-differs-line" })

/** This text's lines that the other version, beside it, doesn't have as they are. */
function versusRanges(mine: Text, other: string): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = []
  for (const change of lineDiff(other.split("\n"), mine.toString().split("\n"))) {
    for (let line = change.fromB; line < change.toB; line++) ranges.push(differsLine.range(mine.line(line + 1).from))
  }
  return ranges
}

/** Text that isn't in this version, shown where it would be. */
class Ghost extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string,
    readonly block: boolean,
  ) {
    super()
  }

  eq(other: Ghost): boolean {
    return other.text === this.text && other.className === this.className && other.block === this.block
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.block ? "div" : "span")
    element.className = this.className
    element.textContent = this.text
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}
