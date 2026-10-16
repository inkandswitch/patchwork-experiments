// What the scene sources read from a doc, hashed. Pure.
// The title is deliberately not in it: renaming a flow doesn't rebuild it.

import { normalizeBodySpec } from "./body.js";
import { upstreamDepsOf } from "./upstream.js";

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
 * The link to a body is in the fingerprint (url, plane, model, panels), the
 * linked doc's contents are not: the scene host watches that doc through
 * dependencies() (by its heads, or by its glbUrl for a scene-render doc).
 * A doc without a body hashes without a `body` key at all.
 *
 * Of `seeds`, only `count` is read by anything (the rake always runs across
 * the upstream face), so only it is hashed: an old doc's `seeds.plane` is
 * ignored.
 */
export function flowFingerprint(doc) {
  const count = doc?.seeds?.count;
  const hashed = {
    freestream: doc?.freestream ?? null,
    elements: doc?.elements ?? null,
    domain: doc?.domain ?? null,
    seeds: count === undefined ? null : { count },
  };
  const body = normalizeBodySpec(doc?.body);
  if (body) hashed.body = body;
  return hashString(stableStringify(hashed));
}

/**
 * Other docs a build reads: the linked body, when there is one, and (for a
 * source-doc link only) whatever that doc's provider said it reads the last
 * time this body was acquired on this peer (upstream.js). This has to be
 * synchronous and can't load the body, so those are only known after a first
 * acquisition, and only picked up when the host next asks (after a flow-doc
 * edit). A scene-render link needs none of it: the render folds its own
 * dependencies into its GLB.
 */
export function flowDependencies(doc) {
  const body = normalizeBodySpec(doc?.body);
  return body ? [body.url, ...upstreamDepsOf(body.url)] : [];
}
