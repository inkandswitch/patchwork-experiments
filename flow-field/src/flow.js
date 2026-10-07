// The whole flow of a doc: its own freestream and elements (field.js) plus,
// when doc.body links another doc, the body derived from that doc's section
// (body.js). Pure. The section is fetched elsewhere (section.js) and passed in.

import { compileField } from "./field.js";
import { compileBody, normalizeBodySpec } from "./body.js";
import { stableStringify } from "./fingerprint.js";

// The panel solve is a dense N × N system: cheap (a millisecond or two at
// N = 120), but the editor compiles the field on every pointer move, so keep
// the last few. Keyed by the section object itself plus everything the solve
// reads from the doc.
const cache = [];
const CACHE_SIZE = 4;

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
  let hit = cache.find((c) => c.section === section && c.key === key);
  if (!hit) {
    let body;
    try {
      body = compileBody(section, spec, base);
    } catch (err) {
      // never let a bad section break the flow: no body, and say why
      body = { model: spec.model, z0: 0, loops: [], empty: true, failed: String(err?.message ?? err), add() {}, contains: () => false, info: { model: spec.model, loops: 0, panels: 0, warnings: [] } };
    }
    hit = { section, key, body };
    cache.unshift(hit);
    cache.length = Math.min(cache.length, CACHE_SIZE);
  }
  return { ...base, body: hit.body };
}

/** Is the doc linked to a body? */
export function bodySpecOf(doc) {
  return normalizeBodySpec(doc?.body);
}
