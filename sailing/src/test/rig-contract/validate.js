// patchwork-rig v1: validation, in two stages, as Chartroom's are.
//
//   structural: schema.json, read by a small interpreter of the JSON Schema
//               keywords the schema uses (type, const, enum, required,
//               properties, additionalProperties, items, minItems, maxItems,
//               minimum, maximum, exclusiveMinimum, exclusiveMaximum, anyOf,
//               $ref to #/$defs). A number must be finite.
//   semantic:   the cross-field rules of specification.md §5, each with the
//               error code the fixtures' manifest names.
//
// validate(contract) → { ok, stage: null | "structural" | "semantic", errors: [{ code, path, message }] }
// Semantic rules run only once the structure is sound. No imports but the
// schema, so a consumer can copy this folder whole.

import schema from "./schema.json";

const typeOk = (t, v) => {
  switch (t) {
    case "null":
      return v === null;
    case "boolean":
      return typeof v === "boolean";
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return Number.isInteger(v);
    case "array":
      return Array.isArray(v);
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v);
    default:
      return false;
  }
};

const resolve = (s) => {
  if (s && s.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    if (!m || !schema.$defs[m[1]]) throw new Error(`schema: unknown $ref ${s.$ref}`);
    return schema.$defs[m[1]];
  }
  return s;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Structural errors of v against schema s, appended to out. */
function check(s0, v, path, out) {
  const s = resolve(s0);
  if (s === true || s == null) return;
  if (s.anyOf) {
    const ok = s.anyOf.some((sub) => {
      const e = [];
      check(sub, v, path, e);
      return e.length === 0;
    });
    if (!ok) out.push({ code: "schema", path, message: "matches none of the allowed shapes" });
    return;
  }
  if ("const" in s && !same(v, s.const)) return void out.push({ code: "schema", path, message: `must be ${JSON.stringify(s.const)}` });
  if (s.enum && !s.enum.some((e) => same(e, v))) return void out.push({ code: "schema", path, message: `must be one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}` });
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeOk(t, v))) return void out.push({ code: "schema", path, message: `must be ${types.join(" or ")}` });
    if (v === null) return;
  }
  if (typeof v === "number") {
    if (s.minimum != null && v < s.minimum) out.push({ code: "schema", path, message: `must be ≥ ${s.minimum}` });
    if (s.maximum != null && v > s.maximum) out.push({ code: "schema", path, message: `must be ≤ ${s.maximum}` });
    if (s.exclusiveMinimum != null && !(v > s.exclusiveMinimum)) out.push({ code: "schema", path, message: `must be > ${s.exclusiveMinimum}` });
    if (s.exclusiveMaximum != null && !(v < s.exclusiveMaximum)) out.push({ code: "schema", path, message: `must be < ${s.exclusiveMaximum}` });
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) out.push({ code: "schema", path, message: `needs at least ${s.minItems} items` });
    if (s.maxItems != null && v.length > s.maxItems) out.push({ code: "schema", path, message: `takes at most ${s.maxItems} items` });
    if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, out));
  } else if (v !== null && typeof v === "object") {
    for (const k of s.required ?? []) if (!(k in v)) out.push({ code: "schema", path: `${path}.${k}`, message: "is required" });
    for (const [k, x] of Object.entries(v)) {
      if (s.properties && k in s.properties) check(s.properties[k], x, `${path}.${k}`, out);
      else if (s.additionalProperties === false) out.push({ code: "schema", path: `${path}.${k}`, message: "is not a field of patchwork-rig v1" });
      else if (s.additionalProperties && typeof s.additionalProperties === "object") check(s.additionalProperties, x, `${path}.${k}`, out);
    }
  }
}

/** The structural stage alone. */
export function validateStructure(c) {
  const errors = [];
  check(schema, c, "$", errors);
  return errors;
}

// ───────────────────────────────── semantic rules (§5)

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const increasing = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

/** Tolerances (§5): relative for sums and areas, absolute (m) for positions. */
export const TOL = { rel: 1e-6, posM: 1e-4, planeM: 1e-9, rotation: 1e-9 };

/** Area and centroid of a planar polygon in 3D (the plane's normal from Newell's method). */
export function polygonAreaCentroid(poly) {
  const n = [0, 0, 0];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const area = Math.hypot(...n) / 2;
  // centroid: fan from the first vertex, triangles weighted by signed area along n
  const nn = Math.hypot(...n) || 1;
  const u = n.map((x) => x / nn);
  let A = 0;
  const c = [0, 0, 0];
  for (let i = 1; i + 1 < poly.length; i++) {
    const t = cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0]));
    const w = (t[0] * u[0] + t[1] * u[1] + t[2] * u[2]) / 2;
    A += w;
    for (let k = 0; k < 3; k++) c[k] += (w * (poly[0][k] + poly[i][k] + poly[i + 1][k])) / 3;
  }
  return { area, centroid: A !== 0 ? c.map((x) => x / A) : poly[0] };
}

