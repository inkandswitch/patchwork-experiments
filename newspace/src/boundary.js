// Crossing a JSON-only boundary (a MessagePort / postMessage to an embedded tool).
//
// An opstream's VALUE is already JSON-shaped, so it crosses by value. Its COMPLEMENT
// is the tricky bit: it holds capabilities (`save()`) and live handles (a File, a
// MediaStream). The idea (from the design chat): split the complement —
//   • JSON-able fields  → cross by value (`data`)
//   • functions         → proxied as async calls back over the channel
//                         (`capabilities`); a call is only safe when its args are
//                         0 / JSON / transferable — enforced at call time, arity here
//   • everything else (a File, a MediaStream, a handle) → can't cross (`dropped`)
//
// This module is the pure split (isJsonable / serializeComplement / hydrateComplement)
// PLUS the real MessagePort proxy built on top (serveBoundary / receiveBoundary).
// Keeping the split pure means we can test the policy without a channel.

// can this value cross a structured-clone / JSON boundary as data?
// transferable / structured-cloneable across a worker/iframe boundary
const CLONEABLE = ["ArrayBuffer", "ImageData", "ImageBitmap", "Blob"];
function isCloneable(v) {
  if (ArrayBuffer.isView(v)) return true; // typed arrays (incl. Uint8Array, Float32Array, Uint8ClampedArray)
  const tag = v && v.constructor && v.constructor.name;
  return CLONEABLE.includes(tag);
}
export function isJsonable(v, seen = new Set()) {
  if (v == null) return true;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (isCloneable(v)) return true; // typed arrays, ImageData, ImageBitmap, ArrayBuffer, Blob
  if (t === "object") {
    // CYCLE GUARD: revisiting an ANCESTOR means a cycle — not JSON-able (it would
    // blow the stack / throw on stringify). `seen` holds ancestors only, so a
    // shared (diamond) reference still classifies as jsonable.
    if (seen.has(v)) return false;
    seen.add(v);
    try {
      if (Array.isArray(v)) return v.every((x) => isJsonable(x, seen));
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return false; // class instances (File, MediaStream, handles)
      return Object.values(v).every((x) => isJsonable(x, seen));
    } finally {
      seen.delete(v);
    }
  }
  return false; // function, symbol, bigint…
}

// split a complement into what crosses by value, what gets proxied, what's dropped
export function serializeComplement(complement = {}) {
  const data = {}, capabilities = [], dropped = [];
  for (const [k, v] of Object.entries(complement || {})) {
    if (typeof v === "function") capabilities.push({ name: k, arity: v.length });
    else if (isJsonable(v)) data[k] = v;
    else dropped.push(k);
  }
  return { data, capabilities, dropped };
}

// rebuild a far-side complement: the `data` as-is, plus each capability as an async
// stub that calls `invoke(name, args)` (the channel's request/response). Mirrors how
// a real capability is the PRESENCE of a function — feature-detection still works.
export function hydrateComplement({ data = {}, capabilities = [] } = {}, invoke) {
  const c = { ...data };
  for (const { name } of capabilities) c[name] = (...args) => invoke(name, args);
  return c;
}

// ── the real MessagePort proxy ───────────────────────────────────────────────
// serveBoundary(complement, port) — the NEAR side. Splits the complement, posts the
// split down the port, then answers capability calls (each call runs the real
// function here; the result crosses back by value). Returns a teardown fn.
//
// receiveBoundary(port) — the FAR side. Resolves to { complement, dropped, close }:
//   complement — the data by value + each capability as an ASYNC STUB, so
//                `complement.save?.()` feature-detects exactly like on the near
//                side (the presence of the function IS the affordance — it just
//                returns a Promise now)
//   dropped    — the field names that could NOT cross (live handles etc.), so the
//                far side can SEE what it isn't getting
//   close      — teardown from this side. It lives BESIDE the complement, not on
//                it — a `complement.close` would read as a capability.
//
// Wire protocol (every message is a plain, structured-clone-safe object):
//   near → far   { type:"boundary:complement", data, capabilities, dropped }   once
//   far  → near  { type:"boundary:call", id, name, args }                      per call
//   near → far   { type:"boundary:result", id, value }
//              | { type:"boundary:result", id, error }        error = message string
//   either way   { type:"boundary:close" }
//
// Semantics: calls are CONCURRENT (correlated by id); a capability may return a
// promise (awaited near-side); a thrown/rejected error crosses as its message
// string and rejects the far promise; a result that can't cross (a function, a
// handle) rejects with a clear error instead of a DataCloneError deep in
// postMessage; non-clonable ARGS are refused far-side before anything is posted.
// After close (from either side) pending calls reject "boundary closed" and every
// later stub call rejects immediately.

