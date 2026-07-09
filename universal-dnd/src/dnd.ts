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

/**
 * Copy variant of {@link setPatchworkDragData}: writes the *same* payload
 * shapes to the clipboard so a paste behaves like a drop. Chrome's async
 * clipboard rejects arbitrary MIME types, so we advertise the structured
 * payloads via `web `-prefixed custom formats and keep the universal
 * `text/plain` (raw url) + `text/uri-list` (web link) fallbacks. Degrades to
 * `writeText(url)` wherever `ClipboardItem` isn't available.
 */
export async function writePatchworkClipboard(
  item: PatchworkDndItem,
  source: string
): Promise<void> {
  const url = item.url;
  const link = webLinkFor(item.url);
  try {
    const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem })
      .ClipboardItem;
    if (navigator.clipboard?.write && CI) {
      const record: Record<string, Blob> = {
        "text/plain": new Blob([url], { type: "text/plain" }),
      };
      // Custom formats must be `web `-prefixed for the async clipboard API.
      record["web text/x-patchwork-dnd"] = new Blob(
        [JSON.stringify({ source, items: [item] })],
        { type: "web text/x-patchwork-dnd" }
      );
      record["web text/x-patchwork-urls"] = new Blob(
        [JSON.stringify([url])],
        { type: "web text/x-patchwork-urls" }
      );
      if (link) {
        record["text/uri-list"] = new Blob([`${link}\r\n`], {
          type: "text/uri-list",
        });
      }
      await navigator.clipboard.write([new CI(record)]);
      return;
    }
  } catch {
    // Fall through to the plain-text fallback below.
  }
  await navigator.clipboard?.writeText?.(url);
}

// 6-dot grip, currentColor so it inherits the button's text color.
const GRIP_SVG = /* html */ `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.3"/><circle cx="10" cy="4" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="6" cy="12" r="1.3"/><circle cx="10" cy="12" r="1.3"/></svg>`;

// Two offset rounded rectangles — the classic "copy" glyph, currentColor.
const COPY_SVG = /* html */ `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="5.25" y="5.25" width="7.5" height="7.5" rx="1.6"/><path d="M10.5 3.25H4.6A1.35 1.35 0 0 0 3.25 4.6v5.9"/></svg>`;

// Checkmark shown briefly after a successful copy.
const CHECK_SVG = /* html */ `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>`;

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

  // A dashed outline marks the augmentable region ("here's a tool"); the
  // controls themselves only surface on hover (see styles.ts).
  overlay.classList.add("pw-udnd-overlay");

  // Build the shared payload once — both the drag handle and the copy button
  // describe the exact same document reference.
  const buildItem = (): PatchworkDndItem => ({
    url,
    name: readName(view),
    type: view.getAttribute("data-type") ?? undefined,
    // Carry the tool this view is showing so targets that honor it (e.g. the
    // markdown embed) can preserve it; targets that don't just ignore it.
    toolId: toolId ?? undefined,
  });
  const source = toolId ?? "universal-dnd";

  // A single corner cluster hosts every per-view control.
  const corner = document.createElement("div");
  corner.className = "pw-udnd-corner";

  // --- Drag handle -----------------------------------------------------------
  const handle = document.createElement("div");
  handle.className = "pw-udnd-btn pw-udnd-btn--drag";
  handle.setAttribute("draggable", "true");
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", "Drag this view");
  handle.title = readName(view) ?? url;
  handle.innerHTML = GRIP_SVG;
  corner.appendChild(handle);

  const onDragStart = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    setPatchworkDragData(e.dataTransfer, buildItem(), source);
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
    handle.classList.add("pw-udnd-btn--dragging");
  };
  const onDragEnd = () => handle.classList.remove("pw-udnd-btn--dragging");

  handle.addEventListener("dragstart", onDragStart);
  handle.addEventListener("dragend", onDragEnd);

  // --- Copy button -----------------------------------------------------------
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "pw-udnd-btn pw-udnd-btn--copy";
  copy.setAttribute("aria-label", "Copy reference to this view");
  copy.title = "Copy reference";
  copy.innerHTML = COPY_SVG;
  corner.appendChild(copy);

  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  const onCopy = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void writePatchworkClipboard(buildItem(), source)
      .then(() => {
        copy.classList.add("pw-udnd-btn--copied");
        copy.innerHTML = CHECK_SVG;
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
          copy.classList.remove("pw-udnd-btn--copied");
          copy.innerHTML = COPY_SVG;
        }, 1100);
      })
      .catch((err) => console.error("[universal-dnd] copy failed", err));
  };
  copy.addEventListener("click", onCopy);

  overlay.appendChild(corner);

  return () => {
    clearTimeout(copiedTimer);
    handle.removeEventListener("dragstart", onDragStart);
    handle.removeEventListener("dragend", onDragEnd);
    copy.removeEventListener("click", onCopy);
    corner.remove();
  };
};
