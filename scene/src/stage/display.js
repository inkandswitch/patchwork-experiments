// What a stage draws of its doc (API.md, "Display"): each object as the doc
// says, or as this viewer's extensions display it instead, never written.
// Each extension's override { transform?, content?, hidden?, name?, tint?,
// opacity?, outline? } is layered in running order, later winning per field.
// A transform is a pose (the viewport's, so worldOf, boxes and picking follow
// it); content is a file doc's URL or a stand-in's GLB bytes; hidden and name
// are as they say; tint is a colour over the object's own, opacity multiplies
// its own, outline is a list of colours its box is drawn in (alternating
// dashes for several). Drawing gives the viewport (through the stage's scope)
// each object's display and the stage's content each object to place.

import { snapshotOf } from "./model.js";
import { isGroup } from "../shared/groups.js";
import { composeMatrix, multiplyMatrices, normalizeTransform } from "../shared/transform.js";
import { layersKey } from "../layers.js";

/** The fields an extension may display an object as, merged per field in layering order. */
const FIELDS = ["transform", "content", "hidden", "name", "tint", "opacity", "outline"];
const noop = () => {};

/** Everything the viewport's applyDisplay reads, as one string: an object is re-applied only when this changes. */
function displayKey(o, parent, inh) {
  const t = o.transform ?? {};
  return `${o.kind === "group" ? "g" : "o"}|${o.visible !== false}|${o.color ?? ""}|${o.opacity ?? 1}|${!!o.wireframe}|${!!o.locked}|${o.tags ?? ""}|${t.position}|${t.rotation}|${t.scale}|${parent ?? ""}|${inh?.visible}|${inh?.opacity}|${layersKey(o.layers)}`;
}

/**
 * @param {{
 *   scope: object,                 // the viewport as the stage sees it (./scope.js)
 *   content: object,               // the stage's content (../content/content.js): place, forget, ids
 *   rank: () => string[],          // the running order, the layering order (an id not in it: after every one)
 *   opened: (id: string) => boolean, // is a stage open under this object?
 *   changed: () => void,           // what's shown changed without the doc changing: every update runs again
 * }} o
 */
