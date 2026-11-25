// A study's setup: what its next run will be. Plain data, with every
// quantity kept as it was given (src/units.js):
//
//   { analysis: "static" | "modal",
//     material: { name, E, nu, density, yield },          E, density, yield: quantities; yield may be null
//     supports: { [id]: { name, kind: "fixed" | "slide", faces: number[] } },
//     loads:    { [id]: { name, kind: "force", faces, magnitude, direction: [x, y, z] }
//                     | { name, kind: "pressure", faces, pressure }
//                     | { name, kind: "gravity", acceleration, direction } },
//     mesh: { size: "coarse" | "medium" | "fine" | a length, order: 1 | 2 },
//     modes: 6, cores: 0 }
//
// Supports and loads are maps, keyed by an id that sorts by when it was made,
// so two people adding one each never collide and a list reads in the order
// things were added. `faces` are face numbers of the part the study keeps
// (src/part/kept.js). Directions are in the part's own frame, the scene's: y
// is up.
//
// Both the tool and the daemon read a setup through normalizeSetup, which
// fills what is missing and drops what it can't read; setupProblems lists
// what that changed, and readiness says what still stands between a setup
// and a run.

import { isQuantity, toSI, format, parseQuantity } from "./units.js";
import { materialFromList, DEFAULT_MATERIAL } from "./materials.js";

export const ANALYSES = Object.freeze([
  { id: "static", label: "Static: stress and deflection under the loads" },
  { id: "modal", label: "Modal: the ways it vibrates, and their frequencies" },
]);
export const SUPPORT_KINDS = Object.freeze([
  { id: "fixed", label: "Fixed", blurb: "held in every direction, as if welded to something that can't move" },
  { id: "slide", label: "Sliding", blurb: "can't move into or off its face, but slides along it: a flat face only. Also a mirror plane of a symmetric part" },
]);
export const LOAD_KINDS = Object.freeze([
  { id: "force", label: "Force", blurb: "a total force, spread evenly over the faces" },
  { id: "pressure", label: "Pressure", blurb: "pushes square onto the faces everywhere, round a curve too" },
  { id: "gravity", label: "Gravity", blurb: "the part's own weight" },
]);
export const MESH_PRESETS = Object.freeze(["coarse", "medium", "fine"]);
/** How much finer each preset is than coarse, and how many elements it puts round a full circle. */
const PRESET = Object.freeze({ coarse: { finer: 1, round: 12 }, medium: { finer: 1.5, round: 16 }, fine: { finer: 2.25, round: 24 } });
export const MAX_MODES = 40;

/** An id for a new support or load: sorts by time, then by chance. */
export function newId(now = Date.now(), random = Math.random()) {
  return `${Math.floor(now).toString(36).padStart(9, "0")}${Math.floor(random * 46656).toString(36).padStart(3, "0")}`;
}

export function defaultSetup() {
  return {
    analysis: "static",
    material: materialFromList(DEFAULT_MATERIAL),
    supports: {},
    loads: {},
    mesh: { size: "coarse", order: 2 },
    modes: 6,
    cores: 0,
  };
}

const DOWN = Object.freeze([0, -1, 0]);

/** A new support or load of a kind, with what it needs filled in (faces empty). */
export function newSupport(kind = "fixed", name = null) {
  return { name: name ?? (kind === "slide" ? "Sliding support" : "Fixed support"), kind: kind === "slide" ? "slide" : "fixed", faces: [] };
}
export function newLoad(kind = "force", name = null) {
  if (kind === "pressure") return { name: name ?? "Pressure", kind, faces: [], pressure: { value: 1, unit: "MPa" } };
  if (kind === "gravity") return { name: name ?? "Gravity", kind, acceleration: { value: 1, unit: "g" }, direction: [...DOWN] };
  return { name: name ?? "Force", kind: "force", faces: [], magnitude: { value: 100, unit: "N" }, direction: [...DOWN] };
}

const isVector = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const faceList = (v) => (Array.isArray(v) ? [...new Set(v.filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b) : []);
const text = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : fallback);

/**
 * A setup with everything in place, and what had to be changed to get there.
 * @returns {{ setup: object, changed: string[] }}
 */
