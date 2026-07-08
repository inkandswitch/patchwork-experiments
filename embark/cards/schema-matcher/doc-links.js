// Document-link extraction, owned by the Schema Matcher card alongside the
// `open-documents` channel whose link-closure walkers use it (the Open
// Documents card imports these by this package's automerge url).
//
// Plain-JS bundleless module: the only bare import is importmap-provided.

import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
} from "@automerge/automerge-repo";

// Over-match `automerge:` urls on a permissive charset (stopping at the
// delimiters that close a link/token/string), then let automerge validate
// each. A sub-url like `automerge:<id>/contextToolIds/@0` matches too and is
// normalized down to its document url — reachability follows documents, not
// sub-locations.
const URL_RE = /automerge:[^\s)\]}"'`]+/g;

/**
 * Pull every document reference out of a string, normalized to canonical
 * document-level automerge urls (deduplicated).
 * @param {string} text
 * @returns {string[]}
 */
export function extractDocLinks(text) {
  const ids = new Set();
  for (const match of text.matchAll(URL_RE)) {
    if (isValidAutomergeUrl(match[0])) {
      ids.add(`automerge:${parseAutomergeUrl(match[0]).documentId}`);
    }
  }
  return [...ids];
}

/**
 * Every document url referenced by a string anywhere in `doc`, skipping the
 * `@patchwork` metadata subtree: links in there (spec docs, source modules,
 * tool wiring) are implementation plumbing, not content, so link-closure
 * walkers must not surface them as reachable documents.
 * @param {unknown} doc
 * @returns {string[]}
 */
export function linkedUrls(doc) {
  const out = new Set();
  walk(doc);
  return [...out];

  function walk(node) {
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
