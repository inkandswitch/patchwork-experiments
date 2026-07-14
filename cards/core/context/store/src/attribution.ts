import { parseAutomergeUrl, type AutomergeUrl } from "@automerge/automerge-repo";

// Ownership/attribution helpers shared by context inspectors. They live here
// (next to the store) rather than in any one channel package because they reason
// about scopes and their owners — a store concern — not about any single
// channel's payload. The scope-filtering built on them (`filterChannel`,
// `contributedSlice`) lives in ./view, which reuses `belongsToDoc` from here.

// Split a doc or match sub-url (`automerge:<id>/seg/seg`) into its owning
// document url and id. Falls back to the raw url if it can't be parsed.
// Cached module-wide: parseAutomergeUrl checksums the id (double SHA-256 in
// JS) on every call, and inspectors call this in per-scope filter loops on
// every store tick — without the cache this dominated the main thread.
export function splitDocUrl(url: AutomergeUrl): DocUrlSplit {
  let split = splitCache.get(url);
  if (!split) {
    try {
      const { documentId } = parseAutomergeUrl(url);
      split = {
        docUrl: `automerge:${documentId}` as AutomergeUrl,
        docId: documentId,
      };
    } catch {
      split = { docUrl: url, docId: url };
    }
    splitCache.set(url, split);
  }
  return split;
}

type DocUrlSplit = { docUrl: AutomergeUrl; docId: string };

const splitCache = new Map<string, DocUrlSplit>();

// Whether `url` (a document url or a match sub-url) belongs to the same document
// as `focus`. Compares by document id, so a sub-url pointing inside the focused
// document still counts.
export function belongsToDoc(url: AutomergeUrl, focus: AutomergeUrl): boolean {
  return splitDocUrl(url).docId === splitDocUrl(focus).docId;
}
