import { getUniversalDnd } from "./app.js";
import { injectStyles } from "./styles.js";

// Local structural type for a tool render fn — kept local so the bundle has no
// runtime or build-time dependency on the platform packages. Matches
// `@inkandswitch/patchwork-plugins`'s `ToolRender`.
type ToolElement = HTMLElement & { repo?: unknown };
type ToolRender = (
  handle: { url: string },
  element: ToolElement
) => () => void;

/**
 * Toolbar tool render: a button that pins/unpins the reveal. The actual
 * universal-DnD behavior is installed globally at module load (see index.ts);
 * this just gives a visible, in-frame control when the host surfaces it.
 */
export const toolRender: ToolRender = (_handle, element) => {
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
};
