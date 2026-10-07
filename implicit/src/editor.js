// The CodeMirror 6 source editor: collaborative through
// @automerge/automerge-codemirror, highlighted with the language's own
// tokenizer (no lezer grammar needed), with inline error/warning marks and
// completion of built-ins and your own definitions.

import { EditorView, Decoration, ViewPlugin, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightSpecialChars } from "@codemirror/view";
import { EditorState, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { automergeSyncPlugin } from "@automerge/automerge-codemirror";
import { tokenize } from "./lang/tokenize.js";
import { BUILTINS, CONSTANTS, signature } from "./lang/builtins.js";

const tokenClass = {
  num: "isf-tok-num",
  kw: "isf-tok-kw",
  comment: "isf-tok-comment",
  op: "isf-tok-op",
  error: "isf-tok-bad",
};

function highlight(doc) {
  const src = doc.toString();
  const tokens = tokenize(src, { comments: true, lenient: true });
  const b = new RangeSetBuilder();
  let prevLet = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "eof" || t.end <= t.start) continue;
    let cls = tokenClass[t.type];
    if (t.type === "ident") {
      const next = tokens[i + 1];
      if (t.value === "x" || t.value === "y" || t.value === "z") cls = "isf-tok-point";
      else if (prevLet) cls = "isf-tok-def";
      else if (Object.hasOwn(BUILTINS, t.value) && next?.type === "(") cls = "isf-tok-fn";
      else if (Object.hasOwn(CONSTANTS, t.value)) cls = "isf-tok-num";
      else cls = "isf-tok-name";
    }
    if (t.type === "num" && t.unit) {
      const unitStart = t.end - t.unit.length;
      b.add(t.start, unitStart, Decoration.mark({ class: "isf-tok-num" }));
      b.add(unitStart, t.end, Decoration.mark({ class: "isf-tok-unit" }));
    } else if (cls) {
      b.add(t.start, t.end, Decoration.mark({ class: cls }));
    }
    if (t.type !== "comment") prevLet = t.type === "kw" && t.value === "let";
  }
  return b.finish();
}

const highlighter = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = highlight(view.state.doc);
    }
    update(u) {
      if (u.docChanged) this.decorations = highlight(u.state.doc);
    }
  },
  { decorations: (v) => v.decorations },
);

// diagnostics: set from outside after each compile
export const setDiagnostics = StateEffect.define();
const diagnostics = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setDiagnostics)) continue;
      const len = tr.state.doc.length;
      const marks = [];
      for (const d of e.value) {
        let from = Math.max(0, Math.min(d.start, len));
        let to = Math.max(from, Math.min(d.end, len));
        if (to === from) {
          // zero-width (e.g. at the end): widen to the previous character
          if (from > 0) from--;
          else if (to < len) to++;
          else continue;
        }
        marks.push(
          Decoration.mark({ class: d.severity === "error" ? "isf-diag-error" : "isf-diag-warning", attributes: { title: d.message } }).range(from, to),
        );
      }
      marks.sort((a, b) => a.from - b.from || a.to - b.to);
      deco = Decoration.set(marks, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function completions(context) {
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const src = context.state.doc.toString();
  const own = [];
  const re = /\blet\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\([^)]*\))?/g;
  for (let m; (m = re.exec(src)); ) {
    own.push({ label: m[1], type: m[2] ? "function" : "variable", detail: m[2] ?? "", boost: 2 });
  }
  const builtins = Object.entries(BUILTINS).map(([name, b]) => ({
    label: name,
    type: "function",
    detail: `(${b.params.join(", ")})`,
    info: b.doc,
    apply: `${name}(`,
    boost: b.group === "math" ? -1 : 1,
  }));
  const consts = [
    ...Object.keys(CONSTANTS).map((n) => ({ label: n, type: "constant" })),
    ...["x", "y", "z"].map((n) => ({ label: n, type: "variable", detail: "sample point", boost: -2 })),
    { label: "let", type: "keyword", apply: "let " },
  ];
  return { from: word.from, options: [...own, ...builtins, ...consts], validFor: /^[A-Za-z_][A-Za-z0-9_]*$/ };
}

/**
 * Mount the editor.
 * @param {HTMLElement} parent
 * @param {import("@automerge/automerge-repo").DocHandle<any>} handle
 */
export function createEditor(parent, handle) {
  const initial = String(handle.doc()?.source ?? "");
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        autocompletion({ override: [completions], icons: false }),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        EditorState.tabSize.of(2),
        EditorView.lineWrapping,
        highlighter,
        diagnostics,
        automergeSyncPlugin({ handle, path: ["source"] }),
        EditorView.contentAttributes.of({ "aria-label": "Implicit surface source", spellcheck: "false" }),
      ],
    }),
  });
  return {
    view,
    setDiagnostics(list) {
      view.dispatch({ effects: setDiagnostics.of(list) });
    },
    select(from, to = from) {
      const len = view.state.doc.length;
      view.dispatch({ selection: { anchor: Math.min(from, len), head: Math.min(to, len) }, scrollIntoView: true });
      view.focus();
    },
    insert(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}

export { signature };
