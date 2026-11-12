// A sector's floor and ceiling: the polygon its lines bound, traced and cut
// into triangles. Pure.
//
// A sector is whatever its sides face: every line whose front (right) side
// is in it contributes the edge v1 → v2, and every line whose back (left)
// side is in it the edge v2 → v1, so the sector is always on the right of
// its edges. Lines with both sides in the sector bound nothing and are left
// out. The edges are chained into loops; at a vertex where several leave
// (two parts of a sector touching at a point, a hole touching the outline),
// the edge taken is the one turning most sharply to the right, so each loop
// keeps to one face. Walking with the sector on the right, an outline goes
// clockwise and a hole counter-clockwise (in Doom's x east, y north). Each
// hole goes in the smallest outline that contains it, and each outline with
// its holes is triangulated by earcut.

import earcut from "earcut";

/** Twice the signed area of a loop of vertex indices (counter-clockwise positive). */
export function loopArea2(loop, verts) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = verts[loop[i]];
    const q = verts[loop[(i + 1) % loop.length]];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

/** Is point (x, y) inside the loop (even-odd)? Points on an edge may fall either way. */
export function insideLoop(x, y, loop, verts) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = verts[loop[i]];
    const b = verts[loop[j]];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The directed edges bounding sector `s`: [from, to] vertex pairs, the sector on their right. */
export function sectorEdges(map, s) {
  const seen = new Map(); // "a,b" → count
  const add = (a, b) => {
    if (a === b) return;
    const back = `${b},${a}`;
    // an edge and its reverse (two lines over one another, facing apart) bound nothing
    if (seen.get(back) > 0) return void seen.set(back, seen.get(back) - 1);
    const k = `${a},${b}`;
    // the same edge twice (two lines over one another, facing alike) is one edge
    if (!seen.get(k)) seen.set(k, 1);
  };
  for (const l of map.linedefs) {
    const front = map.sidedefs[l.right].sector;
    const back = l.left >= 0 ? map.sidedefs[l.left].sector : -1;
    if (front === s && back === s) continue;
    if (front === s) add(l.v1, l.v2);
    if (back === s) add(l.v2, l.v1);
  }
  const out = [];
  for (const [k, n] of seen) if (n > 0) out.push(k.split(",").map(Number));
  return out;
}

/**
 * The loops of a sector's boundary, each a list of vertex indices, and the
 * edges that didn't close into a loop (`open`: a broken map).
 */
export function traceLoops(edges, verts) {
  const out = new Map(); // vertex → indices into edges leaving it
  edges.forEach(([a], i) => (out.get(a) ?? out.set(a, []).get(a)).push(i));
  const used = new Uint8Array(edges.length);
  const loops = [];
  const open = [];
  const angle = (from, to) => Math.atan2(verts[to].y - verts[from].y, verts[to].x - verts[from].x);
  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const loop = [edges[start][0]];
    let [prev, at] = edges[start];
    const first = edges[start][0];
    let closed = false;
    for (let guard = 0; guard <= edges.length; guard++) {
      if (at === first) {
        closed = true;
        break;
      }
      loop.push(at);
      const choices = (out.get(at) ?? []).filter((i) => !used[i]);
      if (!choices.length) break;
      let pick = choices[0];
      if (choices.length > 1) {
        // the sharpest right turn: the least counter-clockwise angle from the way back
        const back = angle(at, prev);
        let best = Infinity;
        for (const i of choices) {
          let d = angle(at, edges[i][1]) - back;
          while (d <= 1e-12) d += 2 * Math.PI;
          if (d < best) (best = d), (pick = i);
        }
      }
      used[pick] = 1;
      prev = at;
      at = edges[pick][1];
    }
    if (closed) loops.push(splitAtRepeats(loop));
    else open.push(loop);
  }
  return { loops: loops.flat(), open };
}

/** A loop that passes a vertex twice is two loops, split there. */
function splitAtRepeats(loop) {
  const seen = new Map();
  for (let i = 0; i < loop.length; i++) {
    const v = loop[i];
    if (seen.has(v)) {
      const j = seen.get(v);
      return [...splitAtRepeats(loop.slice(j, i)), ...splitAtRepeats([...loop.slice(0, j), ...loop.slice(i)])];
    }
    seen.set(v, i);
  }
  return [loop];
}

/** A point inside a loop's polygon near its first edge, to test what contains it. */
function probePoint(loop, verts, others) {
  // a vertex of the loop that is on none of the other loops, else an edge's middle
  const onOthers = new Set(others.flat());
  for (const v of loop) if (!onOthers.has(v)) return [verts[v].x, verts[v].y];
  const a = verts[loop[0]];
  const b = verts[loop[1 % loop.length]];
  return [(a.x + b.x) / 2, (a.y + b.y) / 2];
}

/**
 * A sector as polygons: each outline (clockwise) with the holes (counter-
 * clockwise) it contains.
 * @returns {{ polygons: { outer: number[], holes: number[][] }[], open: number[][] }}
 */
export function sectorPolygons(map, s) {
  const verts = map.vertexes;
  const { loops, open } = traceLoops(sectorEdges(map, s), verts);
  const outers = [];
  const holes = [];
  for (const l of loops) {
    if (l.length < 3) continue;
    const a = loopArea2(l, verts);
    if (a < 0) outers.push({ loop: l, area: -a });
    else if (a > 0) holes.push(l);
  }
  const polygons = outers.map((o) => ({ outer: o.loop, holes: [], area: o.area }));
  for (const h of holes) {
    const [x, y] = probePoint(h, verts, outers.map((o) => o.loop));
    let best = null;
    for (const p of polygons) if (insideLoop(x, y, p.outer, verts) && (!best || p.area < best.area)) best = p;
    // a hole in no outline is a broken map: nothing to cut it from
    if (best) best.holes.push(h);
  }
  return { polygons: polygons.map(({ outer, holes }) => ({ outer, holes })), open };
}

/**
 * The sector's triangles, as vertex index triples, each wound clockwise in
 * plan (Doom's x east, y north), i.e. facing up once y becomes -z.
 * @returns {{ triangles: number[][], area: number, open: number[][], polygons }}
 *   area: the polygon's own area (outlines less holes), map units²
 */
export function triangulateSector(map, s) {
  const verts = map.vertexes;
  const { polygons, open } = sectorPolygons(map, s);
  const triangles = [];
  let area = 0;
  for (const p of polygons) {
    const ids = [...p.outer];
    const holeIndices = [];
    for (const h of p.holes) {
      holeIndices.push(ids.length);
      ids.push(...h);
    }
    const flat = [];
    for (const v of ids) flat.push(verts[v].x, verts[v].y);
    const tri = earcut(flat, holeIndices, 2);
    for (let i = 0; i < tri.length; i += 3) {
      const t = [ids[tri[i]], ids[tri[i + 1]], ids[tri[i + 2]]];
      // clockwise in plan
      if (loopArea2(t, verts) > 0) t.reverse();
      triangles.push(t);
    }
    area += Math.abs(loopArea2(p.outer, verts)) / 2 - p.holes.reduce((a, h) => a + Math.abs(loopArea2(h, verts)) / 2, 0);
  }
  return { triangles, area, open, polygons };
}
