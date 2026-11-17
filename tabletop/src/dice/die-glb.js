// A die as a GLB, at real size: the solid, each side in its colour, with its
// faces' marks drawn a hair proud of it. Pure: no DOM, no three.js.
//
// The GLB's frame: metres, Y up, the die standing on y = 0 showing face 0,
// its middle over the origin; so a die put down at a point stands on it.
//
// What the die IS goes in the GLB too, as `extras.dice` on the glTF scene
// (builtDie below; roll.js says what's in it): the faces' up directions and
// labels, and the solid's corners. A scene reads a die from there, from the
// very thing it is showing, never from a second copy of the shapes, so what
// is rolled and read is always the die that was built.

import { computeBounds, encodeGLB } from "./glb.js";
import { dieOf } from "./die.js";
import { dieMarks, lift } from "./marks.js";
import { add, scale } from "./m3.js";
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
 * A die doc → its GLB and what it measures.
 * @returns {{ glb: Uint8Array, bounds: { min: number[], max: number[] }, built: object, die: object }}
 */
export function dieGLB(doc) {
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

  // the marks, lifted onto their sides
  const ink = gather();
  for (const m of dieMarks(die, s)) {
    const pl = m.placement;
    const onSide = (q) => place(add(lift(pl, q), scale(pl.normal, PROUD)));
    for (const st of m.strokes) for (const outline of strokeOutlines(st)) ink.fan(m.ink, outline.map(onSide), pl.normal);
    for (const d of m.discs) ink.fan(m.ink, circle(d.c, d.r, DISC_SIDES).map(onSide), pl.normal);
  }

  const built = builtDie(die, s);
  const meshes = [{ name: "die", primitives: body.primitives().map((p) => ({ ...p, roughness: 0.55 })) }];
  const marks = ink.primitives();
  if (marks.length) meshes.push({ name: "marks", primitives: marks.map((p) => ({ ...p, roughness: 0.7 })) });
  const glb = encodeGLB({ generator: "patchwork dice", meshes, extras: { dice: built } });
  const all = meshes.flatMap((m) => m.primitives.flatMap((p) => p.positions));
  const b = computeBounds(all);
  return { glb, bounds: { min: b.min.map(trim), max: b.max.map(trim) }, built, die };
}
