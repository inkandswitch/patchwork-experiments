// The documents a study and its runs share, and every write anyone makes to
// them. Pure functions over plain objects (an automerge doc inside a
// change() is one), so the tool and the run's code (daemon/run-task.mjs) run
// the same code and the tests prove it without a network. The shape is
// openfoam's (its src/protocol.js), copied: packages never import each other.
//
// Three kinds of document of this package's own:
//
//   fea-study    the person's: the part link, the setup, the server (a task
//                queue: see src/task-runs.js), the runs it has made. Only
//                people write it.
//   fea-part     the part as the study keeps it (src/part/kept.js). Written
//                whole when the part is read; never changed after.
//   fea-run      one analysis: the setup and the part FROZEN at the moment
//                it was asked for, then the run's progress and results. It
//                is the record of the run; the task that asked a machine for
//                it says only whether a machine has it.
//
// Who writes what never overlaps, so concurrent edits never conflict:
//
//   study     ← people
//   run       ← people: task (once, when    the run's code: status, daemon,
//                        it is asked for)    stages, mesh, summary, layers,
//                                            recipe, notes, error, startedAt,
//                                            finishedAt
//
// What this file doesn't say is the kit's (src/task-runs.js): asking for a
// run, cancelling it (a stop appended to its task, never a write here), the
// status a person sees (`shownRun`, read from the run doc and its task), and
// what a stopped or interrupted run writes (`markStopped`, `markInterrupted`).

import { ANALYSES } from "./setup.js";
import { RUN_ENDED, isRunEnded } from "./task-runs.js";

export const STUDY_TYPE = "fea-study";
export const RUN_TYPE = "fea-run";
export const LAYER_TYPE = "fea-layer";
export const PROTOCOL_VERSION = 1;

/** Run statuses: queued, this package's working ones, and the endings the kit reads (src/task-runs.js RUN_ENDED). */
export const STATUSES = Object.freeze(["queued", "meshing", "solving", "post", ...RUN_ENDED]);
/** The statuses that say a run has ended, and whether a status is one, by this package's names for the kit's. */
export const TERMINAL = RUN_ENDED;
export const isTerminal = isRunEnded;

/** The run's code: what a run's task names, within this package (src/task-runs.js codeUrl). */
export const RUN_CODE = "daemon/run-task.mjs";

/** The stages a run goes through, in order, and the status the run has during each. */
export const STAGES = Object.freeze([
  { id: "prepare", label: "Read the part", status: "meshing" },
  { id: "mesh", label: "Mesh it (gmsh)", status: "meshing" },
  { id: "deck", label: "Supports, loads and the solver's input", status: "meshing" },
  { id: "solve", label: "Solve (CalculiX)", status: "solving" },
  { id: "results", label: "Read the results", status: "post" },
]);

/** A run's id: its document id, which names its directory on the machine that ran it. */
export const runIdOf = (runUrl) => String(runUrl).replace(/^automerge:/, "");

// ---------------------------------------------------------------- study

/** Seed a new study (inside a change). */
export function initStudy(doc, setup) {
  doc.title = "FEA study";
  doc.part = null;
  doc.setup = setup;
  doc.server = null;
  doc.runs = [];
  doc.selected = null;
}

// ---------------------------------------------------------------- run

/**
 * A new run doc's contents: the setup and the part frozen as they are now.
 * @param {object} o
 * @param {string} o.studyUrl
 * @param {string} o.serverUrl  the task queue it is asked of
 * @param {object} o.setup      normalised
 * @param {object} o.part       the kept part (src/part/kept.js encodePart; its bytes inline or as segment refs)
 * @param {string} [o.by]       who asked (a name)
 * @param {number} o.now
 * @param {{ tool: string, version: string }} [o.made]   the tool that asked
 *
 * The asker adds `task` once it has asked. The run's code adds `daemon`
 * (where and with what it ran), `mesh` (what gmsh made), `recipe` (the
 * solver's input, less its node and element lists, and a digest of the
 * whole), `summary` (the figures) and `layers` (links to the drawn results).
 */
export function newRun({ studyUrl, serverUrl, setup, part, by = null, now, title, made = null }) {
  return {
    "@patchwork": { type: RUN_TYPE },
    title: title ?? runTitle(setup, part?.title),
    protocol: PROTOCOL_VERSION,
    study: studyUrl,
    server: serverUrl,
    requestedAt: now,
    requestedBy: by,
    setup,
    part,
    made,
    recipe: null,
    status: "queued",
    task: null,
    daemon: null,
    stages: STAGES.map((s) => ({ id: s.id, label: s.label, status: "pending", startedAt: null, endedAt: null, note: null, tail: null })),
    mesh: null,
    summary: null,
    layers: {},
    notes: [],
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

export function runTitle(setup, partTitle) {
  const what = ANALYSES.find((a) => a.id === setup.analysis)?.id ?? "static";
  const size = typeof setup.mesh.size === "string" ? setup.mesh.size : `${setup.mesh.size.value} ${setup.mesh.size.unit}`;
  return `${partTitle ? `${partTitle} · ` : ""}${what} · ${setup.material.name} · ${size}`;
}

// ---------------------------------------------------------------- layers

/**
 * A result layer: the mesh's skin (triangles, in the part's frame, metres)
 * with fields at its points. Arrays travel as bytes in the doc.
 *   positions  Float32 xyz          indices  Uint32 triples
 *   faces      Uint32, one a triangle: the part's face it is on (0xffffffff: none)
 *   fields     Float32, one value a point, by name (FIELD_INFO; a mode's shape is m<n>x, m<n>y, m<n>z)
 */
export function encodeLayer({ name, positions, indices, faces = null, fields = {} }) {
  const bytes = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength).slice();
  const out = { "@patchwork": { type: LAYER_TYPE }, title: name, name, points: positions.length / 3, triangles: indices.length / 3, positions: bytes(Float32Array.from(positions)), indices: bytes(Uint32Array.from(indices)), fields: {}, ranges: {} };
  if (faces) out.faces = bytes(Uint32Array.from(faces));
  for (const [k, v] of Object.entries(fields)) {
    const a = Float32Array.from(v);
    out.fields[k] = bytes(a);
    let lo = Infinity, hi = -Infinity;
    for (const x of a) if (Number.isFinite(x)) { if (x < lo) lo = x; if (x > hi) hi = x; }
    out.ranges[k] = Number.isFinite(lo) ? [lo, hi] : null;
  }
  return out;
}

const f32 = (b) => (b ? new Float32Array((b instanceof Uint8Array ? b : new Uint8Array(b)).slice().buffer) : null);
const u32 = (b) => (b ? new Uint32Array((b instanceof Uint8Array ? b : new Uint8Array(b)).slice().buffer) : null);

/** A layer doc back as typed arrays (its bytes fetched first if they were segmented). */
export function decodeLayer(doc) {
  if (!doc?.positions) return null;
  const fields = {};
  for (const [k, v] of Object.entries(doc.fields ?? {})) fields[k] = f32(v);
  return { name: doc.name, positions: f32(doc.positions), indices: u32(doc.indices), faces: u32(doc.faces), fields, ranges: { ...(doc.ranges ?? {}) } };
}

/** What each field of a layer is: its name for people, and the dimension its numbers are (SI) for src/units.js. */
export const FIELD_INFO = Object.freeze({
  vm: { label: "Von Mises stress", dimension: "pressure" },
  u: { label: "Displacement", dimension: "length" },
});
