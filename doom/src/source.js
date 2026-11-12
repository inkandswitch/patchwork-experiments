// scene:source "doom-map": a part of a map in a .wad file doc, as a GLB.
// Params { map, door } (index.js): which map, and which part of it: a door
// (its sector), or with none, the static part (parts.js). Every part is built
// at the same scale (UNITS_PER_METRE), so a map's parts fit together whatever
// else is done to them. Every object made from a map reads the same file doc;
// what it shows is a function of that doc and its params alone.

import { noticeOf, originOf } from "./freedoom.js";
import { encodeGLB } from "./glb.js";
import { encodePNG, flatImage, wallImage } from "./images.js";
import { doorOf, mapModel, partGeometry, UNITS_PER_METRE, unpeggedFaces } from "./parts.js";
import { readWad } from "./wad.js";

/** The bytes of a `file` doc. */
export function fileBytes(doc) {
  const c = doc?.content;
  if (c instanceof Uint8Array) return c;
  if (ArrayBuffer.isView(c)) return new Uint8Array(c.buffer, c.byteOffset, c.byteLength);
  if (c instanceof ArrayBuffer) return new Uint8Array(c);
  throw new Error("this file has no bytes");
}

// one reading per file's bytes: every part of a map builds from the same doc
const read = new WeakMap();
export function wadOf(doc) {
  const bytes = fileBytes(doc);
  if (!read.has(bytes)) read.set(bytes, readWad(bytes));
  return read.get(bytes);
}

/** The PNG of a texture or flat, made once per WAD. */
async function pngOf(wad, kind, name) {
  const key = `png:${kind}:${name}`;
  if (!wad.cache.has(key)) {
    const img = kind === "wall" ? wallImage(wad, name) : flatImage(wad, name);
    wad.cache.set(key, img ? encodePNG(img).then((bytes) => ({ bytes, clear: img.clear })) : Promise.resolve(null));
  }
  return wad.cache.get(key);
}

/** A map named in a WAD, or a throw naming the ones it has. */
export function mapIn(wad, map) {
  if (typeof map === "string" && wad.maps.includes(map)) return map;
  throw new Error(`${map ? `no map ${map} in this WAD` : "which map?"}: it has ${wad.maps.join(", ") || "none"}`);
}

/**
 * A part of a map as a GLB, Y-up metres, its origin at the part's anchor.
 * @param {object} wad   readWad's
 * @param {{ map: string, door?: number | null }} params   door null: the static part
 * @param {{ copyright?: string | null }} [o]
 */
export async function buildPart(wad, { map, door = null }, { copyright = null } = {}) {
  const k = 1 / UNITS_PER_METRE;
  const model = mapModel(wad, mapIn(wad, map));
  const { buckets, missing } = partGeometry(model, door);
  const images = [];
  const materials = [];
  const primitives = [];
  for (const b of buckets.values()) {
    const png = await pngOf(wad, b.kind, b.texture);
    if (!png) {
      missing.push(b.texture);
      continue;
    }
    const image = images.push({ name: b.texture, bytes: png.bytes, mimeType: "image/png" }) - 1;
    const material = materials.push({ name: b.key, image, alphaMask: png.clear }) - 1;
    // map units (x east, y north, z up) → metres (x east, y up, z south)
    const src = b.positions;
    const positions = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      positions[i] = src[i] * k;
      positions[i + 1] = src[i + 2] * k;
      positions[i + 2] = -src[i + 1] * k;
    }
    primitives.push({ positions, uvs: b.uvs, colors: b.colors, indices: b.indices, material });
  }
  const bounds = boundsOf(primitives);
  const glb = encodeGLB({ meshes: [{ name: door == null ? map : `${map} door ${door}`, primitives }], materials, images, copyright: copyright ?? undefined });
  return { glb, bounds, missing: [...new Set(missing)].sort() };
}

function boundsOf(primitives) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of primitives) {
    for (let i = 0; i < p.positions.length; i++) {
      const v = p.positions[i];
      const a = i % 3;
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return min[0] <= max[0] ? { min, max } : null;
}

/** What a part's build says about itself (the render's notes). */
export function notesOf(model, door, missing) {
  const map = model.map.name;
  const out = [];
  if (door == null) {
    const { specials } = model;
    out.push(`${map}: ${model.map.sectors.length} sectors; ${specials.doors.length} doors are objects of their own.`);
    if (specials.resting.length) out.push(`Imported where they rest, not working here: ${specials.resting.map((r) => `${r.kind} (sector${r.sectors.length > 1 ? "s" : ""} ${r.sectors.join(", ")})`).join("; ")}.`);
    if (specials.inert.length) out.push(`Not imported: ${specials.inert.map((r) => `${r.kind} (${r.lines.length} line${r.lines.length > 1 ? "s" : ""})`).join("; ")}.`);
  } else {
    const d = doorOf(model, door);
    out.push(`${map}: the door of sector ${door}, ${d.open - d.closed} units of travel.`);
    if (d.ajar > 0) out.push(`The map leaves it ${d.ajar} units ajar; it is imported shut.`);
    const faces = unpeggedFaces(model, door);
    if (faces.length) out.push(`Its face on line${faces.length > 1 ? "s" : ""} ${faces.join(", ")} is upper-unpegged: Doom keeps that texture still as the door rises; here it rises with the door.`);
  }
  if (missing.length) out.push(`Not in this WAD, left undrawn: ${missing.join(", ")}.`);
  return out.join(" ");
}

export default {
  async build({ doc, params }) {
    const wad = wadOf(doc);
    const map = mapIn(wad, params.map);
    const door = params.door ?? null;
    const { glb, bounds, missing } = await buildPart(wad, { map, door }, { copyright: noticeOf(originOf(doc, wad)) });
    return { kind: "glb", glb, meta: { ...(bounds ? { bounds } : {}), notes: notesOf(mapModel(wad, map), door, missing) } };
  },
};
