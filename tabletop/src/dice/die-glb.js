// A die as a GLB, at real size: the solid, each side in its colour, with its
// faces' marks drawn a hair proud of it. Pure: no DOM, no three.js.
//
// A face with a picture (die.js `image`) shows it over the whole side read,
// drawn a hair proud as its marks are, its top toward the marks' up; its
// marks are left out. The picture comes cropped, as `textures` (face index →
// { bytes, mimeType }: source.js crops them through whoever reads files);
// a face whose picture isn't given is drawn with its marks.
//
// The GLB's frame: metres, Y up, the die standing on y = 0 showing face 0,
// its middle over the origin; so a die put down at a point stands on it.
//
// What the die IS goes in the GLB too, as `extras.dice` on the glTF scene
// (builtDie below; roll.js says what's in it): the faces' up directions and
// labels, and the solid's corners. A scene reads a die from there, from the
// very thing it is showing, never from a second copy of the shapes, so what
// is rolled and read is always the die that was built.

import { computeBounds, encodeGLB } from "../kit/glb.js";
import { encodeGLB as encodeTextured } from "../glb.js";
import { dieOf } from "./die.js";
import { dieMarks, lift, placements } from "./marks.js";
import { add, dot, scale, sub } from "./m3.js";
import { solid } from "./solids.js";

/** How far the marks stand off a side, as a part of the die's size. */
const PROUD = 0.004;
/** How many sides a round joint, and a spot, are drawn with. */
const JOINT_SIDES = 8;
const DISC_SIDES = 16;

const trim = (v) => +(+v).toFixed(9) + 0;

/** What a built die says about itself (roll.js builtOf reads it back). */
export function builtDie(die, s = solid(die.shape)) {
  const k = die.size;
  return {
    v: 1,
    shape: die.shape,
    turnOnly: die.turnOnly,
    centre: [0, trim(s.outcomes[0].rest * k), 0],
    verts: s.verts.map((v) => v.map((x) => trim(x * k))),
    faces: s.outcomes.map((o, i) => ({ up: o.up.map(trim), rest: trim(o.rest * k), label: die.faces[i].label })),
  };
}

/** Triangles being gathered by colour: color → { positions, normals, indices }. */
function gather() {
  const byColor = new Map();
  return {
    /** a flat convex outline, its corners anticlockwise about `normal` */
    fan(color, pts, normal) {
      if (!byColor.has(color)) byColor.set(color, { positions: [], normals: [], indices: [] });
      const g = byColor.get(color);
      const base = g.positions.length / 3;
      for (const p of pts) {
        g.positions.push(...p);
        g.normals.push(...normal);
      }
      for (let i = 1; i + 1 < pts.length; i++) g.indices.push(base, base + i, base + i + 1);
    },
    primitives: () => [...byColor.entries()].map(([color, g]) => ({ ...g, color })),
  };
}

const circle = (c, r, n) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);

/** A stroke as flat outlines (x right, y up, each anticlockwise): a strip per step and a round joint at every point. */
export function strokeOutlines({ points, closed, width }) {
  const out = [];
  const h = width / 2;
  const n = points.length;
  for (let i = 0; i + 1 < n || (closed && i < n); i++) {
    const a = points[i], b = points[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-12) continue;
    const nx = (-dy / l) * h, ny = (dx / l) * h;
    out.push([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]);
  }
  for (const p of points) out.push(circle(p, h, JOINT_SIDES));
  return out;
}

/**
 * A face's picture on the side read when it shows: that side's corners (unit
 * solid), with uvs putting the picture's square over the side's square
 * about its middle, its top toward the marks' up, turned as the face is.
 * null for a face read at a corner (a d4): it has no side of its own.
 */
