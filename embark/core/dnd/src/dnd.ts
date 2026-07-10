import { isValidAutomergeUrl, type AutomergeUrl } from "@automerge/automerge-repo";

// A single droppable extracted from a drag. Mirrors the payload Patchwork's
// sideboard writes when you drag a document out of a folder/list. Every drag
// carries a document (`url`).
export type DocumentDragItem = {
  url?: AutomergeUrl;
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

// The slice of a canvas embed a payload is built from (structural, so this
// module doesn't depend on the canvas module).
export type DraggableEmbed = {
  docUrl?: AutomergeUrl;
  toolId?: string;
  width: number;
  height: number;
};

// Opt-in drag-and-drop diagnostics: silent unless `window.EMBARK_DND_DEBUG`
// is truthy, so the noisy per-dragover paths cost nothing in normal use.
// `logDndOnce` dedupes by message so a held dragover doesn't flood the
// console.
declare global {
  interface Window {
    EMBARK_DND_DEBUG?: boolean;
  }
}

const loggedOnce = new Set<string>();

export function logDnd(message: string, detail?: unknown): void {
  if (!window.EMBARK_DND_DEBUG) return;
  if (detail === undefined) console.debug(`[canvas dnd] ${message}`);
  else console.debug(`[canvas dnd] ${message}`, detail);
}

export function logDndOnce(message: string, detail?: unknown): void {
  if (!window.EMBARK_DND_DEBUG || loggedOnce.has(message)) return;
  loggedOnce.add(message);
  logDnd(message, detail);
}

// The payload item describing one embed. Shared by the canvas move bridge and
// clipboard copy so every consumer carries the same shape.
export function embedDragItem(embed: DraggableEmbed): DocumentDragItem {
  const item: DocumentDragItem = {
    width: embed.width,
    height: embed.height,
  };
  if (embed.docUrl) item.url = embed.docUrl;
  if (embed.toolId !== undefined) item.toolId = embed.toolId;
  return item;
}

// Write a document payload into a DataTransfer — a drag's dataTransfer or a
// clipboard event's clipboardData (both are DataTransfers), so drop and paste
// targets read one format (see getDocumentDragPayload). Alongside the rich
// Patchwork flavors, `text/plain` carries the bare automerge urls: custom
// flavors don't survive the OS clipboard into other browsers and apps, plain
// text does — and it parses back on the way in.
export function writeDocumentDragPayload(
  data: DataTransfer,
  source: string,
  items: DocumentDragItem[]
): void {
  data.setData("text/x-patchwork-dnd", JSON.stringify({ source, items }));
  const urls = items
    .map((item) => item.url)
    .filter((url): url is AutomergeUrl => url != null);
  if (urls.length > 0) {
    data.setData("text/x-patchwork-urls", JSON.stringify(urls));
    data.setData("text/plain", urls.join("\n"));
  }
}

// True when a drag item resolves to something droppable: a valid automerge
// document url.
function isDroppableItem(item: DocumentDragItem): boolean {
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
