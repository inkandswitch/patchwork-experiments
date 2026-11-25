import { autocompletion, type CompletionContext, type CompletionResult, startCompletion } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language"
import { Annotation, Compartment, EditorState, type Extension, Transaction } from "@codemirror/state"
import { EditorView, type KeyBinding, keymap } from "@codemirror/view"
import { tags } from "@lezer/highlight"
import { compareMarks, type EditorMarks, setMarks } from "./compare/editor-marks"
import type { SourceEdit } from "./doc"

export type EditorLanguage = "python" | "markdown" | "text"

export type CellEditorOptions = {
  parent: HTMLElement
  source: string
  language: EditorLanguage
  readOnly: boolean
  /** Local edits, to write into the document. */
  onEdit(edits: SourceEdit[]): void
  onFocus?(): void
  /** Notebook commands, ahead of the editor's own keys. */
  keys: KeyBinding[]
  complete?(code: string, cursor: number): Promise<{ from: number; to: number; options: string[] } | null>
}

/** Marks text that came from the document rather than from typing here. */
const fromDoc = Annotation.define<boolean>()

/**
 * A CodeMirror editor for one cell's source. The document is the source of
 * truth: local edits go out through `onEdit`, and `setSource` folds in
 * whatever the document says now (a collaborator's edit, a swapped draft) as
 * the smallest change, so the cursor stays put around it.
 */
export class CellEditor {
  readonly view: EditorView

  constructor(options: CellEditorOptions) {
    this._options = options
    this.view = new EditorView({
      parent: options.parent,
      state: EditorState.create({
        doc: options.source,
        extensions: [
          keymap.of(options.keys),
          this._language.of(languageExtension(options.language)),
          this._editable.of(editable(options.readOnly)),
          history(),
          indentOnInput(),
          bracketMatching(),
          EditorView.lineWrapping,
          syntaxHighlighting(highlightStyle),
          autocompletion({ override: [context => this._complete(context)], activateOnTyping: false }),
          keymap.of([{ key: "Tab", run: tabCompleteOrIndent, shift: indentLess }, ...historyKeymap, ...defaultKeymap]),
          compareMarks,
          EditorView.updateListener.of(update => {
            if (update.focusChanged && update.view.hasFocus) this._options.onFocus?.()
            if (!update.docChanged || update.transactions.some(tr => tr.annotation(fromDoc))) return
            const edits: SourceEdit[] = []
            update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              edits.push({ from: fromA, to: toA, insert: inserted.sliceString(0, inserted.length, "\n") })
            })
            this._options.onEdit(edits)
          }),
        ],
      }),
    })
  }

  setSource(source: string): void {
    const current = this.view.state.doc.toString()
    if (current === source) return
    const change = minimalChange(current, source)
    this.view.dispatch({ changes: change, annotations: [fromDoc.of(true), Transaction.addToHistory.of(false)] })
  }

  setReadOnly(readOnly: boolean): void {
    this.view.dispatch({ effects: this._editable.reconfigure(editable(readOnly)) })
  }

  setLanguage(language: EditorLanguage): void {
    this.view.dispatch({ effects: this._language.reconfigure(languageExtension(language)) })
  }

  /** Marks the source as the notebook is compared (see compare/editor-marks.ts). */
  setMarks(marks: EditorMarks): void {
    const key = JSON.stringify(marks)
    if (key === this._marksKey) return
    this._marksKey = key
    this.view.dispatch({ effects: setMarks.of(marks) })
  }

  focus(at?: "start" | "end"): void {
    if (at) {
      const pos = at === "start" ? 0 : this.view.state.doc.length
      this.view.dispatch({ selection: { anchor: pos } })
    }
    this.view.focus()
  }

  destroy(): void {
    this.view.destroy()
  }

  private async _complete(context: CompletionContext): Promise<CompletionResult | null> {
    if (!this._options.complete) return null
    const reply = await this._options.complete(context.state.doc.toString(), context.pos).catch(() => null)
    if (!reply || reply.options.length === 0) return null
    return { from: reply.from, to: reply.to, options: reply.options.map(label => ({ label })), filter: false }
  }

  private _marksKey = "null"
  private _editable = new Compartment()
  private _language = new Compartment()
  private _options: CellEditorOptions
}

/** Whether the cursor is on the first or last line, for moving between cells. */
export function atBoundary(view: EditorView, direction: "up" | "down"): boolean {
  const { main } = view.state.selection
  if (!main.empty) return false
  const line = view.state.doc.lineAt(main.head)
  return direction === "up" ? line.number === 1 : line.number === view.state.doc.lines
}

/** Tab completes after a name or a dot, as in Jupyter, and indents elsewhere. */
function tabCompleteOrIndent(view: EditorView): boolean {
  const { main } = view.state.selection
  const before = main.empty ? view.state.sliceDoc(Math.max(0, main.head - 1), main.head) : ""
  if (/[\w.]/.test(before)) return startCompletion(view)
  return indentMore(view)
}

function languageExtension(language: EditorLanguage): Extension {
  if (language === "python") return python()
  if (language === "markdown") return markdown()
  return []
}

function editable(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}

function minimalChange(before: string, after: string): { from: number; to: number; insert: string } {
  let prefix = 0
  const shortest = Math.min(before.length, after.length)
  while (prefix < shortest && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < shortest - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return { from: prefix, to: before.length - suffix, insert: after.slice(prefix, after.length - suffix) }
}

const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword], color: "var(--pwnb-syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--pwnb-syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--pwnb-syntax-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--pwnb-syntax-comment)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--pwnb-syntax-function)" },
  { tag: [tags.definition(tags.variableName), tags.className], color: "var(--pwnb-syntax-definition)" },
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.link, textDecoration: "underline" },
])
