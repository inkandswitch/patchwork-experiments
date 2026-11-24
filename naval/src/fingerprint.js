// What the rig scene source reads from a doc, hashed (pure). The linked
// hull's own contents aren't in it: the scene host watches that doc through
// dependencies() (by its heads) and
// rebuilds when it changes. stableStringify and hashString are flow-field's
// (src/fingerprint.js), copied.

import { normalize } from "./doc.js";

/** JSON with object keys sorted, so key order (which automerge doesn't promise) doesn't matter. */
export function stableStringify(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return `[${Array.from(v, stableStringify).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

/** 64-bit FNV-1a as 16 hex digits (two 32-bit lanes; plenty for change detection). */
export function hashString(s) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x0100019d) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * The whole normalized doc (its title too: it is the contract's name), so
 * a doc edit that changes nothing the build reads (an unknown key, a
 * reordering) doesn't rebuild, and every edit that does, does.
 */
export function rigFingerprint(doc) {
  return hashString(stableStringify(normalize(doc)));
}

/** The other doc a build reads: the linked hull, when there is one. */
export function rigDependencies(doc) {
  const url = normalize(doc).hull.link?.url;
  return url ? [url] : [];
}
