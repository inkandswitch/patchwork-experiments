// The flow itself: an analytic, incompressible, irrotational (potential) flow
// built by superposing a uniform stream and a handful of singularities.
// Pure — no DOM, no automerge. Everything is in the document's frame:
// x east, y north, z up, metres, m/s.
//
//   uniform stream   V = U d,  d = (cos h, sin h, 0), h = freestream.headingDeg
//                    (the direction the stream flows TOWARD, counter-clockwise from +x)
//   source (m)       V = +m / (4π r²) r̂          m = volume flux, m³/s
//   sink   (m)       V = −m / (4π r²) r̂
//   doublet (S)      φ = S/(4π) (d·r)/r³          axis along the stream; in a stream
//                                                  of speed U it makes a sphere of
//                                                  radius (S / 2πU)^⅓
//   vortex-line (Γ)  an infinite vertical line vortex, V = Γ/(2πρ²) (−Δy, Δx, 0)
//                                                  (Γ > 0 turns counter-clockwise
//                                                  seen from above), m²/s
//
// Every one of these is divergence-free away from its own singularity, so the
// sum is too.

export const KINDS = Object.freeze(["source", "sink", "doublet", "vortex-line"]);

export const KIND_LABELS = Object.freeze({
  source: "Source",
  sink: "Sink",
  doublet: "Doublet",
  "vortex-line": "Line vortex",
});

/** Units of `strength` per kind, for labels. */
export const STRENGTH_UNITS = Object.freeze({
  source: "m³/s",
  sink: "m³/s",
  doublet: "m⁴/s",
  "vortex-line": "m²/s",
});

const FOUR_PI = 4 * Math.PI;
const TWO_PI = 2 * Math.PI;

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const vec3 = (v, d = [0, 0, 0]) =>
  Array.isArray(v) || ArrayBuffer.isView(v) ? [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])] : [...d];

export const DEFAULT_DOMAIN = Object.freeze({ min: [-6, -6, -4], max: [16, 6, 4] });

/** Normalised domain box: finite, min < max on every axis. */
export function normalizeDomain(domain) {
  const a = vec3(domain?.min, DEFAULT_DOMAIN.min);
  const b = vec3(domain?.max, DEFAULT_DOMAIN.max);
  const min = [0, 0, 0];
  const max = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(a[k], b[k]);
    max[k] = Math.max(a[k], b[k]);
    if (max[k] - min[k] < 1e-6) max[k] = min[k] + 1;
  }
  return { min, max };
}

/** Unit vector the stream flows toward. */
export function headingVector(headingDeg) {
  const h = (num(headingDeg) * Math.PI) / 180;
  return [Math.cos(h), Math.sin(h), 0];
}

/**
 * Compile a (possibly partial or foreign) doc into a flat, fast field.
 * Unknown kinds and non-finite numbers are dropped, not thrown on.
 */
export function compileField(doc) {
  const U = Math.max(0, num(doc?.freestream?.speed, 0));
  const d = headingVector(doc?.freestream?.headingDeg);
  const elements = [];
  const ids = Object.keys(doc?.elements ?? {}).sort();
  for (const id of ids) {
    const e = doc.elements[id];
    if (!e || !KINDS.includes(e.kind)) continue;
    const s = num(e.strength, NaN);
    if (!Number.isFinite(s)) continue;
    const [x, y, z] = vec3(e.position);
    elements.push({ id, kind: e.kind, x, y, z, s });
  }
  return { U, dx: d[0], dy: d[1], elements, domain: normalizeDomain(doc?.domain) };
}

/** Reference speed for Cp: the freestream, or 1 m/s when there is none. */
export function referenceSpeed(field) {
  return field.U > 1e-9 ? field.U : 1;
}

/**
 * Velocity at (x, y, z), written into `out` (returned). Evaluating exactly on
 * a singularity contributes nothing from that element rather than Infinity.
 */
export function velocityAt(field, x, y, z, out = [0, 0, 0]) {
  const { U, dx, dy } = field;
  let u = U * dx;
  let v = U * dy;
  let w = 0;
  const els = field.elements;
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    const rx = x - e.x;
    const ry = y - e.y;
    if (e.kind === "vortex-line") {
      const r2 = rx * rx + ry * ry;
      if (r2 < 1e-18) continue;
      const k = e.s / (TWO_PI * r2);
      u += -k * ry;
      v += k * rx;
      continue;
    }
    const rz = z - e.z;
    const r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < 1e-18) continue;
    const r = Math.sqrt(r2);
    if (e.kind === "doublet") {
      // ∇[ K (d·r)/r³ ] = K [ d/r³ − 3 (d·r) r / r⁵ ]
      const K = e.s / FOUR_PI;
      const r3 = r2 * r;
      const dr = dx * rx + dy * ry;
      const a = (3 * dr) / (r3 * r2);
      u += K * (dx / r3 - a * rx);
      v += K * (dy / r3 - a * ry);
      w += K * (-a * rz);
      continue;
    }
    const m = e.kind === "sink" ? -e.s : e.s;
    const k = m / (FOUR_PI * r2 * r);
    u += k * rx;
    v += k * ry;
    w += k * rz;
  }
  out[0] = u;
  out[1] = v;
  out[2] = w;
  // a linked body (body.js), derived from a section of another doc: it adds
  // its own induced velocity on top
  if (field.body) field.body.add(x, y, z, out);
  return out;
}

const scratch = [0, 0, 0];

export function speedAt(field, x, y, z) {
  const V = velocityAt(field, x, y, z, scratch);
  return Math.hypot(V[0], V[1], V[2]);
}

/** Pressure coefficient Cp = 1 − (|V| / U)², from steady Bernoulli. */
export function cpFromSpeed(field, speed) {
  const r = speed / referenceSpeed(field);
  return 1 - r * r;
}

export function cpAt(field, x, y, z) {
  return cpFromSpeed(field, speedAt(field, x, y, z));
}

/**
 * Velocity potential φ (up to a constant). Vortex lines are multivalued, so
 * they're left out — φ is for tests and for anyone who wants equipotentials
 * of the irrotational part.
 */
export function potentialAt(field, x, y, z) {
  const { U, dx, dy } = field;
  let phi = U * (dx * x + dy * y);
  for (const e of field.elements) {
    const rx = x - e.x;
    const ry = y - e.y;
    const rz = z - e.z;
    const r = Math.hypot(rx, ry, rz);
    if (r < 1e-9) continue;
    if (e.kind === "source") phi += -e.s / (FOUR_PI * r);
    else if (e.kind === "sink") phi += e.s / (FOUR_PI * r);
    else if (e.kind === "doublet") phi += ((e.s / FOUR_PI) * (dx * rx + dy * ry)) / (r * r * r);
  }
  return phi;
}

/** The net volume flux the point singularities add (sources − sinks), m³/s. */
export function netFlux(field) {
  let q = 0;
  for (const e of field.elements) {
    if (e.kind === "source") q += e.s;
    else if (e.kind === "sink") q -= e.s;
  }
  return q;
}

/** Signed volume flux of a point element: > 0 emits fluid. 0 for non-point kinds. */
export function emission(e) {
  if (e.kind === "source") return e.s;
  if (e.kind === "sink") return -e.s;
  return 0;
}
