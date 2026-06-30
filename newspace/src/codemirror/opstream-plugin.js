// Bind an opstream<string> to a CodeMirror EditorView — ported from littlebook
// (lb/.../text/opstream-plugin.ts), adapted to our unified op and with correct
// echo handling.
//
// CodeMirror knows NOTHING about automerge: it only speaks ops to the opstream.
// Echo (local edit → opstream → back to us) is prevented two ways:
//   1. a `sending` guard set while we push a local edit (the opstream emits
//      synchronously, so the echo arrives while the guard is up), and
//   2. the `Transaction.remote` annotation on edits we apply FROM the stream, so
//      `update()` doesn't push them back.
import { Transaction } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { isSnapshot } from "../opstreams.js";

export function opstreamPlugin(opstream) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.sending = false;
        // `connect` fires the initial snapshot SYNCHRONOUSLY — during view
        // construction — and CodeMirror forbids dispatching while an update is in
        // progress. So defer any dispatch that happens during construction to a
        // microtask. (Also coerce non-string values, since an `any`/json stream may
        // be wired here before it holds text.)
        let constructing = true;
        const asText = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
        const handle = (op) => {
          if (this.sending) return; // our own edit echoing back
          // the INITIAL snapshot fires synchronously during construction — skip it
          // (the editor was built with this value via the `content` option), which
          // also avoids dispatching while the view is mid-construction.
          if (constructing) return;
          if (isSnapshot(op)) {
            const v = asText(op.value);
            if (v === view.state.doc.toString()) return; // no-op
            view.dispatch({ annotations: [Transaction.remote.of(true)], changes: { from: 0, to: view.state.doc.length, insert: v } });
          } else {
            const [from = 0, to = from] = op.range; // op { path:[], range:[from,to], value }
            view.dispatch({ annotations: [Transaction.remote.of(true)], changes: { from, to, insert: asText(op.value) } });
          }
        };
        this.cleanup = opstream.connect(handle);
        constructing = false;
      }
      update(update) {
        if (!update.docChanged) return;
        if (typeof opstream.apply !== "function") return; // read-only stream

        for (const tr of update.transactions) {
          if (tr.annotation(Transaction.remote)) continue; // came FROM the stream
          if (tr.changes.empty) continue;
          // apply each change to the opstream in OLD-doc coordinates, tracking the
          // running length delta so successive changes in one transaction land right
          let delta = 0;
          tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            const text = inserted.toString();
            this.sending = true;
            try {
              opstream.apply({ path: [], range: [fromA + delta, toA + delta], value: text });
            } finally {
              this.sending = false;
            }
            delta += text.length - (toA - fromA);
          });
        }
      }
      destroy() {
        this.cleanup();
      }
    }
  );
}
