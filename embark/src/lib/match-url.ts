import { isValidAutomergeUrl, type AutomergeUrl } from "@automerge/automerge-repo";

// A schema match points at a *location inside* a document, not just the
// document. We encode that as the document's `AutomergeUrl` plus an RFC 6901
// JSON Pointer in the URL fragment, e.g. `automerge:abc#/place` or
// `automerge:abc#/items/0` (empty pointer = the whole doc matched).
//
// NB: the result still types as `AutomergeUrl` (it's `automerge:${string}`),
// but the `#…` fragment means `repo.find`/`parseAutomergeUrl` will reject it —
// callers must `parseMatchUrl` and resolve the bare `url` themselves.

export type MatchLocation = { url: AutomergeUrl; pointer: string };

export function makeMatchUrl(url: AutomergeUrl, pointer: string): AutomergeUrl {
  return (pointer ? `${url}#${pointer}` : url) as AutomergeUrl;
}

export function parseMatchUrl(match: string): MatchLocation {
  const hash = match.indexOf("#");
  if (hash === -1) return { url: match as AutomergeUrl, pointer: "" };
  return {
    url: match.slice(0, hash) as AutomergeUrl,
    pointer: match.slice(hash + 1),
  };
}

// Escape a single path segment per RFC 6901 (`~` -> `~0`, `/` -> `~1`).
export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

// Build a child JSON Pointer from a parent pointer and the next key/index.
export function joinPointer(parent: string, key: string | number): string {
  return `${parent}/${escapePointerSegment(String(key))}`;
}

// Read the value a JSON Pointer addresses inside `doc` (empty pointer = the
// whole doc). Used by consumers to read the subtree a match url points at.
export function resolvePointer(doc: unknown, pointer: string): unknown {
  if (!pointer) return doc;
  let node: unknown = doc;
  for (const raw of pointer.split("/").slice(1)) {
    if (node === null || typeof node !== "object") return undefined;
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

// Document ids are base58; both link forms embed one. We over-match on a
// permissive charset and let `isValidAutomergeUrl` reject anything spurious.
const AUTOMERGE_URL_RE = /automerge:([1-9A-HJ-NP-Za-km-z]+)/g;
const DOC_LINK_RE = /\/#doc=([1-9A-HJ-NP-Za-km-z]+)/g;

// Pull every document reference out of a string — both `automerge:<id>` and the
// app's `/#doc=<id>` link form — normalized to canonical `AutomergeUrl`s.
export function extractDocLinks(text: string): AutomergeUrl[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(AUTOMERGE_URL_RE)) ids.add(match[1]);
  for (const match of text.matchAll(DOC_LINK_RE)) ids.add(match[1]);

  const urls: AutomergeUrl[] = [];
  for (const id of ids) {
    const url = `automerge:${id}`;
    if (isValidAutomergeUrl(url)) urls.push(url);
  }
  return urls;
}