const errorMessage = (e) => (e && e.message ? e.message : String(e)); // never post the Error object itself

export function serveBoundary(complement, port) {
  const split = serializeComplement(complement);
  let closed = false;
  const reply = (msg) => { if (!closed) { try { port.postMessage(msg); } catch {} } };
  port.onmessage = async (e) => {
    const m = e.data;
    if (closed || !m || typeof m !== "object") return;
    if (m.type === "boundary:close") { closed = true; try { port.onmessage = null; } catch {} return; }
    if (m.type !== "boundary:call") return;
    const { id, name, args = [] } = m;
    // look the capability up LIVE on the real complement (not the split) — the
    // function is the capability, and it runs with the complement as `this`
    const fn = complement && typeof complement[name] === "function" ? complement[name] : null;
    if (!fn) return reply({ type: "boundary:result", id, error: `no such capability: ${name}` });
    try {
      const value = await fn.apply(complement, args); // promises supported
      if (!isJsonable(value))
        return reply({ type: "boundary:result", id, error: `capability "${name}" returned a non-clonable value` });
      reply({ type: "boundary:result", id, value });
    } catch (err) {
      reply({ type: "boundary:result", id, error: errorMessage(err) });
    }
  };
  reply({ type: "boundary:complement", ...split });
  if (port.start) port.start();
  return () => {
    if (closed) return;
    closed = true;
    try { port.postMessage({ type: "boundary:close" }); } catch {}
    try { port.onmessage = null; } catch {}
  };
}

export function receiveBoundary(port) {
  return new Promise((resolve, reject) => {
    let settled = false, closed = false, nextId = 0;
    const pending = new Map(); // call id → { resolve, reject }
    const close = ({ post = true } = {}) => {
      if (closed) return;
      closed = true;
      for (const p of pending.values()) p.reject(new Error("boundary closed"));
      pending.clear();
      if (post) { try { port.postMessage({ type: "boundary:close" }); } catch {} }
      try { port.onmessage = null; } catch {}
      // closed before the complement ever arrived ⇒ the receive itself fails
      if (!settled) { settled = true; reject(new Error("boundary closed")); }
    };
    const invoke = (name, args) => {
      if (closed) return Promise.reject(new Error("boundary closed"));
      // a call is only safe when its args cross by value — refuse locally, before
      // the wire (clearer than a DataCloneError, and the near side never hears it)
      const bad = args.findIndex((a) => !isJsonable(a));
      if (bad !== -1)
        return Promise.reject(new Error(`capability "${name}": argument ${bad} is not clonable across the boundary`));
      return new Promise((res, rej) => {
        const id = ++nextId;
        pending.set(id, { resolve: res, reject: rej });
        try { port.postMessage({ type: "boundary:call", id, name, args }); }
        catch (e) { pending.delete(id); rej(e); }
      });
    };
    port.onmessage = (e) => {
      const m = e.data;
      if (!m || typeof m !== "object") return;
      if (m.type === "boundary:complement") {
        if (settled) return;
        settled = true;
        resolve({ complement: hydrateComplement(m, invoke), dropped: m.dropped || [], close: () => close() });
      } else if (m.type === "boundary:result") {
        const p = pending.get(m.id);
        if (!p) return; // unknown/late reply — drop
        pending.delete(m.id);
        if (m.error !== undefined) p.reject(new Error(m.error));
        else p.resolve(m.value);
      } else if (m.type === "boundary:close") {
        close({ post: false });
      }
    };
    if (port.start) port.start();
  });
}
