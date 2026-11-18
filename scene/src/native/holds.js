// Pose holds (NATIVE.md, "Holding a pose"): the one order they go in, the
// holds of one view, and the wire that tells the others (scene.poses' sends).
//
// An object has at most one holder in a view, and every view agrees on one
// across them, ranked by (a person's before a yielding one, then `since`):
// `ranksAhead`. A yielding hold is a process's that gives way to a person (a
// hull nobody steers). Here, a hold by another extension stands unless it
// yields and the new one doesn't, and of two of a kind the first stays;
// across views, a hold is refused while a peer's ranks ahead (wire.heldBy),
// and one this view has is dropped as soon as a peer's does (reconcile).
// Nothing here draws: `shown` and `unshown` are the plugin's.
//
// The wire sends a held pose at most once per interval per object, stamped
// with the sender's clock; peers keep the last few as samples to play back
// (smooth.js). A release puts it back or says where it landed.

import { addSample, clockOffset, playoutDelay } from "./smooth.js";

export const POSE_MS = 50; // at most one pose per object per this long, unless a caller asked for a higher rate
export const MAX_HZ = 60;
export const HOLD_TTL_MS = 3_000; // drop a remote hold not refreshed in this long (and a landed one after it)
export const HOLD_KEEPALIVE_MS = 1_000; // resend a still pose this often, so peers don't time it out

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.length > 0;

/** How often a held pose may go out (ms): every POSE_MS, or faster when a caller asked (a hull streamed at 30 or 60 Hz). */
export const poseInterval = (rates) => Math.min(POSE_MS, 1000 / Math.min(MAX_HZ, Math.max(1, ...rates)));

/** A sender's pose interval as it says it, checked; POSE_MS if it doesn't. */
export const cleanEvery = (v) => (typeof v === "number" && v >= 1000 / MAX_HZ && v <= HOLD_KEEPALIVE_MS ? v : POSE_MS);

/**
 * Does hold `a` rank ahead of hold `b` on one object? One still held beats a
 * landed one; then a person's beats a yielding one; then the lower `since`,
 * then the lower session id. One total order, the same in every view.
 * @param {{ session: string, since: number, landed?: object | null, yields?: boolean }} a
 * @param {{ session: string, since: number, landed?: object | null, yields?: boolean }} b
 */
export function ranksAhead(a, b) {
  const la = a.landed ? 1 : 0;
  const lb = b.landed ? 1 : 0;
  if (la !== lb) return la < lb;
  const ya = a.yields ? 1 : 0;
  const yb = b.yields ? 1 : 0;
  if (ya !== yb) return ya < yb;
  if (a.since !== b.since) return a.since < b.since;
  return a.session < b.session;
}

/**
 * Which of several peers' holds on one object counts: the first by
 * ranksAhead. `since` is a Lamport stamp, not a time: a hold begun after its
 * holder heard of another gets a higher one, so the order follows what each
 * holder knew, and concurrent holds fall to the session id. Every view sees
 * the same stamps and flags, so every view picks the same winner, the way
 * Automerge settles concurrent writes by operation id rather than by anyone's
 * clock.
 * @param {{ session: string, since: number, landed: object | null, yields?: boolean }[]} holds
 */
export function winningHold(holds) {
  let best = null;
  for (const h of holds) if (!best || ranksAhead(h, best)) best = h;
  return best;
}

/**
 * May a hold by `ext` (yielding or not) be taken where `cur` holds the
 * object in this view? "keep": it's `ext`'s own; "take": `cur` yields to
 * it; "refuse": `cur` stands. Pure.
 * @param {{ ext: string, yields: boolean } | null | undefined} cur
 * @param {string} ext
 * @param {boolean} yields
 * @returns {"keep" | "take" | "refuse"}
 */
export function localTake(cur, ext, yields) {
  if (!cur) return "take";
  if (cur.ext === ext) return "keep";
  return cur.yields && !yields ? "take" : "refuse";
}

/**
 * @param {{
 *   presence: { hold(ext, id, parent, transform, yields): void, release(ext, id, landed?): void, heldBy(id, o?: { yields?: boolean }): string | null },  // the wire
 *   exists: (id: string) => boolean,          // an object a pose can be held on (not a group)
 *   parentOf: (id: string) => string | null,  // its doc parent, as the stage resolves it
 *   shown?: (id: string, transform: object) => void,
 *   unshown?: (id: string) => void,
 *   lost?: (ext: string, id: string) => void,  // an extension no longer holds this (taken from it here, or a peer's ranks ahead)
 * }} o
 */
