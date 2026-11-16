// A bounded body's reader (WATER.md, "Which water a thing is in", the
// reader): sailing's ocean shape, for water that is its own doc's thing, in
// the calling stage's frame (which is that doc's root frame) and on the
// stage's own clock (no τ: it is never another doc's water).
//
//   - The waves are a field in the doc's frame, evaluated at the stage's
//     (x, z) about the body's level: a tank carried on a hull moves through
//     its doc's wave field instead of carrying one. The free surface stays
//     level in the doc's frame through the body's origin, however the box is
//     turned (gravity is the doc's -Y, as it is for sailing).
//   - heightAt is the displaced surface inside the footprint and the floor
//     outside it: a dry column.
//   - velocityAt is the orbital velocity, plus the current, plus the body's
//     rigid velocity in its doc (v + ω×r): the water in a tank on a moving
//     hull moves with the tank. Outside the footprint, only the carrier's.
//
// `cell` is mutable: the extension sets its box (drawn pose) and its rigid
// velocity once a frame, and the reader reads them at each call. Pure but for
// reading the cell.

import { carried, floorAt, inFootprint } from "./bodies.js";
import { createSurface } from "./surface.js";

const STATS = Object.freeze({ hs: 0, peakPeriod: 0, peakWavelength: 0, whitecaps: 0 });

/**
 * @param {{ id: string, components: object[], U: number[], look?: object }} body  its components already shifted and clipped
 * @param {{ box: ReturnType<import("./bodies.js").boxOf>, rv: { v: number[], w: number[], o: number[] } }} cell
 */
export function boundedReader(body, cell) {
  const surface = createSurface(body.components);
  const U = body.U ?? [0, 0];
  const look = body.look ?? {};
  const C = [0, 0, 0];
  const S = [0, 0, 1, 0];
  const D = [0, 0, 0, 1];
  const inside = (x, z) => inFootprint(cell.box, [x, 0, z]);

  function heightAt(x, z, t) {
    if (!inside(x, z)) return floorAt(cell.box, x, z).y;
    return cell.box.level + surface.heightAt(x, z, t);
  }
  function sampleAt(x, z, t, out = [0, 0, 1, 0]) {
    if (!inside(x, z)) {
      const f = floorAt(cell.box, x, z);
      out[0] = f.y;
      out[1] = f.normal[0];
      out[2] = f.normal[1];
      out[3] = f.normal[2];
      return out;
    }
    surface.sampleAt(x, z, t, S);
    out[0] = cell.box.level + S[0];
    out[1] = S[1];
    out[2] = S[2];
    out[3] = S[3];
    return out;
  }
  function normalAt(x, z, t, out = [0, 1, 0]) {
    sampleAt(x, z, t, S);
    out[0] = S[1];
    out[1] = S[2];
    out[2] = S[3];
    return out;
  }
  function velocityAt(x, y, z, t, out = [0, 0, 0]) {
    carried(cell.rv, [x, y, z], C);
    if (!inside(x, z)) {
      out[0] = C[0];
      out[1] = C[1];
      out[2] = C[2];
      return out;
    }
    surface.velocityAt(x, y - cell.box.level, z, t, out);
    out[0] += U[0] + C[0];
    out[1] += C[1];
    out[2] += U[1] + C[2];
    return out;
  }
  function displaced(x0, z0, t, out = [0, 0, 0, 1]) {
    surface.displaced(x0, z0, t, D);
    out[0] = D[0];
    out[1] = cell.box.level + D[1];
    out[2] = D[2];
    out[3] = D[3];
    return out;
  }
  return Object.freeze({
    body: body.id,
    components: surface.components,
    heightAt,
    sampleAt,
    normalAt,
    velocityAt,
    displaced,
    get level() {
      return cell.box.level;
    },
    seed: look.seed ?? 1,
    stats: look.stats ?? STATS,
  });
}
