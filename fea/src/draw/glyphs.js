// The marks that say how a part is held and loaded: arrows for loads, pins
// for supports. Pure: line segments in the part's frame (six numbers a
// segment), for the scene's GLB and the study's view alike.

import { listOf } from "../setup.js";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(...a);
  return l > 0 ? mul(a, 1 / l) : null;
};
/** Two unit directions square to `d` and to each other. */
function across(d) {
  const u = unit(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return [u, cross(d, u)];
}

/** An arrow whose tip is at `tip`, pointing along unit `d`, `length` long: a shaft and four barbs. */
export function arrow(out, tip, d, length) {
  const tail = sub(tip, mul(d, length));
  const [u, v] = across(d);
  const back = sub(tip, mul(d, length * 0.28));
  const w = length * 0.11;
  out.push(...tail, ...tip);
  for (const side of [mul(u, w), mul(u, -w), mul(v, w), mul(v, -w)]) out.push(...tip, ...add(back, side));
}

/** A pin standing on `at`, pointing away along unit `n`: a small pyramid on a square foot; `slide` adds a second foot under it. */
export function pin(out, at, n, size, slide = false) {
  const [u, v] = across(n);
  const base = add(at, mul(n, size));
  const corners = [add(add(base, mul(u, size * 0.5)), mul(v, size * 0.5)), add(add(base, mul(u, -size * 0.5)), mul(v, size * 0.5)), add(add(base, mul(u, -size * 0.5)), mul(v, -size * 0.5)), add(add(base, mul(u, size * 0.5)), mul(v, -size * 0.5))];
  for (let i = 0; i < 4; i++) {
    out.push(...at, ...corners[i]);
    out.push(...corners[i], ...corners[(i + 1) % 4]);
  }
  if (slide) {
    const lift = mul(n, size * 0.3);
    for (let i = 0; i < 4; i++) out.push(...add(corners[i], lift), ...add(corners[(i + 1) % 4], lift));
  }
}

/**
 * Where a mark for one face stands, and which way is out there: its middle
 * and mean direction, or, for a face with no one direction (a tube's wall,
 * whose middle is on its axis), a point that is on it.
 */
function standOn(f) {
  const n = unit(f.normal);
  return n ? [f.centroid, n] : [f.at, f.atNormal];
}

/** Where a set of faces is, taken together: their area-weighted centre and mean outward direction. */
export function placeOf(part, faces) {
  const want = new Set(faces);
  let area = 0;
  const c = [0, 0, 0], n = [0, 0, 0];
  for (const f of part.faces) {
    if (!want.has(f.id)) continue;
    area += f.area;
    for (let k = 0; k < 3; k++) {
      c[k] += f.area * f.centroid[k];
      n[k] += f.area * f.normal[k];
    }
  }
  return area > 0 ? { at: mul(c, 1 / area), normal: unit(n), area } : null;
}

/**
 * @param {{ faces: object[], box: { min: number[], max: number[] }, diagonal: number }} part   a kept part (or a run's)
 * @param {object} setup   normalised
 * @returns {{ loads: Float32Array, supports: Float32Array, items: { what: "support"|"load", id: string, name: string, at: number[] }[] }}
 *   items: where each mark stands, for a label
 */
export function setupGlyphs(part, setup) {
  const loads = [], supports = [], items = [];
  const L = part.diagonal;
  for (const s of listOf(setup.supports)) {
    for (const id of s.faces) {
      const f = part.faces.find((x) => x.id === id);
      if (!f) continue;
      const [at, n] = standOn(f);
      pin(supports, at, n, L * 0.035, s.kind === "slide");
    }
    const place = placeOf(part, s.faces);
    if (place) items.push({ what: "support", id: s.id, name: s.name, at: place.at });
  }
  for (const l of listOf(setup.loads)) {
    if (l.kind === "gravity") {
      const centre = mul(add(part.box.min, part.box.max), 0.5);
      const d = unit(l.direction);
      arrow(loads, add(centre, mul(d, L * 0.11)), d, L * 0.22);
      items.push({ what: "load", id: l.id, name: l.name, at: centre });
      continue;
    }
    const place = placeOf(part, l.faces);
    if (!place) continue;
    if (l.kind === "pressure") {
      // one arrow a face, pushing in (a negative pressure pulls: drawn pointing out)
      for (const id of l.faces) {
        const f = part.faces.find((x) => x.id === id);
        if (!f) continue;
        const [at, n] = standOn(f);
        if (l.pressure.value >= 0) arrow(loads, at, mul(n, -1), L * 0.1);
        else arrow(loads, add(at, mul(n, L * 0.1)), n, L * 0.1);
      }
    } else arrow(loads, place.at, unit(l.direction), L * 0.18);
    items.push({ what: "load", id: l.id, name: l.name, at: place.at });
  }
  return { loads: Float32Array.from(loads), supports: Float32Array.from(supports), items };
}
