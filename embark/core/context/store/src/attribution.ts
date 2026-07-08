import { parseAutomergeUrl, type AutomergeUrl } from "@automerge/automerge-repo";

// Ownership/attribution helpers shared by context inspectors. They live here
// (next to the store) rather than in any one channel package because they reason
// about scopes and their owners — a store concern — not about any single
// channel's payload. The scope-filtering built on them (`filterChannel`,
// `contributedSlice`) lives in ./view, which reuses `belongsToDoc` from here.

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
