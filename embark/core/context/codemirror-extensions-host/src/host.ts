import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { subscribeContext } from "@embark/context";
import { CodemirrorExtensions } from "./channel";

// The single globally-installed CodeMirror extension that turns the canvas into
// the source of truth for which editor features are on. It reads the canvas
// `CodemirrorExtensions` context channel — where feature cards publish their own
// extension while they sit on the canvas — and installs whatever it finds into a
// compartment, reconfiguring live as cards come and go. Gating on *which*
// features are on lives in the channel contents, not here: with no card
// publishing an extension, this installs nothing.
export function codemirrorExtensionsHost(): Extension {
  const hostCompartment = new Compartment();

  const hostController = ViewPlugin.fromClass(
    class {
      private unsubscribe?: () => void;
      private destroyed = false;

      // Context discovery needs the editor's DOM in the document, but this is
      // a static extension: the plugin is constructed inside `new EditorView()`,
      // before the caller has attached it. Editors are constructed and mounted
      // in the same task, so one deferred check is all the settling that's
      // allowed — if the editor still isn't connected by then, the invariant is
      // broken and we throw rather than silently hosting nothing.
      constructor(view: EditorView) {
        if (view.dom.isConnected) {
          this.start(view);
          return;
        }
        queueMicrotask(() => {
          if (this.destroyed) return;
          if (!view.dom.isConnected) {
            throw new Error(
              "[codemirror-extensions-host] editor DOM still not connected after mount settled; context discovery cannot run",
            );
          }
          this.start(view);
        });
      }

      private start(view: EditorView) {
        this.unsubscribe = subscribeContext(
          view.dom,
          CodemirrorExtensions,
          (all) => {
            const extensions = Object.values(all) as Extension[];
            // The channel emits on a microtask; dispatching mid-update is
            // illegal, so defer the reconfigure to its own microtask.
            queueMicrotask(() =>
              view.dispatch({
                effects: hostCompartment.reconfigure(extensions),
              }),
            );
          },
        );
      }

      destroy() {
        this.destroyed = true;
        this.unsubscribe?.();
      }
    },
  );

  return [hostCompartment.of([]), hostController];
}
