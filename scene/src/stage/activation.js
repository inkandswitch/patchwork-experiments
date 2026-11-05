// Which extensions run in a view: a function of the registry's metadata, the
// doc and this viewer's kits (STAGE.md, "Activation"). Pure.

import { chosenKits, suggestedKits } from "../kits.js";

export { chosenKits, suggestedKits };

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** The trait keys on one scene object (or group). */
export const traitKeys = (o) => (o?.traits && typeof o.traits === "object" ? Object.keys(o.traits) : []);

/**
 * Why the doc calls for this extension: "scene" (a scene trait or legacy
 * scene field), "objects" (only object traits or legacy object fields), or
 * null. (`always` and kits are the viewer's reasons: see activeSet.)
 */
export function docReason(meta, d) {
  const traits = new Set(list(meta?.traits));
  if (list(meta?.legacy?.scene).some((k) => d?.[k] != null)) return "scene";
  for (const k of traitKeys(d)) if (traits.has(k)) return "scene";
  const legacyObjects = list(meta?.legacy?.objects);
  for (const o of Object.values(d?.objects ?? {})) {
    if (!o) continue;
    if (legacyObjects.some((k) => o[k] != null)) return "objects";
    for (const k of traitKeys(o)) if (traits.has(k)) return "objects";
  }
  return null;
}

/** Does the doc call for it at all? */
export const docWants = (meta, d) => docReason(meta, d) != null;

/** May this extension lay out a dropped doc of this datatype? */
export function takesDrop(meta, type) {
  const drops = list(meta?.drops);
  return drops.includes("*") || (!!type && drops.includes(type));
}

/**
 * A kit list → the extension ids in it, in order (nested kits expanded where
 * they're named; each id once, first place wins; unknown kits and cycles ignored).
 * @param {Map<string, object> | object[]} kitMetas
 * @param {string[]} kitIds
 */
export function expandKits(kitMetas, kitIds) {
  const byId = kitMetas instanceof Map ? kitMetas : new Map((kitMetas ?? []).map((k) => [k.id, k]));
  const out = [];
  const seen = new Set();
  const visiting = new Set();
  const walk = (kid) => {
    const kit = byId.get(kid);
    if (!kit || visiting.has(kid)) return;
    visiting.add(kid);
    for (const sub of list(kit.kits)) walk(sub);
    for (const id of list(kit.extensions)) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    visiting.delete(kid);
  };
  for (const kid of list(kitIds)) walk(kid);
  return out;
}

/**
 * The extensions that run, in chain order, each with its scope (STAGE.md,
 * "Activation"): the scene's (registry order), then those only some objects
 * call for (registry order), then this viewer's kits' (kit order), then
 * `always` (registry order). An extension's `requires` follow it; requiring
 * never lends scope (a required extension with no reason of its own is
 * "viewer"). Unknown ids are left out. Each extension appears once, with the
 * earliest scope any of its own reasons gives it.
 *
 * @param {{ metas: object[], kits: object[], kitIds: string[], doc: object }} o
 * @returns {{ id: string, meta: object, scope: "scene" | "objects" | "viewer" }[]}
 */
export function activeSet({ metas, kits, kitIds, doc }) {
  const byId = new Map((metas ?? []).filter((m) => m?.id).map((m) => [m.id, m]));
  const own = new Map(); // id → its own scope
  for (const m of byId.values()) {
    const r = docReason(m, doc);
    if (r) own.set(m.id, r);
  }
  const kitMembers = expandKits(kits, kitIds).filter((id) => byId.has(id));
  for (const id of kitMembers) if (!own.has(id)) own.set(id, "viewer");
  for (const m of byId.values()) if (m.always && !own.has(m.id)) own.set(m.id, "viewer");

  const out = new Map();
  const add = (id) => {
    if (out.has(id) || !byId.has(id)) return;
    out.set(id, { id, meta: byId.get(id), scope: own.get(id) ?? "viewer" });
    for (const r of list(byId.get(id).requires)) add(r);
  };
  for (const scope of ["scene", "objects"]) for (const m of byId.values()) if (own.get(m.id) === scope) add(m.id);
  for (const id of kitMembers) add(id);
  for (const m of byId.values()) if (m.always) add(m.id);
  return [...out.values()];
}
