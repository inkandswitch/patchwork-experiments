import { getUniversalDnd } from "./app.js";
import { injectStyles } from "./styles.js";

// Local structural types — kept local so the bundle has no runtime or
// build-time dependency on the platform packages.
type ToolElement = HTMLElement & { repo?: unknown };
type Cleanup = () => void;
/** `patchwork:component` render: mounted bare, no document → `(element)`. */
type ComponentRender = (element: ToolElement) => Cleanup;
/** `patchwork:tool` render: mounted against a doc → `(handle, element)`. */
type ToolRender = (handle: unknown, element: ToolElement) => Cleanup;

/**
 * Mount the visible pin/unpin control into `element`. The actual universal-DnD
 * behavior is installed globally at module load (see index.ts); this control
 * just gives an in-frame affordance — and, crucially, *being mounted anywhere*
 * is what imports this module on the main thread so the global `install()`
 * runs. It ignores any document: the tool is frame-level, not doc-scoped.
 */
function mountControl(element: ToolElement): Cleanup {
  injectStyles();
  const app = getUniversalDnd();

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pw-udnd-toolbar-button";
  button.style.cursor = "pointer";
  button.addEventListener("click", () => app.togglePinned());

  const render = () => {
    button.textContent = app.pinned ? "\u2630 DnD: on" : "\u2630 DnD";
    button.setAttribute("aria-pressed", String(app.pinned));
  };
  const unsubscribe = app.onChange(render);
  render();

  element.appendChild(button);

  return () => {
    unsubscribe();
    button.remove();
  };
}

/**
 * Registered for two surfaces so the tool comes alive regardless of how a given
 * frame exposes always-on tools:
 *  - `componentRender` — bare `(element)`, for a `patchwork:component` (system
 *    tray, or a threepane sidebar-widget / bare-string slot).
 *  - `toolRender` — `(handle, element)`, for a `patchwork:tool` (threepane's
 *    doctitle lane, and doc-panel tool surfaces on other frames). The handle is
 *    ignored.
 */
export const componentRender: ComponentRender = (element) =>
  mountControl(element);
export const toolRender: ToolRender = (_handle, element) =>
  mountControl(element);
