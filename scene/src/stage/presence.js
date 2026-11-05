// Presence: what this view tells the others while it's open, and what they
// tell it (STAGE.md, "Three places for state" and "Inside the stage"). Three
// kinds of ephemeral message go over handle.broadcast:
//
//   scene:presence  this view's whole state, keys namespaced by extension. It
//                   goes out coalesced, at the highest rate any extension
//                   asked for, and again as a heartbeat. Peers drop a view
//                   they haven't heard from in a while, or at once on a bye.
//   scene:send      a one-off message from an extension to the same
//                   extension on every other peer. Never stored, never
//                   replayed, delivered at most once.
//   scene:pose      an object someone is holding (carrying, dragging on the
//                   gizmo) and where it is right now, throttled per object.
//                   A release either puts it back or says where it landed.
//
// Every message carries the sending view's `session`, a random id made when
// the presence is, so two tabs of the same viewer are two peers. Messages
// without one (the old {type:"scene:presence", selected, hover} and
// {type:"scene:carry"}) are ignored, as are our own.
//
// Nothing here knows what a key means or what a transform looks like: the
// stage shows poses and extensions read keys. Time comes in through now /
// setTimer / clearTimer so tests can drive it.

export const PRESENCE = "scene:presence";
export const SEND = "scene:send";
export const POSE = "scene:pose";

export const HEARTBEAT_MS = 5_000; // resend the whole state at least this often
export const PEER_TTL_MS = 15_000; // drop a peer not heard from in this long
export const DEFAULT_HZ = 4; // presence rate when no extension asks for more
export const MAX_HZ = 60;
export const POSE_MS = 50; // at most one pose per object per this long
export const HOLD_TTL_MS = 3_000; // drop a remote hold not refreshed in this long (and a landed one after it)
export const HOLD_KEEPALIVE_MS = 1_000; // resend a still pose this often, so peers don't time it out
const SEEN_SENDS = 512; // how many send ids to remember for de-duplication
const GONE = 256; // how many bye'd sessions to remember

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.length > 0;

