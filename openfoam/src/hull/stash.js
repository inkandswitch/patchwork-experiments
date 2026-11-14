// The hull a case keeps with itself: the geometry it uses, read once from
// the model, so the case opens without the original. Pure.
//
// A model can be huge (Jim's Daysailor is a 92 MB Rhino file, seconds to
// convert, and too big to reach a fresh browser at all) while the hull a
// case uses is small (11,000 triangles, under half a megabyte). So when you
// link a hull, choose its parts, or re-read it, the case writes one small
// `openfoam-hull` doc: the chosen parts' triangles in the model's own frame
// (before the bow turn and waterline shift, so changing those needs nothing
// more), every part's summary (so the parts list still works), and what it
// was read from (the doc's heads, the reader, its version and params).
//
// Opening a case reads only this. Whether the original has changed since is
// not checked on open (that would mean loading the original); the case says
// when the hull was read, and "Re-read" reads it again.

export const STASH_TYPE = "openfoam-hull";
/** Bump when what a stash holds, or how it's read, changes. */
export const STASH_VERSION = 1;
/** A hull bigger than this isn't kept: the case reads the model each time instead. */
export const STASH_MAX_TRIANGLES = 2_000_000;

const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength).slice();

/**
 * A stash doc for the chosen parts of a model as read.
 * @param {object} o
 * @param {Float64Array} o.triangles   the model's triangles as read (floating frame, metres)
 * @param {{ name: string, from: number, to: number }[]} o.ranges
 * @param {object[]} o.parts           partsOf() of the whole model
 * @param {string[]} o.chosen          the parts to keep
 * @param {object} o.source            { url, heads, path, providerId, providerName, title }
 * @param {number} o.now
 * @returns {object|null}  null when the chosen parts are too big to keep
 */
export function makeStash({ triangles, ranges, parts, chosen, source, now }) {
  const want = new Set(chosen);
  let n = 0;
  for (const r of ranges) if (want.has(r.name)) n += r.to - r.from;
  if (n > STASH_MAX_TRIANGLES) return null;
  const out = new Float32Array(n * 9);
  const kept = [];
  let o = 0;
  for (const r of ranges) {
    if (!want.has(r.name)) continue;
    const from = o / 9;
    out.set(triangles.subarray(r.from * 9, r.to * 9), o);
    o += (r.to - r.from) * 9;
    kept.push({ name: r.name, from, to: o / 9 });
  }
  return {
    "@patchwork": { type: STASH_TYPE },
    title: `${source?.title ?? "hull"} · hull`,
    version: STASH_VERSION,
    builtAt: now,
    source: {
      url: source?.url ?? null,
      heads: Array.isArray(source?.heads) ? [...source.heads].map(String).sort() : null,
      path: source?.path ?? null,
      providerId: source?.providerId ?? null,
      providerName: source?.providerName ?? null,
      title: source?.title ?? null,
    },
    parts: parts.map((p) => ({ name: p.name, triangles: p.triangles, min: [...p.min], max: [...p.max], flat: !!p.flat })),
    chosen: [...new Set(kept.map((r) => r.name))],
    ranges: kept,
    triangles: bytesOf(out),
  };
}

/**
 * A stash doc read back as acquireHull would have given the model, holding
 * only the kept parts' triangles (`parts` still lists every part).
 * @returns {{ ok: true, triangles: Float64Array, ranges: object[], parts: object[], kept: string[], path: "stash", title: string, stash: object } | null}
 */
export function fromStash(doc) {
  if (doc?.["@patchwork"]?.type !== STASH_TYPE || doc.version !== STASH_VERSION || !doc.triangles) return null;
  const b = doc.triangles instanceof Uint8Array ? doc.triangles : new Uint8Array(doc.triangles);
  const f32 = new Float32Array(b.slice().buffer);
  return {
    ok: true,
    triangles: Float64Array.from(f32),
    ranges: (doc.ranges ?? []).map((r) => ({ name: r.name, from: r.from, to: r.to })),
    parts: (doc.parts ?? []).map((p) => ({ name: p.name, triangles: p.triangles, min: [...p.min], max: [...p.max], flat: !!p.flat })),
    kept: [...(doc.chosen ?? [])],
    path: "stash",
    title: doc.source?.title ?? doc.title ?? "hull",
    providerName: doc.source?.providerName ?? null,
    providerId: doc.source?.providerId ?? null,
    stash: { builtAt: doc.builtAt, source: doc.source },
  };
}

/** Can these parts be had from a stash that kept `kept`? (Water planes are never needed.) */
export function stashCovers(kept, wanted) {
  const k = new Set(kept);
  return wanted.every((n) => k.has(n));
}
