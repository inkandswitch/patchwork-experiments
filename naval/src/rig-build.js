// The whole rig, from a doc (and a linked hull's mesh, read on the main
// thread): the hydrostatic table, the numbers, the polar, the contract and
// the GLB. Pure and synchronous (about a second for a 12 m boat), so it runs
// in the worker (statics-job.js, job type "rig") for the scene source and
// the tool's "Export contract JSON", and directly in tests.
//
// The table is chosen and built exactly as the tool does it (staticsFor:
// the linked hull's own Chartroom table when it checks out, else one built
// from the floated mesh with staticsJobFor's settings), so the contract's
// predictions are the polar the tool shows for the same doc and hull.

import { normalize } from "./doc.js";
import { computeNumbers } from "./numbers.js";
import { validateTable, buildTable } from "./naval/statics.js";
import { rigToTable } from "./naval/hull-form.js";
import { formatText } from "./naval/units.js";
import { polar as runPolar } from "./naval/vpp.js";
import { buildContract } from "./contract.js";
import { buildRigGlb } from "./glb-rig.js";

/** The statics job for a floated hull, as the tool's worker and the rig build both make it (so their tables agree). */
export function staticsJobFor(form) {
  return {
    triangles: form.mesh.triangles,
    volumes: [form.float.volumeM3],
    name: form.label || "hull",
    originDescription: "The rig aid's hull frame: the floated waterplane at z = 0, x as the hull's own source",
    reference: { heelDeg: 0, trimDeg: 0, waterplaneOffsetM: 0 },
  };
}

/** A linked hull's own Chartroom table, when it checks out and lines up with the floated hull; else null. */
export function ownTableFor(doc, linked, form) {
  const own = doc.hull.link && linked?.mesh?.table;
  return own && validateTable(own).ok && rigToTable(own, form).available ? own : null;
}

/** The statics for a floated hull: { status: "ready", table, source }. */
export function staticsFor(doc, linked, form) {
  const own = ownTableFor(doc, linked, form);
  if (own) return { status: "ready", table: own, source: "chartroom" };
  const j = staticsJobFor(form);
  return { status: "ready", table: buildTable(j.triangles, j), source: "mesh" };
}

/**
 * The contract (and the numbers it came from) for a doc.
 * @param {{ doc: object, linked?: object|null, source?: object, polar?: boolean, options?: object }} x
 *   linked: { status: "ready", mesh: { triangles, table? }, chip } as the tool holds it
 * @returns {{ ok: true, contract: object, n: object, polar: object|null } | { ok: false, why: string, warnings?: string[] }}
 */
export function composeRig({ doc, linked = null, source = {}, polar = true, options = {} }) {
  const d = normalize(doc);
  const n0 = computeNumbers(d, { linked });
  if (!n0.form) return { ok: false, why: formatText(n0.warnings.find((w) => /hull/i.test(w)) ?? "no hull could be floated", "metric"), warnings: n0.warnings.map((w) => formatText(w, "metric")) };
  const statics = staticsFor(d, linked, n0.form);
  const n = computeNumbers(d, { linked, statics });
  const p = polar && n.design.ok ? runPolar(n.design) : null;
  const r = buildContract({ doc: d, n, polar: p, source: { ...source, statics: statics.source }, options });
  if (!r.ok) return { ok: false, why: r.why, warnings: n.warnings.map((w) => formatText(w, "metric")) };
  return { ok: true, contract: r.contract, n, polar: p };
}

/**
 * The rig GLB for a doc: { ok, glb, bounds, notes } (and the contract).
 * @param {{ doc: object, linked?: object|null, source?: object, params?: { sails?: boolean, hull?: boolean } }} job
 */
export function buildRig({ doc, linked = null, source = {}, params = {} }) {
  const r = composeRig({ doc, linked, source });
  if (!r.ok) return { ok: false, why: r.why, notes: [r.why, ...(r.warnings ?? [])].join(" ") };
  const n = r.n;
  const synthetic = !n.doc.hull.link;
  const { glb, bounds } = buildRigGlb(r.contract, {
    sails: params.sails !== false,
    hullTriangles: synthetic && params.hull !== false ? n.form.mesh.triangles : null,
    bottomAt: n.analysis.geo.bottomAt,
  });
  return { ok: true, glb, bounds, contract: r.contract, notes: r.contract.warnings.join(" ") };
}
