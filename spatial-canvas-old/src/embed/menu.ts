import { createElement, type IconNode } from "lucide";
import * as icons from "lucide";

export type MenuItem = {
  id: string;
  name: string;
  icon?: string;
  onDragStart?: (e: DragEvent) => void;
};

const ITEM_CSS = [
  "display:flex",
  "align-items:center",
  "gap:8px",
  "width:100%",
  "padding:6px 10px",
  "border:none",
  "background:none",
  "border-radius:5px",
  "cursor:pointer",
  "text-align:left",
  "font:inherit",
  "box-sizing:border-box",
].join(";");

/**
 * Opens a popup menu anchored to `anchorEl`, positioned above it.
 * Returns a close function.
 */
export function openMenu(
  anchorEl: HTMLElement,
  items: MenuItem[],
  onSelect: (id: string) => void,
): () => void {
  const menu = document.createElement("div");
  menu.style.cssText = [
    "position:fixed",
    "z-index:99999",
    "background:#fff",
    "border:1px solid #ddd",
    "border-radius:8px",
    "box-shadow:0 4px 16px rgba(0,0,0,0.15)",
    "padding:4px",
    "min-width:160px",
    "font:13px/1.4 system-ui,sans-serif",
  ].join(";");

  for (const item of items) {
    const row = document.createElement("div");
    row.style.cssText = ITEM_CSS;
    if (item.onDragStart) row.draggable = true;

    const iconData = item.icon
      ? (icons as unknown as Record<string, IconNode | undefined>)[item.icon]
      : undefined;
    if (iconData) {
      row.appendChild(
        createElement(iconData, {
          width: 16,
          height: 16,
          style: "pointer-events:none;flex-shrink:0",
        }),
      );
    }

    const label = document.createElement("span");
    label.textContent = item.name;
    label.style.cssText =
      "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;";
    row.appendChild(label);

    row.addEventListener("mouseover", () => {
      row.style.background = "#f0f0f0";
    });
    row.addEventListener("mouseout", () => {
      row.style.background = "";
    });

    // Stop propagation on pointerdown so parent overlays don't interfere,
    // but do NOT select/close here — we need to distinguish click vs drag.
    row.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });

    // Select on click (browser suppresses click after a successful drag)
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(item.id);
      close();
    });

    if (item.onDragStart) {
      row.addEventListener("dragstart", (e) => {
        item.onDragStart!(e);
        setTimeout(close, 0);
      });
    }

    menu.appendChild(row);
  }

  // Append hidden to measure, then position above anchor
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  const rect = anchorEl.getBoundingClientRect();
  const menuH = menu.offsetHeight;
  const menuW = menu.offsetWidth;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menuW - 8)}px`;
  menu.style.top = `${rect.top - menuH - 4}px`;
  menu.style.visibility = "";

  function close() {
    menu.remove();
    document.removeEventListener("pointerdown", onOutside);
  }

  function onOutside(e: PointerEvent) {
    if (!menu.contains(e.target as Node)) close();
  }
  setTimeout(() => document.addEventListener("pointerdown", onOutside), 0);

  return close;
}