/** Presence values are plain data, so equal JSON means equal. */
export function same(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * The presence rate: the highest any extension asked for, never below the
 * default (so one extension asking for less can't slow another's hover).
 * @param {Iterable<number>} rates
 */
export function effectiveHz(rates) {
  let hz = DEFAULT_HZ;
  for (const r of rates) if (r > hz) hz = r;
  return Math.min(hz, MAX_HZ);
}

/**
 * Keep only what a presence message's `keys` may hold: `{ [ext]: { [key]: value } }`.
 * @returns {object | null} null when it isn't that shape at all
 */
export function cleanKeys(keys) {
  if (keys === undefined) return {};
  if (!isObj(keys)) return null;
  const out = {};
  for (const [ext, m] of Object.entries(keys)) if (isObj(m)) out[ext] = m;
  return out;
}

/**
 * Which of several peers' holds on one object counts: one still held beats a
 * landed one, then the lower `since`, then the lower session id. `since` is a
 * Lamport stamp, not a time: a hold begun after its holder heard of another
 * gets a higher one, so the order follows what each holder knew, and
 * concurrent holds fall to the session id. Every view sees the same stamps,
 * so every view picks the same winner, the way Automerge settles concurrent
 * writes by operation id rather than by anyone's clock.
 * @param {{ session: string, since: number, landed: object | null }[]} holds
 */
export function winningHold(holds) {
  let best = null;
  for (const h of holds) {
    if (!best) {
      best = h;
      continue;
    }
    const a = h.landed ? 1 : 0;
    const b = best.landed ? 1 : 0;
    if (a !== b ? a < b : h.since !== best.since ? h.since < best.since : h.session < best.session) best = h;
  }
  return best;
}

function newSession() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // fall through
  }
  return `s${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * @param {{
 *   handle: { broadcast?(msg: object): void, on?(ev: string, fn: Function): void, off?(ev: string, fn: Function): void },
 *   viewer: string | null,
 *   session?: string,                       // normally made here; tests pass one
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (t: any) => void,
 * }} o
 */
export function createPresence({
  handle,
  viewer = null,
  session: firstSession = newSession(),
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
}) {
  let dead = false;
  let session = firstSession;
  let away = false; // said bye on pagehide; hello() comes back as a new session

  function broadcast(msg) {
    if ((dead || away) && !msg.bye) return;
    try {
      handle?.broadcast?.(msg);
    } catch {
      // best effort: presence is never worth an error
    }
  }

  function tell(listeners, ...args) {
    for (const fn of [...listeners]) {
      try {
        fn(...args);
      } catch (err) {
        console.warn("[scene] a presence listener failed", err);
      }
    }
  }

  // ─── this view's state ─────────────────────────────────────────────────────
  let keys = {}; // { [ext]: { [key]: value } }, replaced, never mutated
  const rates = new Map(); // ext → hz
  let seq = 0;
  let sentAt = -Infinity;
  // the Lamport clock for holds: past every stamp this view has seen
  let lamport = 0;
  const observe = (stamp) => {
    if (Number.isFinite(stamp) && stamp > lamport) lamport = stamp;
  };
  let sendTimer = null; // a coalesced send waiting for its turn
  let heartbeat = null;

  const interval = () => 1000 / effectiveHz(rates.values());

  function sendState() {
    clearTimer(sendTimer);
    sendTimer = null;
    if (dead || away) return;
    sentAt = now();
    broadcast({ type: PRESENCE, session, viewer, seq: ++seq, at: sentAt, keys });
    clearTimer(heartbeat);
    heartbeat = setTimer(sendState, HEARTBEAT_MS);
  }

  // Send now if the rate allows, else once it does; any number of changes in
  // between go out as one message carrying the latest state.
  function requestSend() {
    if (dead || sendTimer) return;
    const wait = interval() - (now() - sentAt);
    if (wait <= 0) sendState();
    else sendTimer = setTimer(sendState, wait);
  }

  function set(ext, key, value) {
    if (dead || !isStr(ext) || !isStr(key)) return;
    const mine = keys[ext];
    if (value === undefined) {
      if (!mine || !(key in mine)) return;
      const { [key]: _gone, ...rest } = mine;
      keys = { ...keys, [ext]: rest };
    } else {
      if (mine && key in mine && same(mine[key], value)) return;
      keys = { ...keys, [ext]: { ...mine, [key]: value } };
    }
    requestSend();
  }

  function clear(ext) {
    if (dead) return;
    rates.delete(ext);
    for (const h of [...held.values()]) if (h.ext === ext) release(ext, h.id);
    if (!(ext in keys)) return;
    const { [ext]: _gone, ...rest } = keys;
    keys = rest;
    requestSend();
  }

  function rate(ext, hz) {
    if (dead || !isStr(ext)) return;
    if (typeof hz === "number" && Number.isFinite(hz) && hz > 0) rates.set(ext, hz);
    else rates.delete(ext);
    // a waiting send was timed for the old rate
    if (sendTimer) {
      clearTimer(sendTimer);
      sendTimer = null;
      requestSend();
    }
  }

  // ─── peers ─────────────────────────────────────────────────────────────────
  const peers = new Map(); // session → { record, seq, ttl }
  const gone = new Set(); // sessions that said bye: late messages from them are ignored
  const watchers = new Set();
  let snapshot = null;

  function get() {
    if (!snapshot) {
      const out = {};
      for (const [s, p] of peers) out[s] = p.record;
      snapshot = Object.freeze(out);
    }
    return snapshot;
  }

  function peersChanged() {
    snapshot = null;
    tell(watchers, get());
  }

  function dropPeer(s) {
    const p = peers.get(s);
    if (!p) return;
    clearTimer(p.ttl);
    peers.delete(s);
    // gone without a bye (crashed, closed): its pose bookkeeping goes too,
    // once none of its holds is left
    if (![...holds.values()].some((bySession) => bySession.has(s))) lastPose.delete(s);
    peersChanged();
  }

  function onPresence(msg) {
    const s = msg.session;
    if (msg.bye === true) {
      gone.add(s);
      if (gone.size > GONE) gone.delete(gone.values().next().value);
      dropPeer(s);
      dropHoldsOf(s);
      return;
    }
    if (typeof msg.seq !== "number" || gone.has(s)) return;
    const k = cleanKeys(msg.keys);
    if (!k) return;
    const v = typeof msg.viewer === "string" ? msg.viewer : null;
    const p = peers.get(s);
    if (p && msg.seq <= p.seq) return; // older than what we have
    const fresh = !p;
    const entry = p ?? { record: null, seq: 0, ttl: null };
    entry.seq = msg.seq;
    clearTimer(entry.ttl);
    entry.ttl = setTimer(() => dropPeer(s), PEER_TTL_MS);
    peers.set(s, entry);
    // A heartbeat that changes nothing keeps the record (and `at`, the local
    // time this state last changed), so watchers aren't woken for it.
    if (!entry.record || entry.record.viewer !== v || !same(entry.record.keys, k)) {
      entry.record = Object.freeze({ viewer: v, at: now(), keys: k });
      peersChanged();
    }
    // Someone new: tell them about us now rather than at our next heartbeat.
    if (fresh) requestSend();
  }

  // ─── sends ─────────────────────────────────────────────────────────────────
  const receivers = new Set();
  const seenSends = new Set(); // `${session}:${n}`, oldest first
  let sendSeq = 0;

  function send(ext, kind, data) {
    if (dead || !isStr(ext) || !isStr(kind)) return;
    broadcast({ type: SEND, session, viewer, ext, kind, n: ++sendSeq, data: data ?? null });
  }

  function onSend(msg) {
    if (!isStr(msg.ext) || !isStr(msg.kind) || typeof msg.n !== "number") return;
    const key = `${msg.session}:${msg.n}`;
    if (seenSends.has(key)) return;
    seenSends.add(key);
    if (seenSends.size > SEEN_SENDS) seenSends.delete(seenSends.values().next().value);
    const from = Object.freeze({ session: msg.session, viewer: typeof msg.viewer === "string" ? msg.viewer : null });
    tell(receivers, msg.ext, msg.kind, msg.data ?? null, from);
  }

  // ─── this view's pose holds ────────────────────────────────────────────────
  const held = new Map(); // object id → { ext, id, parent, transform, sentAt, timer, dirty }
  let poseSeq = 0;
  let keepalive = null;

  function sendPose(h) {
    clearTimer(h.timer);
    h.timer = null;
    h.dirty = false;
    h.sentAt = now();
    broadcast({ type: POSE, session, viewer, id: h.id, parent: h.parent, transform: h.transform, since: h.since, seq: ++poseSeq });
  }

  // A pose that stays still still has to reach peers often enough that they
  // don't take the holder for gone.
  function tickKeepalive() {
    keepalive = null;
    if (dead || !held.size) return;
    const t = now();
    for (const h of held.values()) if (!h.timer && t - h.sentAt >= HOLD_KEEPALIVE_MS) sendPose(h);
    keepalive = setTimer(tickKeepalive, HOLD_KEEPALIVE_MS);
  }

  function hold(ext, id, parent, transform) {
    if (dead || !isStr(ext) || !isStr(id) || !isObj(transform)) return;
    let h = held.get(id);
    if (!h) {
      // since: this hold's Lamport stamp, after every hold we've heard of; every peer ranks holds by it
      h = { ext, id, parent: null, transform: null, since: ++lamport, sentAt: -Infinity, timer: null, dirty: false };
      held.set(id, h);
    }
    h.ext = ext; // the latest holder owns the release
    h.parent = isStr(parent) ? parent : null;
    h.transform = transform;
    h.dirty = true;
    if (!keepalive) keepalive = setTimer(tickKeepalive, HOLD_KEEPALIVE_MS);
    if (h.timer) return; // the trailing send will carry this pose
    const wait = POSE_MS - (now() - h.sentAt);
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
    const msg = { type: POSE, session, viewer, id, parent: h.parent, transform: null, seq: ++poseSeq };
    if (isObj(landedTransform)) msg.landed = landedTransform;
    broadcast(msg);
  }

  // ─── other views' pose holds ───────────────────────────────────────────────
  const holds = new Map(); // object id → Map session → { session, viewer, parent, transform, landed, since, timer }
  const lastPose = new Map(); // session → Map object id → seq, so a late pose can't undo a release
  const holdWatchers = new Set();
  let holdsView = null;

  function remoteHolds() {
    if (!holdsView) {
      holdsView = new Map();
      for (const [id, bySession] of holds) {
        const w = winningHold(bySession.values());
        if (w)
          holdsView.set(
            id,
            Object.freeze({ session: w.session, viewer: w.viewer, parent: w.parent, transform: w.transform, landed: w.landed, since: w.since }),
          );
      }
    }
    return holdsView;
  }

  /**
   * The peer session holding this object, or null. While this view holds it
   * too, only a peer whose hold began first counts (winningHold), so of two
   * views that grabbed it at once, exactly one is told the other has it.
   */
  function heldBy(id) {
    const bySession = holds.get(id);
    if (!bySession) return null;
    const theirs = [...bySession.values()].filter((h) => !h.landed);
    const mine = held.get(id);
    const w = winningHold(mine ? [...theirs, { session, since: mine.since, landed: null }] : theirs);
    return w && w.session !== session ? w.session : null;
  }

  function holdsChanged(ids) {
    holdsView = null;
    tell(holdWatchers, remoteHolds(), ids);
  }

  function dropHold(id, s, quiet = false) {
    const bySession = holds.get(id);
    const h = bySession?.get(s);
    if (!h) return false;
    clearTimer(h.timer);
    bySession.delete(s);
    if (!bySession.size) holds.delete(id);
    if (!quiet) holdsChanged([id]);
    return true;
  }

  function dropHoldsOf(s) {
    const ids = [];
    for (const [id, bySession] of holds) if (bySession.has(s)) ids.push(id);
    for (const id of ids) dropHold(id, s, true);
    lastPose.delete(s);
    if (ids.length) holdsChanged(ids);
  }

  /** Drop the landed holds on an object: the stage calls this once its doc shows where it landed. */
  function settle(id) {
    const bySession = holds.get(id);
    if (!bySession) return;
    let any = false;
    for (const h of [...bySession.values()]) if (h.landed) any = dropHold(id, h.session, true) || any;
    if (any) holdsChanged([id]);
  }

  function onPose(msg) {
    const s = msg.session;
    const id = msg.id;
    if (!isStr(id) || typeof msg.seq !== "number" || gone.has(s)) return;
    const t = msg.transform;
    if (t !== null && !isObj(t)) return;
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
      return holdsChanged([id]);
    }
    // the hold's stamp, as its holder says (so every view ranks it the same);
    // a peer that doesn't say ranks after every stamp we know
    observe(msg.since);
    const since = Number.isFinite(msg.since) ? msg.since : lamport + 1;
    const h = prev && !prev.landed ? prev : { session: s, viewer: null, parent: null, transform: null, landed: null, since, timer: null };
    if (prev && prev !== h) clearTimer(prev.timer);
    h.viewer = typeof msg.viewer === "string" ? msg.viewer : null;
    h.parent = isStr(msg.parent) ? msg.parent : null;
    h.transform = t;
    clearTimer(h.timer);
    h.timer = setTimer(() => dropHold(id, s), HOLD_TTL_MS);
    let bySession = holds.get(id);
    if (!bySession) holds.set(id, (bySession = new Map()));
    bySession.set(s, h);
    holdsChanged([id]);
  }

  // ─── the wire ──────────────────────────────────────────────────────────────
  const onMessage = (payload) => {
    if (dead) return;
    const msg = payload?.message;
    if (!isObj(msg) || !isStr(msg.session) || msg.session === session) return;
    if (msg.type === PRESENCE) onPresence(msg);
    else if (msg.type === SEND) onSend(msg);
    else if (msg.type === POSE) onPose(msg);
  };
  try {
    handle?.on?.("ephemeral-message", onMessage);
  } catch {
    // a handle without ephemeral messages: presence stays local
  }

  // say hello, so peers know we're here before our first key
  sendState();

  // The page is going away (pagehide), and the tool's cleanup may never run:
  // put our holds back and say bye now, then stay quiet.
  function goodbye() {
    if (dead || away) return;
    for (const h of [...held.values()]) release(h.ext, h.id);
    broadcast({ type: PRESENCE, session, bye: true });
    away = true;
    clearTimer(sendTimer);
    sendTimer = null;
    clearTimer(heartbeat);
    heartbeat = null;
  }

  // Back from the back-forward cache: peers took our bye as final, so come
  // back as a new session, with the state we have.
  function hello() {
    if (dead || !away) return;
    away = false;
    session = newSession();
    sendState();
  }

  function dispose() {
    if (dead) return;
    dead = true;
    try {
      handle?.off?.("ephemeral-message", onMessage);
    } catch {
      // ignore
    }
    clearTimer(sendTimer);
    clearTimer(heartbeat);
    clearTimer(keepalive);
    for (const h of held.values()) clearTimer(h.timer);
    held.clear();
    for (const p of peers.values()) clearTimer(p.ttl);
    peers.clear();
    for (const bySession of holds.values()) for (const h of bySession.values()) clearTimer(h.timer);
    holds.clear();
    snapshot = null;
    holdsView = null;
    watchers.clear();
    receivers.clear();
    holdWatchers.clear();
    // the bye also ends our holds on every peer
    if (!away) broadcast({ type: PRESENCE, session, bye: true });
  }

  const listen = (bag) => (fn) => {
    if (dead || typeof fn !== "function") return () => {};
    bag.add(fn);
    return () => bag.delete(fn);
  };

  return {
    get session() {
      return session;
    },
    set,
    clear,
    get,
    watch: listen(watchers),
    rate,
    send,
    onReceive: listen(receivers),
    hold,
    release,
    remoteHolds,
    heldBy,
    watchHolds: listen(holdWatchers),
    settle,
    goodbye,
    hello,
    dispose,
  };
}
