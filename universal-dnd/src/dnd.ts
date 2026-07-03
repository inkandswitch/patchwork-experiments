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
  /** Datatype id (`@patchwork.type`), if known. */
  type?: string;
  /** Explicit tool preference — the tool this view was rendering. */
  toolId?: string;
}

/** Build a Patchwork web link (`…/#doc=<id>`) for `text/uri-list`. */
function webLinkFor(url: string): string | null {
  const id = url.replace(/^automerge:/, "").split(/[?#/]/)[0];
  if (!id) return null;
  try {
    return `${location.origin}/#doc=${id}`;
  } catch {
    return null;
  }
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
  // A real link so the browser treats the drag as a link (Chrome split-view)
  // and canvases that only read uri-list still accept it.
  const link = webLinkFor(item.url);
  if (link) dt.setData("text/uri-list", `${link}\r\n`);
  dt.setData("text/plain", item.url);
  // "all" advertises copy, move AND link — link is what lets Chrome offer
  // split-view when dragging a doc out of the app (mirrors the sideboard).
  dt.effectAllowed = "all";
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

  // Best-effort: if this view's doc is a `file`, learn its mime type + name so
  // dragstart can also expose a `DownloadURL` (drag straight to the desktop).
  // Async lookup via the `window.repo` global — resolves well before a drag in
  // practice; if it hasn't, we simply skip the OS-export format.
  let fileMeta: { mime: string; name: string } | null = null;
  const repo = (
    window as unknown as { repo?: { find?: (u: string) => Promise<unknown> } }
  ).repo;
  if (repo?.find) {
    void repo
      .find(url)
      .then((handle) => {
        const doc = (handle as { doc?: () => Record<string, any> })?.doc?.();
        if (doc?.["@patchwork"]?.type !== "file") return;
        const base = String(doc.name || "file");
        const ext = doc.extension ? `.${doc.extension}` : "";
        const name = ext && !base.endsWith(ext) ? `${base}${ext}` : base;
        fileMeta = {
          mime: String(doc.mimeType || "application/octet-stream"),
          name,
        };
      })
      .catch(() => {});
  }

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
      // Carry the tool this view is showing so targets that honor it (e.g. the
      // markdown embed) can preserve it; targets that don't just ignore it.
      toolId: toolId ?? undefined,
    };
    setPatchworkDragData(e.dataTransfer, item, toolId ?? "universal-dnd");
    // If the doc is a file, let the OS accept this drag as a real file. Served
    // as raw content by the patchwork service worker at `/<encoded url>/`.
    if (fileMeta) {
      try {
        const swUrl = `${location.origin}/${encodeURIComponent(url)}/`;
        e.dataTransfer.setData(
          "DownloadURL",
          `${fileMeta.mime}:${fileMeta.name}:${swUrl}`
        );
      } catch {
        // location unavailable in exotic embeds — skip OS export.
      }
    }
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
