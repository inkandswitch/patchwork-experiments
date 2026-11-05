// scene.inspector's Behaviours, the pure side: what the scene:extension
// registry says about traits (each plugin's `describes`, STAGE.md
// "Describing traits"), and how a described field reads from and writes to a
// trait's value. No DOM, no api.
//
// A field is a ParamSpec ({ key, label?, kind, default?, options?, min?, max?,
// step? }), so the scene's param form (src/param-form.js) draws it. Four kinds
// beyond the ParamSpec ones are turned into ParamSpec ones here:
// - "object": an object or group id in this scene (a select; None removes it);
// - "entry": a key of the scene trait `of`, a map of entries such as seats,
//   labelled by each entry's `name` (a select; None removes it);
// - "url": an automerge URL, as text (empty removes it);
// - "json": any value, as JSON text. A kind nobody knows is treated as this,
//   so a field never writes a string over a structured value.

import { stableStringify } from "../staleness.js";
import { outlineTree } from "./inspector-model.js";

const PARAM_KINDS = new Set(["number", "integer", "string", "boolean", "enum", "color"]);
const OWN_KINDS = new Set(["object", "entry", "url", "json"]);
const PLACES = ["object", "scene"];
const NONE = "";

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** A field as the inspector uses it, or null if it can't be one. */
function cleanField(f) {
  if (!isMap(f) || typeof f.key !== "string" || !f.key) return null;
  const kind = f.kind == null ? "string" : PARAM_KINDS.has(f.kind) || OWN_KINDS.has(f.kind) ? f.kind : "json";
  return { ...f, kind, label: typeof f.label === "string" ? f.label : f.key };
}

const cleanFields = (list) => (Array.isArray(list) ? list.map(cleanField).filter(Boolean) : []);

/** Where a description says its trait goes: ["object"], ["scene"] or both. */
function placesOf(on) {
  const list = (Array.isArray(on) ? on : [on]).filter((p) => PLACES.includes(p));
  return list.length ? list : ["object"];
}

/**
 * Every described trait in the registry, the first plugin (registry order) to
 * describe a key winning: Map key → { key, ext, name, blurb, on, fields,
 * entries, init }. `entries` (or null) says the trait's value is a map of
 * entries, id → { …fields }: { label, noun, prefix, fields, init }.
 * @param {object[]} plugins  scene:extension metadata
 */
export function describedTraits(plugins) {
  const out = new Map();
  for (const p of plugins ?? []) {
    if (!isMap(p?.describes)) continue;
    for (const [key, d] of Object.entries(p.describes)) {
      if (out.has(key) || !isMap(d)) continue;
      const e = isMap(d.entries) ? d.entries : null;
      out.set(key, {
        key,
        ext: p.id,
        name: typeof d.name === "string" && d.name ? d.name : key,
        blurb: typeof d.blurb === "string" ? d.blurb : "",
        on: placesOf(d.on),
        fields: cleanFields(d.fields),
        entries: e
          ? {
              label: typeof e.label === "string" ? e.label : "Entries",
              noun: typeof e.noun === "string" && e.noun ? e.noun : "entry",
              prefix: typeof e.prefix === "string" && /^[a-z]+$/i.test(e.prefix) ? e.prefix : "e",
              fields: cleanFields(e.fields),
              init: isMap(e.init) ? clone(e.init) : {},
            }
          : null,
        init: isMap(d.init) ? clone(d.init) : {},
      });
    }
  }
  return out;
}

/**
 * The traits a holder (an object, or the scene's own traits) has, in its
 * map's order, each with its description or null (nothing installed
 * describes it): [{ key, desc, value }].
 */
export function traitRows(traits, described) {
  if (!isMap(traits)) return [];
  return Object.keys(traits).map((key) => ({ key, desc: described.get(key) ?? null, value: traits[key] }));
}