export function pictureSide(s, i, turn = 0) {
  const pl = placements(s, i)[0];
  if (!pl || s.outcomes[i].readPoly == null) return null;
  const poly = s.polys[pl.poly];
  const pts = poly.verts.map((v) => s.verts[v]);
  const c = scale(pts.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / pts.length);
  const a = (-turn * Math.PI) / 180;
  const flat = pts.map((p) => {
    const x = dot(sub(p, c), pl.right);
    const y = dot(sub(p, c), pl.up);
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  });
  const h = Math.max(...flat.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)])) || 1;
  return { pts, normal: poly.normal, uvs: flat.flatMap(([x, y]) => [trim(0.5 + x / (2 * h)), trim(0.5 - y / (2 * h))]) };
}

/**
 * A die doc → its GLB and what it measures.
 * @param {object} doc
 * @param {{ textures?: Map<number, { bytes: Uint8Array, mimeType: string }> }} [o]  each pictured face's picture, cropped
 * @returns {{ glb: Uint8Array, bounds: { min: number[], max: number[] }, built: object, die: object }}
 */
export function dieGLB(doc, { textures = null } = {}) {
  const die = dieOf(doc);
  const s = solid(die.shape);
  const k = die.size;
  const centre = [0, s.outcomes[0].rest * k, 0];
  const place = (p) => add(centre, scale(p, k));

  // the solid: each side flat, in the colour of the face read from it (else the body's)
  const body = gather();
  s.polys.forEach((poly, p) => {
    const reads = s.outcomes.findIndex((o) => o.readPoly === p);
    const color = (reads >= 0 ? die.faces[reads].color : null) ?? die.body;
    body.fan(color, poly.verts.map((v) => place(s.verts[v])), poly.normal);
  });

  // the pictures, each over its side, a hair proud: and those faces' marks left out
  const images = [];
  const pictured = [];
  die.faces.forEach((f, i) => {
    const t = f.image ? textures?.get?.(i) : null;
    const side = t?.bytes?.length ? pictureSide(s, i, f.turn) : null;
    if (!side) return;
    const positions = side.pts.flatMap((p) => place(add(p, scale(side.normal, PROUD))));
    const indices = [];
    for (let k = 1; k + 1 < side.pts.length; k++) indices.push(0, k, k + 1);
    pictured.push({ face: i, positions, normals: side.pts.flatMap(() => side.normal), uvs: side.uvs, indices, texture: { image: images.length, wrap: "clamp" }, color: "#ffffff", roughness: 0.6 });
    images.push({ bytes: t.bytes, mimeType: t.mimeType ?? "image/png" });
  });
  const bare = new Set(pictured.map((p) => p.face));

  // the marks, lifted onto their sides
  const ink = gather();
  for (const m of dieMarks(die, s)) {
    if (bare.has(m.face)) continue;
    const pl = m.placement;
    const onSide = (q) => place(add(lift(pl, q), scale(pl.normal, PROUD)));
    for (const st of m.strokes) for (const outline of strokeOutlines(st)) ink.fan(m.ink, outline.map(onSide), pl.normal);
    for (const d of m.discs) ink.fan(m.ink, circle(d.c, d.r, DISC_SIDES).map(onSide), pl.normal);
  }

  const built = builtDie(die, s);
  const meshes = [{ name: "die", primitives: body.primitives().map((p) => ({ ...p, roughness: 0.55 })) }];
  const marks = ink.primitives();
  if (marks.length) meshes.push({ name: "marks", primitives: marks.map((p) => ({ ...p, roughness: 0.7 })) });
  for (const { face, ...p } of pictured) meshes.push({ name: `face ${face + 1}`, primitives: [p] });
  // (a pictured die needs the encoder with textures: the kit's has none)
  const glb = pictured.length ? encodeTextured({ generator: "patchwork dice", images, meshes, extras: { dice: built } }) : encodeGLB({ generator: "patchwork dice", meshes, extras: { dice: built } });
  const all = meshes.flatMap((m) => m.primitives.flatMap((p) => p.positions));
  const b = computeBounds(all);
  return { glb, bounds: { min: b.min.map(trim), max: b.max.map(trim) }, built, die };
}
