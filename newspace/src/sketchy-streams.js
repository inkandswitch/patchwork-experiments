// The tool↔component BOUNDARY for Sketchy, built on the opstream-over-port primitive.
//
//   patchwork:TOOL  — acquires the automerge docs (folder, the `.sketch` layout doc, the
//                     user doc) and PROVIDES them as opstreams: provideSketchyStreams.
//   patchwork:COMPONENT — SUBSCRIBES to those opstreams and renders the canvas from them:
//                     subscribeSketchyStream.
//
// Ops cross the MessagePort natively (see port-opstream.js), so what the component receives
// is a live, bidirectional opstream of each doc — read its value, apply ops to write back.
// `docHandleFromOpstream` then dresses such an opstream as a DocHandle-like object so the
// existing Canvas (which speaks `handle.doc()/.change()/.on("change")`) can run on it.
import { serveOpstreamOverPort, portOpstream, createPortConsumerSync } from "./port-opstream.js";
import { applyAutomerge, patchesToOps } from "./opstreams.js";
import { from as amFrom, change as amChange } from "@automerge/automerge";
import { snapshot } from "./ops.js";

const SUB = "patchwork:subscribe";
const toPlain = (v) => { try { return JSON.parse(JSON.stringify(v)); } catch { return {}; } };
const clone = (v) => { try { return (typeof structuredClone === "function") ? structuredClone(v) : JSON.parse(JSON.stringify(v)); } catch { return Array.isArray(v) ? v.slice() : { ...v }; } };

// PROVIDER (tool side): answer `sketchy:*` subscriptions by serving the matching opstream over
// the subscriber's port. `streamFor(type, selector)` returns the opstream for a selector type
// (e.g. "sketchy:items" → automergeOpstream(layoutHandle, {path:["items"]})), or null to ignore.
export function provideSketchyStreams(element, streamFor) {
  // Each subscription gets its OWN teardown, keyed by (subscribing element, selector): a
  // remounted component re-subscribing REPLACES its old bridge instead of accumulating one
  // per remount. Where the platform supports the MessagePort `close` event, a consumer
  // closing (or GC'ing) its port also tears its bridge down directly.
  const subs = new Map(); // source element → Map(selector key → dispose)
  const onSub = (e) => {
    const sel = e.detail && e.detail.selector, port = e.detail && e.detail.port;
    if (!sel || !port || typeof sel.type !== "string" || !sel.type.startsWith("sketchy:")) return;
    const stream = streamFor(sel.type, sel);
    if (!stream) return;
    e.stopPropagation(); // claim it so ancestor providers don't double-answer
    const source = (e.composedPath && e.composedPath()[0]) || e.target || element;
    let key; try { key = JSON.stringify(sel); } catch { key = sel.type; }
    let bySel = subs.get(source);
    if (!bySel) subs.set(source, (bySel = new Map()));
    const prev = bySel.get(key);
    if (prev) try { prev(); } catch {}
    const off = serveOpstreamOverPort(stream, port);
    const dispose = () => { try { off && off(); } catch {} try { port.close && port.close(); } catch {} if (bySel.get(key) === dispose) bySel.delete(key); };
    bySel.set(key, dispose);
    if (port.addEventListener) try { port.addEventListener("close", dispose); } catch {}
  };
  element.addEventListener(SUB, onSub);
  return () => { element.removeEventListener(SUB, onSub); for (const bySel of [...subs.values()]) for (const d of [...bySel.values()]) try { d(); } catch {} subs.clear(); };
}

// CONSUMER (component side): open a raw subscription port for `selectorType`. Dispatches the
// same `patchwork:subscribe` the providers package uses (fresh MessageChannel; we keep port1,
// the provider gets port2). The various subscribe* helpers build on this.
export function openSketchyPort(element, selectorType, args) {
  const channel = new MessageChannel();
  const detail = { selector: { type: selectorType, ...(args || {}) }, port: channel.port2 };
  element.dispatchEvent(new CustomEvent(SUB, { detail, bubbles: true, composed: true }));
  return channel.port1;
}

// open `selectorType` as a bidirectional VALUE opstream (snapshot writes).
export function subscribeSketchyStream(element, selectorType, { value, args } = {}) {
  return portOpstream(openSketchyPort(element, selectorType, args), { value });
}

// open `selectorType` as a GRANULAR, automerge-backed DocHandle adapter. A local automerge
// replica tracks the far doc; `.change(fn)` runs through automerge so the patches become
// GRANULAR ops (a per-field/splice op, never a whole-doc snapshot) — which cross the port and
// land on the tool's real doc via a granular automerge change, so concurrent collab MERGES
// instead of clobbering. This is the automerge<->opstream adaption, reusable beyond Sketchy.
export function subscribeSketchyDoc(element, selectorType, url, { args, ephemeral } = {}) {
  // when `ephemeral`, ALSO open the broadcast channel (sketchy:ephemeral) so the adapter
  // handle has working .broadcast/.on("ephemeral-message") — presence/cursors in component mode.
  const ephPort = ephemeral ? openSketchyPort(element, "sketchy:ephemeral") : null;
  return automergeDocOverPort(openSketchyPort(element, selectorType, args), url, ephPort);
}