export function createHolds({ presence, exists, parentOf, shown = () => {}, unshown = () => {}, lost = () => {} }) {
  const local = new Map(); // object id → { ext, yields }

  function drop(id, cur, landed) {
    local.delete(id);
    presence.release(cur.ext, id, landed);
  }

  /**
   * Hold an object's pose for an extension. True when the hold stands.
   * @param {string} ext @param {string} id @param {object} transform  (normalized by the caller)
   * @param {{ yields?: boolean }} [o]
   */
  function hold(ext, id, transform, { yields = false } = {}) {
    if (!exists(id)) return false;
    const y = !!yields;
    const cur = local.get(id) ?? null;
    const how = localTake(cur, ext, y);
    if (how === "refuse") return false;
    if (how === "take" && cur) {
      // taken from a process here: its hold goes first, so the new one is ranked as begun now
      drop(id, cur);
      lost(cur.ext, id);
    }
    if (presence.heldBy(id, { yields: y }) != null) {
      // a peer's ranks ahead: refused (and ours, if it was ours, goes)
      if (how === "keep") {
        drop(id, cur);
        lost(ext, id);
        unshown(id);
      } else if (cur) unshown(id);
      return false;
    }
    local.set(id, { ext, yields: y });
    presence.hold(ext, id, parentOf(id), transform, y);
    shown(id, transform);
    return true;
  }

  /** Let go of an extension's hold: put back, or (with the doc's transform) landed. */
  function release(ext, id, landed) {
    const cur = local.get(id);
    if (!cur || cur.ext !== ext) return false;
    drop(id, cur, landed);
    unshown(id);
    return true;
  }

  /** Peers' holds on these objects changed: any of ours a peer's now ranks ahead of goes. */
  function reconcile(ids) {
    for (const id of ids) {
      const cur = local.get(id);
      if (!cur || presence.heldBy(id, { yields: cur.yields }) == null) continue;
      drop(id, cur);
      lost(cur.ext, id);
      unshown(id);
    }
  }

  return {
    hold,
    release,
    reconcile,
    /** the extension holding this object here, or null */
    holderOf: (id) => local.get(id)?.ext ?? null,
    has: (id) => local.has(id),
  };
}

/**
 * This view's holds told to peers, and theirs heard: `send(data)` says one
 * (scene.poses' channel send), `receive(data, from)` hears one.
 * @param {{
 *   send: (data: object) => void,
 *   session: () => string | null,          // this view's, now (a new one after pageshow)
 *   interval?: () => number,                // ms between poses of one object (poseInterval)
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (t: any) => void,
 * }} o
 */
