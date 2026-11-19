// Presence: what this view tells the others while it's open, and what they
// tell it (STAGE.md, "Three places for state", "`api`"). Two
// kinds of ephemeral message go over handle.broadcast:
//
//   scene:presence  this view's whole state, keys namespaced by extension,
//                   and what the view itself says of the viewer on every
//                   channel it acts on: its body and hands (`body`,
//                   `held`, top last: STAGE.md, "Views, stages and links", so whoever has this doc open
//                   sees what a person at any placement of it is doing). It
//                   goes out coalesced, at the highest rate any extension
//                   asked for, and again as a heartbeat. Peers drop a view
//                   they haven't heard from in a while, or at once on a bye.
//   scene:send      a one-off message from an extension to the same
//                   extension on every other peer. Never stored, never
//                   replayed, delivered at most once.
//
// Every message carries the sending view's `session`, a random id made when
// the presence is, so two tabs of the same viewer are two peers. Messages
// without one are ignored, as are our own and a departed session's.
//
// A presence that only listens (`listen: true`: a read-only stage's,
// STAGE.md, "Views, stages and links") hears its doc's channel and says
// nothing on it: no hello, no heartbeat, no keys or sends, no bye.
//
// Nothing here knows what a key or a send means: extensions read them (pose
// holds are scene.poses' sends, ../native/poses.js). Time comes in through now /
// setTimer / clearTimer so tests can drive it.

import { rawHandle } from "./readonly.js";

export const PRESENCE = "scene:presence";
export const SEND = "scene:send";

export const HEARTBEAT_MS = 5_000; // resend the whole state at least this often
export const PEER_TTL_MS = 15_000; // drop a peer not heard from in this long
export const DEFAULT_HZ = 4; // presence rate when no extension asks for more
export const MAX_HZ = 60;
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

/** A body as presence carries it: `{ id, label }`, both strings; null if it isn't one. */
export function cleanBody(v) {
  return isObj(v) && isStr(v.id) && typeof v.label === "string" ? Object.freeze({ id: v.id, label: v.label }) : null;
}

/** What a view holds as presence carries it: its hands (an open menu passed over), `[{ name }]`, top last; each that isn't one is left out, and anything but a list is nothing held (`[]`). */
export function cleanHeld(v) {
  return Object.freeze(Array.isArray(v) ? v.filter((h) => isObj(h) && typeof h.name === "string").map((h) => Object.freeze({ name: h.name })) : []);
}

// ─── the page bus ────────────────────────────────────────────────────────────
// automerge-repo doesn't echo an ephemeral broadcast within a page: two
// views of one doc in one page (split panes, a game open alone beside the
// boat it is linked into) share one handle and never hear each other. The
// page bus delivers each broadcast to every other presence on the same
// handle in the page, as the network delivers it to other pages: a copy, a
// task later. Presences on different handles (different repos, connected by
// a network) are left to the network, so nothing is heard twice. A
// read-only stage's handle (./readonly.js) is its doc's handle: the same bus.
const buses = new WeakMap(); // handle → Set of receivers on it in this page

/** Join the page bus for `handle`: deliver(msg) to the others, and leave(). */
export function pageBus(handle, receive) {
  if (!handle || typeof handle !== "object") return { deliver() {}, leave() {} };
  handle = rawHandle(handle);
  let set = buses.get(handle);
  if (!set) buses.set(handle, (set = new Set()));
  set.add(receive);
  return {
    deliver(message) {
      for (const other of [...set]) {
        if (other === receive) continue;
        const copy = structuredClone(message);
        queueMicrotask(() => {
          if (set.has(other)) other({ message: copy, senderId: "page" });
        });
      }
    },
    leave() {
      set.delete(receive);
    },
  };
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
 *   listen?: boolean,                       // hear the channel, say nothing on it
 *   tap?: { on(): boolean, say(e: object): void },  // a read-only tap: every message sent or heard, said while on()
 * }} o
 */