// PROVIDER (tool side): bridge the real doc handle's EPHEMERAL channel to subscribers. The
// component asks for "sketchy:ephemeral"; we relay the handle's incoming broadcasts to the
// port, and the port's messages out via handle.broadcast (which fans out to all peers). A
// non-persisted presence channel, off the main doc handle — falls back to nothing if the host
// handle can't broadcast (WebRTC via ShareSession is the heavier alternative).
export function provideSketchyEphemeral(element, handle) {
  // per-subscription teardown, replace-on-resubscribe — same discipline as provideSketchyStreams
  const subs = new Map(); // source element → dispose
  const onSub = (e) => {
    const sel = e.detail && e.detail.selector, port = e.detail && e.detail.port;
    if (!sel || !port || sel.type !== "sketchy:ephemeral") return;
    e.stopPropagation();
    const source = (e.composedPath && e.composedPath()[0]) || e.target || element;
    const prev = subs.get(source);
    if (prev) try { prev(); } catch {}
    const relay = (p) => { try { port.postMessage(p && p.message); } catch {} };
    if (handle && handle.on) handle.on("ephemeral-message", relay);
    port.onmessage = (ev) => { if (handle && handle.broadcast) try { handle.broadcast(ev.data); } catch {} };
    if (port.start) port.start();
    const dispose = () => { if (handle && handle.off) handle.off("ephemeral-message", relay); try { port.onmessage = null; port.close && port.close(); } catch {} if (subs.get(source) === dispose) subs.delete(source); };
    subs.set(source, dispose);
    if (port.addEventListener) try { port.addEventListener("close", dispose); } catch {}
  };
  element.addEventListener(SUB, onSub);
  return () => { element.removeEventListener(SUB, onSub); for (const d of [...subs.values()]) try { d(); } catch {} subs.clear(); };
}

export function automergeDocOverPort(port, url, ephemeralPort) {
  let doc = amFrom({});
  let plain = {};
  // the consumer half of the port protocol (see port-opstream.js): the local
  // replica is an optimistic mirror carrying our in-flight granular ops, so an
  // incoming provider op must be FOLDED over them (the dual transform) before it
  // lands — applying it raw onto a shifted replica splices the wrong elements,
  // and our outgoing ops must ride with `basedOn` or the provider-side rebase
  // never engages and a stale index op silently corrupts the PERSISTED doc.
  const remote = createPortConsumerSync();
  const listeners = new Set(), eph = new Set();
  const sync = () => { plain = toPlain(doc); for (const cb of [...listeners]) try { cb({ handle, doc: plain }); } catch {} };
  // EPHEMERAL (presence) channel over its own port — gives the handle .broadcast/.on so the
  // canvas's presence/cursor code works in component mode just as on a real DocHandle.
  if (ephemeralPort) {
    ephemeralPort.onmessage = (e) => { const m = e.data; for (const cb of [...eph]) try { cb({ message: m }); } catch {} };
    if (ephemeralPort.start) ephemeralPort.start();
  }
  port.onmessage = (e) => {
    const r = remote.receive(e.data);
    // a REMOTE op (the tool's doc changed) → apply to the local replica
    if (r.type === "snapshot") doc = amFrom(r.op.value && typeof r.op.value === "object" ? r.op.value : {});
    else if (r.type === "op") { const op = r.op; try { doc = amChange(doc, (d) => applyAutomerge(d, op.path || [], op.range, op.value)); } catch {} }
    else return; // ack / drop / error / ignore — nothing lands on the replica
    sync();
  };
  if (port.start) port.start();
  const handle = {
    url, __fromOpstream: true,
    doc: () => plain,
    change: (fn) => {
      const patches = [];
      doc = amChange(doc, { patchCallback: (ps) => { for (const p of ps) patches.push(p); } }, fn);
      const ops = patchesToOps(patches, []);
      // GRANULAR — send only (no local echo), each op basedOn-tagged + tracked in
      // flight via the shared consumer machinery, so races rebase instead of corrupt
      if (ops === null) { try { port.postMessage(remote.send(snapshot(toPlain(doc)))); } catch {} }
      else for (const op of ops) { try { port.postMessage(remote.send(op)); } catch {} }
      sync();
    },
    broadcast: (msg) => { if (ephemeralPort) try { ephemeralPort.postMessage(msg); } catch {} },
    on: (ev, cb) => { if (ev === "change") listeners.add(cb); else if (ev === "ephemeral-message") eph.add(cb); },
    off: (ev, cb) => { if (ev === "change") listeners.delete(cb); else if (ev === "ephemeral-message") eph.delete(cb); },
    whenReady: async () => {}, isReady: () => true,
    free: () => { try { port.onmessage = null; port.close && port.close(); if (ephemeralPort) { ephemeralPort.onmessage = null; ephemeralPort.close && ephemeralPort.close(); } } catch {} listeners.clear(); eph.clear(); },
  };
  return handle;
}

// Dress an opstream (whose value IS a doc) as a DocHandle-like object the Canvas can use.
// `.change(fn)` mutates a clone and writes it back as a SNAPSHOT op — correct, if coarse;
// granular-op diffing (to preserve automerge's per-field merge) is a later refinement.
export function docHandleFromOpstream(stream, url) {
  const listeners = new Set();
  const off = stream.connect ? stream.connect(() => { for (const cb of [...listeners]) try { cb({ handle, doc: stream.value }); } catch {} }) : null;
  const handle = {
    url,
    __fromOpstream: true, // surfaceDoc() drives a Solid store from .on("change") instead of projecting
    doc: () => stream.value,
    change: (fn) => { const next = clone(stream.value) ?? {}; fn(next); stream.apply(snapshot(next)); },
    on: (ev, cb) => { if (ev === "change") listeners.add(cb); },
    off: (ev, cb) => { if (ev === "change") listeners.delete(cb); },
    whenReady: async () => {},
    isReady: () => true,
    free: () => { if (off) off(); listeners.clear(); },
  };
  return handle;
}
