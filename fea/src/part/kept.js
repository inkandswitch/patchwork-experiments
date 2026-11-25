// The part a study keeps: its surface as it was read, and the faces it was
// split into then.
//
// A support says "faces 3 and 7", so what face 7 is must not move under it.
// So the split is made ONCE, when the part is linked or read again, and kept
// as data: the welded surface as a binary STL (Float32) and, for each of its
// triangles in order, the number of its face. A study opens from this alone
// (nothing rebuilt, nothing re-split), a run freezes a copy of it, and the
// run meshes exactly these triangles with exactly these face numbers. A
// newer version of the splitting rule changes nothing that was already kept.
//
// When the model changes and is read again, the faces are split afresh and
// the setup's faces are carried over by what each face looks like
// (carryFaces): where it is, which way it faces, how big it is.

import { encodeSTL, decodeSTL } from "./stl.js";
import { weld, soup } from "./faces.js";

export const PART_TYPE = "fea-part";

const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength).slice();
const asBytes = (v) => (v instanceof Uint8Array ? v : new Uint8Array(v));

/**
 * What is kept of a part (a plain value: a `fea-part` doc's contents, and a run's `part`).
 * @param {ReturnType<import("./faces.js").readPart>} part
 * @param {{ url: string, title: string, heads?: string[]|null, path?: string, providerId?: string|null, providerName?: string|null, readAt: number }} source
 */
export function encodePart(part, source) {
  return {
    title: source.title,
    stl: encodeSTL(soup(part), { name: source.title }),
    faceOf: bytesOf(Uint32Array.from(part.faceOf)),
    faces: part.faces.map((f) => ({ id: f.id, triangles: f.triangles, area: f.area, centroid: [...f.centroid], normal: [...f.normal], at: [...f.at], atNormal: [...f.atNormal], flat: f.flat, box: { min: [...f.box.min], max: [...f.box.max] }, radius: f.radius })),
    volume: part.volume,
    area: part.area,
    box: { min: [...part.box.min], max: [...part.box.max] },
    diagonal: part.diagonal,
    solid: part.solid,
    problems: [...part.problems],
    notes: [...part.notes],
    source: { url: source.url, title: source.title, heads: source.heads ? [...source.heads] : null, path: source.path ?? null, providerId: source.providerId ?? null, providerName: source.providerName ?? null, readAt: source.readAt },
  };
}

/**
 * A kept part back as geometry. `stl` and `faceOf` must be bytes (a ref to
 * segments is fetched first: src/segments.js, getBytes).
 * @returns {ReturnType<import("./faces.js").readPart> & { source: object, title: string }}
 */
export function decodePart(kept) {
  if (!kept?.stl || !kept?.faceOf) throw new Error("no part is kept here");
  const mesh = weld(decodeSTL(asBytes(kept.stl)), { exact: true });
  const faceBytes = asBytes(kept.faceOf);
  // copy: bytes out of a doc needn't be 4-aligned
  const faceOf = new Uint32Array(faceBytes.slice().buffer);
  if (faceOf.length !== mesh.tris.length / 3) throw new Error("the kept part's faces don't match its triangles");
  return {
    positions: mesh.positions,
    tris: mesh.tris,
    faceOf,
    faces: (kept.faces ?? []).map((f) => ({ ...f, centroid: [...f.centroid], normal: [...f.normal], at: [...f.at], atNormal: [...f.atNormal], box: { min: [...f.box.min], max: [...f.box.max] } })),
    volume: kept.volume,
    area: kept.area,
    box: { min: [...kept.box.min], max: [...kept.box.max] },
    diagonal: kept.diagonal,
    solid: kept.solid === true,
    problems: [...(kept.problems ?? [])],
    notes: [...(kept.notes ?? [])],
    source: kept.source ?? null,
    title: kept.title ?? kept.source?.title ?? "part",
  };
}

/**
 * Which face of a newly read part each face of the old one is: the nearest
 * that is alike. Alike: both flat or both not, facing within 10°, within a
 * fiftieth of the part's size of the same place, and within a tenth of the
 * same area. Each new face answers for one old face at most (the closest).
 * @returns {Map<number, number|null>}  old face → new face, or null where none is alike
 */
export function carryFaces(oldPart, newPart) {
  const reach = Math.max(oldPart.diagonal, newPart.diagonal) / 50;
  const cos10 = Math.cos((10 * Math.PI) / 180);
  const candidates = [];
  for (const a of oldPart.faces)
    for (const b of newPart.faces) {
      if (a.flat !== b.flat) continue;
      const d = Math.hypot(a.centroid[0] - b.centroid[0], a.centroid[1] - b.centroid[1], a.centroid[2] - b.centroid[2]);
      if (d > reach) continue;
      if (Math.abs(a.area - b.area) > 0.1 * Math.max(a.area, b.area)) continue;
      const la = Math.hypot(...a.normal), lb = Math.hypot(...b.normal);
      if (la > 0.5 !== lb > 0.5) continue;
      if (la > 0.5 && a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2] < cos10) continue;
      candidates.push({ a: a.id, b: b.id, score: d / (reach || 1) + Math.abs(a.area - b.area) / Math.max(a.area, b.area) });
    }
  candidates.sort((x, y) => x.score - y.score || x.a - y.a || x.b - y.b);
  const out = new Map(oldPart.faces.map((f) => [f.id, null]));
  const used = new Set();
  for (const c of candidates) {
    if (out.get(c.a) != null || used.has(c.b)) continue;
    out.set(c.a, c.b);
    used.add(c.b);
  }
  return out;
}

/**
 * A setup's supports and loads moved onto a newly read part's faces.
 * @param {object} setup   normalised
 * @param {Map<number, number|null>} carried   from carryFaces
 * @returns {{ supports: object, loads: object, lost: { what: "support"|"load", id: string, name: string, faces: number }[] }}
 *   the maps to write back; `lost`: those with faces the new part has nothing like (their other faces are kept)
 */
export function carrySetup(setup, carried) {
  const lost = [];
  const move = (what, map) => {
    const out = {};
    for (const [id, item] of Object.entries(map ?? {})) {
      if (!Array.isArray(item.faces)) {
        out[id] = item;
        continue;
      }
      const faces = item.faces.map((f) => carried.get(f) ?? null);
      const gone = faces.filter((f) => f == null).length;
      if (gone) lost.push({ what, id, name: item.name, faces: gone });
      out[id] = { ...item, faces: [...new Set(faces.filter((f) => f != null))].sort((a, b) => a - b) };
    }
    return out;
  };
  return { supports: move("support", setup.supports), loads: move("load", setup.loads), lost };
}
