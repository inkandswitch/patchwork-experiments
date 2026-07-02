import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo";

// Over-match `automerge:` urls on a permissive charset (stopping at the
// delimiters that close a link/token/string), then let automerge validate
// each. A sub-url like `automerge:<id>/contextToolIds/@0` matches too and is
// normalized down to its document url — reachability follows documents, not
// sub-locations.
const URL_RE = /automerge:[^\s)\]}"'`]+/g;

// Pull every document reference out of a string, normalized to canonical
// document-level `AutomergeUrl`s (deduplicated).
export function extractDocLinks(text: string): AutomergeUrl[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    if (isValidAutomergeUrl(match[0])) {
      ids.add(`automerge:${parseAutomergeUrl(match[0]).documentId}`);
    }
  }
  return [...ids] as AutomergeUrl[];
}
