// A collaborative CodeMirror editor on one of the scene's files
// (doc.files[path]), synced through @automerge/automerge-codemirror.

import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightSpecialChars } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { automergeSyncPlugin } from "@automerge/automerge-codemirror";

export function createEditor(parent, handle, path) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: String(handle.doc()?.files?.[path] ?? ""),
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle),
        path.endsWith(".json") ? json() : javascript(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorState.tabSize.of(2),
        automergeSyncPlugin({ handle, path: ["files", path] }),
        EditorView.contentAttributes.of({ "aria-label": `Source of ${path}`, spellcheck: "false" }),
      ],
    }),
  });
  return { view, destroy: () => view.destroy() };
}
