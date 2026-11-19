// scene.poses (native, every doc): provides "poses" (NATIVE.md, "Holding a pose").
//
// A pose hold shows an object at a local transform while held, says so to
// peers on the channel (createWire: its sends), and shows theirs, played
// back a little late and smoothly (smooth.js). One holder per object
// (createHolds, ranksAhead: H6). What anything here shows is api.display's
// transform; this view's hold wins over a peer's. Only the public api.

import { normalizeTransform } from "../transform.js";
import { tie } from "./claims.js";
import { snapshot } from "./inspect.js";
import { createHolds, createWire, poseInterval } from "./holds.js";
import { aheadOf, playoutDelay, poseAt } from "./smooth.js";

/** Are two transforms the same pose, number by number (within eps)? */
export function sameTransform(a, b, eps = 1e-6) {
  if (!a || !b) return false;
  const x = normalizeTransform(a);
  const y = normalizeTransform(b);
  const close = (p, q) => Math.abs(p - q) <= eps;
  return x.position.every((v, i) => close(v, y.position[i])) && x.rotation.every((v, i) => close(v, y.rotation[i])) && close(x.scale, y.scale);
}

/** Where another view's live hold is shown at `t` (our clock): its stream, played back a little late. */
function playback(h, t) {
  if (!h.samples?.length) return { transform: h.transform, settled: true };
  return poseAt(h.samples, t - h.offset - playoutDelay(h.every), { ahead: aheadOf(h.every) }) ?? { transform: h.transform, settled: true };
}

function create(api) {
  const ch = api.channel;
  const rates = new Map(); // caller id → the pose rate it asked for (hz)
  const here = new Map(); // object id → this view's held transform
  const shown = new Map(); // object id → the release of what's displayed for it
  const playing = new Set(); // ids of peers' holds still playing back
  let loop = null;
  const wire = createWire({ send: (data) => ch.send("pose", data), session: () => ch.session, interval: () => poseInterval(rates.values()), now: api.now, setTimer: (fn, ms) => api.after(ms, fn), clearTimer: (cancel) => cancel?.() });
  const holds = createHolds({
    presence: wire,
    exists: (id) => !!api.scene().objects[id] && api.scene().objects[id].kind !== "group",
    parentOf: (id) => api.scene().parents.get(id) ?? null,
    shown: (id, t) => (here.set(id, t), show(id)),
    unshown: (id) => (here.delete(id), show(id)),
  });

  // What an object shows: this view's hold, else a peer's while its parent is
  // the doc's (a landed one until the doc shows the same transform), played
  // back between its samples every frame until it has caught up (tick).
  function show(id, t = api.now()) {
    let pose = here.get(id) ?? null;
    let settled = true;
    const h = pose ? null : wire.remoteHolds().get(id);
    const s = api.scene();
    if (h && s.objects[id] && (s.parents.get(id) ?? null) === (h.parent ?? null)) {
      if (!h.landed) ({ transform: pose, settled } = playback(h, t));
      else if (sameTransform(s.objects[id].transform, h.landed)) return void wire.settle(id); // its watcher shows the doc's
      else pose = h.landed;
    }
    if (settled) playing.delete(id);
    else if (!playing.has(id)) playing.add(id), (loop ??= api.loop(() => tick(), { first: true }));
    if (pose) shown.set(id, api.display(id, { transform: pose }));
    else if (shown.has(id)) shown.get(id)(), shown.delete(id);
  }
  /** One frame of playback (before any other loop, so what they read is what's drawn); `t` for tests. */
  function tick(t = api.now()) {
    for (const id of [...playing]) show(id, t);
    if (!playing.size && loop) loop = void loop();
  }
  wire.watch((_holds, ids) => {
    // a peer's hold that now ranks ahead of one here takes it, then each is shown as it stands
    holds.reconcile(ids);
    ids.forEach((id) => show(id));
  });
  // a peer gone (a bye, or its presence timed out) leaves nothing held
  let peers = new Set(Object.keys(ch.peers()));
  ch.watch((now) => {
    for (const s of peers) if (!(s in now)) wire.dropHoldsOf(s);
    peers = new Set(Object.keys(now));
  });
  api.page.on("hide", () => wire.goodbye());

  function release(ext, id, landed) {
    const t = landed ? api.doc().objects?.[id]?.transform : null;
    holds.release(ext, id, t ? JSON.parse(JSON.stringify(normalizeTransform(t))) : undefined);
  }
  const poses = (caller) => {
    const ext = caller.id;
    tie(caller.signal, () => {
      for (const id of [...here.keys()]) if (holds.holderOf(id) === ext) release(ext, id, false);
      rates.delete(ext);
    });
    return Object.freeze({
      /** true when the hold stands: false while another's ranks ahead (a person's before a yielding one, then the first) */
      hold: (id, transform, { yields = false } = {}) => !caller.signal.aborted && api.writable() && holds.hold(ext, id, normalizeTransform(transform), { yields }),
      release: (id, { landed = false } = {}) => release(ext, id, landed),
      heldBy: (id, o) => wire.heldBy(id, o),
      /** stream this caller's holds faster than 20 Hz (up to 60), or null for the default */
      rate: (hz) => (Number.isFinite(hz) && hz > 0 ? rates.set(ext, hz) : rates.delete(ext)),
      /** the moment (a peer's now()) whose poses of that peer this view draws, or null */
      shownAt: (session) => wire.shownAt(session),
    });
  };

  return {
    provides: { poses },
    receive: (type, data, from) => type === "pose" && wire.receive(data, from),
    // an extension holding a pose is busy: a peer's edit doesn't stop it mid-carry or mid-stream (STAGE.md, "Stopping")
    busy: (ext) => [...here.keys()].some((id) => holds.holderOf(id) === ext),
    // the doc changed: a landed hold it caught up with goes, and one whose parent it changed is shown (or not) again
    update: () => [...wire.remoteHolds().keys()].forEach((id) => show(id)),
    tick,
    /** CONVENTIONS.md, "Inspect": every hold on every object, this view's and peers', ranked (rank 0 counts): holder (an extension here, else the peer's session), yields, since */
    inspect: () => snapshot({ holds: wire.all() }),
    /** for probes: peers' holds as this view has them */
    remoteHolds: () => wire.remoteHolds(),
    dispose: () => wire.dispose(),
  };
}

export default { create };
