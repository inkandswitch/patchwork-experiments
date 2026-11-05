// Which extensions run in a view: a function of the registry's metadata, the
// doc and what this viewer is doing (its activity: STAGE.md, "Activation").
// Pure.

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** The activity a viewer starts in when nothing says otherwise, and the one always offered. */
export const DEFAULT_ACTIVITY = "edit";

/** The trait keys on one scene object (or group). */
export const traitKeys = (o) => (o?.traits && typeof o.traits === "object" ? Object.keys(o.traits) : []);

/**
 * Why the doc calls for this extension: "scene" (a scene trait), "objects"
 * (only object traits), or null. (Declaring no traits at all, or `always`,
 * is a reason of another kind: see ownReason.)
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

/** Does the doc call for it at all? */
export const docWants = (meta, d) => docReason(meta, d) != null;

/**
 * Its own reason to run, whatever the activity: the doc's (above), else
 * "general" when it declares no traits (a general-purpose part: the editor's
 * toolbar, the key map) or is `always`, else null (traits the doc doesn't have).
 */
export function ownReason(meta, d) {
  const r = docReason(meta, d);
  if (r) return r;
  if (meta?.always || !list(meta?.traits).length) return "general";
  return null;
}

/** Does it take part in this activity? Declaring none means every one. */
export function inActivity(meta, activity) {
  const mine = list(meta?.activities);
  return !mine.length || mine.includes(activity);
}

/** May this extension lay out a dropped doc of this datatype? */
export function takesDrop(meta, type) {
  const drops = list(meta?.drops);
  return drops.includes("*") || (!!type && drops.includes(type));
}

/**
 * The activities this scene offers: "edit", then every activity declared by
 * an extension with a reason of its own (registry order, each once). An
 * extension whose traits the doc lacks offers nothing, so a plain model
 * offers only "edit" and a scene with an arena's traits "edit" and "play".
 * @param {object[]} metas  scene:extension metadata, registry order
 * @param {object} doc
 * @returns {string[]}
 */
export function availableActivities(metas, doc) {
  const out = [DEFAULT_ACTIVITY];
  for (const m of metas ?? []) {
    if (!m?.id || !ownReason(m, doc)) continue;
    for (const a of list(m.activities)) if (!out.includes(a)) out.push(a);
  }
  return out;
}

/**
 * What this viewer is doing: their own choice, else what the doc starts
 * people in (view.activity), else "edit"; but only among the available ones,
 * and when it isn't one of them, "edit" (which always is).
 * @param {string | null | undefined} mine  local.activity
 * @param {object} doc
 * @param {string[]} available  availableActivities(…)
 * @returns {string}
 */
export function currentActivity(mine, doc, available) {
  const want = typeof mine === "string" ? mine : typeof doc?.view?.activity === "string" ? doc.view.activity : DEFAULT_ACTIVITY;
  if (available.includes(want)) return want;
  return available.includes(DEFAULT_ACTIVITY) ? DEFAULT_ACTIVITY : (available[0] ?? DEFAULT_ACTIVITY);
}

/**
 * The extensions that run, in chain order, each with its scope (STAGE.md,
 * "Activation"). One runs when it takes part in the activity and has a
 * reason of its own; the scene's come first (registry order), then those
 * only some objects call for (registry order), then the general ones
 * (registry order). An extension's `requires` follow it, whatever their
 * activities; requiring lends no scope (a required extension's own reasons
 * decide it, and with none it's "general"). Unknown ids are left out. Each
 * extension appears once.
 *
 * @param {{ metas: object[], doc: object, activity?: string }} o
 * @returns {{ id: string, meta: object, scope: "scene" | "objects" | "general" }[]}
 */
export function activeSet({ metas, doc, activity = DEFAULT_ACTIVITY }) {
  const byId = new Map((metas ?? []).filter((m) => m?.id).map((m) => [m.id, m]));
  const own = new Map(); // id → its own scope, whatever the activity
  for (const m of byId.values()) {
    const r = ownReason(m, doc);
    if (r) own.set(m.id, r);
  }
  const out = new Map();
  const add = (id) => {
    if (out.has(id) || !byId.has(id)) return;
    out.set(id, { id, meta: byId.get(id), scope: own.get(id) ?? "general" });
    for (const r of list(byId.get(id).requires)) add(r);
  };
  for (const scope of ["scene", "objects", "general"]) {
    for (const m of byId.values()) if (own.get(m.id) === scope && inActivity(m, activity)) add(m.id);
  }
  return [...out.values()];
}
