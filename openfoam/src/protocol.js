// The documents a case, its runs and a daemon share, and every write either
// side makes to them. Pure functions over plain objects (an automerge doc
// inside a change() is one), so the tool and the daemon run the same code
// and the tests prove the protocol without a network.
//
// Three documents:
//
//   openfoam-case    the user's: the hull link, the setup, the server, the
//                    runs it has made. Only people write it.
//   openfoam-run     one analysis: the setup and hull FROZEN at the moment
//                    it was asked for, then the daemon's progress and results.
//                    People write only `control` (cancel / finish now).
//   openfoam-server  a daemon's inbox and status. People add `requests`;
//                    the daemon writes everything else.
//
// Who writes what never overlaps, so concurrent edits never conflict:
//
//   case      ← people
//   run       ← people: control.*         daemon: status, daemon, stages,
//                                          progress, mesh, summary, layers,
//                                          error, startedAt, finishedAt
//   server    ← people: requests[id]      daemon: daemon, handled[id], active[id]

export const CASE_TYPE = "openfoam-case";
export const RUN_TYPE = "openfoam-run";
export const SERVER_TYPE = "openfoam-server";
export const PROTOCOL_VERSION = 1;

/** A daemon is online if it beat within this long. */
export const HEARTBEAT_MS = 20_000;
export const ONLINE_MS = 75_000;

/** Run statuses. Terminal: done, failed, cancelled. */
export const STATUSES = Object.freeze(["queued", "meshing", "solving", "post", "done", "failed", "cancelled"]);
export const TERMINAL = Object.freeze(["done", "failed", "cancelled"]);
export const isTerminal = (status) => TERMINAL.includes(status);

/**
 * The stages a run goes through, in order, by mode. Meshing on several cores
 * splits the background mesh first and meshes the pieces in parallel; on one,
 * nothing is split. (A run doc starts with the serial order; the daemon, which
 * knows its cores, rewrites the list when it starts.)
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

/** The id a run's request goes under in a server's inbox: its document id. */
export const requestIdOf = (runUrl) => String(runUrl).replace(/^automerge:/, "");

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
 * @param {string} o.serverUrl
 * @param {object} o.setup     normalised setup
 * @param {object} o.hull      { stl: Uint8Array, info, source, warnings }
 * @param {string} [o.by]      who asked (a name, for the queue)
 * @param {number} o.now
 *
 * A run doc, as asked for. `hull` is everything about the hull the run uses
 * (its STL, measurements, frame, where it came from, its geometry digest);
 * `made` the tool that asked ({ tool, version }). The daemon adds `daemon`
 * (where and with what it ran) and `recipe` (the case files it wrote): see
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
    control: { cancel: false, finish: false },
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
  const kn = (setup.speed / (1852 / 3600)).toFixed(1);
  const what = setup.mode === "free-surface" ? "free surface" : "double body";
  const heel = Math.abs(setup.attitude?.heel ?? 0) > 1e-9 ? ` · ${Math.abs(setup.attitude.heel)}° heel to ${setup.attitude.heel > 0 ? "starboard" : "port"}` : "";
  return `${hullTitle ? `${hullTitle} · ` : ""}${kn} kn${heel} · ${what} · ${setup.mesh}`;
}

/** People: ask the daemon to stop. `finish` keeps what it has (writes now); otherwise it is killed. */
export function requestStop(run, { keep }) {
  if (!run.control) run.control = { cancel: false, finish: false };
  if (keep) run.control.finish = true;
  else run.control.cancel = true;
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
 * A result layer: geometry the daemon cut out of the solution, in the
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
