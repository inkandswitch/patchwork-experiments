import type { Cursor, Prop } from "@automerge/automerge";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { DocHandle } from "@automerge/automerge-repo";
import { resolveHighlightRange } from "./automerge";
import { createHighlightRule } from "./styles";

type HighlightEntry = {
  id: string;
  group: string;
  path: Prop[];
  from: Cursor;
  to: Cursor;
  css: string;
};

type DocumentHighlightState = {
  handle?: DocHandle<any>;
  entries: Map<string, HighlightEntry>;
  views: Set<EditorView>;
};

const documentHighlights = new Map<string, DocumentHighlightState>();
let nextHighlightId = 0;
let styleElement: HTMLStyleElement | null = null;

export function customHighlights(): Extension {
  return highlightPlugin;
}

export function addHighlightStyle(
  handle: DocHandle<any>,
  path: Prop[],
  from: Cursor,
  to: Cursor,
  css = "",
): () => void {
  const docUrl = handle.url;
  const documentState = getOrCreateDocumentState(docUrl);
  const entry = createHighlightEntry(path, from, to, css);

  documentState.handle = handle;
  documentState.entries.set(entry.id, entry);

  syncStyleRules();
  refreshDocumentHighlights(docUrl);

  return function removeHighlightStyle() {
    removeHighlightStyleEntry(docUrl, entry.id);
  };
}

export function clearHighlightStyle(handle: DocHandle<any>): void {
  const docUrl = handle.url;
  const documentState = documentHighlights.get(docUrl);
  if (!documentState) return;

  for (const entry of documentState.entries.values()) {
    deleteHighlightGroup(entry.group);
  }

  documentState.entries.clear();
  syncStyleRules();
  pruneDocumentState(docUrl);
}

const highlightPlugin = ViewPlugin.fromClass(
  class {
    readonly docUrl: string | null;
    readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.docUrl = getViewDocUrl(view);

      if (!this.docUrl) return;

      registerViewForDocument(this.docUrl, view);
      refreshDocumentHighlights(this.docUrl);
    }

    update(update: ViewUpdate) {
      if (!this.docUrl) return;
      if (!shouldRefreshHighlights(update)) return;

      refreshDocumentHighlights(this.docUrl);
    }

    destroy() {
      if (!this.docUrl) return;

      unregisterViewForDocument(this.docUrl, this.view);
      refreshDocumentHighlights(this.docUrl);
    }
  },
);

function createHighlightEntry(
  path: Prop[],
  from: Cursor,
  to: Cursor,
  css: string,
): HighlightEntry {
  const id = `highlight-${nextHighlightId++}`;

  return {
    id,
    group: `patchwork-highlight-${id}`,
    path: [...path],
    from,
    to,
    css,
  };
}

function getOrCreateDocumentState(docUrl: string): DocumentHighlightState {
  const existing = documentHighlights.get(docUrl);
  if (existing) return existing;

  const created: DocumentHighlightState = {
    entries: new Map(),
    views: new Set(),
  };

  documentHighlights.set(docUrl, created);
  return created;
}

function removeHighlightStyleEntry(docUrl: string, entryId: string): void {
  const documentState = documentHighlights.get(docUrl);
  if (!documentState) return;

  const entry = documentState.entries.get(entryId);
  if (!entry) return;

  deleteHighlightGroup(entry.group);
  documentState.entries.delete(entryId);
  syncStyleRules();
  refreshDocumentHighlights(docUrl);
  pruneDocumentState(docUrl);
}

function registerViewForDocument(docUrl: string, view: EditorView): void {
  getOrCreateDocumentState(docUrl).views.add(view);
}

function unregisterViewForDocument(docUrl: string, view: EditorView): void {
  const documentState = documentHighlights.get(docUrl);
  if (!documentState) return;

  documentState.views.delete(view);
  pruneDocumentState(docUrl);
}

function refreshDocumentHighlights(docUrl: string): void {
  const documentState = documentHighlights.get(docUrl);
  if (!documentState) return;

  for (const entry of documentState.entries.values()) {
    const ranges = buildRangesForEntry(documentState, entry);

    if (ranges.length === 0) {
      deleteHighlightGroup(entry.group);
      continue;
    }

    setHighlightGroup(entry.group, ranges);
  }
}

