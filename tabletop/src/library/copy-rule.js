// The scene's copy rule, as a whole doc is copied (a session forked): what
// of an object is about now, never copied. The source of truth is
// scene/src/parts/copy-rule.js (RUNTIME_FIELDS, runtimeOf, cleanTraits,
// cleanObject; refsOf's `copy: "drop"`) and extract.js's whole-doc copy.
// This is a copy, since packages don't import each other: when the rule
// there changes, change this to match (as empty-scene.js is to the scene's init).
//
// Every object of the doc is copied with its id, so an `object` reference
// follows its object, and the root traits go along, so an `entry` reference
// is kept: of the rule's references only `copy: "drop"` fields are left
// behind here. One thing transfer.js has no case for, since paste never
// copies a scene's root: an `entries` trait's `init` (seats' `player:
// null`) is each entry's state when nobody has used it, so a forked doc's
// entries are set back to it (its seats emptied).

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s) : []);

/** Fields the stage keeps that are about now, not about the object: never copied. */
export const RUNTIME_FIELDS = Object.freeze(["claims", "saved"]);

/** Each trait key's description, the first plugin's in registry order. Pure. */
export function describesOf(metas) {
  const out = new Map();
  for (const m of Array.isArray(metas) ? metas : []) {
    for (const [k, d] of Object.entries(m?.describes ?? {})) if (!out.has(k) && isMap(d)) out.set(k, d);
  }
  return out;
}

/**
 * What a whole-doc copy leaves behind or sets back, from what the extensions
 * describe: `runtime` (trait key → true, or a Set of its keys), `drops`
 * (trait key → the keys of its `copy: "drop"` fields), `inits` (trait key →
 * an `entries` trait's fresh entry state). Pure.
 */
export function copyRules(describes) {
  const runtime = new Map();
  const drops = new Map();
  const inits = new Map();
  for (const [k, d] of describes ?? []) {
    const fields = Array.isArray(d.fields) ? d.fields : [];
    if (d.runtime === true) runtime.set(k, true);
    else {
      const keys = new Set([...strings(d.runtime), ...fields.filter((f) => f?.runtime === true && typeof f.key === "string").map((f) => f.key)]);
      if (keys.size) runtime.set(k, keys);
    }
    const dropped = fields.filter((f) => f?.copy === "drop" && typeof f.key === "string").map((f) => f.key);
    if (dropped.length) drops.set(k, dropped);
    if (isMap(d.entries?.init)) inits.set(k, plain(d.entries.init));
  }
  return { runtime, drops, inits };
}

/** Traits as a whole-doc copy has them (an object's, or the root's): runtime state and dropped fields gone, entries fresh. Pure. */
export function cleanTraits(traits, { runtime = new Map(), drops = new Map(), inits = new Map() } = {}) {
  const out = plain(traits) ?? {};
  for (const [k, v] of Object.entries(out)) {
    const r = runtime.get(k);
    if (r === true) {
      delete out[k];
      continue;
    }
    if (!isMap(v)) continue;
    if (r) for (const key of r) delete v[key];
    for (const key of drops.get(k) ?? []) delete v[key];
    const init = inits.get(k);
    if (init) for (const entry of Object.values(v)) if (isMap(entry)) Object.assign(entry, plain(init));
  }
  return out;
}

/** An object as a whole-doc copy has it: the stage's runtime fields gone, its traits cleaned. Pure. */
export function cleanObject(o, rules) {
  const out = plain(o) ?? {};
  for (const f of RUNTIME_FIELDS) delete out[f];
  if (isMap(out.traits)) out.traits = cleanTraits(out.traits, rules);
  return out;
}