function normalize(raw) {
  const d = defaultSetup();
  const changed = [];
  const r = raw && typeof raw === "object" ? raw : {};
  const out = { ...d };
  const note = (what) => changed.push(what);

  if (ANALYSES.some((a) => a.id === r.analysis)) out.analysis = r.analysis;
  else if (r.analysis !== undefined) note(`the analysis “${r.analysis}” isn't one this does: static is used`);

  const m = r.material && typeof r.material === "object" ? r.material : null;
  if (!m) {
    if (r.material !== undefined) note("the material couldn't be read: the default is used");
  } else {
    out.material = { ...d.material, name: text(m.name, "Custom material") };
    for (const [key, dimension, label] of [["E", "pressure", "Young's modulus"], ["density", "density", "density"]]) {
      if (isQuantity(m[key], dimension) && m[key].value > 0) out.material[key] = { value: m[key].value, unit: m[key].unit };
      else note(`the material's ${label} must be a positive value with its unit: ${format(d.material[key])} is used`);
    }
    if (Number.isFinite(m.nu) && m.nu > -1 && m.nu < 0.5) out.material.nu = m.nu;
    else note(`Poisson's ratio must be between −1 and 0.5: ${d.material.nu} is used`);
    if (m.yield == null) out.material.yield = null;
    else if (isQuantity(m.yield, "pressure") && m.yield.value > 0) out.material.yield = { value: m.yield.value, unit: m.yield.unit };
    else {
      out.material.yield = null;
      note("the yield strength must be a positive value with its unit, or none: none is used");
    }
  }

  out.supports = {};
  for (const [id, s] of Object.entries(r.supports && typeof r.supports === "object" ? r.supports : {})) {
    if (!s || typeof s !== "object") continue;
    const kind = SUPPORT_KINDS.some((k) => k.id === s.kind) ? s.kind : "fixed";
    if (kind !== s.kind) note(`the support “${text(s.name, id)}” has a kind this doesn't know: it is taken as fixed`);
    out.supports[id] = { name: text(s.name, kind === "slide" ? "Sliding support" : "Fixed support"), kind, faces: faceList(s.faces) };
  }

  out.loads = {};
  for (const [id, l] of Object.entries(r.loads && typeof r.loads === "object" ? r.loads : {})) {
    if (!l || typeof l !== "object") continue;
    const name = text(l.name, id);
    if (l.kind === "force") {
      const base = newLoad("force");
      const load = { name: text(l.name, base.name), kind: "force", faces: faceList(l.faces), magnitude: base.magnitude, direction: base.direction };
      if (isQuantity(l.magnitude, "force") && l.magnitude.value >= 0) load.magnitude = { value: l.magnitude.value, unit: l.magnitude.unit };
      else note(`the force “${name}” needs a size with its unit, not negative (turn its direction instead): ${format(base.magnitude)} is used`);
      if (isVector(l.direction) && Math.hypot(...l.direction) > 0) load.direction = [...l.direction];
      else note(`the force “${name}” needs a direction: down is used`);
      out.loads[id] = load;
    } else if (l.kind === "pressure") {
      const base = newLoad("pressure");
      const load = { name: text(l.name, base.name), kind: "pressure", faces: faceList(l.faces), pressure: base.pressure };
      if (isQuantity(l.pressure, "pressure")) load.pressure = { value: l.pressure.value, unit: l.pressure.unit };
      else note(`the pressure “${name}” needs a value with its unit: ${format(base.pressure)} is used`);
      out.loads[id] = load;
    } else if (l.kind === "gravity") {
      const base = newLoad("gravity");
      const load = { name: text(l.name, base.name), kind: "gravity", acceleration: base.acceleration, direction: base.direction };
      if (isQuantity(l.acceleration, "acceleration") && l.acceleration.value >= 0) load.acceleration = { value: l.acceleration.value, unit: l.acceleration.unit };
      else note(`gravity “${name}” needs an acceleration with its unit: ${format(base.acceleration)} is used`);
      if (isVector(l.direction) && Math.hypot(...l.direction) > 0) load.direction = [...l.direction];
      else note(`gravity “${name}” needs a direction: down is used`);
      out.loads[id] = load;
    } else note(`the load “${name}” has a kind this doesn't know: it is left out`);
  }

  const mesh = r.mesh && typeof r.mesh === "object" ? r.mesh : {};
  out.mesh = { size: d.mesh.size, order: mesh.order === 1 ? 1 : 2 };
  if (MESH_PRESETS.includes(mesh.size)) out.mesh.size = mesh.size;
  else if (isQuantity(mesh.size, "length") && mesh.size.value > 0) out.mesh.size = { value: mesh.size.value, unit: mesh.size.unit };
  else if (mesh.size !== undefined) note("the mesh size must be coarse, medium, fine or a length: coarse is used");
  if (mesh.order !== undefined && mesh.order !== 1 && mesh.order !== 2) note("the element order must be 1 or 2: 2 is used");

  if (Number.isInteger(r.modes) && r.modes >= 1 && r.modes <= MAX_MODES) out.modes = r.modes;
  else if (r.modes !== undefined) note(`the number of modes must be a whole number from 1 to ${MAX_MODES}: ${d.modes} is used`);
  if (Number.isInteger(r.cores) && r.cores >= 0 && r.cores <= 256) out.cores = r.cores;
  else if (r.cores !== undefined) note("the cores must be a whole number (0: the server's choice): 0 is used");
  return { setup: out, changed };
}

