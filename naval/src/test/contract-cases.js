// The boats the contract fixtures (contract/v1/fixtures/valid) are built
// from, shared by contract.test.js and contract-fixtures.test.js. Node only
// (reads the camber GLB from disk).
//
// - the four published boats of src/fixtures (their docs as "New from…"
//   gives them; the J/24 in its ORC condition, the one its certificate polar
//   is for);
// - cuvature-kink at 12 m, floated at 8 t, with the first guess's rig: the
//   "camber hull + first guess" case sailing's agreement test asks for;
// - "minimal": the Laser with coarse tables and no polar, small enough to
//   read, and the base the invalid fixtures are mutated from.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalize, defaultDoc } from "../doc.js";
import { glbTriangles } from "../link/glb-read.js";
import { FIXTURES, fixtureDoc } from "../fixtures/index.js";
import { firstGuess, FIRST_GUESS_KEYS } from "../firstguess.js";
import { composeRig } from "../rig-build.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const CAMBER_FRAME = { bow: "+X", up: "+Y" };
export const camberBytes = (name) => new Uint8Array(readFileSync(here(`./fixtures/camber/${name}.glb`)));
export const camberLinked = (name) => ({ status: "ready", mesh: glbTriangles(camberBytes(name)), chip: name });

/** A doc linked to a camber hull, floated at a given mass. */
export function linkedDoc(kg = 8000) {
  const d = defaultDoc();
  return normalize({ ...d, title: "cuvature-kink, first guess", hull: { ...d.hull, link: { url: "automerge:cuvature-kink", frame: CAMBER_FRAME } }, loading: { ...d.loading, displacement: { from: "given", kg } } });
}

/** The first guess on cuvature-kink at 8 t, as one doc. */
export function cuvatureFirstGuess() {
  const linked = camberLinked("cuvature-kink-with-unmodified-pchip");
  const base = linkedDoc();
  const g = firstGuess(base, { linked });
  if (!g.ok) throw new Error(`first guess failed: ${g.why}`);
  const d = structuredClone(base);
  for (const k of FIRST_GUESS_KEYS) d[k] = structuredClone(g.doc[k]);
  return { doc: normalize(d), linked };
}

function publishedDoc(id, condition = null) {
  const f = FIXTURES.find((x) => x.id === id).fixture;
  const d = fixtureDoc(f);
  const c = condition && f.published.conditions?.[condition];
  if (c) d.loading = { ...d.loading, displacement: { from: "given", kg: c.displacementKg }, crew: { ...d.loading.crew, ...c.crew } };
  return normalize(d);
}

export const MINIMAL_OPTIONS = { coeffStepDeg: 15, resistanceHeels: [0, 20], resistanceFnStep: 0.25, trimmed: false };

/** Every case: { id, file, about, make() → { doc, linked, polar, options } }. */
export const CASES = [
  { id: "sloop-12m", about: "the stock 12 m sloop (sailing's SLOOP as a rig) on its synthetic hull", make: () => ({ doc: publishedDoc("sloop-12m") }) },
  { id: "catalina-30", about: "Catalina 30, standard rig, on a synthetic hull from its published dimensions", make: () => ({ doc: publishedDoc("catalina-30") }) },
  { id: "j24", about: "J/24 (fractional) in its ORC condition (1,271 kg + 340 kg crew)", make: () => ({ doc: publishedDoc("j24", "orc") }) },
  { id: "laser-ilca7", about: "Laser / ILCA 7, one 80 kg crew hiking; planes", make: () => ({ doc: publishedDoc("laser-ilca7") }) },
  { id: "cuvature-first-guess", about: "camber's cuvature-kink at 12 m floated at 8 t, with the first guess's rig (linked hull, mesh statics)", make: () => cuvatureFirstGuess() },
  { id: "minimal", about: "the Laser with coarse tables and no polar: small enough to read", make: () => ({ doc: publishedDoc("laser-ilca7"), polar: false, options: MINIMAL_OPTIONS }) },
];

