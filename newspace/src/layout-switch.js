// unregistered 2026-07-02 pending the container-types rethink (see TODO)
// The ONE layout switcher shared by every non-canvas layout (list / grid / dock —
// the canvas chrome has its own owner). It lists the registered `sketchy:layout`
// descriptors and re-opens the SAME folder through another lens by dispatching
// `patchwork:open-document` with that layout's toolId: the docs are shared; only
// the lens + its complement differ (LAYOUTS.md). Plain DOM, no framework.
import { layoutsFor } from "./layouts.js";

const SWITCH = "display:flex;gap:4px;";
const SWBTN = "padding:3px 9px;border:1px solid currentColor;border-radius:5px;background:transparent;color:inherit;font:600 11px ui-monospace,monospace;cursor:pointer;";
const SWBTN_ON = SWBTN + "background:var(--ns-ink,#2b2b2b);color:var(--ns-paper,#fff);";

// dispatch the switch: re-open `folderUrl` with the target layout's tool
export function switchToLayout(element, folderUrl, toolId) {
  element.dispatchEvent(
    new CustomEvent("patchwork:open-document", {
      detail: { url: folderUrl, toolId },
      bubbles: true,
      composed: true,
    }),
  );
}

// build the switcher bar — one button per registered layout for `type`, the active
// one filled. Returns null when there's nothing to switch to (fewer than 2 layouts).
export function layoutSwitcher(element, folderUrl, activeToolId, type = "folder") {
  const layouts = layoutsFor(type);
  if (layouts.length < 2) return null;
  const sw = document.createElement("div");
  sw.style.cssText = SWITCH;
  for (const l of layouts) {
    const b = document.createElement("button");
    b.textContent = l.name;
    b.style.cssText = l.toolId === activeToolId ? SWBTN_ON : SWBTN;
    b.onclick = () => {
      if (l.toolId !== activeToolId) switchToLayout(element, folderUrl, l.toolId);
    };
    sw.append(b);
  }
  return sw;
}
