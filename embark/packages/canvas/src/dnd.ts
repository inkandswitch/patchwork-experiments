import { isValidAutomergeUrl, type AutomergeUrl } from "@automerge/automerge-repo";

// A single droppable extracted from a drag. Mirrors the payload Patchwork's
// sideboard writes when you drag a document out of a folder/list. A drag carries
// either a document (`url`) or a standalone `patchwork:component` (`componentUrl`
// — a head-less module url); exactly one is set.
export type DocumentDragItem = {
  url?: AutomergeUrl;
  // A stable, head-less component module url for component embeds (no document).
  componentUrl?: string;
  name?: string;
  type?: string;
  // The tool to render the item with, carried by canvas-embed drags so a parts
  // bin recreates the same preview tool. Absent for plain document drags (the
  // dropped doc's default tool is used).
  toolId?: string;
  // Optional canvas footprint carried by parts-bin / canvas-embed drags so the
  // dropped embed recreates the recorded size instead of the canvas default.
  width?: number;
  height?: number;
};

// True when a drag item resolves to something droppable: a component url, or a
// valid automerge document url.
function isDroppableItem(item: DocumentDragItem): boolean {
  if (typeof item.componentUrl === "string" && item.componentUrl) return true;
  return item.url != null && isValidAutomergeUrl(item.url);
}

// MIME types a document drag can arrive on, in order of preference. The first
// is Patchwork's rich payload; the rest are fallbacks for plain url drags
// (e.g. dropping a copied document link).
const DOCUMENT_DRAG_TYPES = [
  "text/x-patchwork-dnd",
  "text/x-patchwork-urls",
  "text/uri-list",
  "text/plain",
];

// True when a drag carries at least one media type we know how to read a
// document out of. Used by dragover to decide whether to accept the drop.
export function hasDocumentDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(
    dataTransfer &&
      DOCUMENT_DRAG_TYPES.some((type) => dataTransfer.types.includes(type))
  );
}

// The `source` tag a rich Patchwork payload may carry (e.g. "parts-bin"), used
// by the canvas to decide whether a drop should be deep-copied. Null when the
// payload is absent, unparseable, or untagged. Must be read synchronously
// during the drop event, before any await clears the dataTransfer.
export function getDragSource(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) return null;
  const dndData = dataTransfer.getData("text/x-patchwork-dnd");
  if (!dndData) return null;
  try {
    const parsed = JSON.parse(dndData) as { source?: unknown };
    return typeof parsed.source === "string" ? parsed.source : null;
  } catch {
    return null;
  }
}

// Pull every droppable document out of a drag, trying the rich Patchwork
// payload first and falling back to bare url lists. Returns null when nothing
// resolves to a valid automerge document.
export function getDocumentDragPayload(
  dataTransfer: DataTransfer | null
): DocumentDragItem[] | null {
  if (!dataTransfer) return null;

  const dndData = dataTransfer.getData("text/x-patchwork-dnd");
  if (dndData) {
    try {
      const parsed = JSON.parse(dndData) as { items?: DocumentDragItem[] };
      const items = (parsed.items ?? []).filter(isDroppableItem);
      if (items.length > 0) return items;
    } catch {
      // fall through to the other types
    }
  }

  const urlData = dataTransfer.getData("text/x-patchwork-urls");
  if (urlData) {
    try {
      const urls: unknown = JSON.parse(urlData);
      const items = (Array.isArray(urls) ? urls : [])
        .filter((url): url is AutomergeUrl => isValidAutomergeUrl(url))
        .map((url) => ({ url }));
      if (items.length > 0) return items;
    } catch {
      // fall through to the other types
    }
  }

  const text =
    dataTransfer.getData("text/uri-list") || dataTransfer.getData("text/plain");
  const items = text
    .split(/\r?\n/)
    .map(parseAutomergeUrl)
    .filter((url): url is AutomergeUrl => url !== null)
    .map((url) => ({ url }));
  if (items.length > 0) return items;

  return null;
}

// Read an automerge url from a single line of text: either a bare url, or a
// Patchwork web link that carries the document id in its fragment (#doc=...).
function parseAutomergeUrl(text: string): AutomergeUrl | null {
  const trimmed = text.trim();
  if (isValidAutomergeUrl(trimmed)) return trimmed;

  const docId = trimmed.match(/#doc=([^&\s]+)/)?.[1];
  if (docId && isValidAutomergeUrl(`automerge:${docId}`)) {
    return `automerge:${docId}` as AutomergeUrl;
  }
  return null;
}
