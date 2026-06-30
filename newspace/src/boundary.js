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
// This module is the pure split; the actual MessagePort proxy is built on top (TODO,
// see NODES.md). Keeping it pure means we can test the policy without a channel.

// can this value cross a structured-clone / JSON boundary as data?
// transferable / structured-cloneable across a worker/iframe boundary
const CLONEABLE = ["ArrayBuffer", "ImageData", "ImageBitmap", "Blob"];
function isCloneable(v) {
  if (ArrayBuffer.isView(v)) return true; // typed arrays (incl. Uint8Array, Float32Array, Uint8ClampedArray)
  const tag = v && v.constructor && v.constructor.name;
  return CLONEABLE.includes(tag);
}
export function isJsonable(v) {
  if (v == null) return true;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (isCloneable(v)) return true; // typed arrays, ImageData, ImageBitmap, ArrayBuffer, Blob
  if (Array.isArray(v)) return v.every(isJsonable);
  if (t === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false; // class instances (File, MediaStream, handles)
    return Object.values(v).every(isJsonable);
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
