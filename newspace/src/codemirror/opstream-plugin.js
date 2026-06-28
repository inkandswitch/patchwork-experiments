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
        this.cleanup = opstream.connect((op) => {
          if (this.sending) return; // our own edit echoing back
          if (isSnapshot(op)) {
            if (op.value === view.state.doc.toString()) return; // no-op (e.g. initial)
            view.dispatch({
              annotations: [Transaction.remote.of(true)],
              changes: { from: 0, to: view.state.doc.length, insert: op.value },
            });
          } else {
            const [from = 0, to = from] = op.range; // op { path:[], range:[from,to], value }
            view.dispatch({
              annotations: [Transaction.remote.of(true)],
              changes: { from, to, insert: op.value || "" },
            });
          }
        });
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