export function createDisplay({ scope, content, rank, opened, changed }) {
  const overrides = new Map(); // object id → Map extension id → its override
  const displayed = new Map(); // object id → the merged override
  const displayKeys = new Map(); // object id → displayKey last applied
  const outlineKeys = new Map(); // object id → the outline last drawn, as a string
  let stale = false; // content, hidden, tint, opacity or an outline changed: draw again (redraw)

  /** An object's overrides in layering order, as [ext, override]. */
  function layered(id) {
    const at = new Map(rank().map((ext, i) => [ext, i]));
    return [...(overrides.get(id) ?? [])].sort(([a], [b]) => (at.get(a) ?? 1e9) - (at.get(b) ?? 1e9));
  }

  function merge(id) {
    const next = {};
    for (const [, o] of layered(id)) for (const k of FIELDS) if (o[k] !== undefined) next[k] = o[k];
    const was = displayed.get(id) ?? {};
    if (Object.keys(next).length) displayed.set(id, next);
    else displayed.delete(id);
    if (next.transform !== was.transform) scope.setPose(id, next.transform ? normalizeTransform(next.transform) : null);
    // a pose moving isn't news (what moves reads worldOf in its loop); anything else wakes every update
    const look = (d) => JSON.stringify([d.tint, d.opacity, d.outline]);
    if (next.content === was.content && next.hidden === was.hidden && next.name === was.name && !next.transform === !was.transform && look(next) === look(was)) return;
    stale ||= next.content !== was.content || next.hidden !== was.hidden || look(next) !== look(was);
    changed();
  }

  /**
   * Draw model `m` (./model.js): display state, then content. Only what is
   * shown is loaded, and once loaded it stays loaded. Parents before children
   * (attachment order), so each object's new parent is already in place when
   * it's attached to it.
   */
  function draw(m) {
    const { objects, parents, attachOrder, inherited } = m;
    scope.setGroups(m.members);
    let rerouted = false;
    for (const { id } of attachOrder) {
      const o = objects[id];
      if (isGroup(o)) {
        content.forget(id);
        continue;
      }
      const parent = parents.get(id) ?? null;
      const inh = inherited.get(id);
      // back (an undo): what extensions display for it applies again
      if (overrides.has(id) && !displayed.has(id)) merge(id);
      // placed even without geometry, so whatever is attached to it sits right
      const over = displayed.get(id);
      const oo = over ? { ...o, ...(over.hidden ? { visible: false } : {}), ...(over.tint ? { color: over.tint } : {}), ...(over.opacity != null ? { opacity: (o.opacity ?? 1) * over.opacity } : {}) } : o;
      const key = displayKey(oo, parent, inh);
      if (displayKeys.get(id) !== key) {
        displayKeys.set(id, key);
        scope.applyDisplay(id, oo, parent, inh);
      }
      const outline = over?.outline?.length ? over.outline : null;
      const outlineKey = outline ? outline.join("|") : "";
      if (outlineKeys.get(id) !== outlineKey) {
        outlineKeys.set(id, outlineKey);
        scope.setOutline(id, outline);
      }
      // a route that moved (its provider arrived or went) is a change to what's shown
      if (content.place(id, o, { shown: oo.visible !== false && inh.visible, show: over?.content, opened: opened(id) })) rerouted = true;
    }
    for (const id of new Set([...content.ids(), ...scope.ids(), ...displayKeys.keys()])) {
      if (objects[id]) continue;
      content.forget(id);
      scope.removeObject(id);
      displayKeys.delete(id);
      outlineKeys.delete(id);
      displayed.delete(id); // (its overrides stay until released: it may come back)
    }
    if (rerouted) changed();
  }

  return {
    /** Extension `ext` displays object `id` as `o` (again: replaces its own). → release */
    set(ext, id, o) {
      if (typeof id !== "string") return noop;
      const mine = Object.freeze({ ...o });
      if (!overrides.has(id)) overrides.set(id, new Map());
      overrides.get(id).set(ext, mine);
      merge(id);
      return () => {
        const by = overrides.get(id);
        if (by?.get(ext) !== mine) return;
        by.delete(ext);
        if (!by.size) overrides.delete(id);
        merge(id);
      };
    },
    /** Every override of extension `ext` goes (it stopped). */
    drop(ext) {
      for (const [id, by] of [...overrides]) if (by.delete(ext)) (by.size || overrides.delete(id), merge(id));
    },
    draw,
    /** Draw `m` again if an override changed what is drawn since the last redraw. */
    redraw(m) {
      if (!stale) return;
      stale = false;
      draw(m);
    },
    /** An object's displayed name, else its own (in model `m`), else null. */
    nameOf: (m, id) => displayed.get(id)?.name ?? m.objects[id]?.name ?? null,
    /**
     * An object's displayed world matrix: the viewport's, which displayed
     * transforms have moved; without WebGL, the doc's chain (in model `m`)
     * with each displayed transform in place of its own.
     */
    worldOf(m, oid) {
      const w = scope.worldOf(oid);
      if (w) return w;
      if (!m.objects[oid]) return null;
      if (!scope.posed) return snapshotOf(m).world(oid);
      let out = null;
      const seen = new Set();
      for (let id = oid; id != null && m.objects[id] && !seen.has(id); id = m.parents.get(id) ?? null) {
        seen.add(id);
        const local = composeMatrix(scope.poseOf(id) ?? m.objects[id].transform);
        out = out ? multiplyMatrices(local, out) : local;
      }
      return out;
    },
    /** Each displayed object's overrides by author, in layering order: { [id]: [{ ext, fields }] }, frozen (trace.draws). */
    authors: () => Object.fromEntries([...overrides.keys()].sort().map((id) => [id, Object.freeze(layered(id).map(([ext, o]) => Object.freeze({ ext, fields: Object.freeze(Object.keys(o).filter((k) => o[k] !== undefined)) })))])),
    /** What this viewer sees instead of the doc, merged: id → override (for probes). */
    merged: () => displayed,
  };
}
