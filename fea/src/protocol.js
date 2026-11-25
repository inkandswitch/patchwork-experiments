// The documents a study, its runs and a daemon share, and every write either
// side makes to them. Pure functions over plain objects (an automerge doc
// inside a change() is one), so the tool and the daemon run the same code
// and the tests prove the protocol without a network. The shape is
// openfoam's (its src/protocol.js), copied: packages never import each other.
//
// Four kinds of document:
//
//   fea-study    the person's: the part link, the setup, the server, the runs
//                it has made. Only people write it.
//   fea-part     the part as the study keeps it (src/part/kept.js). Written
//                whole when the part is read; never changed after.
//   fea-run      one analysis: the setup and the part FROZEN at the moment it
//                was asked for, then the daemon's progress and results.
//                People write only `control` (cancel).
//   fea-server   a daemon's inbox and status. People add `requests`; the
//                daemon writes everything else.
//
// Who writes what never overlaps, so concurrent edits never conflict:
//
//   study     ← people
//   run       ← people: control.cancel    daemon: status, daemon, stages,
//                                          mesh, summary, layers, recipe,
//                                          notes, error, startedAt, finishedAt
//   server    ← people: requests[id]      daemon: daemon, handled[id], active[id]

import { ANALYSES } from "./setup.js";

export const STUDY_TYPE = "fea-study";
export const RUN_TYPE = "fea-run";
export const SERVER_TYPE = "fea-server";
export const LAYER_TYPE = "fea-layer";
export const PROTOCOL_VERSION = 1;

/** A daemon is online if it beat within this long. */
export const HEARTBEAT_MS = 20_000;
export const ONLINE_MS = 75_000;

/** Run statuses. Terminal: done, failed, cancelled. */
export const STATUSES = Object.freeze(["queued", "meshing", "solving", "post", "done", "failed", "cancelled"]);
export const TERMINAL = Object.freeze(["done", "failed", "cancelled"]);
export const isTerminal = (status) => TERMINAL.includes(status);

/** The stages a run goes through, in order, and the status the run has during each. */
export const STAGES = Object.freeze([
  { id: "prepare", label: "Read the part", status: "meshing" },
  { id: "mesh", label: "Mesh it (gmsh)", status: "meshing" },
  { id: "deck", label: "Supports, loads and the solver's input", status: "meshing" },
  { id: "solve", label: "Solve (CalculiX)", status: "solving" },
  { id: "results", label: "Read the results", status: "post" },
]);

/** The id a run's request goes under in a server's inbox: its document id. */
export const requestIdOf = (runUrl) => String(runUrl).replace(/^automerge:/, "");

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
 * @param {string} o.serverUrl
 * @param {object} o.setup      normalised
 * @param {object} o.part       the kept part (src/part/kept.js encodePart; its bytes inline or as segment refs)
 * @param {string} [o.by]       who asked (a name, for the queue)
 * @param {number} o.now
 * @param {{ tool: string, version: string }} [o.made]   the tool that asked
 *
 * The daemon adds `daemon` (where and with what it ran), `mesh` (what gmsh
 * made), `recipe` (the solver's input, less its node and element lists, and a
 * digest of the whole), `summary` (the figures) and `layers` (links to the
 * drawn results).
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
    control: { cancel: false },
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

/** People: ask the daemon to stop this run. */
export function requestStop(run) {
  if (!run.control) run.control = { cancel: false };
  run.control.cancel = true;
}

// ---------------------------------------------------------------- server

/** A fresh server doc (the daemon makes it). */
export function newServer({ title, daemon }) {
  return {
    "@patchwork": { type: SERVER_TYPE },
    title,
    protocol: PROTOCOL_VERSION,
    daemon,
    requests: {},
    handled: {},
    active: {}, // request id → { run, since }: what runs now (up to the daemon's --jobs)
  };
}

/** People: put a run in a server's queue (inside a change on the server doc). */
export function enqueue(server, runUrl, { now, by = null }) {
  if (!server.requests) server.requests = {};
  server.requests[requestIdOf(runUrl)] = { run: runUrl, at: now, by };
}

/**
 * The requests a daemon has yet to take, oldest first. A request is taken
 * once it is in `handled`, so a daemon that restarts never runs one twice.
 */
export function pendingRequests(server) {
  const handled = server?.handled ?? {};
  return Object.entries(server?.requests ?? {})
    .filter(([id, r]) => !handled[id] && typeof r?.run === "string")
    .map(([id, r]) => ({ id, run: r.run, at: Number(r.at) || 0, by: r.by ?? null }))
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** What runs now: [{ id, run, since }]. */
export function activeRuns(server) {
  const a = server?.active;
  if (!a || typeof a !== "object") return [];
  return Object.entries(a)
    .filter(([, v]) => typeof v?.run === "string")
    .map(([id, v]) => ({ id, run: v.run, since: Number(v.since) || 0 }));
}

/** The queue as people see it: what runs, then what waits, oldest first. */
export function queueView(server) {
  const active = activeRuns(server);
  const running = new Set(active.map((r) => r.id));
  return { active, waiting: pendingRequests(server).filter((r) => !running.has(r.id)) };
}

/** Is the daemon behind this server doc alive? */
export function daemonOnline(server, now) {
  const hb = Number(server?.daemon?.heartbeat);
  return Number.isFinite(hb) && now - hb < ONLINE_MS;
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