export function createPresence({
  handle,
  viewer = null,
  session: firstSession = newSession(),
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  listen = false,
  tap = null,
}) {
  let dead = false;
  // the tap (STAGE.md, "View plugins"): what goes out and what comes in, and where it went or why it was dropped; made only while on
  const said = (make) => {
    if (tap?.on()) tap.say(make());
  };
  let session = firstSession;
  let away = false; // said bye on pagehide; hello() comes back as a new session

  let bus = null; // this presence on the page bus (joined below, once onMessage exists)
  function broadcast(msg) {
    if (listen) return;
    if ((dead || away) && !msg.bye) return;
    try {
      handle?.broadcast?.(msg);
    } catch {
      // best effort: presence is never worth an error
    }
    bus?.deliver(msg);
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
  let body = null; // the view's: its body ({ id, label }) and hands ([{ name }], top last), the same on every channel it acts on
  let heldTool = cleanHeld(null);
  const rates = new Map(); // ext → hz
  let seq = 0;
  let sentAt = -Infinity;
  let sendTimer = null; // a coalesced send waiting for its turn
  let heartbeat = null;

  const interval = () => 1000 / effectiveHz(rates.values());

  function sendState() {
    clearTimer(sendTimer);
    sendTimer = null;
    if (dead || away || listen) return;
    sentAt = now();
    broadcast({ type: PRESENCE, session, viewer, seq: ++seq, at: sentAt, keys, ...(body ? { body } : {}), ...(heldTool.length ? { held: heldTool } : {}) });
    said(() => ({ dir: "out", kind: "presence", session, viewer, keys }));
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

  /** What the view says of the viewer here: its body and hands (the view's, on every channel it acts on). */
  function announce(state) {
    if (dead) return;
    const b = cleanBody(state?.body);
    const h = cleanHeld(state?.held);
    if (same(b, body) && same(h, heldTool)) return;
    body = b;
    heldTool = h;
    requestSend();
  }

  function clear(ext) {
    if (dead) return;
    rates.delete(ext);
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
    peersChanged();
  }

  function onPresence(msg) {
    const s = msg.session;
    const v = typeof msg.viewer === "string" ? msg.viewer : null;
    const drop = (why) => said(() => ({ dir: "in", kind: "presence", session: s, viewer: v, dropped: why }));
    if (msg.bye === true) {
      gone.add(s);
      if (gone.size > GONE) gone.delete(gone.values().next().value);
      said(() => ({ dir: "in", kind: "bye", session: s, viewer: v, to: "stage" }));
      dropPeer(s);
      return;
    }
    if (typeof msg.seq !== "number") return drop("malformed");
    if (gone.has(s)) return drop("said bye");
    const k = cleanKeys(msg.keys);
    if (!k) return drop("malformed");
    const b = cleanBody(msg.body);
    const h = cleanHeld(msg.held);
    const p = peers.get(s);
    if (p && msg.seq <= p.seq) return drop("stale"); // older than what we have
    const fresh = !p;
    const entry = p ?? { record: null, seq: 0, ttl: null };
    entry.seq = msg.seq;
    clearTimer(entry.ttl);
    entry.ttl = setTimer(() => dropPeer(s), PEER_TTL_MS);
    peers.set(s, entry);
    // A heartbeat that changes nothing keeps the record (and `at`, the local
    // time this state last changed), so watchers aren't woken for it.
    const changed = !entry.record || entry.record.viewer !== v || !same(entry.record.keys, k) || !same(entry.record.body, b) || !same(entry.record.held, h);
    said(() => ({ dir: "in", kind: "presence", session: s, viewer: v, keys: k, changed, to: "stage" }));
    if (changed) {
      entry.record = Object.freeze({ viewer: v, body: b, held: h, at: now(), keys: k });
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
    if (!listen && !away) said(() => ({ dir: "out", kind: "send", session, viewer, ext, type: kind, data: data ?? null }));
  }

  function onSend(msg) {
    const v = typeof msg.viewer === "string" ? msg.viewer : null;
    const heard = (o) => said(() => ({ dir: "in", kind: "send", session: msg.session, viewer: v, ext: msg.ext, type: msg.kind, data: msg.data ?? null, ...o }));
    if (!isStr(msg.ext) || !isStr(msg.kind) || typeof msg.n !== "number") return heard({ dropped: "malformed" });
    if (gone.has(msg.session)) return heard({ dropped: "said bye" });
    const key = `${msg.session}:${msg.n}`;
    if (seenSends.has(key)) return heard({ dropped: "duplicate" });
    seenSends.add(key);
    if (seenSends.size > SEEN_SENDS) seenSends.delete(seenSends.values().next().value);
    const from = Object.freeze({ session: msg.session, viewer: v });
    // each receiver says where it went ({ to } or { dropped }): the stage's, its extension's receive
    let route = null;
    for (const fn of [...receivers]) {
      try {
        route = fn(msg.ext, msg.kind, msg.data ?? null, from) ?? route;
      } catch (err) {
        console.warn("[scene] a presence listener failed", err);
      }
    }
    heard(route ?? { dropped: "no receiver" });
  }

  // ─── the wire ──────────────────────────────────────────────────────────────
  const onMessage = (payload) => {
    if (dead) return;
    const msg = payload?.message;
    if (!isObj(msg) || !isStr(msg.session) || msg.session === session) return;
    if (msg.type === PRESENCE) onPresence(msg);
    else if (msg.type === SEND) onSend(msg);
  };
  try {
    handle?.on?.("ephemeral-message", onMessage);
  } catch {
    // a handle without ephemeral messages: presence stays local
  }
  bus = pageBus(handle, onMessage);

  // say hello, so peers know we're here before our first key
  sendState();

  // The page is going away (pagehide), and the tool's cleanup may never run:
  // say bye now, then stay quiet.
  function goodbye() {
    if (dead || away) return;
    broadcast({ type: PRESENCE, session, bye: true });
    if (!listen) said(() => ({ dir: "out", kind: "bye", session, viewer }));
    away = true;
    clearTimer(sendTimer);
    sendTimer = null;
    clearTimer(heartbeat);
    heartbeat = null;
  }

  // Back from the back-forward cache: peers took our bye as final, so come
  // back as a new session, with the state we have.
  function hello(next = newSession()) {
    if (dead || !away) return;
    away = false;
    session = next;
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
    const leaving = bus;
    clearTimer(sendTimer);
    clearTimer(heartbeat);
    for (const p of peers.values()) clearTimer(p.ttl);
    peers.clear();
    snapshot = null;
    watchers.clear();
    receivers.clear();
    // the bye, then off the bus
    if (!away) broadcast({ type: PRESENCE, session, bye: true });
    leaving?.leave();
    bus = null;
  }

  const subscribe = (bag) => (fn) => {
    if (dead || typeof fn !== "function") return () => {};
    bag.add(fn);
    return () => bag.delete(fn);
  };

  return {
    get session() {
      return session;
    },
    set,
    announce,
    clear,
    get,
    watch: subscribe(watchers),
    rate,
    send,
    onReceive: subscribe(receivers),
    goodbye,
    hello,
    dispose,
  };
}
