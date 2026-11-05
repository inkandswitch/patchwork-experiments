// The whole flow of a doc: its own freestream and elements (field.js) plus,
// when doc.body links another doc, the body derived from that doc's section
// (body.js). Pure. The section is fetched elsewhere (section.js) and passed in.

import { compileField } from "./field.js";
import { compileBody, normalizeBodySpec } from "./body.js";
import { hashString, stableStringify } from "./fingerprint.js";

// The panel solve is a dense N × N system: cheap (a millisecond or two at
// N = 120), but the editor compiles the field on every pointer move, so keep
// the last few. Keyed by the section's geometry (section.key, a hash of its
// plane and loops: every acquisition makes a new section object, so identity
// would never hit across builds) plus everything the solve reads from the doc.
const cache = [];
const CACHE_SIZE = 4;
const keys = new WeakMap(); // sections without a .key (made by hand) → their key, hashed once

/** A stable key for a section's geometry: a hash of its plane and loops. */
export function sectionKey(section) {
  const loops = (section?.loops ?? []).map((l) => l?.points ?? l);
  return hashString(stableStringify({ kind: section?.plane?.kind ?? null, z: section?.plane?.z ?? null, loops }));
}

function keyOfSection(section) {
  if (typeof section.key === "string") return section.key;
  let k = keys.get(section);
  if (!k) keys.set(section, (k = sectionKey(section)));
  return k;
}

/**
 * @param {object} doc
 * @param {object|null} [section]  a SectionResult for doc.body, or null
 * @returns the compiled field, with `.body` when a body applies
 */
export function compileFlow(doc, section = null) {
  const base = compileField(doc);
  const spec = normalizeBodySpec(doc?.body);
  if (!spec || !section) return base;
  const key = stableStringify({
    model: spec.model,
    panels: spec.panels,
    plane: spec.plane,
    U: base.U,
    dx: base.dx,
    dy: base.dy,
    elements: base.elements,
  });
  const skey = keyOfSection(section);
  let hit = cache.find((c) => c.skey === skey && c.key === key);
  if (!hit) {
    let body;
    try {
      body = compileBody(section, spec, base);
    } catch (err) {
      // never let a bad section break the flow: no body, and say why
      body = { model: spec.model, z0: 0, loops: [], empty: true, failed: String(err?.message ?? err), add() {}, contains: () => false, info: { model: spec.model, loops: 0, panels: 0, warnings: [] } };
    }
    hit = { skey, key, body };
    cache.unshift(hit);
    cache.length = Math.min(cache.length, CACHE_SIZE);
  }
  return { ...base, body: hit.body };
}

/** Is the doc linked to a body? */
export function bodySpecOf(doc) {
  return normalizeBodySpec(doc?.body);
}
