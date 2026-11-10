// The worker's jobs, pure, so they run the same in the worker (worker.js)
// and, when no worker can start, on the main thread (statics-runner.js):
//
//   { type: "statics", triangles: Float64Array (rig frame), volumes, heels?, trims?, steps?, name?, originDescription?, reference? }
//     → a Chartroom hydrostatic table (naval/statics.js)
//   { type: "polar", design, tws?, twa? }
//     → the VPP's polar (naval/vpp.js) for a design (naval/design.js)
//   { type: "rig", doc, linked?, source?, params? }
//     → { ok, glb, bounds, notes, contract }: the rig GLB carrying the contract (rig-build.js)
//   { type: "contract", doc, linked?, source? }
//     → { ok, contract } | { ok: false, why }: the contract alone, for "Export contract JSON"
//   { type: "screen", doc: object|null, linked?, frame?, title? }
//     → a study subject's Figures (study/screen.js)
// A job with no type is a statics job.

import { buildTable } from "./naval/statics.js";
import { polar } from "./naval/vpp.js";
import { buildRig, composeRig } from "./rig-build.js";
import { screenSubject } from "./study/screen.js";

export { staticsJobFor } from "./rig-build.js";

export function runStaticsJob(job) {
  return buildTable(job.triangles, {
    heels: job.heels,
    trims: job.trims,
    steps: job.steps,
    volumes: job.volumes,
    name: job.name,
    originDescription: job.originDescription,
    reference: job.reference,
  });
}

export function runPolarJob(job) {
  return polar(job.design, { tws: job.tws ?? job.design.conditions.tws, twa: job.twa ?? job.design.conditions.twa });
}

export function runContractJob(job) {
  const r = composeRig({ doc: job.doc, linked: job.linked ?? null, source: job.source ?? {} });
  return r.ok ? { ok: true, contract: r.contract } : { ok: false, why: r.why };
}

/** Any job. */
export const runJob = (job) =>
  job?.type === "polar"
    ? runPolarJob(job)
    : job?.type === "rig"
      ? buildRig(job)
      : job?.type === "contract"
        ? runContractJob(job)
        : job?.type === "screen"
          ? screenSubject(job)
          : runStaticsJob(job);

/** The worker's message handler: { id, job } → { id, type: "done", ok, result | error }. */
export function handleMessage(data) {
  const { id, job } = data ?? {};
  try {
    return { id, type: "done", ok: true, result: runJob(job) };
  } catch (err) {
    return { id, type: "done", ok: false, error: String(err?.message ?? err) };
  }
}
