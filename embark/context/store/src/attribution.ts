import { parseAutomergeUrl, type AutomergeUrl } from "@automerge/automerge-repo";
import type { Channel, ContextStore } from "./context";

// Ownership/attribution helpers shared by context inspectors. They live here
// (next to the store) rather than in any one channel package because they reason
// about scopes and their owners — a store concern — not about any single
// channel's payload.

// Split a doc or match sub-url (`automerge:<id>/seg/seg`) into its owning
// document url and id. Falls back to the raw url if it can't be parsed.
export function splitDocUrl(url: AutomergeUrl): {
  docUrl: AutomergeUrl;
  docId: string;
} {
  try {
    const { documentId } = parseAutomergeUrl(url);
    return {
      docUrl: `automerge:${documentId}` as AutomergeUrl,
      docId: documentId,
    };
  } catch {
    return { docUrl: url, docId: url };
  }
}

// Whether `url` (a document url or a match sub-url) belongs to the same document
// as `focus`. Compares by document id, so a sub-url pointing inside the focused
// document still counts.
export function belongsToDoc(url: AutomergeUrl, focus: AutomergeUrl): boolean {
  return splitDocUrl(url).docId === splitDocUrl(focus).docId;
}

// The slice of `channel` authored by scopes the store attributed to
// `focusDocUrl` — i.e. exactly what the focused embed contributed. Merges every
// matching scope's slice (last writer wins per key), mirroring the store's own
// one-level merge.
export function contributedSlice<T extends Record<string, unknown>>(
  store: ContextStore,
  channel: Channel<T>,
  focusDocUrl: AutomergeUrl,
): T {
  const merged: Record<string, unknown> = {};
  for (const scope of store.scopes(channel)) {
    const ownerDoc = scope.owner?.docUrl as AutomergeUrl | undefined;
    if (!ownerDoc || !belongsToDoc(ownerDoc, focusDocUrl)) continue;
    Object.assign(merged, scope.slice);
  }
  return merged as T;
}
