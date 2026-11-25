// The documents a case and its runs share, and every write anyone makes to
// them. Pure functions over plain objects (an automerge doc inside a
// change() is one), so the tool and the run's code (daemon/run-task.mjs) run
// the same code and the tests prove it without a network.
//
// Two documents of this package's own:
//
//   openfoam-case    the user's: the hull link, the setup, the server (a
//                    task queue: see src/run-tasks.js), the runs it has made.
//                    Only people write it.
//   openfoam-run     one analysis: the setup and hull FROZEN at the moment
//                    it was asked for, then the run's progress and results.
//                    It is the record of the run; the task that asked a
//                    machine for it says only whether a machine has it.
//
// Who writes what never overlaps, so concurrent edits never conflict:
//
//   case      ← people
//   run       ← people: control.finish,     the run's code: status, daemon,
//                        task (once, when     stages, progress, mesh, summary,
//                        it is asked for)     layers, error, startedAt,
//                                             finishedAt
//
// Cancelling is not written here: it is a flag on the run's task, and the
// status a person sees is read from both (`shownRun`).

import { formatSpeed } from "./setup.js";

export const CASE_TYPE = "openfoam-case";
export const RUN_TYPE = "openfoam-run";
export const PROTOCOL_VERSION = 1;

/** Run statuses. Terminal: done, failed, cancelled. */
export const STATUSES = Object.freeze(["queued", "meshing", "solving", "post", "done", "failed", "cancelled"]);
export const TERMINAL = Object.freeze(["done", "failed", "cancelled"]);
export const isTerminal = (status) => TERMINAL.includes(status);

/**
 * The stages a run goes through, in order, by mode. Meshing on several cores
 * splits the background mesh first and meshes the pieces in parallel; on one,
 * nothing is split. (A run doc starts with the serial order; the run's code,
 * which knows its cores, rewrites the list when it starts.)
 */
export function stagesFor(mode, { parallel = false, volume = false } = {}) {
  const split = { id: "decomposePar", label: "Split for cores" };
  return [
    { id: "prepare", label: "Write the case" },
    { id: "surfaceFeatureExtract", label: "Hull features" },
    { id: "blockMesh", label: "Background mesh" },
    ...(parallel ? [split] : []),
    { id: "snappyHexMesh", label: "Mesh the hull" },
    { id: "checkMesh", label: "Check the mesh" },
    ...(mode === "free-surface" ? [{ id: "setFields", label: "Fill with water" }] : []),
    ...(parallel ? [] : [split]),
    { id: "initialise", label: "Start from a past run" },
    { id: "solve", label: mode === "free-surface" ? "Solve (interFoam, LTS)" : "Solve (simpleFoam)" },
    { id: "results", label: "Read the results" },
    ...(volume ? [{ id: "volume", label: "Keep the flow volume" }] : []),
  ];
}

/** A run's id: its document id, which names its case directory on the machine that ran it. */
export const runIdOf = (runUrl) => String(runUrl).replace(/^automerge:/, "");

// ---------------------------------------------------------------- case

/** Seed a new case (inside a change). */
export function initCase(doc, setup) {
  doc.title = "OpenFOAM case";
  doc.hull = null;
  doc.setup = setup;
  doc.server = null;
  doc.runs = [];
  doc.selected = null;
}

// ---------------------------------------------------------------- run

/**
 * A new run doc's contents: the setup and hull frozen as they are now.
 * @param {object} o
 * @param {string} o.caseUrl
 * @param {string} o.serverUrl  the task queue it is asked of
 * @param {object} o.setup     normalised setup
 * @param {object} o.hull      { stl: Uint8Array, info, source, warnings }
 * @param {string} [o.by]      who asked (a name, for the queue)
 * @param {number} o.now
 *
 * A run doc, as asked for. `hull` is everything about the hull the run uses
 * (its STL, measurements, frame, where it came from, its geometry digest);
 * `made` the tool that asked ({ tool, version }). The asker adds `task`
 * once it has asked; the run's code adds `daemon` (where and with what it
 * ran) and `recipe` (the case files it wrote): see
 * src/inputs.js for reading them back.
 * @param {{ tool: string, version: string }} [o.made]
 */