const built = new Map();
/** A case's contract (memoised): { contract, n, polar, doc, linked }. */
export function buildCase(id) {
  if (built.has(id)) return built.get(id);
  const c = CASES.find((x) => x.id === id);
  const m = c.make();
  const source = m.linked ? { hull: { path: "file", heads: null, glbKey: null } } : {};
  const r = composeRig({ doc: m.doc, linked: m.linked ?? null, polar: m.polar !== false, options: m.options ?? {}, source });
  if (!r.ok) throw new Error(`${id}: ${r.why}`);
  const out = { ...r, doc: m.doc, linked: m.linked ?? null };
  built.set(id, out);
  return out;
}

/** JSON for a fixture file: numbers to 9 significant digits (§9), two-space indent. */
export function fixtureJson(contract) {
  return `${JSON.stringify(contract, (k, v) => (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(9)) : v), 2)}\n`;
}

/**
 * The invalid fixtures: each a mutation of the minimal contract, with the
 * stage it must fail at and (for a semantic one) the error code.
 */
export const INVALID = [
  { file: "missing-frame.json", stage: "structural", mutate: (c) => delete c.frame },
  { file: "unknown-field.json", stage: "structural", mutate: (c) => (c.extra = true) },
  { file: "unsupported-version.json", stage: "structural", mutate: (c) => (c.version = 2) },
  { file: "wrong-axes.json", stage: "structural", mutate: (c) => (c.frame.axes = "x-forward-y-up-z-starboard") },
  { file: "unknown-flag.json", stage: "structural", mutate: (c) => (c.predicted.reference.flags = [{ id: "capsized", text: "?" }]) },
  { file: "negative-area.json", stage: "structural", mutate: (c) => (c.sails[0].areaM2 = -1) },
  { file: "non-rotation-frame.json", stage: "semantic", error: "frame-matrix", mutate: (c) => (c.frame.glbToFrame[0] = 2) },
  { file: "mass-mismatch.json", stage: "semantic", error: "mass-sum", mutate: (c) => (c.loading.items[0].massKg += 10) },
  { file: "cg-mismatch.json", stage: "semantic", error: "mass-sum", mutate: (c) => (c.loading.cgM[2] += 0.1) },
  { file: "sail-area-mismatch.json", stage: "semantic", error: "sail-area", mutate: (c) => (c.sails[0].areaM2 *= 1.1) },
  { file: "sail-off-centreplane.json", stage: "semantic", error: "sail-plane", mutate: (c) => (c.sails[0].polygonM[1][1] = 0.2) },
  { file: "appendage-area-mismatch.json", stage: "semantic", error: "appendage-area", mutate: (c) => (c.appendages[0].areaM2 *= 2) },
  { file: "ragged-resistance.json", stage: "semantic", error: "table-shape", mutate: (c) => c.resistance.hullN[0].pop() },
  { file: "unsorted-righting.json", stage: "semantic", error: "table-shape", mutate: (c) => c.loading.righting.heelsDeg.reverse() },
  { file: "unknown-sail.json", stage: "semantic", error: "unknown-sail", mutate: (c) => c.sets[0].sails.push("jib") },
  { file: "unknown-chainplate.json", stage: "semantic", error: "unknown-hardpoint", mutate: (c) => (c.loads.chainplatesN.bowsprit = 1000) },
  { file: "duplicate-sail.json", stage: "semantic", error: "duplicate-id", mutate: (c) => c.sails.push(structuredClone(c.sails[0])) },
  { file: "beyond-with-speed.json", stage: "semantic", error: "predicted-speed", mutate: (c) => (c.predicted.reference.flags.push({ id: "beyond", text: "beyond model" }), (c.predicted.reference.hollow = true)) },
  { file: "hollow-without-flag.json", stage: "semantic", error: "predicted-speed", mutate: (c) => (c.predicted.reference.hollow = !c.predicted.reference.hollow) },
];
