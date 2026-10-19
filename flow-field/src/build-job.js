// A scene build's heavy part as plain data in, bytes out: compiling the flow
// (the panel solve), tracing, meshing and encoding the GLB. Pure, no DOM, no
// repo: it runs in the build worker (build-worker.js) and, when no worker can
// be started, on the main thread (build-runner.js), on the same job object,
// so both paths make the same bytes.

import { buildSlice, sliceParams } from "./build-slice.js";
import { buildStreamlines, streamlineParams } from "./build-streamlines.js";

export const BUILDS = {
  slice: { build: buildSlice, params: sliceParams },
  streamlines: { build: buildStreamlines, params: streamlineParams },
};

/**
 * A deep copy holding only plain data: objects, arrays, strings, numbers
 * (−0 kept, unlike JSON), booleans and null. Functions and undefined are
 * dropped (undefined in an array becomes null, as in JSON); anything with a
 * toJSON() (an automerge string, a Date) is copied as what that returns. An
 * automerge doc is a proxy that structuredClone refuses, and a section's meta
 * comes from another package; this makes both safe to post to a worker.
 */
export function plain(v) {
  if (v === null || typeof v !== "object") return typeof v === "function" || typeof v === "symbol" || typeof v === "bigint" ? undefined : v;
  if (!Array.isArray(v) && typeof v.toJSON === "function") return plain(v.toJSON());
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v, (x) => plain(x) ?? null);
  const out = {};
  for (const k of Object.keys(v)) {
    const x = plain(v[k]);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

/** What bodyNote() reads from acquireSection's result (which also holds handles and docs). */
function notesResult(r) {
  if (!r) return null;
  const out = { ok: !!r.ok };
  for (const k of ["pending", "transient", "error", "path", "providerName"]) if (r[k] !== undefined) out[k] = plain(r[k]);
  return out;
}

/**
 * The job for one build, as plain data a worker can be posted.
 * @param {"slice"|"streamlines"} kind
 * @param {object} doc     the flow doc (an automerge doc is fine)
 * @param {object} params  as the host hands them; coerced here the way the host does
 * @param {object} [ctx]   { section, result } from section.js's bodySectionFor
 */
export function makeJob(kind, doc, params = {}, ctx = {}) {
  const b = BUILDS[kind];
  if (!b) throw new Error(`unknown flow-field build “${kind}”`);
  return {
    kind,
    doc: plain(doc ?? {}),
    params: b.params(params ?? {}),
    section: ctx?.section ? plain(ctx.section) : null,
    result: notesResult(ctx?.result),
  };
}

/** Run a job. @returns {{ glb: Uint8Array, meta: { bounds, notes } }} */
export function runJob(job) {
  const b = BUILDS[job?.kind];
  if (!b) throw new Error(`unknown flow-field build “${job?.kind}”`);
  const { glb, meta } = b.build(job.doc, job.params, { section: job.section, result: job.result });
  return { glb, meta };
}

/**
 * The worker's message handler, without the worker (tests call it directly).
 * @param {{ id: number, job: object }} data
 * @returns {{ message: object, transfer: ArrayBuffer[] }}
 */
export function handleMessage(data) {
  const { id, job } = data ?? {};
  try {
    const { glb, meta } = runJob(job);
    return { message: { id, type: "done", ok: true, glb, meta }, transfer: [glb.buffer] };
  } catch (err) {
    return { message: { id, type: "done", ok: false, error: String(err?.message ?? err) }, transfer: [] };
  }
}
