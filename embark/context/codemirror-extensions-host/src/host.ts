import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { findContextStore, subscribeContext } from "@embark/context";
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

      // Attach the first time a canvas store is reachable. The editor's DOM may
      // not be connected to the canvas `<patchwork-context>` when the plugin is
      // first constructed, so retry on updates until discovery succeeds (the
      // same probe the mention search uses). Outside a canvas it simply never
      // starts.
      private start(view: EditorView) {
        if (this.started || this.destroyed) return;
        if (!findContextStore(view.dom)) return;
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
