// A map as parts: what each object made from a map is built of. Pure.
//
// Doom's world is a plan of sectors, each with one floor and one ceiling
// height, and walls between them. A moving floor or ceiling stretches the
// walls beside it, which a scene object can't do: it is rigid. So a map
// becomes rigid parts:
//
// - the static part (door: null): everything that doesn't move. Built as if
//   every working door were OPEN, without the doors' ceilings: the walls
//   beside a door reach down only to where its underside stops when open,
//   and its jambs reach up to there.
// - a door (door: <sector>): a rigid prism: its underside (the sector's
//   ceiling) and, on each line to a neighbour, the strip of that
//   neighbour's upper wall that the door covers when shut (from its closed
//   height to its open one), set a hair inside the door so the wall above
//   hides it as it rises. Slid up by its travel, it is the door open.
//
// Textures are aligned as the map draws them at rest with EVERY DOOR SHUT
// (Doom's pegging rules, dmsp1666 §4.3/§4.4; a door shuts to its floor, so a
// door a map leaves ajar is drawn, and imported, shut), on every part alike,
// so the parts meet seamlessly while the doors are shut: an upper wall
// pegged to the lower ceiling (the default) has its texture's bottom on the
// door's bottom edge, so the door's face is the door's and moves with it.
//
// Coordinates are Doom's map units (x east, y north, z up), relative to the
// part's anchor; source.js turns them into the scene's metres, at
// UNITS_PER_METRE, one fixed scale for every part, so the parts of a map fit
// together by construction (a map is resized by its static object's scale,
// which its doors, attached to it, inherit).

import { insideLoop, sectorPolygons, triangulateSector } from "./sectors.js";
import { classify } from "./specials.js";
import { readMap, readTextures } from "./wad.js";

export const SKY = "F_SKY1";
export const UPPER_UNPEGGED = 8;
export const LOWER_UNPEGGED = 16;
/** How far inside a door its wall strips sit (map units), so the fixed wall above wins the depth test as it slides up behind it. */
export const INSET = 0.25;
/**
 * Map units to the metre, for every part: 36 puts Doom's common 16-unit steps
 * (0.44 m) under a walker's 0.45 m step, its 24-unit ones within a jump, and
 * its 56-unit player at 1.56 m.
 */
export const UNITS_PER_METRE = 36;

/** What a map is, worked out once per WAD and map (modelOf). */
export function mapModel(wad, name) {
  const key = `model:${name}`;
  if (!wad.cache.has(key)) wad.cache.set(key, modelOf(wad, readMap(wad, name)));
  return wad.cache.get(key);
}

/**
 * What a map is: the map, its specials, its doors, the sectors at rest with
 * every door shut (what textures are aligned to), and the ceilings the static
 * part is built at (every door open).
 */
export function modelOf(wad, map) {
  const specials = classify(map);
  const doors = new Map(specials.doors.map((d) => [d.sector, d]));
  const rest = map.sectors.map((s, i) => (doors.has(i) ? { ...s, ceiling: doors.get(i).closed } : s));
  const ceiling = map.sectors.map((s, i) => (doors.has(i) ? doors.get(i).open : s.ceiling));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of map.vertexes) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  return { wad, map, specials, doors, rest, ceiling, centre: [Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2)], polygons: new Map() };
}

const polygonsOf = (model, s) => {
  if (!model.polygons.has(s)) model.polygons.set(s, sectorPolygons(model.map, s).polygons);
  return model.polygons.get(s);
};

/** The sector a point is in, or -1. */
export function sectorAt(model, x, y) {
  const verts = model.map.vertexes;
  for (let s = 0; s < model.map.sectors.length; s++) {
    for (const p of polygonsOf(model, s)) if (insideLoop(x, y, p.outer, verts) && !p.holes.some((h) => insideLoop(x, y, h, verts))) return s;
  }
  return -1;
}

/** The lines bounding a sector (by its sides). */
const linesOf = (model, s) => model.map.linedefs.map((l, i) => i).filter((i) => {
  const l = model.map.linedefs[i];
  return model.map.sidedefs[l.right].sector === s || (l.left >= 0 && model.map.sidedefs[l.left].sector === s);
});

/** A door of the map that works here, or a throw saying why not. */
export function doorOf(model, sector) {
  const d = model.doors.get(sector);
  if (!d) throw new Error(`sector ${sector} of ${model.map.name} isn't a door that works here`);
  return d;
}

/** Where a part's frame is, in map units: its own geometry is built relative to it. The static part's (door null) is the map's middle at height 0; a door's the middle of its footprint at its shut height. */
export function anchorOf(model, door = null) {
  if (door == null) return [...model.centre, 0];
  const d = doorOf(model, door);
  const vs = linesOf(model, door).flatMap((i) => [model.map.linedefs[i].v1, model.map.linedefs[i].v2]).map((v) => model.map.vertexes[v]);
  const xs = vs.map((v) => v.x);
  const ys = vs.map((v) => v.y);
  return [Math.round((Math.min(...xs) + Math.max(...xs)) / 2), Math.round((Math.min(...ys) + Math.max(...ys)) / 2), d.closed];
}

