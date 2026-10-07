// What the scene sources read from a doc, hashed. Pure.
// The title is deliberately not in it: renaming a flow doesn't rebuild it.

import { normalizeBodySpec } from "./body.js";

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
 * linked doc's contents are not: the scene host watches that doc's heads
 * through dependencies() (contract v2 §1). A doc without a body hashes
 * exactly as it always did, so its renders don't rebuild.
 */
export function flowFingerprint(doc) {
  const hashed = {
    freestream: doc?.freestream ?? null,
    elements: doc?.elements ?? null,
    domain: doc?.domain ?? null,
    seeds: doc?.seeds ?? null,
  };
  const body = normalizeBodySpec(doc?.body);
  if (body) hashed.body = body;
  return hashString(stableStringify(hashed));
}

/** Other docs a build reads: the linked body, when there is one. */
export function flowDependencies(doc) {
  const body = normalizeBodySpec(doc?.body);
  return body ? [body.url] : [];
}