/** The described traits that can go on this holder ("object" or "scene") and it hasn't got, by name. */
export function addableTraits(described, place, traits) {
  const have = isMap(traits) ? traits : {};
  return [...described.values()].filter((d) => d.on.includes(place) && !(d.key in have)).sort((a, b) => a.name.localeCompare(b.name));
}

/** A new trait's (or entry's) value: its init, then each field's default it doesn't already set. */
export function newValue(desc) {
  const out = clone(desc?.init) ?? {};
  for (const f of desc?.fields ?? []) if (!(f.key in out) && f.default !== undefined) out[f.key] = clone(f.default);
  return out;
}

/** A map trait's entries, [[id, entry]], skipping anything that isn't one. */
export const entriesOf = (value) => (isMap(value) ? Object.entries(value).filter(([, e]) => isMap(e)) : []);

/**
 * The ParamSpecs the form draws for these fields, with "object" and "entry"
 * as selects over what the scene holds now, and "url" and "json" as text.
 * @param {{ scene: object, self?: string | null, nameOf?: (id: string) => string | null }} ctx
 *   self: the holder, which an object field never offers
 */
export function formSpecs(fields, { scene, self = null, nameOf = null } = {}) {
  const objects = scene?.objects ?? {};
  const label = (id) => nameOf?.(id) || objects[id]?.name || (objects[id]?.kind === "group" ? "Group" : "Object");
  return fields.map((f) => {
    const base = { key: f.key, label: f.label };
    if (PARAM_KINDS.has(f.kind)) return { ...clone(f), ...base };
    if (f.kind === "object") {
      const opts = outlineTree(scene ?? {}).filter(({ id }) => id !== self && objects[id]);
      return { ...base, kind: "enum", options: [{ value: NONE, label: "None" }, ...opts.map(({ id }) => ({ value: id, label: label(id) }))] };
    }
    if (f.kind === "entry") {
      const list = entriesOf(scene?.traits?.[f.of]);
      return { ...base, kind: "enum", options: [{ value: NONE, label: "None" }, ...list.map(([id, e]) => ({ value: id, label: typeof e.name === "string" && e.name ? e.name : id }))] };
    }
    return { ...base, kind: "string" };
  });
}

/** What the form shows for a value (a trait's, or an entry's): { [key]: shown }. */
export function shownValues(fields, specs, value) {
  const v = isMap(value) ? value : {};
  const out = {};
  fields.forEach((f, i) => {
    const raw = v[f.key] ?? f.default;
    if (f.kind === "object" || f.kind === "entry") out[f.key] = (specs[i].options ?? []).some((o) => o.value === raw) ? raw : NONE;
    else if (f.kind === "json") out[f.key] = raw === undefined ? "" : JSON.stringify(raw);
    else if (f.kind === "url") out[f.key] = typeof raw === "string" ? raw : "";
    else out[f.key] = raw;
  });
  return out;
}

/**
 * What to write for what the form gave (already coerced to its ParamSpec):
 * { value } to set, { remove: true } to delete the key, or { error } to
 * refuse with a reason.
 */
export function fieldWrite(field, formValue) {
  switch (field.kind) {
    case "object":
    case "entry":
      return formValue === NONE || formValue == null ? { remove: true } : { value: formValue };
    case "url": {
      const s = String(formValue ?? "").trim();
      if (!s) return { remove: true };
      return /^automerge:[1-9A-HJ-NP-Za-km-z]+/.test(s) ? { value: s } : { error: `${field.label} needs a document link (automerge:…).` };
    }
    case "json": {
      const s = String(formValue ?? "").trim();
      if (!s) return { remove: true };
      try {
        return { value: JSON.parse(s) };
      } catch {
        return { error: `${field.label} isn't valid JSON.` };
      }
    }
    default:
      return formValue == null ? { error: `That isn't a valid ${field.label}.` } : { value: formValue };
  }
}

/** A key that changes when the Behaviours section's layout would (not its values). */
export const layoutKey = (parts) => stableStringify(parts);
