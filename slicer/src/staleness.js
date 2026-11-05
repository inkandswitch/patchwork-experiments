// Is a slice job's G-code current, and should it re-slice by itself? Pure.
//
// A job records what its G-code was sliced from in `builtFrom`:
//   sourceKey   = "<source url> <key>", the key being
//                   renderKey(render) for a scene render ("render:<glbUrl>"),
//                   which changes only when the scene writes a new GLB, never
//                   on the render's status writes or a rename;
//                   "sha256:…" of the bytes for a GLB/STL file, recomputed when
//                   the file's heads change, so renaming the file changes nothing;
//   settingsKey = stable JSON of the effective settings (title and `auto` are not settings).
// The tool works out the same two keys for what is there now and asks decide().

/** "<url> <key>" — a key per source doc, so pointing the job elsewhere is a change. */
export function sourceKeyFor(url, key) {
  return `${url} ${key}`;
}

/**
 * Why a job's G-code is stale, or null if it is current.
 * @param {object|null} builtFrom
 * @param {{ sourceKey: string, settingsKey: string }} now
 * @returns {null | "never-sliced" | "source" | "settings"}
 */
export function staleReason(builtFrom, now) {
  if (!builtFrom) return "never-sliced";
  if (builtFrom.sourceKey !== now.sourceKey) return "source";
  if (builtFrom.settingsKey !== now.settingsKey) return "settings";
  return null;
}

export function sameInputs(a, b) {
  return !!a && !!b && a.sourceKey === b.sourceKey && a.settingsKey === b.settingsKey;
}

/**
 * @param {object} job      normalizeJob(doc)
 * @param {object} now
 * @param {"ok"|"loading"|"missing"|"unbuilt"|"unsupported"|"error"} now.sourceState
 *        ok: the source is loaded and sourceKey is known; unbuilt: a render with no GLB yet
 * @param {string|null} now.sourceKey
 * @param {string} now.settingsKey
 * @param {object} [o]
 * @param {boolean} [o.busy]          this tool is slicing
 * @param {boolean} [o.peerSlicing]   another peer said it is slicing these inputs
 * @returns {{ state: "no-source"|"waiting"|"unsupported"|"slicing"|"fresh"|"stale"|"error", reason?: string, slice: boolean }}
 *   slice: start a slice (after debounceFor(reason)) without being asked
 */
export function decide(job, now, { busy = false, peerSlicing = false } = {}) {
  if (!job?.source) return { state: "no-source", slice: false };
  if (busy) return { state: "slicing", slice: false };
  if (now.sourceState === "unsupported") return { state: "unsupported", slice: false };
  if (now.sourceState !== "ok" || !now.sourceKey) return { state: "waiting", reason: now.sourceState, slice: false };
  const reason = staleReason(job.builtFrom, now);
  if (!reason) return { state: "fresh", slice: false };
  // A slice of exactly these inputs already failed: say so, and don't loop on it.
  if (job.status === "error" && sameInputs(job.errorFrom, now)) return { state: "error", reason, slice: false };
  if (peerSlicing) return { state: "slicing", reason: "peer", slice: false };
  return { state: "stale", reason, slice: !!job.auto };
}

/** How long to wait before an automatic slice, by why it is stale (ms). */
export function debounceFor(reason) {
  if (reason === "never-sliced") return 0;
  if (reason === "settings") return 600;
  return 900;
}

/** The ephemeral message a slicing peer broadcasts on the job, and how long others hold off for it. */
export const SLICING_MESSAGE = "slice-job:slicing";
export const PEER_HOLD_MS = 30000;

export function slicingKey(now) {
  return `${now.sourceKey}\n${now.settingsKey}`;
}
