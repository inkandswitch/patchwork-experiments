import type { BulletsDoc } from "./datatype.ts";
import { MAX_SEARCH_RESULTS } from "./constants.ts";

export type SearchResult = {
  id: string;
  /** The display text that was matched against */
  displayText: string;
  /** Start index of the match within displayText */
  matchStart: number;
  /** Length of the match */
  matchLength: number;
};

/**
 * Returns the display text for a node. Override via the `getDisplayText`
 * parameter of `searchBullets` to resolve titles for automerge docs,
 * YouTube videos, images, etc.
 */
export type GetDisplayText = (id: string, content: string) => string;

const defaultGetDisplayText: GetDisplayText = (_id, content) => content;

/**
 * Search all bullets in a doc for a query string.
 * Returns matching bullets sorted by document order (if possible) or insertion order.
 *
 * Replace this function to change the search algorithm.
 */
export function searchBullets(
  doc: BulletsDoc,
  query: string,
  getDisplayText: GetDisplayText = defaultGetDisplayText,
  maxResults: number = MAX_SEARCH_RESULTS,
  reachableIds?: Set<string>,
): SearchResult[] {
  if (!query.trim()) return [];

  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];

  if (!doc.nodes) return [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (id === doc.rootId) continue;
    if (!node) continue;
    if (reachableIds && !reachableIds.has(id)) continue;
    if (results.length >= maxResults) break;

    const displayText = getDisplayText(id, node.content);

    const idx = displayText.toLowerCase().indexOf(lowerQuery);
    if (idx !== -1) {
      results.push({
        id,
        displayText,
        matchStart: idx,
        matchLength: query.length,
      });
    }
  }

  return results;
}
