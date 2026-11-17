// Where the stock sloop's crew stand to work her (ship.js standSpot), checked
// over her own drawing, no bake: what each spot is for. crew.test.js pins
// where each spot is; walk's deck-12m.test.js checks her claims of a right
// bake of her (her export's `claims`: the cockpit's STEPs, her floors, the
// mainsheet's spot beside the Card table). These are the rows of
// sloop-navmesh.test.js that never needed a navmesh: the winch stands, the
// luff seen past the main, the mainsheet in reach (DESIGN.md, "Walking",
// "Her checks").

import { describe, it, expect } from "vitest";
import { COCKPIT, FIT, deckAt, halfBreadthAt, rigDrawing, standSpot } from "./ship.js";
import { REACH } from "./crew.js";
import { stockJib, stockMain } from "./stock-rig.js";
import KEPT from "./stock-rig-12m.js";
import { cockpitTableBoxes } from "../probes/cockpit-table.js";

const DEG = Math.PI / 180;
/** A standing person's eye over the floor (walk's BODY.eye: a station's eye is walk's walker's, standing at the spot). */
const EYE = 1.6;
/** The reach of the body you take a station in (walk's REACH, Q9): within it, you can take it from its spot. */
const WALK_REACH = 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
/** A jib winch's piece (side −1 port, +1 starboard: the starboard one is the port one's mirror). */
const winchAt = (side) => [side * Math.abs(FIT.winch.position[0]), FIT.winch.position[1], FIT.winch.position[2]];
/** A stand spot in her hull's frame: its piece's place (each squared to her) plus the spot. */
const spotOf = (kind, side = -1) => add(kind === "winch" ? winchAt(side) : FIT[kind].position, standSpot(kind, side));

describe("the stock sloop's stand spots, over her drawing", () => {
  it("each jib winch's stand spot is on the side deck across the well from it (tailing from the high side), inside her rail, its drum's top within 3 m of the eye there (the sheet's tail comes across the well)", () => {
    for (const side of [-1, 1]) {
      const [x, y, z] = spotOf("winch", side);
      expect(Math.abs(y - deckAt(x, z))).toBeLessThan(0.05); // on her deck
      expect(Math.sign(x)).toBe(-side); // on the far side
      expect(Math.abs(x)).toBeGreaterThan(0.85); // outboard of the far coaming
      expect(Math.abs(x)).toBeLessThan(halfBreadthAt(z)); // inside her rail
      const drum = add(winchAt(side), [0, 0.2, 0]);
      expect(Math.hypot(...sub(drum, [x, y + EYE, z]))).toBeLessThan(3);
    }
  });

  it("from the working winch's stand, the eye sees the jib's luff past the main and the mast: the ray to its luff (¼ and ½ up; ¾ close-hauled) misses the main's cloth, flat or bellied to leeward as it draws, and the mast, close-hauled and on a beam reach", () => {
    const d = rigDrawing();
    const main = stockMain(d, KEPT.models.main), jib = stockJib(d, KEPT.models.jib);
    const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    /** Does the segment p→q cross triangle abc (Möller–Trumbore)? */
    const crosses = (p, q, a, b, c) => {
      const dd = sub(q, p), e1 = sub(b, a), e2 = sub(c, a), h = cross(dd, e2), det = dot(e1, h);
      if (Math.abs(det) < 1e-12) return false;
      const sv = sub(p, a), u = dot(sv, h) / det, qq = cross(sv, e1), v = dot(dd, qq) / det, t = dot(e2, qq) / det;
      return u >= 0 && v >= 0 && u + v <= 1 && t > 0 && t < 1;
    };
    /** p swung θ (+ to starboard) about the unit axis k through o. */
    const swing = (p, o, k, th) => {
      const r = sub(p, o), c = Math.cos(th), sn = Math.sin(th), kr = cross(k, r), kd = dot(k, r);
      return [0, 1, 2].map((i) => o[i] + r[i] * c + kr[i] * sn + k[i] * kd * (1 - c));
    };
    const luff = sub(jib.head, jib.tack), ll = Math.hypot(...luff), jAxis = luff.map((v) => v / ll);
    const camber = 0.085 * main.foot; // the cloth's camber at its deepest, on its longest chord
    // [boom, jib] to port (starboard tack: the port winch works), deg: as she sails them, measured at 7 m/s
    const POSES = { "close-hauled": [[12, 10], [25.5, 21.4]], "beam reach": [[42.5, 38.8]] };
    const feet = spotOf("winch", -1);
    const eye = [feet[0], feet[1] + EYE, feet[2]];
    let rays = 0;
    for (const [name, poses] of Object.entries(POSES)) {
      for (const [bm, jb] of poses) {
        // bellied to leeward (−x, swung to port); its whole outline moved by its deepest camber, a bound
        for (const off of [0, -camber]) {
          const poly = main.polygon.map((p) => swing([main.tack[0] + off, p[1], p[2]], main.tack, [0, 1, 0], -bm * DEG));
          const ce = swing([main.tack[0] + off, main.ce[1], main.ce[2]], main.tack, [0, 1, 0], -bm * DEG);
          for (const h of name === "close-hauled" ? [0.25, 0.5, 0.75] : [0.25, 0.5]) {
            const on = [0, 1, 2].map((i) => jib.tack[i] + luff[i] * h);
            const target = swing([on[0], on[1], on[2] + 0.3], on, jAxis, -jb * DEG); // a telltale 0.3 aft on the luff
            const hid = poly.some((p, i) => crosses(eye, target, ce, p, poly[(i + 1) % poly.length]));
            expect(hid, `${name} boom ${bm}° jib ${jb}°, ${h} up, camber ${off}`).toBe(false);
            // the mast (upright at its step, its section's radius and 5 cm to spare): where the ray passes it, it's clear
            const k = (d.mast.step[2] - eye[2]) / (target[2] - eye[2]);
            expect(Math.abs(eye[0] + k * (target[0] - eye[0]) - d.mast.step[0]), `${name} ${h} up: the mast`).toBeGreaterThan(d.mast.section / 2 + 0.05);
            rays++;
          }
        }
      }
    }
    expect(rays).toBe(2 * 2 * 3 + 2 * 2);
  });

  it("the helm's spot (her spawn) is on the cockpit's sole aft of the wheel", () => {
    const [x, y, z] = spotOf("wheel");
    expect(x).toBe(0);
    expect(y).toBeCloseTo(COCKPIT.floor, 9);
    expect(z).toBeGreaterThan(FIT.wheel.position[2]);
    expect(z).toBeLessThan(COCKPIT.z1);
  });

  it("the mainsheet's spot is on the sole aft of the traveller and forward of the wheel; its block is in reach from the eye there, walking or at the station; the Card table, where the aboard setup puts it, lies wholly forward of the block, so no look from the spot to it crosses the table", () => {
    const p = spotOf("mainsheet");
    const sheet = FIT.mainsheet.position;
    expect(p[1]).toBeCloseTo(COCKPIT.floor, 9);
    expect(p[2]).toBeGreaterThan(sheet[2] + 0.15);
    expect(p[2]).toBeLessThan(FIT.wheel.position[2]);
    const block = [sheet[0], sheet[1] + 0.21, sheet[2]];
    const reach = Math.hypot(...sub(block, [p[0], p[1] + EYE, p[2]]));
    expect(reach).toBeLessThan(Math.min(WALK_REACH, REACH));
    for (const [, hi] of cockpitTableBoxes()) expect(hi[2]).toBeLessThan(block[2]);
  });
});