export function createWire({ send, session, interval = () => POSE_MS, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) }) {
  let dead = false;
  // the Lamport clock for holds: past every stamp this view has seen
  let lamport = 0;
  const observe = (stamp) => {
    if (Number.isFinite(stamp) && stamp > lamport) lamport = stamp;
  };

  // ─── this view's holds ─────────────────────────────────────────────────────
  const held = new Map(); // object id → { ext, id, parent, transform, since, sentAt, heldAt, timer, dirty, yields }
  let poseSeq = 0;
  let keepalive = null;

  function sendPose(h) {
    clearTimer(h.timer);
    h.timer = null;
    h.dirty = false;
    h.sentAt = now();
    // stamped when it was held, not when it went: a trailing send carries a pose from a frame ago
    const data = { id: h.id, parent: h.parent, transform: h.transform, since: h.since, seq: ++poseSeq, at: h.heldAt ?? h.sentAt, every: interval() };
    if (h.yields) data.yields = true;
    send(data);
  }

  // A pose that stays still still has to reach peers often enough that they don't take the holder for gone.
  function tickKeepalive() {
    keepalive = null;
    if (dead || !held.size) return;
    const t = now();
    for (const h of held.values()) if (!h.timer && t - h.sentAt >= HOLD_KEEPALIVE_MS) (h.heldAt = t), sendPose(h);
    keepalive = setTimer(tickKeepalive, HOLD_KEEPALIVE_MS);
  }

  /**
   * Hold an object's pose for an extension (`yields`: a process's hold that
   * gives way to a person's). Another extension's hold here on the same
   * object is replaced, as a new hold with a new stamp: which extension may
   * hold it is createHolds', this only says it to peers.
   */
  function hold(ext, id, parent, transform, yields = false) {
    if (dead || !isStr(ext) || !isStr(id) || !isObj(transform)) return;
    let h = held.get(id);
    if (h && h.ext !== ext) {
      clearTimer(h.timer);
      held.delete(id);
      h = null;
    }
    if (!h) {
      // since: this hold's Lamport stamp, after every hold we've heard of; every peer ranks holds by it
      h = { ext, id, parent: null, transform: null, yields: false, since: ++lamport, sentAt: -Infinity, heldAt: null, timer: null, dirty: false };
      held.set(id, h);
    }
    h.yields = !!yields;
    h.parent = isStr(parent) ? parent : null;
    h.transform = transform;
    h.heldAt = now();
    h.dirty = true;
    if (!keepalive) keepalive = setTimer(tickKeepalive, HOLD_KEEPALIVE_MS);
    if (h.timer) return; // the trailing send will carry this pose
    const wait = interval() - (now() - h.sentAt);
    if (wait <= 0) sendPose(h);
    else
      h.timer = setTimer(() => {
        h.timer = null;
        if (h.dirty && held.get(id) === h) sendPose(h);
      }, wait);
  }

  function release(ext, id, landedTransform) {
    if (dead) return;
    const h = held.get(id);
    if (!h || h.ext !== ext) return;
    clearTimer(h.timer);
    held.delete(id);
    if (!held.size) {
      clearTimer(keepalive);
      keepalive = null;
    }
    const data = { id, parent: h.parent, transform: null, seq: ++poseSeq };
    if (isObj(landedTransform)) data.landed = landedTransform;
    send(data);
  }

  // ─── other views' holds ────────────────────────────────────────────────────
  // object id → Map session → { session, viewer, parent, transform, landed, since, timer, samples, every }
  const holds = new Map();
  const lastPose = new Map(); // session → Map object id → seq, so a late pose can't undo a release
  const offsets = new Map(); // session → our clock minus its (smooth.js clockOffset)
  const everies = new Map(); // session → its pose interval (ms), as its last pose said
  const watchers = new Set();
  let view = null;

  function remoteHolds() {
    if (!view) {
      view = new Map();
      // each object's winner, with what playing it back needs: its timed samples (sender's clock), its send interval, and our clock minus the sender's
      for (const [id, bySession] of holds) {
        const w = winningHold(bySession.values());
        if (!w) continue;
        const { timer: _timer, ...h } = w;
        view.set(id, Object.freeze({ ...h, offset: offsets.get(w.session) ?? 0 }));
      }
    }
    return view;
  }

  /**
   * The moment, on a peer's clock (ms), whose poses this view is drawing at
   * `t` (ours): its holds are played back that far behind (smooth.js). So
   * anything else that peer streams with its own timestamps (a sea's clock)
   * can be shown at the same moment as its holds. null before any pose of
   * its has been heard.
   */
  function shownAt(s, t = now()) {
    if (!offsets.has(s)) return null;
    return t - offsets.get(s) - playoutDelay(everies.get(s) ?? POSE_MS);
  }

  /**
   * The peer session whose hold on this object ranks ahead of this view's,
   * or null (ranksAhead). This view's hold is the one it has, or else one it
   * would begin now, ranking after every hold it has heard of; `yields` says
   * which kind (by default what it holds, else a person's). So a person
   * isn't kept off by a peer's yielding hold, a yielding hold is by a
   * person's, and of two views that grabbed it at once exactly one is told
   * the other has it.
   */
  function heldBy(id, { yields } = {}) {
    const bySession = holds.get(id);
    if (!bySession) return null;
    const theirs = [...bySession.values()].filter((h) => !h.landed);
    if (!theirs.length) return null;
    const mine = held.get(id);
    const me = { session: session(), since: mine ? mine.since : Infinity, landed: null, yields: yields ?? mine?.yields ?? false };
    const w = winningHold([...theirs, me]);
    return w && w !== me ? w.session : null;
  }

  function changed(ids) {
    view = null;
    for (const fn of [...watchers]) fn(remoteHolds(), ids);
  }

  function dropHold(id, s, quiet = false) {
    const bySession = holds.get(id);
    const h = bySession?.get(s);
    if (!h) return false;
    clearTimer(h.timer);
    bySession.delete(s);
    if (!bySession.size) holds.delete(id);
    if (!quiet) changed([id]);
    return true;
  }

  /** A peer has gone (a bye, or its presence timed out): its holds end. */
  function dropHoldsOf(s) {
    const ids = [];
    for (const [id, bySession] of holds) if (bySession.has(s)) ids.push(id);
    for (const id of ids) dropHold(id, s, true);
    lastPose.delete(s);
    offsets.delete(s);
    everies.delete(s);
    if (ids.length) changed(ids);
  }

  /** Drop the landed holds on an object: once its doc shows where it landed. */
  function settle(id) {
    const bySession = holds.get(id);
    if (!bySession) return;
    let any = false;
    for (const h of [...bySession.values()]) if (h.landed) any = dropHold(id, h.session, true) || any;
    if (any) changed([id]);
  }

  /** A peer's pose or release, `from` its { session, viewer }. */
  function receive(msg, { session: s, viewer } = {}) {
    const id = msg?.id;
    if (dead || !isStr(s) || !isStr(id) || typeof msg.seq !== "number") return;
    const t = msg.transform;
    if (t !== null && (!isObj(t) || !Number.isFinite(msg.since))) return;
    let seqs = lastPose.get(s);
    if (!seqs) lastPose.set(s, (seqs = new Map()));
    if (msg.seq <= (seqs.get(id) ?? 0)) return; // overtaken by a later pose or release
    seqs.set(id, msg.seq);

    const prev = holds.get(id)?.get(s);
    if (t === null) {
      if (!isObj(msg.landed)) return void dropHold(id, s); // put back
      if (!prev) return; // landed without a pose we saw: the doc will show it
      clearTimer(prev.timer);
      prev.landed = msg.landed;
      prev.timer = setTimer(() => dropHold(id, s), HOLD_TTL_MS);
      return changed([id]);
    }
    // the hold's stamp, as its holder says (so every view ranks it the same)
    observe(msg.since);
    const since = msg.since;
    // a new stamp from the same session is a new hold (another of its extensions took it over)
    const h = prev && !prev.landed && prev.since === since ? prev : { session: s, viewer: null, parent: null, transform: null, landed: null, yields: false, since, timer: null, samples: null, every: POSE_MS };
    if (prev && prev !== h) clearTimer(prev.timer);
    h.viewer = typeof viewer === "string" ? viewer : null;
    h.yields = msg.yields === true;
    const parent = isStr(msg.parent) ? msg.parent : null;
    // a new parent is a new frame: the old samples aren't comparable
    if (parent !== h.parent) h.samples = null;
    h.parent = parent;
    h.transform = t;
    // Timed by the sender's clock, so the wire's jitter isn't played back
    // (a pose whose `at` isn't a number is timed by ours, on arrival).
    const heard = now();
    const sentAt = Number.isFinite(msg.at) ? msg.at : heard;
    offsets.set(s, Number.isFinite(msg.at) ? clockOffset(offsets.get(s) ?? null, sentAt, heard) : 0);
    h.every = cleanEvery(msg.every);
    everies.set(s, h.every);
    h.samples = Object.freeze(addSample(h.samples, Object.freeze({ at: sentAt, transform: t }), h.every));
    clearTimer(h.timer);
    h.timer = setTimer(() => dropHold(id, s), HOLD_TTL_MS);
    let bySession = holds.get(id);
    if (!bySession) holds.set(id, (bySession = new Map()));
    bySession.set(s, h);
    changed([id]);
  }

  /** The page is going away (pagehide): put this view's holds back now. */
  function goodbye() {
    for (const h of [...held.values()]) release(h.ext, h.id);
  }

  function dispose() {
    dead = true;
    clearTimer(keepalive);
    for (const h of held.values()) clearTimer(h.timer);
    held.clear();
    for (const bySession of holds.values()) for (const h of bySession.values()) clearTimer(h.timer);
    holds.clear();
    view = null;
    watchers.clear();
  }

  return {
    hold,
    release,
    remoteHolds,
    shownAt,
    heldBy,
    watch: (fn) => (watchers.add(fn), () => watchers.delete(fn)),
    settle,
    receive,
    dropHoldsOf,
    goodbye,
    dispose,
  };
}
