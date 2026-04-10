import { type Prop } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import { addHighlightStyle, clearHighlightStyle } from "./extension";
import { createCursorRange } from "./automerge";

export type SearchMatch = {
  from: number;
  to: number;
};

const ALL_MATCH_CSS = "background: rgba(250, 204, 21, 0.28);";
const ACTIVE_MATCH_CSS =
  "background: rgba(249, 115, 22, 0.45); outline: 1px solid rgba(194, 65, 12, 0.7);";

export function applySearchHighlights(
  handle: DocHandle<any>,
  path: Prop[],
  content: string,
  query: string,
  activeIndex: number,
): SearchMatch[] {
  clearHighlightStyle(handle);

  const matches = computeSearchMatches(content, query);
  if (matches.length === 0) return matches;

  for (const match of matches) {
    addMatchHighlight(handle, path, match, ALL_MATCH_CSS);
  }

  addMatchHighlight(
    handle,
    path,
    matches[normalizeIndex(activeIndex, matches.length)],
    ACTIVE_MATCH_CSS,
  );
  return matches;
}

export function clearSearchHighlights(handle: DocHandle<any>): void {
  clearHighlightStyle(handle);
}

export function computeSearchMatches(content: string, query: string): SearchMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const normalizedContent = content.toLocaleLowerCase();
  const matches: SearchMatch[] = [];
  let offset = 0;

  while (offset <= normalizedContent.length - normalizedQuery.length) {
    const foundAt = normalizedContent.indexOf(normalizedQuery, offset);
    if (foundAt === -1) break;

    matches.push({
      from: foundAt,
      to: foundAt + normalizedQuery.length,
    });

    offset = foundAt + Math.max(1, normalizedQuery.length);
  }

  return matches;
}

function addMatchHighlight(
  handle: DocHandle<any>,
  path: Prop[],
  match: SearchMatch,
  css: string,
): void {
  const cursorRange = createCursorRange(handle, path, match.from, match.to);
  if (!cursorRange) return;

  addHighlightStyle(handle, path, cursorRange.from, cursorRange.to, css);
}

function normalizeIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}