export const normalizeSetup = (raw) => normalize(raw).setup;
/** What normalizeSetup changed: said under the setup until what it names is put right. */
export const setupProblems = (raw) => normalize(raw).changed;

/** A setup's supports or loads as a list, in the order they were made: [{ id, ...fields }]. */
export const listOf = (map) =>
  Object.keys(map ?? {})
    .sort()
    .map((id) => ({ id, ...map[id] }));

// ---------------------------------------------------------------- the mesh

/**
 * The element size a setup asks for on a part, in metres. A preset follows
 * the part: about its thinnest dimension (twice its volume over its skin, a
 * plate's thickness), but never coarser than a twelfth of its length nor,
 * for a sliver, finer than a sixtieth.
 */
export function elementSize(setup, part) {
  const size = setup.mesh.size;
  if (typeof size !== "string") return toSI(size, "length");
  const D = part.diagonal;
  const thin = part.area > 0 ? (2 * part.volume) / part.area : D / 12;
  const coarse = Math.max(Math.min(D / 12, thin), D / 60);
  return coarse / PRESET[size].finer;
}

/**
 * Round faces that want smaller elements than the rest, so a hole is a ring
 * of them and not a square: [{ face, size }], sizes in metres.
 */
export function finerFaces(setup, part) {
  const h = elementSize(setup, part);
  const round = PRESET[typeof setup.mesh.size === "string" ? setup.mesh.size : "medium"].round;
  const out = [];
  for (const f of part.faces) {
    if (!(f.radius > 0)) continue;
    const s = (2 * Math.PI * f.radius) / round;
    if (s < h * 0.95) out.push({ face: f.id, size: s });
  }
  return out;
}

/**
 * About how big the mesh will be. Tetrahedra fill the volume at the element
 * size, and never fewer than line the skin; a ten-node one brings about 1.6
 * nodes with it, a four-node one a quarter of one. (Measured on a beam, a
 * plate with a hole and a bracket: within a third. Fine round faces add
 * more than this counts.)
 * @returns {{ size: number, elements: number, nodes: number, unknowns: number }}
 */
export function meshEstimate(setup, part) {
  const h = elementSize(setup, part);
  const elements = Math.max(11 * (part.volume / h ** 3), 2.5 * (part.area / h ** 2));
  const nodes = elements * (setup.mesh.order === 1 ? 0.25 : 1.6);
  return { size: h, elements: Math.round(elements), nodes: Math.round(nodes), unknowns: Math.round(nodes) * 3 };
}

// ---------------------------------------------------------------- can it run?

/**
 * What stands between this setup and a run on this part: each a sentence
 * saying what to do. Empty: it can run.
 * @param {object} setup   normalised
 * @param {{ solid: boolean, problems: string[], faces: { id: number, flat: boolean }[] } | null} part
 * @returns {{ blocking: string[], warnings: string[] }}
 */
