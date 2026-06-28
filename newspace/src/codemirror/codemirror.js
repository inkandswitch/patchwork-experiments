// The CodeMirror EditorView builder — ported from littlebook (lb/.../text/
// codemirror.ts). Full extension parity (search, history, indent, active line,
// rectangular selection, line numbers/wrapping); language + extra extensions live
// in Compartments so they can be reconfigured live. `option`/`alt` gates the
// multi-cursor + rectangular-selection affordances (lb used a modshift helper;
// inlined here).
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { indentUnit } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import theme from "./theme.js";

export class Codemirror {
  constructor(opts = {}) {
    this.language = new Compartment();
    this.extensions = new Compartment();

    this.view = new EditorView({
      state: opts.state,
      root: opts.shadow,
      parent: opts.parent,
      doc: opts.content,
      extensions: [
        theme,
        search(),
        history(),
        drawSelection(),
        indentUnit.of("\t"),
        highlightSpecialChars(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        lineNumbers(),
        EditorState.allowMultipleSelections.of(true),
        EditorState.tabSize.of(2),
        EditorState.readOnly.of(!!opts.readOnly),
        EditorView.editable.of(!opts.readOnly),
        // option-click adds a selection range (multi-cursor)
        EditorView.clickAddsSelectionRange.of((event) => event.altKey && !event.shiftKey),
        rectangularSelection({ eventFilter: (event) => event.altKey && event.shiftKey }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        this.language.of(opts.language ?? []),
        this.extensions.of(opts.extensions ?? []),
      ],
    });
  }

  get element() {
    return this.view.dom;
  }

  setLanguage(language) {
    this.view.dispatch({ effects: this.language.reconfigure(language ?? []) });
  }

  setExtensions(ext) {
    this.view.dispatch({ effects: this.extensions.reconfigure(ext ?? []) });
  }

  destroy() {
    this.view.destroy();
  }
}
