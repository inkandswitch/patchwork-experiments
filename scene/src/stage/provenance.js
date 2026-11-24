// Write provenance (API.md, "`api`", `change`): every change the kernel
// makes stamps its Automerge change message with who made it, as JSON:
// `{ "ext": "<extension or view plugin id>" }`, or `{ "kernel": "<part>" }`
// for the stage's own writes (the packages list). The message travels with
// the change, so a peer's write says who made it too.
//
// lastWriter reads it back: the change whose operation is the value a path
// shows now (the winner of a conflict, as the doc shows it), or for a map or
// list the latest operation anywhere under it, by Lamport order (the order
// Automerge resolves conflicts in). Pure; on demand, never on a hot path: it
// reads every change's metadata once per call of writers().

import * as A from "@automerge/automerge";

/** The change message for a write by `by` (`{ ext }` or `{ kernel }`). */
export const stamp = (by) => JSON.stringify(by);

/** Who a change message says made the change: `{ ext } | { kernel }`, or null (unstamped, or not ours). */
export function writerOf(message) {
  if (typeof message !== "string" || !message.startsWith("{")) return null;
  try {
    const m = JSON.parse(message);
    if (typeof m?.ext === "string") return Object.freeze({ ext: m.ext });
    if (typeof m?.kernel === "string") return Object.freeze({ kernel: m.kernel });
  } catch {
    // not ours
  }
  return null;
}

/** "counter@actor" → { counter, actor }, or null. */
function parseOp(id) {
  const at = typeof id === "string" ? id.indexOf("@") : -1;
  return at > 0 ? { counter: Number(id.slice(0, at)), actor: id.slice(at + 1) } : null;
}
/** Lamport order on op ids: counter, then actor. */
const later = (a, b) => (a.counter !== b.counter ? a.counter > b.counter : a.actor > b.actor);

/** The op id of a value as the backend's getAll gives it: [type, id] for an object, [type, value, id] for a scalar. */
const opOf = (v) => (v.length === 2 ? v[1] : v[2]);
const isObjType = (t) => t === "map" || t === "list" || t === "text" || t === "table";

/**
 * A reader of a doc's provenance: `lastWriter(path)` → `{ by, actor, hash,
 * seq, time }` (by: writerOf the change's message) or null when the path
 * isn't there; `null` for a doc that isn't an Automerge one.
 * @param {object} doc  an Automerge doc (handle.doc())
 */
export function writers(doc) {
  if (!doc || !A.isAutomerge(doc)) return null;
  const backend = A.getBackend(doc);
  const byActor = new Map(); // actor → change metadata sorted by startOp
  for (const c of A.getChangesMetaSince(doc, [])) {
    if (!byActor.has(c.actor)) byActor.set(c.actor, []);
    byActor.get(c.actor).push(c);
  }
  for (const list of byActor.values()) list.sort((a, b) => a.startOp - b.startOp);
  const changeOf = (op) => {
    const list = byActor.get(op.actor) ?? [];
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = list[mid];
      if (op.counter < c.startOp) hi = mid - 1;
      else if (op.counter > c.maxOp) lo = mid + 1;
      else return c;
    }
    return null;
  };
  // the winner at (obj, prop): the last of getAll's values
  const at = (obj, prop) => {
    const all = backend.getAll(obj, prop);
    return all?.length ? all[all.length - 1] : null;
  };
  // the latest op at or under a value
  function latest(v) {
    let best = parseOp(opOf(v));
    if (!isObjType(v[0]) || v[0] === "text") return best;
    const obj = v[1];
    const keys = v[0] === "map" || v[0] === "table" ? backend.keys(obj) : Array.from({ length: backend.length(obj) }, (_, i) => i);
    for (const k of keys) {
      const w = at(obj, k);
      const o = w && latest(w);
      if (o && (!best || later(o, best))) best = o;
    }
    return best;
  }
  return Object.freeze({
    /** @param {(string | number)[]} path  e.g. ["objects", id, "transform"] */
    lastWriter(path) {
      if (!Array.isArray(path) || !path.length) return null;
      let obj = "_root";
      let v = null;
      for (let i = 0; i < path.length; i++) {
        v = at(obj, path[i]);
        if (!v) return null;
        if (i < path.length - 1) {
          if (!isObjType(v[0])) return null;
          obj = v[1];
        }
      }
      const op = latest(v);
      const c = op && changeOf(op);
      return c ? Object.freeze({ by: writerOf(c.message), actor: c.actor, hash: c.hash, seq: c.seq, time: c.time }) : null;
    },
  });
}

/** The last writer of one path of a doc (writers(doc).lastWriter(path)), or null. */
export const lastWriter = (doc, path) => writers(doc)?.lastWriter(path) ?? null;
