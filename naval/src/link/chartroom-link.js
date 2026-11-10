// Chartroom from the hull's own package: a `chartroom:source` plugin in the
// host's registry, looked up by the hull doc's datatype at runtime. Main
// thread only (it uses the registry, late-bound). Nothing here imports the
// provider's package: when none is installed, or it fails, or its table
// doesn't check out, the caller keeps the mesh path (rig-build.js builds a
// table from the floated mesh) and says why.
//
// The plugin (registered by the hull's package, camber/patchwork for
// camber-hull docs):
//
//   { type: "chartroom:source", id, supportedDatatypes: [...],
//     formats: ["hydrostatic-table/1", "marine-geometry/1"], version: 1,
//     load: () => import(...) }
//
// and its module:
//
//   { fingerprint(doc) → string,
//     hydrostaticTable(doc, opts) → a Chartroom hydrostatic-table v1 (or a promise of one),
//     marineGeometry(doc, opts) → a Chartroom marine-geometry v1 (or a promise of one) }
//
// The table is in metres in the producer's own frame (x forward, y port,
// z up); rigToTable (naval/hull-form.js) lines it up with the floated mesh by
// its LCB, so its origin doesn't matter. It is validated (validateTable)
// before anything reads it: a reading outside its coverage is unavailable,
// never extrapolated.

import { loadGetRegistry } from "./registry.js";
import { validateTable, DEFAULT_HEELS } from "../naval/statics.js";

export const CHARTROOM_SOURCE = "chartroom:source";
export const TABLE_FORMAT = "hydrostatic-table/1";
export const GEOMETRY_FORMAT = "marine-geometry/1";

/**
 * What the screen asks a producer for: heels 0–180° (the rig aid's own, so
 * large-angle stability reaches past AVS), at a resolution the design notes
 * measured at ~50 ms for camber (96 sections × 6 girth steps, 32 immersion
 * steps). Trims are the producer's choice (its design trim among them).
 * The keys are camber's HydrostaticExportOptions; a producer ignores what
 * it doesn't know.
 */
export const TABLE_OPTIONS = Object.freeze({ heelDeg: DEFAULT_HEELS, numSections: 96, girthSteps: 6, immersionSteps: 32 });

function list(registry) {
  try {
    return registry?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
}

const offers = (p, format) => !Array.isArray(p?.formats) || p.formats.includes(format);
const supports = (p, datatype) => {
  const sd = p?.supportedDatatypes;
  return datatype != null && Array.isArray(sd) && sd.includes(datatype);
};

/**
 * The chartroom:source plugins for a datatype that offer a format, registry
 * order. Wildcard providers aren't matched: a table is only ever the hull's
 * own package's word about its own datatype.
 */
export function chartroomProviders(providers, datatype, format = TABLE_FORMAT) {
  return (providers ?? []).filter((p) => p && p.id && supports(p, datatype) && offers(p, format));
}

/**
 * The hull's own hydrostatic table, when its package publishes one.
 * @param {{ doc: object, datatype: string|null, getRegistry?: Function, options?: object }} o
 * @returns {Promise<{ ok: true, table: object, fingerprint: string|null, providerId: string, providerName: string }
 *                  | { ok: false, absent: boolean, why: string }>}
 *   absent: no provider is installed for this datatype (the ordinary case
 *   for anything but a camber hull); otherwise one was, and `why` says
 *   what went wrong with it.
 */
export async function chartroomTableFor({ doc, datatype, getRegistry, options = TABLE_OPTIONS } = {}) {
  const get = getRegistry ?? (await loadGetRegistry());
  if (!get) return { ok: false, absent: true, why: "no plugin registry" };
  let reg = null;
  try {
    reg = get(CHARTROOM_SOURCE);
  } catch {
    reg = null;
  }
  const candidates = chartroomProviders(list(reg), datatype);
  if (!candidates.length) return { ok: false, absent: true, why: `no ${CHARTROOM_SOURCE} for “${datatype}” documents` };
  const notes = [];
  for (const p of candidates) {
    const name = p.name ?? p.id;
    try {
      const loaded = await reg.load?.(p.id);
      const mod = loaded?.module ?? null;
      if (typeof mod?.hydrostaticTable !== "function") throw new Error("it has no hydrostaticTable()");
      const table = await mod.hydrostaticTable(doc, { ...options });
      const v = validateTable(table);
      if (!v.ok) throw new Error(`its table doesn't check out: ${v.errors.slice(0, 3).map((e) => e.message).join("; ")}${v.errors.length > 3 ? ` (and ${v.errors.length - 3} more)` : ""}`);
      let fingerprint = null;
      try {
        fingerprint = typeof mod.fingerprint === "function" ? String(mod.fingerprint(doc)) : null;
      } catch {
        fingerprint = null;
      }
      return { ok: true, table, fingerprint, providerId: p.id, providerName: name };
    } catch (err) {
      notes.push(`${name}: ${err?.message ?? err}`);
    }
  }
  return { ok: false, absent: false, why: notes.join("; ") };
}
