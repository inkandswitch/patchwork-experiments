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

// Every document url referenced by a string anywhere in `doc`, skipping the
// `@patchwork` metadata subtree: links in there (spec docs, source modules,
// tool wiring) are implementation plumbing, not content, so link-closure
// walkers must not surface them as reachable documents.
export function linkedUrls(doc: unknown): AutomergeUrl[] {
  const out = new Set<AutomergeUrl>();
  walk(doc);
  return [...out];

  function walk(node: unknown): void {
    if (typeof node === "string") {
      for (const url of extractDocLinks(node)) out.add(url);
    } else if (Array.isArray(node)) {
      for (const child of node) walk(child);
    } else if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (key === "@patchwork") continue;
        walk(child);
      }
    }
  }
}