const relClose = (a, b, tol = TOL.rel) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/** The semantic stage, on a structurally sound contract. */
export function validateSemantics(c) {
  const errors = [];
  const err = (code, path, message) => errors.push({ code, path, message });

  // frame-matrix: a rotation (orthonormal, det +1) and a translation, last row 0 0 0 1
  const m = c.frame.glbToFrame;
  const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j * 4 + i]));
  let worst = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const d = A[i][0] * A[j][0] + A[i][1] * A[j][1] + A[i][2] * A[j][2] - (i === j ? 1 : 0);
      worst = Math.max(worst, Math.abs(d));
    }
  const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  if (worst > TOL.rotation || Math.abs(det - 1) > TOL.rotation || m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1)
    err("frame-matrix", "$.frame.glbToFrame", "is not a proper rotation and translation (column-major, last row 0 0 0 1)");

  // duplicate-id
  const dup = (xs) => xs.find((x, i) => xs.indexOf(x) !== i);
  const d1 = dup(c.sails.map((s) => s.id));
  if (d1) err("duplicate-id", "$.sails", `sail id "${d1}" appears twice`);
  const d2 = dup(c.appendages.map((a) => a.id));
  if (d2) err("duplicate-id", "$.appendages", `appendage id "${d2}" appears twice`);
  const d3 = dup(c.hardpoints.chainplates.map((x) => x.id));
  if (d3) err("duplicate-id", "$.hardpoints.chainplates", `chainplate id "${d3}" appears twice`);

  // mass-sum: the items sum to the mass, and the CG is their centroid
  const L = c.loading;
  const ms = L.items.reduce((s, i) => s + i.massKg, 0);
  if (!relClose(ms, L.massKg)) err("mass-sum", "$.loading.massKg", `the items sum to ${ms} kg, not ${L.massKg}`);
  else {
    const G = [0, 1, 2].map((k) => L.items.reduce((s, i) => s + i.massKg * i.atM[k], 0) / ms);
    if (dist(G, L.cgM) > TOL.posM) err("mass-sum", "$.loading.cgM", `the items' centroid is [${G.map((x) => x.toFixed(4))}], not the stated CG`);
  }
  if (!relClose(L.massKg, c.frame.design.displacementKg, 1e-3)) err("mass-sum", "$.frame.design.displacementKg", "the design waterplane floats a different mass from the loading's");

  // sail-plane and sail-area: on the centreplane; the polygon's area and centroid are the stated ones
  const sailIds = new Set(c.sails.map((s) => s.id));
  c.sails.forEach((s, i) => {
    const p = `$.sails[${i}]`;
    const off = [...s.polygonM, s.ceM, s.tackM, s.headM, s.clewM, ...s.reefs.flatMap((r) => [...r.polygonM, r.ceM])].some((q) => Math.abs(q[1]) > TOL.planeM);
    if (off) err("sail-plane", p, "a sail point is off the centreplane (y ≠ 0): v1 sails are stated on it, a consumer sheets them");
    const g = polygonAreaCentroid(s.polygonM);
    if (!relClose(g.area, s.areaM2)) err("sail-area", `${p}.areaM2`, `the polygon's area is ${g.area}, not ${s.areaM2}`);
    else if (dist(g.centroid, s.ceM) > TOL.posM) err("sail-area", `${p}.ceM`, "is not the polygon's centroid");
    s.reefs.forEach((r, k) => {
      const gr = polygonAreaCentroid(r.polygonM);
      if (!relClose(gr.area, r.areaM2) || dist(gr.centroid, r.ceM) > TOL.posM) err("sail-area", `${p}.reefs[${k}]`, "area or CE disagrees with its polygon");
    });
    const cf = s.coeffs;
    if (cf.alphaDeg.length !== cf.cl.length || cf.alphaDeg.length !== cf.cd.length || !increasing(cf.alphaDeg)) err("coeff-shape", `${p}.coeffs`, "alphaDeg, cl and cd must be the same length, alphaDeg increasing");
  });

  // appendage-area: a trapezoid's ½(cr + ct)·span
  c.appendages.forEach((a, i) => {
    const want = 0.5 * (a.rootChordM + a.tipChordM) * a.spanM;
    if (!relClose(want, a.areaM2)) err("appendage-area", `$.appendages[${i}].areaM2`, `½(root + tip)·span is ${want}, not ${a.areaM2}`);
  });

  // unknown-sail: every reference to a sail names one in sails[]
  c.sets.forEach((s, i) => s.sails.forEach((id) => sailIds.has(id) || err("unknown-sail", `$.sets[${i}].sails`, `no sail "${id}"`)));
  c.sets.forEach((s, i) => {
    const t = s.trimmed;
    if (!t) return;
    const n = t.betaDeg.length;
    if (!increasing(t.betaDeg) || t.cl.length !== n || t.cdv.length !== n || Object.values(t.sheetsDeg).some((v) => v.length !== n)) err("table-shape", `$.sets[${i}].trimmed`, "cl, cdv and each sheet must be one per β, β increasing");
    for (const id of Object.keys(t.sheetsDeg)) if (!s.sails.includes(id)) err("unknown-sail", `$.sets[${i}].trimmed.sheetsDeg`, `"${id}" isn't in the set`);
  });
  c.hardpoints.jibLeads.forEach((l, i) => sailIds.has(l.sail) || err("unknown-sail", `$.hardpoints.jibLeads[${i}]`, `no sail "${l.sail}"`));
  c.hardpoints.halyardExits.forEach((l, i) => sailIds.has(l.sail) || err("unknown-sail", `$.hardpoints.halyardExits[${i}]`, `no sail "${l.sail}"`));
  const pts = [...c.predicted.points, ...c.predicted.beat, ...c.predicted.run, ...(c.predicted.reference ? [c.predicted.reference] : [])];
  pts.forEach((p, i) => Object.keys(p.sheetsDeg).forEach((id) => sailIds.has(id) || err("unknown-sail", `$.predicted (point ${i}).sheetsDeg`, `no sail "${id}"`)));
  const setIds = new Set(c.sets.map((s) => s.id));
  pts.forEach((p, i) => p.ok && !setIds.has(p.set) && err("unknown-set", `$.predicted (point ${i}).set`, `no sail set "${p.set}"`));

  // unknown-hardpoint: loads name only chainplates that exist
  if (c.loads) {
    const ids = new Set(c.hardpoints.chainplates.map((x) => x.id));
    for (const k of Object.keys(c.loads.chainplatesN)) if (!ids.has(k)) err("unknown-hardpoint", "$.loads.chainplatesN", `no chainplate "${k}"`);
  }

  // table-shape: the resistance and righting tables are complete grids on increasing axes
  const R = c.resistance;
  const nv = R.speedsMs.length, nh = R.heelsDeg.length;
  const gridOk = (g) => g.length === nh && g.every((row) => row.length === nv);
  const rowOk = (r) => r.length === nv;
  if (!increasing(R.speedsMs) || !increasing(R.heelsDeg) || !gridOk(R.hullN) || !gridOk(R.frictionN) || !gridOk(R.heelResiduaryN) || ![R.residuaryN, R.planingN, R.planingWeight, R.appendagesN, R.regime].every(rowOk) || (R.fn && !rowOk(R.fn)))
    err("table-shape", "$.resistance", "every table must be heels × speeds (or one per speed), on increasing axes");
  if (R.status === "computed" && nv === 0) err("table-shape", "$.resistance", "a computed table has no speeds");
  const rt = L.righting;
  if (!increasing(rt.heelsDeg) || rt.boatNm.length !== rt.heelsDeg.length || rt.crewNm.length !== rt.heelsDeg.length || (rt.wettedAreaM2 && rt.wettedAreaM2.length !== rt.heelsDeg.length))
    err("table-shape", "$.loading.righting", "boatNm, crewNm and wettedAreaM2 must be one per heel, heels increasing");

  // predicted-speed: a point with no equilibrium, or beyond the model, states no speed
  pts.forEach((p, i) => {
    if ((!p.ok || p.flags.some((f) => f.id === "beyond")) && p.speedMs != null) err("predicted-speed", `$.predicted (point ${i}).speedMs`, "a point with no equilibrium or beyond the model must have speedMs null");
    const hollow = p.flags.some((f) => f.id !== "dsyhs");
    if (hollow !== p.hollow) err("predicted-speed", `$.predicted (point ${i}).hollow`, "hollow is true exactly when a flag other than dsyhs is set");
  });
  if (c.predicted.status === "computed" && c.predicted.points.length === 0) err("predicted-speed", "$.predicted", "a computed prediction has no points");

  return errors;
}

/** Both stages. */
export function validate(c) {
  const s = validateStructure(c);
  if (s.length) return { ok: false, stage: "structural", errors: s };
  const m = validateSemantics(c);
  if (m.length) return { ok: false, stage: "semantic", errors: m };
  return { ok: true, stage: null, errors: [] };
}

/** One line per error, for messages. */
export const errorText = (r) => r.errors.map((e) => `${e.code} at ${e.path}: ${e.message}`).join("; ");
