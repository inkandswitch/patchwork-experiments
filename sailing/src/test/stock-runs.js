// The stock boats' runs that `stock-golden.json` recorded before the rig
// contract path existed (DESIGN.md, "The rig contract"): the default
// SLOOP, and the stock hull carrying the "Mast and sail" part at its stand,
// each sailed 20 s on a beam reach through a swell on a steady breeze, a
// helmsman holding her course. The contract path is gated on extras.rig,
// so these must come out bit for bit what they did: stock-golden.test.js
// holds them to it. The golden file was written by this module run against
// the sources before the contract path (git archive of the commit before).
//
// Rewrite the golden file only on purpose (a deliberate change to the
// stock physics), with:
//   node src/test/write-stock-golden.mjs

import { createShip } from "../physics.js";
import { specFor } from "../sim.js";
import { frameOf, placeIn } from "../body.js";
import { partGLB, STAND } from "../ship.js";
import { PIECES } from "../parts.js";
import { SAIL, SHIP } from "../traits.js";

const DEG = Math.PI / 180;

/** What the stage reads off a GLB: its positions' box and the scene's extras. */
export function readGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], a.min[i]);
        max[i] = Math.max(max[i], a.max[i]);
      }
    }
  }
  return { box: { min, max }, extras: json.scenes[0].extras ?? {} };
}

/** One long-crested Airy wave (physics.test.js's). */
function swell({ amp, length, toward = 0 }) {
  const k = (2 * Math.PI) / length;
  const omega = Math.sqrt(9.81 * k);
  const dx = Math.sin(toward * DEG), dz = -Math.cos(toward * DEG);
  const phase = (x, z, t) => k * (x * dx + z * dz) - omega * t;
  const heightAt = (x, z, t) => amp * Math.cos(phase(x, z, t));
  return {
    heightAt,
    velocityAt(x, y, z, t) {
      const th = phase(x, z, t);
      const e = amp * omega * Math.exp(k * Math.min(0, y - heightAt(x, z, t)));
      return [e * Math.cos(th) * dx, e * Math.sin(th), e * Math.cos(th) * dz];
    },
  };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** The stock hull's and the "Mast and sail" part's specs, as sim.js builds them. */
export function stockSpecs() {
  const hull = readGLB(partGLB("hull").bytes);
  const rig = readGLB(partGLB("rig").bytes).extras;
  const doc = {
    objects: {
      h: { traits: { [SHIP]: {} } },
      m: { parent: "h", transform: { position: STAND.mast } },
      r: { parent: "m", transform: { position: PIECES.mast[1].at }, traits: { [SAIL]: {} } },
    },
  };
  return {
    sloop: undefined,
    mastAndSail: specFor(hull, undefined, 1, { frame: frameOf({}, hull), rig: { matrix: placeIn(doc, "r", "h"), sail: rig.sail } }),
  };
}

/** Each stock boat sailed 20 s: her spec, and her state and diagnostics every 5 s. */
export function stockRuns() {
  const out = {};
  for (const [name, spec] of Object.entries(stockSpecs())) {
    const ship = createShip(spec);
    const env = { water: swell({ amp: 0.6, length: 40, toward: 30 }), wind: { at: () => [-Math.sin(20 * DEG) * 7, Math.cos(20 * DEG) * 7] } };
    // a beam reach: the wind from 20°, her course 110°
    const course = 110 * DEG;
    const c = { sail: 1, sheet: 0.45, rudder: 0 };
    let s = ship.rest({ yaw: -course });
    const marks = [];
    const dt = 1 / 30;
    for (let i = 1; i <= 600; i++) {
      const d = ship.read(s, c, env);
      c.rudder = clamp(2 * wrap(course - d.heading) + 4 * s.spin[1], -1, 1);
      s = ship.step(s, c, env, dt);
      if (i % 150 === 0) marks.push({ state: s, read: ship.read(s, c, env) });
    }
    out[name] = { spec: ship.spec, marks };
  }
  return out;
}