function buildRangesForEntry(
  documentState: DocumentHighlightState,
  entry: HighlightEntry,
): Range[] {
  if (!documentState.handle) return [];

  const resolvedRange = resolveHighlightRange(
    documentState.handle,
    entry.path,
    entry.from,
    entry.to,
  );

  if (!resolvedRange || resolvedRange.from === resolvedRange.to) {
    return [];
  }

  const ranges: Range[] = [];

  for (const view of documentState.views) {
    ranges.push(...createRangesForView(view, resolvedRange.from, resolvedRange.to));
  }

  return ranges;
}

function createRangesForView(view: EditorView, from: number, to: number): Range[] {
  const safeFrom = clampNumber(from, 0, view.state.doc.length);
  const safeTo = clampNumber(to, 0, view.state.doc.length);

  if (safeFrom >= safeTo) return [];

  const ranges: Range[] = [];

  for (const visibleRange of view.visibleRanges) {
    const start = Math.max(safeFrom, visibleRange.from);
    const end = Math.min(safeTo, visibleRange.to);

    if (start >= end) continue;

    const domRange = createDomRange(view, start, end);
    if (domRange) {
      ranges.push(domRange);
    }
  }

  return ranges;
}

function createDomRange(view: EditorView, from: number, to: number): Range | null {
  try {
    const range = view.dom.ownerDocument.createRange();
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);

    setRangeBoundary(range, "start", start.node, start.offset);
    setRangeBoundary(range, "end", end.node, end.offset);

    return range;
  } catch {
    return null;
  }
}

function setRangeBoundary(
  range: Range,
  side: "start" | "end",
  node: Node,
  offset: number,
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    const safeOffset = clampNumber(offset, 0, text.data.length);

    if (side === "start") {
      range.setStart(text, safeOffset);
    } else {
      range.setEnd(text, safeOffset);
    }

    return;
  }

  const safeOffset = clampNumber(offset, 0, node.childNodes.length);

  if (side === "start") {
    range.setStart(node, safeOffset);
  } else {
    range.setEnd(node, safeOffset);
  }
}

function shouldRefreshHighlights(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.viewportChanged ||
    update.geometryChanged ||
    update.heightChanged
  );
}

function getViewDocUrl(view: EditorView): string | null {
  const patchworkView = view.dom.closest("patchwork-view");
  return patchworkView?.getAttribute("doc-url") ?? null;
}

function syncStyleRules(): void {
  const nextCss = Array.from(documentHighlights.values())
    .flatMap((documentState) => Array.from(documentState.entries.values()))
    .map((entry) => createHighlightRule(entry.group, entry.css))
    .join("\n");

  const stylesheet = ensureStyleElement();
  if (!stylesheet) return;

  stylesheet.textContent = nextCss;
}

function ensureStyleElement(): HTMLStyleElement | null {
  if (styleElement?.isConnected) return styleElement;
  if (typeof document === "undefined") return null;

  styleElement = document.querySelector(
    'style[data-patchwork-codemirror-highlights="true"]',
  );

  if (styleElement) return styleElement;

  styleElement = document.createElement("style");
  styleElement.setAttribute("data-patchwork-codemirror-highlights", "true");
  document.head.appendChild(styleElement);
  return styleElement;
}

function setHighlightGroup(group: string, ranges: Range[]): void {
  const highlightRegistry = getHighlightRegistry();
  const HighlightCtor = getHighlightConstructor();

  if (!highlightRegistry || !HighlightCtor) return;

  highlightRegistry.set(group, new HighlightCtor(...ranges));
}

function deleteHighlightGroup(group: string): void {
  const highlightRegistry = getHighlightRegistry();
  if (!highlightRegistry) return;

  highlightRegistry.delete(group);
}

function getHighlightRegistry():
  | {
      set(key: string, value: unknown): void;
      delete(key: string): void;
    }
  | null {
  const cssObject = (globalThis as any).CSS;
  if (!cssObject?.highlights) return null;

  return cssObject.highlights;
}

function getHighlightConstructor():
  | (new (...ranges: Range[]) => unknown)
  | null {
  const HighlightCtor = (globalThis as any).Highlight;
  return typeof HighlightCtor === "function" ? HighlightCtor : null;
}

function pruneDocumentState(docUrl: string): void {
  const documentState = documentHighlights.get(docUrl);
  if (!documentState) return;
  if (documentState.entries.size > 0) return;
  if (documentState.views.size > 0) return;

  documentHighlights.delete(docUrl);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
