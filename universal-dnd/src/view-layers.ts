import type { Cleanup, ViewDecorator, ViewLayerContext } from "./types.js";
import { handleFromElement } from "./dom.js";

export interface ViewLayersOptions {
  /** Which elements count as "views". Defaults to `patchwork-view`. */
  selector?: string;
  /** Notified whenever the active state flips (key reveal, pin, etc.). */
  onActiveChange?: (active: boolean) => void;
}

export interface ViewLayersController {
  readonly active: boolean;
  activate(): void;
  deactivate(): void;
  toggle(): void;
  destroy(): void;
}

interface DecoratedView {
  root: HTMLElement;
  cleanups: Cleanup[];
  observer: MutationObserver;
  /** Inline style we set and must restore on teardown. */
  prevPosition: string;
}

const ROOT_CLASS = "pw-udnd-layers-root";
const LAYER_CLASS = "pw-udnd-layer";

/**
 * Manages per-view overlay "layers".
 *
 * This is the abstraction we're prototyping. Today it uses **on-demand DOM
 * injection** scoped to the active window (handles only exist while revealed),
 * which sidesteps the tool-trampling problem almost entirely. The contract it
 * exposes to decorators — "you get your own full-size overlay per view" — is
 * the part we actually want to keep, independent of how it's backed (on-demand
 * injection now; a real `<patchwork-view>` overlay slot later).
 *
 * Discovery is a live DOM query ({@link ViewLayersOptions.selector}) plus a
 * `MutationObserver`, not a global registry of elements. See the design notes
 * for the trade-offs of that choice.
 */
export function createViewLayers(
  decorators: ViewDecorator[],
  options: ViewLayersOptions = {}
): ViewLayersController {
  const selector = options.selector ?? "patchwork-view";
  const decorated = new Map<HTMLElement, DecoratedView>();
  let active = false;
  // Watches for views that appear (or get re-mounted) while we're active.
  let domObserver: MutationObserver | null = null;

  function decorateView(view: HTMLElement) {
    if (decorated.has(view)) return;

    // `display: contents` views (component-mode frame chrome) generate no box
    // to anchor an absolute overlay against — skip them rather than fight
    // their layout.
    const cs = getComputedStyle(view);
    if (cs.display === "contents" || cs.display === "none") return;

    const prevPosition = view.style.position;
    if (cs.position === "static") view.style.position = "relative";

    const root = document.createElement("div");
    root.className = ROOT_CLASS;

    const url = handleFromElement(view);
    const toolId = view.getAttribute("tool-id");

    const cleanups: Cleanup[] = [];
    for (const decorator of decorators) {
      const overlay = document.createElement("div");
      overlay.className = LAYER_CLASS;
      root.appendChild(overlay);
      const ctx: ViewLayerContext = { view, overlay, url, toolId };
      const cleanup = decorator(ctx);
      if (typeof cleanup === "function") cleanups.push(cleanup);
    }

    view.appendChild(root);

    // Tools wipe their own subtree on re-render (replaceChildren /
    // textContent=""), which detaches our root. Re-attach it — the layer
    // children survive in memory, so decorations persist across re-renders.
    const observer = new MutationObserver(() => {
      if (root.parentElement !== view) view.appendChild(root);
    });
    observer.observe(view, { childList: true });

    decorated.set(view, { root, cleanups, observer, prevPosition });
  }

  function undecorateView(view: HTMLElement) {
    const entry = decorated.get(view);
    if (!entry) return;
    entry.observer.disconnect();
    for (const cleanup of entry.cleanups) {
      try {
        cleanup();
      } catch (err) {
        console.error("[universal-dnd] decorator cleanup failed", err);
      }
    }
    entry.root.remove();
    view.style.position = entry.prevPosition;
    decorated.delete(view);
  }

  function scan() {
    document
      .querySelectorAll<HTMLElement>(selector)
      .forEach((view) => decorateView(view));
  }

  function activate() {
    if (active) return;
    active = true;
    document.documentElement.classList.add("pw-udnd-active");
    scan();
    domObserver = new MutationObserver(() => {
      if (active) scan();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
    options.onActiveChange?.(true);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    document.documentElement.classList.remove("pw-udnd-active");
    domObserver?.disconnect();
    domObserver = null;
    for (const view of [...decorated.keys()]) undecorateView(view);
    options.onActiveChange?.(false);
  }

  return {
    get active() {
      return active;
    },
    activate,
    deactivate,
    toggle() {
      active ? deactivate() : activate();
    },
    destroy() {
      deactivate();
    },
  };
}