export function readiness(setup, part) {
  const blocking = [];
  const warnings = [];
  if (!part) {
    blocking.push("link a part");
    return { blocking, warnings };
  }
  if (!part.solid) blocking.push(`the part can't be meshed: ${part.problems.join("; ")}`);
  const known = new Set(part.faces.map((f) => f.id));
  const flat = new Set(part.faces.filter((f) => f.flat).map((f) => f.id));
  const supports = listOf(setup.supports), loads = listOf(setup.loads);
  for (const s of supports) {
    const gone = s.faces.filter((f) => !known.has(f));
    if (gone.length) blocking.push(`the support “${s.name}” is on ${gone.length === 1 ? "a face" : "faces"} the part doesn't have: pick ${gone.length === 1 ? "it" : "them"} again`);
    else if (!s.faces.length) blocking.push(`pick the faces the support “${s.name}” holds`);
    else if (s.kind === "slide" && s.faces.some((f) => !flat.has(f))) blocking.push(`the sliding support “${s.name}” needs flat faces: it is on a curved one`);
  }
  for (const l of loads) {
    if (l.kind === "gravity") continue;
    const gone = l.faces.filter((f) => !known.has(f));
    if (gone.length) blocking.push(`the load “${l.name}” is on ${gone.length === 1 ? "a face" : "faces"} the part doesn't have: pick ${gone.length === 1 ? "it" : "them"} again`);
    else if (!l.faces.length) blocking.push(`pick the faces the load “${l.name}” acts on`);
  }
  if (setup.analysis === "static") {
    if (!supports.length) blocking.push("add a support: with nothing holding it, the part would simply move away");
    else if (!supports.some((s) => s.kind === "fixed")) warnings.push("only sliding supports hold the part: between them they must stop it moving and turning every way, or the answer means nothing");
    if (!loads.length) blocking.push("add a load: with nothing pushing on it, nothing happens");
    const held = new Set(supports.flatMap((s) => s.faces));
    for (const l of loads) if (l.kind !== "gravity" && l.faces.length && l.faces.every((f) => held.has(f) && supports.some((s) => s.kind === "fixed" && s.faces.includes(f)))) warnings.push(`the load “${l.name}” is only on fixed faces, which can't move: it does nothing`);
  } else if (loads.length) warnings.push("a modal analysis takes no account of the loads: it finds how the part rings on its own");
  if (!setup.material.yield && setup.analysis === "static") warnings.push("the material has no yield strength, so no safety factor can be given");
  return { blocking, warnings };
}

// ---------------------------------------------------------------- for the solver

/**
 * The setup as the solver takes it: SI numbers, lists, vectors.
 * @returns {{ analysis: { kind: "static" } | { kind: "modal", modes: number },
 *   material: { E: number, nu: number, density: number, yield: number|null },
 *   supports: object[], loads: object[], size: number, order: 1|2, finer: { face: number, size: number }[] }}
 */
export function solverModel(setup, part) {
  const unit = (v) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  return {
    analysis: setup.analysis === "modal" ? { kind: "modal", modes: setup.modes } : { kind: "static" },
    material: {
      E: toSI(setup.material.E, "pressure"),
      nu: setup.material.nu,
      density: toSI(setup.material.density, "density"),
      yield: setup.material.yield ? toSI(setup.material.yield, "pressure") : null,
    },
    supports: listOf(setup.supports).map((s) => ({ id: s.id, name: s.name, kind: s.kind, faces: s.faces })),
    loads: listOf(setup.loads).map((l) => {
      if (l.kind === "pressure") return { id: l.id, name: l.name, kind: "pressure", faces: l.faces, pressure: toSI(l.pressure, "pressure") };
      if (l.kind === "gravity") return { id: l.id, name: l.name, kind: "gravity", acceleration: unit(l.direction).map((x) => x * toSI(l.acceleration, "acceleration")) };
      return { id: l.id, name: l.name, kind: "force", faces: l.faces, force: unit(l.direction).map((x) => x * toSI(l.magnitude, "force")) };
    }),
    size: elementSize(setup, part),
    order: setup.mesh.order,
    finer: finerFaces(setup, part),
  };
}

/** "2 kN down on 1 face", for a list and a title. */
export function describeLoad(load) {
  const on = load.faces ? ` on ${load.faces.length} face${load.faces.length === 1 ? "" : "s"}` : "";
  if (load.kind === "pressure") return `${format(load.pressure)}${on}`;
  if (load.kind === "gravity") return `${format(load.acceleration)} ${directionWord(load.direction)}`;
  return `${format(load.magnitude)} ${directionWord(load.direction)}${on}`;
}

/** A direction in words: "down", "along +x", or its numbers. */
export function directionWord(v) {
  const l = Math.hypot(...v) || 1;
  const u = v.map((x) => x / l);
  const names = [["+x", "−x"], ["up", "down"], ["+z", "−z"]];
  for (let k = 0; k < 3; k++) if (Math.abs(u[k]) > 0.9995) return k === 1 ? names[k][u[k] > 0 ? 0 : 1] : `along ${names[k][u[k] > 0 ? 0 : 1]}`;
  return `along (${u.map((x) => Number(x.toFixed(3))).join(", ")})`;
}

/** A quantity from a form or an agent, or a sentence saying what's wrong with it. */
export function readQuantity(input, dimension, what) {
  const q = parseQuantity(input, dimension);
  return q ? { ok: true, value: q } : { ok: false, error: `${what} needs a value with its unit (like “${EXAMPLE[dimension]}”), not ${JSON.stringify(input)}` };
}
const EXAMPLE = { force: "250 N", pressure: "2 MPa", length: "3 mm", density: "2700 kg/m³", acceleration: "1 g" };
