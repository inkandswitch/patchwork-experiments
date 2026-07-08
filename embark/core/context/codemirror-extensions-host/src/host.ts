import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { subscribeContext } from "@embark/context";
import { CodemirrorExtensions } from "./channel";

// The single globally-installed CodeMirror extension that turns the canvas into
// the source of truth for which editor features are on. It reads the canvas
// `CodemirrorExtensions` context channel — where feature cards publish their own
// extension while they sit on the canvas — and installs whatever it finds into a
// compartment, reconfiguring live as cards come and go. Outside a canvas there
// is no context store to answer discovery, so it installs nothing and stays
// inert; that keeps mentions/stickers/etc. from being baked into every editor.
export function codemirrorExtensionsHost(): Extension {
  const hostCompartment = new Compartment();

  const hostController = ViewPlugin.fromClass(
    class {
      private unsubscribe?: () => void;
      private started = false;
      private destroyed = false;

      constructor(view: EditorView) {
        this.start(view);
      }

      update(update: ViewUpdate) {
        this.start(update.view);
      }

      // Attach once the editor's DOM is in the document, so context discovery
      // resolves to the right store (the nearest `<patchwork-context>`, or the
      // page-global body store). The DOM may not be connected when the plugin is
      // first constructed, so retry on updates until it is. Gating on *which*
      // features are on lives in the `CodemirrorExtensions` channel contents, not
      // here: with no card publishing an extension, this installs nothing.
      private start(view: EditorView) {
        if (this.started || this.destroyed) return;
        if (!view.dom.isConnected) return;
        this.started = true;
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
