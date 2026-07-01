import type { ViewDecorator } from "./types.js";

/**
 * Patchwork's cross-tool DnD is a MIME-type convention (no central bus). To
 * stay compatible with existing drop targets (sideboard, paper, space, the
 * markdown embed extension, …) we emit the same shapes they read:
 *
 *  - `text/x-patchwork-dnd`  → `{ source, items: [{ url, name?, type? }] }`
 *  - `text/x-patchwork-urls` → `[url, …]`
 *  - `text/plain`            → the raw automerge URL (universal fallback)
 *
 * Mirrors patchwork-base/sideboard's `payload.ts` / `item.tsx`.
 */
export interface PatchworkDndItem {
  url: string;
  name?: string;
  type?: string;
}

export function setPatchworkDragData(
  dt: DataTransfer,
  item: PatchworkDndItem,
  source: string
): void {
  dt.setData(
    "text/x-patchwork-dnd",
    JSON.stringify({ source, items: [item] })
  );
  dt.setData("text/x-patchwork-urls", JSON.stringify([item.url]));
  dt.setData("text/plain", item.url);
  dt.effectAllowed = "copyMove";
}

// 6-dot grip, currentColor so it inherits the handle's text color.
const GRIP_SVG = /* html */ `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.3"/><circle cx="10" cy="4" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="6" cy="12" r="1.3"/><circle cx="10" cy="12" r="1.3"/></svg>`;

/** Best-effort human label for the dragged view, for the structured payload. */
function readName(view: HTMLElement): string | undefined {
  return (
    view.getAttribute("data-title") ??
    view.getAttribute("data-name") ??
    view.getAttribute("aria-label") ??
    undefined
  );
}

/**
 * The actual augmentation: a grip in the corner of every view that drags the
 * view's document using the patchwork DnD payload.
 */
export const dragHandleDecorator: ViewDecorator = ({
  view,
  overlay,
  url,
  toolId,
}) => {
  // Only views that actually represent a document are draggable.
  if (!url) return;

  // A faint outline so the whole augmentable region reads as "grabbable".
  overlay.classList.add("pw-udnd-overlay");

  const handle = document.createElement("div");
  handle.className = "pw-udnd-handle";
  handle.setAttribute("draggable", "true");
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", "Drag this view");
  handle.title = readName(view) ?? url;
  handle.innerHTML = GRIP_SVG;
  overlay.appendChild(handle);

  const onDragStart = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    const item: PatchworkDndItem = {
      url,
      name: readName(view),
      type: view.getAttribute("data-type") ?? undefined,
    };
    setPatchworkDragData(e.dataTransfer, item, toolId ?? "universal-dnd");
    // Drag a ghost of the actual view so the gesture feels like moving it.
    try {
      e.dataTransfer.setDragImage(view, 12, 12);
    } catch {
      // setDragImage can throw on detached/odd nodes — ignore, use default.
    }
    handle.classList.add("pw-udnd-handle--dragging");
  };
  const onDragEnd = () => handle.classList.remove("pw-udnd-handle--dragging");

  handle.addEventListener("dragstart", onDragStart);
  handle.addEventListener("dragend", onDragEnd);

  return () => {
    handle.removeEventListener("dragstart", onDragStart);
    handle.removeEventListener("dragend", onDragEnd);
    handle.remove();
  };
};
