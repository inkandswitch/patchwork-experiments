import { isValidAutomergeUrl, type AutomergeUrl } from "@automerge/automerge-repo";

// A single document extracted from a drag. Mirrors the payload Patchwork's
// sideboard writes when you drag a document out of a folder/list.
export type DocumentDragItem = {
  url: AutomergeUrl;
  name?: string;
  type?: string;
  // When true, the source asked for this to be dropped as a frameless embed
  // (no drag border, no clipping). Only the rich x-patchwork-dnd payload carries
  // it; bare url drags default to framed.
  frameless?: boolean;
};

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
      const items = (parsed.items ?? []).filter((item) =>
        isValidAutomergeUrl(item.url)
      );
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