export function newRun({ caseUrl, serverUrl, setup, hull, by = null, now, title, made = null }) {
  return {
    "@patchwork": { type: RUN_TYPE },
    title: title ?? runTitle(setup, hull?.source?.title),
    protocol: PROTOCOL_VERSION,
    case: caseUrl,
    server: serverUrl,
    requestedAt: now,
    requestedBy: by,
    setup,
    hull,
    made,
    recipe: null,
    status: "queued",
    task: null,
    control: { finish: false },
    daemon: null,
    stages: stagesFor(setup.mode, { volume: setup.keepVolume }).map((s) => ({ ...s, status: "pending", startedAt: null, endedAt: null, note: null, tail: null })),
    progress: { iteration: 0, of: setup.iterations, forces: [], residuals: [] },
    mesh: null,
    summary: null,
    layers: {},
    volume: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

export function runTitle(setup, hullTitle) {
  const what = setup.mode === "free-surface" ? "free surface" : "double body";
  const heel = Math.abs(setup.attitude?.heel ?? 0) > 1e-9 ? ` · ${Math.abs(setup.attitude.heel)}° heel to ${setup.attitude.heel > 0 ? "starboard" : "port"}` : "";
  return `${hullTitle ? `${hullTitle} · ` : ""}${formatSpeed(setup.speed)}${heel} · ${what} · ${setup.mesh}`;
}

/** People: ask a solving run to finish now: the solver writes what it has, and its results are read. */
export function requestFinish(run) {
  if (!run.control) run.control = { finish: false };
  run.control.finish = true;
}

// ---------------------------------------------------------------- stopping

/** Why a run's code was told to stop (its task's signal): see daemon/run-task.mjs. */
export const STOP_REASONS = Object.freeze(["cancelled", "stopping", "yielded"]);

/** What a run doc says when the machine running it stopped mid-run. */
export const MACHINE_STOPPED = "The machine running this stopped while it ran; run it again.";
/** What a run doc says when its task is taken again after that: it is never solved twice unasked. */
export const NOT_RESTARTED = "This run was interrupted (the machine running it stopped) and was not started again, so that it isn't solved twice without anyone asking; run it again.";

/**
 * The run's code, told to stop (inside a change on the run doc): `cancelled`
 * says cancelled, `stopping` (its machine is shutting down) says failed with
 * MACHINE_STOPPED. A run that had finished and was keeping its flow volume
 * keeps its status and says the volume wasn't kept. (`yielded` writes
 * nothing: another run of the task has it.)
 */
export function markStopped(run, reason, now) {
  if (reason === "yielded") return;
  if (isTerminal(run.status)) {
    if (run.volume?.status === "posting") {
      run.volume.status = "failed";
      run.volume.error = reason === "cancelled" ? "cancelled while keeping it" : "the machine running it stopped while keeping it";
      for (const s of run.stages ?? []) if (s.id === "volume" && s.status === "running") s.status = "failed";
    }
    return;
  }
  run.status = reason === "cancelled" ? "cancelled" : "failed";
  run.error = reason === "cancelled" ? null : MACHINE_STOPPED;
  run.finishedAt = now;
  for (const s of run.stages ?? [])
    if (s.status === "running") {
      s.status = "failed";
      s.endedAt = now;
      s.note = reason === "cancelled" ? "cancelled" : "stopped";
    }
}

/**
 * A run taken up again after its first try was interrupted (inside a change
 * on the run doc): not solved again. A run doc that already says how it
 * ended keeps that; one keeping its volume says the volume wasn't kept.
 */
export function markInterrupted(run, now) {
  if (isTerminal(run.status)) {
    markStopped(run, "stopping", now);
    return;
  }
  run.status = "failed";
  run.error = NOT_RESTARTED;
  run.finishedAt = now;
  for (const s of run.stages ?? []) if (s.status === "running") s.status = "failed";
}

/**
 * The status a person sees for a run: its document's, unless its task says
 * what the document can't. The run's code writes the run doc; but a run
 * cancelled before its code started, or whose code never ran to the end (it
 * would not load, its machine stopped for good, its worker was ended), has
 * nobody to write it, and only its task knows.
 * @param {{ status: string, error?: string | null }} run  the run doc
 * @param {{ state: string, error?: string | null } | null} task  the task's state as its reader has it (task-client.js's watch, or taskState and taskError), or null while unknown
 * @returns {{ status: string, error: string | null, note: string | null }}
 */
export function shownRun(run, task) {
  const status = run?.status ?? "queued";
  if (isTerminal(status) || !task) return { status, error: run?.error ?? null, note: null };
  switch (task.state) {
    case "cancelled":
      return { status: "cancelled", error: null, note: status === "queued" ? "cancelled before it started" : null };
    case "failed":
      return { status: "failed", error: task.error ?? "it failed", note: null };
    case "stopping":
      return { status, error: null, note: "cancelling…" };
    case "stalled":
      return { status, error: null, note: "the machine running it isn't heard from" };
    case "waiting":
      return { status, error: null, note: status === "queued" ? null : "the machine running it stopped; it waits to be taken up again" };
    default:
      return { status, error: null, note: null };
  }
}

// ---------------------------------------------------------------- progress

/**
 * Pack rows of numbers as a chunk: Float32, row-major. Appending chunks (not
 * numbers) keeps the doc's history about the size of its data.
 */
export function packChunk(cols, rows) {
  const data = new Float32Array(rows.length * cols.length);
  rows.forEach((r, i) => cols.forEach((_, j) => (data[i * cols.length + j] = Number.isFinite(r[j]) ? r[j] : NaN)));
  return { cols: [...cols], rows: rows.length, data: new Uint8Array(data.buffer) };
}

/** Every chunk of a stream as one table: { cols, rows: number[][] }. Chunks with other columns are skipped. */
export function unpackChunks(chunks) {
  const list = Array.isArray(chunks) ? chunks : [];
  const cols = list.find((c) => Array.isArray(c?.cols))?.cols ?? [];
  const rows = [];
  for (const c of list) {
    if (!c?.data || !Array.isArray(c.cols) || c.cols.join() !== cols.join()) continue;
    const bytes = c.data instanceof Uint8Array ? c.data : new Uint8Array(c.data);
    // copy: an automerge byte array needn't be 4-aligned
    const f = new Float32Array(bytes.slice().buffer);
    for (let i = 0; i + cols.length <= f.length; i += cols.length) rows.push(Array.from(f.subarray(i, i + cols.length)));
  }
  return { cols: [...cols], rows };
}

// ---------------------------------------------------------------- layers

/**
 * A result layer: geometry the run cut out of the solution, in the
 * floating frame (metres), with dimensionless fields per point.
 *   kind "triangles": positions (xyz Float32), indices (Uint32 triples)
 *   kind "lines":     positions, counts (Uint32: points per polyline, in order)
 * Arrays travel as bytes (Uint8Array) in the doc.
 */
export function encodeLayer({ name, kind, positions, indices = null, counts = null, fields = {}, half = false, notes = null }) {
  const bytes = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength).slice();
  const out = { name, kind, half, points: positions.length / 3, positions: bytes(Float32Array.from(positions)), fields: {}, ranges: {} };
  if (indices) out.indices = bytes(Uint32Array.from(indices));
  if (counts) out.counts = bytes(Uint32Array.from(counts));
  for (const [k, v] of Object.entries(fields)) {
    const a = Float32Array.from(v);
    out.fields[k] = bytes(a);
    let lo = Infinity, hi = -Infinity;
    for (const x of a) if (Number.isFinite(x)) { if (x < lo) lo = x; if (x > hi) hi = x; }
    out.ranges[k] = Number.isFinite(lo) ? [lo, hi] : null;
  }
  if (notes) out.notes = notes;
  return out;
}

const f32 = (b) => (b ? new Float32Array((b instanceof Uint8Array ? b : new Uint8Array(b)).slice().buffer) : null);
const u32 = (b) => (b ? new Uint32Array((b instanceof Uint8Array ? b : new Uint8Array(b)).slice().buffer) : null);

/** A layer doc back as typed arrays. */
export function decodeLayer(doc) {
  if (!doc?.positions) return null;
  const fields = {};
  for (const [k, v] of Object.entries(doc.fields ?? {})) fields[k] = f32(v);
  return {
    name: doc.name,
    kind: doc.kind === "lines" ? "lines" : "triangles",
    half: doc.half === true,
    positions: f32(doc.positions),
    indices: u32(doc.indices),
    counts: u32(doc.counts),
    fields,
    ranges: { ...(doc.ranges ?? {}) },
  };
}

/** What each field of a layer means, for legends. */
export const FIELD_INFO = Object.freeze({
  Cp: { label: "Pressure coefficient", unit: "Cp", diverging: true },
  Cf: { label: "Skin friction coefficient", unit: "Cf", diverging: false },
  ux: { label: "Axial velocity", unit: "u/V", diverging: false },
  speed: { label: "Speed", unit: "|U|/V", diverging: false },
  eta: { label: "Wave elevation", unit: "m", diverging: true },
  alpha: { label: "Water fraction", unit: "α", diverging: false },
});
