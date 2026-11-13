// Which extensions run in a stage: a function of the registry's metadata and
// the doc, nothing else (STAGE.md, "Activation"; TOOLS.md §1). Nothing the
// viewer holds, where they stand, what they have selected or the clock
// changes it. Pure.

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** The trait keys on one scene object (or group). */
export const traitKeys = (o) => (o?.traits && typeof o.traits === "object" ? Object.keys(o.traits) : []);

/**
 * Why the doc calls for this extension: "scene" (a scene trait), "objects"
 * (only object traits), or null.
 */
export function docReason(meta, d) {
  const traits = new Set(list(meta?.traits));
  for (const k of traitKeys(d)) if (traits.has(k)) return "scene";
  for (const o of Object.values(d?.objects ?? {})) {
    if (!o) continue;
    for (const k of traitKeys(o)) if (traits.has(k)) return "objects";
  }
  return null;
}

/**
 * Its scope here: the doc's reason (above), else "general" when it declares
 * no traits (it belongs to the view: the key map, the menu, the inspector),
 * else null (traits the doc doesn't have: it doesn't run).
 */
export function ownReason(meta, d) {
  return docReason(meta, d) ?? (list(meta?.traits).length ? null : "general");
}

/** May this extension lay out a dropped doc of this datatype? */
export function takesDrop(meta, type) {
  const drops = list(meta?.drops);
  return drops.includes("*") || (!!type && drops.includes(type));
}

/**
 * The extensions that run, in chain order, each with its scope (STAGE.md,
 * "Activation"): the scene's first (registry order), then those only some
 * objects call for (registry order), then the general ones (registry
 * order). Each appears once; metadata without an id is left out.
 *
 * @param {{ metas: object[], doc: object }} o
 * @returns {{ id: string, meta: object, scope: "scene" | "objects" | "general" }[]}
 */
export function activeSet({ metas, doc }) {
  const byId = new Map((metas ?? []).filter((m) => m?.id).map((m) => [m.id, m]));
  const out = [];
  for (const scope of ["scene", "objects", "general"]) {
    for (const m of byId.values()) if (ownReason(m, doc) === scope) out.push({ id: m.id, meta: m, scope });
  }
  return out;
}
