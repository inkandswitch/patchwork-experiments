// The rig's scene:source (SourceImpl): a rig GLB in the hull's frame
// carrying extras.rig (contract/v1) and sailing's lumped extras.sail.plan.
// The linked hull is read here on the main thread (it needs the repo and
// the plugin registry); the rest is the "rig" job (rig-build.js), run in a
// worker, or on the main thread when no worker can start.
//
// Builds run one at a time on one worker, in the order asked. A newer
// build of the same rig doc supersedes an older one still waiting (its
// promise rejects with an AbortError, which the scene host treats as
// cancelled); builds of other rig docs wait their turn.

import { normalize } from "./doc.js";
import { acquireHull, hullPathChip } from "./link/hull-link.js";
import { createStaticsRunner, abortError } from "./statics-runner.js";
import { rigFingerprint, rigDependencies } from "./fingerprint.js";
import { encodeGLB } from "./glb.js";

let runner = null;
let chain = Promise.resolve();
const latest = new Map(); // rig url → newest build's ticket
let tickets = 0;

/** Run a job after every earlier one; a newer job for the same key drops this one if it hasn't started. */
export function runQueued(job, key) {
  runner ??= createStaticsRunner({ name: "rig-build" });
  const ticket = ++tickets;
  latest.set(key, ticket);
  const p = chain.then(() => {
    if (latest.get(key) !== ticket) throw abortError();
    return runner.run(job);
  });
  chain = p.catch(() => {});
  return p;
}

const headsOf = (h) => {
  try {
    const v = h?.heads?.();
    return Array.isArray(v) ? [...v] : null;
  } catch {
    return null;
  }
};

/** An empty GLB that says why, for a build with nothing to show. */
function emptyResult(notes) {
  return { kind: "glb", glb: encodeGLB({ meshes: [], generator: "patchwork rig-design" }), meta: { notes } };
}

/**
 * The job a build runs, after the linked hull is read.
 * @returns {Promise<{ job: object } | { error: string, transient: boolean }>}
 *   transient: about this peer (the hull not synced or loaded here yet, no
 *   registry, no decoder); a retry may succeed.
 */
export async function rigJobFor({ doc, handle, url, params, repo }, { acquire = acquireHull } = {}) {
  const d = normalize(doc);
  let linked = null;
  let hull = {};
  if (d.hull.link) {
    const r = await acquire({ url: d.hull.link.url, repo, selfUrl: url });
    if (!r.ok) return { error: `The linked hull can't be read: ${r.error}.`, transient: r.transient !== false };
    linked = { status: "ready", mesh: r.mesh, chip: hullPathChip(r) };
    hull = { path: r.path, heads: headsOf(r.handle), glbKey: null };
  }
  const source = { rigDoc: url ?? null, rigHeads: headsOf(handle), hull };
  return { job: { type: "rig", doc: JSON.parse(JSON.stringify(d)), linked, source, params: { ...params } } };
}

export const RigSource = {
  /**
   * A transient failure to read the linked hull THROWS (as flow-field's
   * section.js does): an empty GLB would be stored in the render doc, synced
   * to every peer over the last good rig, and recorded as up to date against
   * the fingerprint, so nothing would rebuild it when the hull arrived here.
   * Thrown, the host keeps the last render and retries. A failure that is
   * the same on every peer (a rig linked to itself or to another rig, a GLB
   * that isn't one, a hull not built yet) is an empty GLB that says why.
   */
  async build(args) {
    const j = await rigJobFor(args);
    if (j.error && j.transient) throw new Error(j.error);
    if (j.error) return emptyResult(j.error);
    const res = await runQueued(j.job, args.url ?? "-");
    if (!res?.ok) return emptyResult(res?.notes || res?.why || "The rig couldn't be built.");
    return { kind: "glb", glb: res.glb, meta: { ...(res.bounds ? { bounds: res.bounds } : {}), ...(res.notes ? { notes: res.notes } : {}) } };
  },
  fingerprint: rigFingerprint,
  dependencies: rigDependencies,
};

export default RigSource;