/** Where a thing stands, in map units: its place, on the floor of the sector it's in. */
export function thingAt(model, index) {
  const t = model.map.things[index];
  if (!t) throw new Error(`${model.map.name} has no thing ${index}`);
  const s = sectorAt(model, t.x, t.y);
  return [t.x, t.y, s >= 0 ? model.map.sectors[s].floor : 0];
}

/**
 * The lines of a door's face whose upper wall is upper-unpegged. Doom keeps
 * such a texture still in the world as the door moves over it; a rigid part
 * carries it, so these are drawn right shut and slide with the door as it
 * opens (the notes say so).
 */
export function unpeggedFaces(model, door) {
  return linesOf(model, door).filter((i) => {
    const l = model.map.linedefs[i];
    return l.left >= 0 && model.map.sidedefs[l.right].sector !== model.map.sidedefs[l.left].sector && l.flags & UPPER_UNPEGGED;
  });
}

/** How bright a sector's light (0–255, Doom's) draws, as a linear grey to multiply the texture by. */
export function lightOf(level) {
  const f = Math.max(0, Math.min(255, level)) / 255;
  return f <= 0.04045 ? f / 12.92 : Math.pow((f + 0.055) / 1.055, 2.4);
}

/** Collects triangles into buckets, one per texture: what becomes a primitive (one draw). */
function collector(anchor) {
  const buckets = new Map();
  const bucket = (key, texture, kind) => {
    if (!buckets.has(key)) buckets.set(key, { key, texture, kind, positions: [], uvs: [], colors: [], indices: [] });
    return buckets.get(key);
  };
  const [ax, ay, az] = anchor;
  /** Corners [x, y, z] (map units) with uvs, a grey, and the way they should face: a fan of triangles. */
  function polygon(b, corners, uvs, grey, normal) {
    const base = b.positions.length / 3;
    for (let i = 0; i < corners.length; i++) {
      const [x, y, z] = corners[i];
      b.positions.push(x - ax, y - ay, z - az);
      b.uvs.push(...uvs[i]);
      b.colors.push(grey, grey, grey);
    }
    // wind toward `normal`
    const [p, q, r] = corners;
    const n = cross(sub(q, p), sub(r, p));
    const flip = n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0;
    for (let i = 1; i + 1 < corners.length; i++) {
      if (flip) b.indices.push(base, base + i + 1, base + i);
      else b.indices.push(base, base + i, base + i + 1);
    }
  }
  return { buckets, bucket, polygon };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * One wall strip of a side, from height z0 to z1, its texture's top row at
 * `top` (before the side's row offset): faces the side's sector, which is on
 * the right of (a → b).
 */
function wallStrip(c, textures, missing, side, a, b, z0, z1, top, grey, inset = 0, name) {
  if (!(z1 > z0) || !name || name === "-") return;
  const tex = textures.get(name);
  if (!tex) return void missing.add(name);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return;
  const n = [dy / len, -dx / len, 0]; // the right-hand side of a → b
  const ox = -n[0] * inset;
  const oy = -n[1] * inset;
  const u0 = side.xoff / tex.width;
  const u1 = (side.xoff + len) / tex.width;
  const v = (z) => (top + side.yoff - z) / tex.height;
  const corners = [[a.x + ox, a.y + oy, z0], [b.x + ox, b.y + oy, z0], [b.x + ox, b.y + oy, z1], [a.x + ox, a.y + oy, z1]];
  c.polygon(c.bucket(`wall:${name}`, name, "wall"), corners, [[u0, v(z0)], [u1, v(z0)], [u1, v(z1)], [u0, v(z1)]], grey, n);
}

/**
 * Where a wall's texture has its top row (before the side's row offset), by
 * Doom's pegging (dmsp1666 §4.3): which of the wall's edges the texture hangs
 * from. `F` is the side's sector and `B` the one beyond it, both at rest
 * ({ floor, ceiling }); `h` the texture's height.
 * - "wall" (a one-sided line's middle): from the ceiling; lower-unpegged,
 *   standing on the floor.
 * - "lower" (up to the higher floor beyond): from that floor; lower-unpegged,
 *   from this ceiling, as if it were the bottom of a wall reaching up there.
 * - "upper" (down to the lower ceiling beyond): standing on that ceiling, so
 *   it goes with whatever that ceiling is (a door's face); upper-unpegged,
 *   from this ceiling.
 * - "railing" (a two-sided line's middle): from the lower ceiling;
 *   lower-unpegged, standing on the higher floor.
 */
export function textureTop(kind, flags, F, B, h) {
  const lowerUnpegged = !!(flags & LOWER_UNPEGGED);
  if (kind === "wall") return lowerUnpegged ? F.floor + h : F.ceiling;
  if (kind === "lower") return lowerUnpegged ? F.ceiling : B.floor;
  if (kind === "upper") return flags & UPPER_UNPEGGED ? F.ceiling : B.ceiling + h;
  if (kind === "railing") return lowerUnpegged ? Math.max(F.floor, B.floor) + h : Math.min(F.ceiling, B.ceiling);
  throw new Error(`no wall kind ${kind}`);
}

/** Doom's fake contrast: walls running east–west a little darker, north–south a little lighter. */
const contrast = (a, b) => (a.y === b.y ? -16 : a.x === b.x ? 16 : 0);

/**
 * The walls of one side of a line, as the static part has them.
 * `model.rest` gives the heights textures are aligned at (the map at rest,
 * doors shut); `model.ceiling` the heights the walls span (doors open).
 */
function sideWalls(c, model, textures, missing, l, sideIndex, other, a, b) {
  const { map, rest, ceiling } = model;
  const side = map.sidedefs[sideIndex];
  const s = side.sector;
  const F = rest[s];
  const grey = lightOf(F.light + contrast(a, b));
  const fc = ceiling[s];
  const height = (name) => textures.get(name)?.height ?? 0;
  if (other < 0) return wallStrip(c, textures, missing, side, a, b, F.floor, fc, textureTop("wall", l.flags, F, null, height(side.middle)), grey, 0, side.middle);
  const B = rest[other];
  const bc = ceiling[other];
  // lower: from this floor up to the higher one beyond
  if (B.floor > F.floor) wallStrip(c, textures, missing, side, a, b, F.floor, B.floor, textureTop("lower", l.flags, F, B, height(side.lower)), grey, 0, side.lower);
  // upper: from the lower ceiling beyond up to this one, unless both are sky
  if (bc < fc && !(F.ceilingFlat === SKY && B.ceilingFlat === SKY)) wallStrip(c, textures, missing, side, a, b, bc, fc, textureTop("upper", l.flags, F, B, height(side.upper)), grey, 0, side.upper);
  // a railing or a grate: one texture tall, in the opening
  if (side.middle && side.middle !== "-") {
    const tex = textures.get(side.middle);
    if (!tex) return void missing.add(side.middle);
    const top = textureTop("railing", l.flags, F, B, tex.height);
    const z1 = Math.min(fc, bc, top + side.yoff);
    const z0 = Math.max(F.floor, B.floor, top + side.yoff - tex.height);
    wallStrip(c, textures, missing, side, a, b, z0, z1, top, grey, 0, side.middle);
  }
}

/** A sector's floor (facing up) or ceiling (facing down) at height z, with its flat aligned to the world's 64-unit grid. */
function plane(c, model, s, z, flat, up) {
  if (!flat || flat === SKY) return;
  const { map } = model;
  const tri = triangulateSector(map, s).triangles;
  const b = c.bucket(`flat:${flat}`, flat, "flat");
  const grey = lightOf(map.sectors[s].light);
  for (const t of tri) {
    const corners = t.map((v) => [map.vertexes[v].x, map.vertexes[v].y, z]);
    c.polygon(b, corners, corners.map(([x, y]) => [x / 64, -y / 64]), grey, [0, 0, up ? 1 : -1]);
  }
}

/**
 * A part's triangles, by texture: the static part (door null) or a door's.
 * @returns {{ anchor: number[], buckets: Map<string, { key, texture, kind, positions, uvs, colors, indices }>, missing: string[] }}
 */
export function partGeometry(model, door = null) {
  const anchor = anchorOf(model, door);
  const c = collector(anchor);
  const textures = readTextures(model.wad);
  const missing = new Set();
  const { map, rest } = model;
  const V = map.vertexes;
  if (door == null) {
    map.sectors.forEach((sec, s) => {
      plane(c, model, s, sec.floor, sec.floorFlat, true);
      if (!model.doors.has(s)) plane(c, model, s, sec.ceiling, sec.ceilingFlat, false);
    });
    map.linedefs.forEach((l) => {
      const front = map.sidedefs[l.right].sector;
      const back = l.left >= 0 ? map.sidedefs[l.left].sector : -1;
      sideWalls(c, model, textures, missing, l, l.right, back, V[l.v1], V[l.v2]);
      if (l.left >= 0) sideWalls(c, model, textures, missing, l, l.left, front, V[l.v2], V[l.v1]);
    });
  } else {
    const d = model.doors.get(door);
    const sec = rest[door];
    plane(c, model, door, d.closed, sec.ceilingFlat, false);
    // the strip of each neighbour's upper wall the door is, when shut
    map.linedefs.forEach((l) => {
      if (l.left < 0) return;
      const front = map.sidedefs[l.right].sector;
      const back = map.sidedefs[l.left].sector;
      if (front === back || (front !== door && back !== door)) return;
      // the neighbour's side, which faces away from the door
      const [sideIndex, a, b, other] = front === door ? [l.left, V[l.v2], V[l.v1], back] : [l.right, V[l.v1], V[l.v2], front];
      const S = rest[other];
      const side = map.sidedefs[sideIndex];
      // aligned as the static part aligns the rest of that wall: at rest, the door shut
      const top = textureTop("upper", l.flags, S, sec, textures.get(side.upper)?.height ?? 0);
      wallStrip(c, textures, missing, side, a, b, d.closed, Math.min(d.open, model.ceiling[other]), top, lightOf(S.light + contrast(a, b)), INSET, side.upper);
    });
  }
  return { anchor, buckets: c.buckets, missing: [...missing].sort() };
}
