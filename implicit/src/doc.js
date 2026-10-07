// Pure helpers for the implicit-surface document. No DOM, no imports that
// need the importmap: the scene provider, the worker and the tool share these.

export const DATATYPE_ID = "implicit-surface";

export const DEFAULT_BOUNDS = Object.freeze({ min: Object.freeze([-0.5, -0.5, -0.5]), max: Object.freeze([0.5, 0.5, 0.5]) });

/** Largest bounds edge we accept, in metres (a sanity limit, not a design rule). */
export const MAX_EXTENT = 10_000;

/**
 * Check a bounds object. Returns null when it is usable, else a sentence.
 * @param {any} b
 */
export function boundsProblem(b) {
  if (!b || typeof b !== "object") return "Bounds are missing.";
  for (const key of ["min", "max"]) {
    const v = b[key];
    if (!v || typeof v.length !== "number" || v.length !== 3) return `Bounds ${key} must be three numbers [x, y, z].`;
    for (let i = 0; i < 3; i++) {
      const n = Number(v[i]);
      if (!Number.isFinite(n)) return `Bounds ${key} ${"xyz"[i]} is not a number.`;
      if (Math.abs(n) > MAX_EXTENT) return `Bounds ${key} ${"xyz"[i]} is further than ${MAX_EXTENT} m from the origin.`;
    }
  }
  for (let i = 0; i < 3; i++) {
    if (!(Number(b.max[i]) > Number(b.min[i]))) return `Bounds max ${"xyz"[i]} must be larger than min ${"xyz"[i]}.`;
  }
  return null;
}

/** Plain-number copy of usable bounds, or the defaults. */
export function normalizeBounds(b) {
  if (boundsProblem(b)) return { min: [...DEFAULT_BOUNDS.min], max: [...DEFAULT_BOUNDS.max] };
  return { min: [0, 1, 2].map((i) => Number(b.min[i])), max: [0, 1, 2].map((i) => Number(b.max[i])) };
}

/** cyrb53: a small, fast, well-mixed 53-bit string hash, as 14 hex digits. */
export function hashString(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

/** Bump when the mesher's output changes for the same input, so old renders go stale. */
export const MESHER_VERSION = 1;

/**
 * Everything build() reads from the doc: the source, the bounds, and the
 * title (which names the mesh in the scene outline).
 */
export function fingerprintDoc(doc) {
  const source = String(doc?.source ?? "");
  const b = normalizeBounds(doc?.bounds);
  const title = String(doc?.title ?? "");
  return `v${MESHER_VERSION}:${hashString(`${source}\u0000${JSON.stringify(b)}\u0000${title}`)}`;
}
