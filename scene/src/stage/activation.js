// Which extensions run in a stage: a function of the registry's metadata and
// the doc, nothing else (STAGE.md, "Activation"). Nothing the
// viewer holds, where they stand, what they have selected or the clock
// changes it. Pure.

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** The trait keys on one scene object (or group). */
export const traitKeys = (o) => (o?.traits && typeof o.traits === "object" ? Object.keys(o.traits) : []);

/**
 * Why the doc calls for this extension: "scene" (a scene trait, or any doc
 * at all: `traits: ["*"]`, as `drops: ["*"]` takes any datatype), "objects"
 * (only object traits), or null. An extension of every doc runs in every
 * stage, as that doc's own part, wherever the focus is: what it draws is the
 * doc's, never the viewer's (other people: STAGE.md, "Views, stages and links", "Presence
 * where it is").
 */
export function docReason(meta, d) {
  const traits = new Set(list(meta?.traits));
  if (traits.has("*")) return "scene";
  for (const k of traitKeys(d)) if (traits.has(k)) return "scene";
  for (const o of Object.values(d?.objects ?? {})) {
    if (!o) continue;
    for (const k of traitKeys(o)) if (traits.has(k)) return "objects";
  }
  return null;
}

/**
 * Providers first (STAGE.md, "Activation"): every entry whose metadata
 * `provides` a service, then the rest, each in the order given; a provider
 * that `uses` a service another of them provides goes after it (a cycle:
 * the order given). As each is created once everything before it has
 * started or failed, a create's `use` finds every service that will run.
 * Pure.
 * @template {{ meta: object }} E @param {E[]} entries @returns {E[]}
 */
export function providersFirst(entries) {
  const of = (e, k) => list(e.meta?.[k]);
  const prov = entries.filter((e) => of(e, "provides").length);
  const out = [];
  while (prov.length) {
    const waits = (e) => of(e, "uses").some((n) => prov.some((p) => p !== e && of(p, "provides").includes(n)));
    out.push(...prov.splice(Math.max(0, prov.findIndex((e) => !waits(e))), 1));
  }
  return [...out, ...entries.filter((e) => !of(e, "provides").length)];
}

/**
 * The extensions that run, in running order, each with its scope (STAGE.md,
 * "Activation"): providers first (providersFirst), each group the scene's
 * (registry order) then those only some objects call for (registry order).
 * Each appears once; metadata without an id is left out, and so is one with
 * no traits: an extension runs for a trait (`"*"`: every doc), and what is
 * the view's is a view plugin.
 *
 * @param {{ metas: object[], doc: object }} o
 * @returns {{ id: string, meta: object, scope: "scene" | "objects" }[]}
 */
export function activeSet({ metas, doc }) {
  const byId = new Map((metas ?? []).filter((m) => m?.id).map((m) => [m.id, m]));
  const out = [];
  for (const scope of ["scene", "objects"]) {
    for (const m of byId.values()) if (docReason(m, doc) === scope) out.push({ id: m.id, meta: m, scope });
  }
  return providersFirst(out);
}
