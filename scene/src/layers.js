/**
 * layers.js — a GLB's layers, and which are shown.  [kit: layers.js v1]
 *
 * COPY THIS FILE into your package; do not import it across packages. It has no
 * imports, so it runs anywhere. The canonical copy is
 * patchwork-experiments/scene/src/layers.js; copy it whole, never edit a copy
 * (`node scripts/check-kit.mjs` fails on a copy that differs).
 */

// Layers: named, nested sets of a GLB's meshes that can be shown or hidden
// one by one (a CAD file's layers: Rhino's, AutoCAD's, SketchUp's tags).
// Pure.
//
// A GLB declares them (README, "GLB conventions"):
//   - the glTF scene's `extras.layers` = [{ id, name?, parent?, visible? }, …]:
//     `id` a string, stable across rebuilds of the same source; `parent` another
//     entry's id; `visible` (default true) whether the source shows it;
//   - a node's `extras.layer` = an id: that node and everything under it are
//     on that layer, unless a nearer node says otherwise.
// An object in a scene keeps its own choices in `layers` = { [id]: boolean },
// only where someone chose; anything not there is as the GLB says.
//
// A layer is shown when its own choice (else the GLB's `visible`) says so and
// every layer above it is shown: hiding a parent hides what's in it, as in
// Rhino. A mesh on no layer, or on an id the table doesn't have, is always
// shown: an unknown id can't be toggled, so it mustn't vanish.

/**
 * The GLB's layer table, checked: entries without a string id, and repeats
 * of an id, are dropped; a parent that isn't in the table, or that would make
 * a loop, is cut (the entry becomes top-level). Ordered as a tree (each
 * layer, then what's in it, depth-first, in the GLB's order), with each
 * entry's depth.
 * @param {unknown} raw  scene extras.layers
 * @returns {readonly { id: string, name: string, parent: string | null, visible: boolean, depth: number }[]}
 */
export function sanitizeLayers(raw) {
  if (!Array.isArray(raw)) return Object.freeze([]);
  const byId = new Map();
  for (const e of raw) {
    if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id || byId.has(e.id)) continue;
    byId.set(e.id, {
      id: e.id,
      name: typeof e.name === "string" && e.name ? e.name : e.id,
      parent: typeof e.parent === "string" && e.parent ? e.parent : null,
      visible: e.visible !== false,
    });
  }
  // cut parents that aren't there, then break each loop at its first entry in
  // the GLB's order: going through the entries in order, one whose walk up
  // comes back to it is in a loop nothing earlier broke, so it becomes
  // top-level (a walk that meets some other repeat is in a loop that a later
  // entry will break; it stops there)
  for (const e of byId.values()) if (e.parent != null && (!byId.has(e.parent) || e.parent === e.id)) e.parent = null;
  for (const start of byId.values()) {
    const seen = new Set([start.id]);
    for (let e = byId.get(start.parent); e; e = byId.get(e.parent)) {
      if (e.id === start.id) {
        start.parent = null;
        break;
      }
      if (seen.has(e.id)) break;
      seen.add(e.id);
    }
  }
  const children = new Map();
  const roots = [];
  for (const e of byId.values()) {
    if (e.parent == null) roots.push(e);
    else {
      if (!children.has(e.parent)) children.set(e.parent, []);
      children.get(e.parent).push(e);
    }
  }
  const out = [];
  const visit = (e, depth) => {
    out.push(Object.freeze({ ...e, depth }));
    for (const c of children.get(e.id) ?? []) visit(c, depth + 1);
  };
  for (const r of roots) visit(r, 0);
  return Object.freeze(out);
}

/** An object's own choices, checked: only boolean values count. */
export function layerChoices(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean") out[k] = v;
  return out;
}

/**
 * Each layer's own state and whether it's shown.
 * @param {ReturnType<typeof sanitizeLayers>} table
 * @param {unknown} choices  the object's `layers`
 * @returns {Map<string, { on: boolean, chosen: boolean, shown: boolean }>}
 *   on: its own state (the choice, else the GLB's); chosen: someone chose it
 *   here; shown: on, and everything above it shown
 */
export function layerStates(table, choices) {
  const c = layerChoices(choices);
  const out = new Map();
  // the table is in tree order, so a parent is always settled before its children
  for (const e of table) {
    const chosen = Object.hasOwn(c, e.id);
    const on = chosen ? c[e.id] : e.visible;
    const above = e.parent == null ? true : out.get(e.parent)?.shown !== false;
    out.set(e.id, { on, chosen, shown: on && above });
  }
  return out;
}

/** Is a mesh on `layer` (an id, or null) drawn? Unknown ids and no layer: yes. */
export function layerShown(states, layer) {
  if (layer == null) return true;
  return states.get(layer)?.shown ?? true;
}

/** The layer a node is on: its own `extras.layer`, else its nearest ancestor's (up to, not past, `root`). */
export function nodeLayer(node, root = null) {
  for (let n = node; n; n = n.parent) {
    const l = n.userData?.layer;
    if (typeof l === "string" && l) return l;
    if (n === root) break;
  }
  return null;
}

/** An object's choices as one string, for a key that changes iff they do. */
export function layersKey(choices) {
  const c = layerChoices(choices);
  return Object.keys(c)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${c[k] ? 1 : 0}`)
    .join(",");
}
