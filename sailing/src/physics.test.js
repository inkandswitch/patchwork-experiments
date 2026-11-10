// The ship's dynamics, tested as a sailor would expect the boat to behave.
// The sea and wind here are small stubs with ocean.js's and wind.js's
// interfaces: a flat calm, one long swell, a steady wind.

import { describe, it, expect } from "vitest";
import { createShip, specFromBox, SLOOP, SUBSTEP } from "./physics.js";
import { buildHull } from "./hull-model.js";
import { sailCL, sailCD, foilCL } from "./physics-foils.js";

const DEG = Math.PI / 180;

const calm = {
  heightAt: () => 0,
  normalAt: () => [0, 1, 0],
  velocityAt: () => [0, 0, 0],
};

/** One long-crested Airy wave travelling toward `toward` (degrees from −Z toward +X). */
function swell({ amp, length, toward = 0 }) {
  const k = (2 * Math.PI) / length;
  const omega = Math.sqrt(9.81 * k);
  const dx = Math.sin(toward * DEG), dz = -Math.cos(toward * DEG);
  const phase = (x, z, t) => k * (x * dx + z * dz) - omega * t;
  const heightAt = (x, z, t) => amp * Math.cos(phase(x, z, t));
  return {
    omega,
    heightAt,
    normalAt(x, z, t) {
      const s = amp * k * Math.sin(phase(x, z, t));
      const l = Math.hypot(s * dx, 1, s * dz);
      return [(s * dx) / l, 1 / l, (s * dz) / l];
    },
    velocityAt(x, y, z, t) {
      const th = phase(x, z, t);
      const e = amp * omega * Math.exp(k * Math.min(0, y - heightAt(x, z, t)));
      return [e * Math.cos(th) * dx, e * Math.sin(th), e * Math.cos(th) * dz];
    },
  };
}

import { bestSpeed, clamp, helmsman, sail, sailAt, speedAt, steady, wrap } from "./test/sail-runs.js";

describe("the hull", () => {
  it("floats its mass with its waterline at y = 0", () => {
    const hull = buildHull(SLOOP);
    expect(hull.restVolume * 1025).toBeCloseTo(SLOOP.mass, 0);
    // a canoe body a few tens of centimetres deep, and a keel down to the draft
    expect(hull.depth).toBeGreaterThan(0.2);
    expect(hull.depth).toBeLessThan(0.7);
    expect(hull.keel.span).toBeGreaterThan(1);
  });

  it("scales a spec from any object's box", () => {
    const spec = specFromBox({ min: [-1, -0.5, -3], max: [1, 0.6, 3] });
    expect(spec.length).toBeCloseTo(6);
    expect(spec.beam).toBeCloseTo(2);
    expect(spec.sail.area).toBeCloseTo(55 / 4);
    expect(spec.mass).toBeGreaterThan(0);
    // overrides win
    expect(specFromBox({ min: [-1, -0.5, -3], max: [1, 0.6, 3] }, { mass: 900 }).mass).toBe(900);
    // the box's own centre, not the origin
    const off = specFromBox({ min: [-1, -0.5, 0], max: [1, 0.6, 6] });
    expect(off.center).toEqual([0, 3]);
  });

  it("an editor-built boat from its box floats and sails", () => {
    const ship = createShip(specFromBox({ min: [-1.2, -1, -4], max: [1.2, 0.8, 4] }));
    const s = sail(ship, {
      state: ship.rest({ yaw: -90 * DEG }),
      env: { water: calm, wind: steady(7, 0) },
      controls: { sail: 1, sheet: 0.4 },
      seconds: 40,
      helm: helmsman(90 * DEG),
    });
    const d = ship.read(s, { sail: 1, sheet: 0.4 }, { water: calm, wind: steady(7, 0) });
    expect(Math.abs(s.position[1])).toBeLessThan(0.15);
    expect(d.speed).toBeGreaterThan(1.5);
    expect(d.speed).toBeLessThan(ship.hullSpeed * 1.2);
  });
});

describe("the sail's coefficients", () => {
  it("lift peaks around 20-25° and stalls gently, never to nothing; drag ~1.2 square to the wind", () => {
    let peak = 0, at = 0;
    for (let a = 0; a <= 90; a += 1) {
      const cl = sailCL(a * DEG);
      if (cl > peak) (peak = cl), (at = a);
    }
    expect(peak).toBeGreaterThan(1.3);
    expect(peak).toBeLessThan(1.5);
    expect(at).toBeGreaterThanOrEqual(20);
    expect(at).toBeLessThanOrEqual(25);
    expect(sailCL(0)).toBe(0);
    expect(sailCD(90 * DEG, sailCL(90 * DEG), 4)).toBeCloseTo(1.2, 1);
    for (let a = 30; a <= 90; a += 10) {
      const cl = sailCL(a * DEG);
      const force = Math.hypot(cl, sailCD(a * DEG, cl, 4));
      expect(force).toBeGreaterThan(1);
    }
  });

  it("a symmetric foil stalls above 15°", () => {
    expect(foilCL(14 * DEG, 3.4)).toBeGreaterThan(foilCL(10 * DEG, 3.4));
    expect(foilCL(28 * DEG, 3.4)).toBeLessThan(foilCL(15 * DEG, 3.4));
    expect(foilCL(170 * DEG, 3.4)).toBeCloseTo(foilCL(10 * DEG, 3.4));
  });
});

describe("afloat in a calm", () => {
  const ship = createShip();

  it("settles level with its waterline at sea level and stays still", () => {
    let worst = 0;
    const s = sail(ship, {
      state: ship.rest({ position: [3, 0, -2], yaw: 0.3 }),
      env: { water: calm },
      seconds: 20,
      each: (d) => (worst = Math.max(worst, Math.abs(d.heel), Math.abs(d.pitch))),
    });
    expect(Math.abs(s.position[1])).toBeLessThan(0.1);
    expect(worst).toBeLessThan(0.5 * DEG);
    expect(Math.hypot(s.position[0] - 3, s.position[2] + 2)).toBeLessThan(0.05);
    expect(Math.hypot(...s.velocity)).toBeLessThan(0.01);
    const d = ship.read(s, {}, { water: calm });
    expect(d.heading).toBeCloseTo(-0.3, 2);
    expect(d.submerged).toBeGreaterThan(0.05);
    expect(d.submerged).toBeLessThan(0.5);
  });

  it("dropped from a metre, splashes down and settles within a few seconds", () => {
    const start = ship.rest();
    start.position[1] = 1;
    let after = 0;
    sail(ship, {
      state: start,
      env: { water: calm },
      seconds: 10,
      each(d, s, t) {
        if (t > 5) after = Math.max(after, Math.abs(s.position[1]), Math.abs(s.velocity[1]));
      },
    });
    expect(after).toBeLessThan(0.05);
  });

  it("tipped to 45°, rights itself and settles", () => {
    const start = ship.rest();
    const a = 45 * DEG;
    start.quaternion = [0, 0, Math.sin(a / 2), Math.cos(a / 2)]; // rolled about the fore-and-aft axis
    let first, overshoot = 0, late = 0;
    sail(ship, {
      state: start,
      env: { water: calm },
      seconds: 15,
      each(d, s, t) {
        first ??= d.heel;
        overshoot = Math.max(overshoot, Math.sign(first) * -d.heel);
        if (t > 10) late = Math.max(late, Math.abs(d.heel));
      },
    });
    expect(Math.abs(first)).toBeCloseTo(45 * DEG, 2);
    expect(overshoot).toBeLessThan(35 * DEG); // swings back through, but not over
    expect(late).toBeLessThan(3 * DEG);
  });
  it("knocked flat, comes back up; turned turtle, stays there", () => {
    // how far the mast points up: 1 upright, −1 upside down
    const up = (deg) => {
      const start = ship.rest();
      start.quaternion = [0, 0, Math.sin((deg * DEG) / 2), Math.cos((deg * DEG) / 2)];
      const [x, , z] = sail(ship, { state: start, env: { water: calm }, seconds: 30 }).quaternion;
      return 1 - 2 * (x * x + z * z);
    };
    expect(up(90)).toBeGreaterThan(Math.cos(1 * DEG));
    expect(up(120)).toBeGreaterThan(Math.cos(1 * DEG));
    // upside down the ballast is up high and holds it there
    expect(up(175)).toBeLessThan(-0.95);
  });
});

describe("under sail, 8 m/s of wind from the north", () => {
  const ship = createShip();
  const env = { water: calm, wind: steady(8, 0) };

  it("on a beam reach, reaches a steady 3-4.5 m/s within a minute, heeling 5-25°", () => {
    const trace = [];
    const s = sail(ship, {
      state: ship.rest({ yaw: -90 * DEG }),
      env,
      controls: { sail: 1, sheet: 0.4 },
      seconds: 60,
      helm: helmsman(90 * DEG),
      each: (d, s, t) => trace.push({ t, ...d }),
    });
    const last = trace.filter((d) => d.t > 50);
    const speeds = last.map((d) => d.speed);
    expect(Math.min(...speeds)).toBeGreaterThan(3);
    expect(Math.max(...speeds)).toBeLessThan(4.5);
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(0.1); // steady
    const heel = Math.abs(last.at(-1).heel);
    expect(heel).toBeGreaterThan(5 * DEG);
    expect(heel).toBeLessThan(25 * DEG);
    // heeling away from the wind: it's on the port side, so starboard goes down
    expect(last.at(-1).heel).toBeGreaterThan(0);
    // the boom is out to leeward (starboard), the apparent wind forward of the beam on the port side
    expect(last.at(-1).boom).toBeGreaterThan(0);
    expect(last.at(-1).apparentWind.angle).toBeLessThan(-30 * DEG);
    expect(last.at(-1).apparentWind.angle).toBeGreaterThan(-90 * DEG);
    // and it went east
    expect(s.position[0]).toBeGreaterThan(100);
  });

  it("close-hauled, 45° off the wind, still makes way to windward", () => {
    let start, end;
    sail(ship, {
      state: ship.rest({ yaw: -45 * DEG }),
      env,
      controls: { sail: 1, sheet: 0.1 },
      seconds: 60,
      helm: helmsman(45 * DEG),
      each(d, s, t) {
        if (t <= 30) start = s.position[2];
        end = s.position[2];
      },
    });
    // windward is −Z: velocity made good over the last 30 s
    const vmg = (start - end) / 30;
    expect(vmg).toBeGreaterThan(1);
  });

  it("pointing straight into the wind it can't make headway: it stops and drifts back", () => {
    let most = 0, stopped = Infinity, last;
    const start = ship.rest();
    start.velocity = [0, 0, -3]; // carrying way as it comes head to wind
    sail(ship, {
      state: start,
      env,
      controls: { sail: 1, sheet: 0 },
      seconds: 60,
      each(d, s, t) {
        most = Math.max(most, -s.position[2]);
        if (d.speed < 0.3) stopped = Math.min(stopped, t);
        last = { d, s };
      },
    });
    // it shoots a few boat lengths, no more, with the sail flogging
    expect(stopped).toBeLessThan(30);
    expect(most).toBeLessThan(40);
    expect(last.d.sailForce).toBeLessThan(800);
    // then the wind pushes it back, slowly (a keel going astern is all drag)
    expect(last.d.speed).toBeLessThan(0);
    expect(last.d.speed).toBeGreaterThan(-0.5);
    expect(-last.s.position[2]).toBeLessThan(most - 3);
    // and from a standstill it gains nothing to windward
    let gained = 0;
    sail(ship, {
      state: ship.rest(),
      env,
      controls: { sail: 1, sheet: 0 },
      seconds: 60,
      each: (d, s) => (gained = Math.max(gained, -s.position[2])),
    });
    expect(gained).toBeLessThan(0.5);
  });

  it("running dead downwind it moves, no faster than on a beam reach", () => {
    const run = speedAt(ship, { twa: 180, sheet: 1, seconds: 60 });
    const reach = speedAt(ship, { twa: 90, sheet: 0.4, seconds: 60 });
    expect(run).toBeGreaterThan(1.5);
    expect(run).toBeLessThan(reach * 1.05);
  });

  it("with the sail down it barely moves: it drifts", () => {
    let fastest = 0;
    sail(ship, {
      state: ship.rest({ yaw: -90 * DEG }),
      env,
      controls: { sail: 0 },
      seconds: 60,
      each: (d, s) => (fastest = Math.max(fastest, Math.hypot(s.velocity[0], s.velocity[2]))),
    });
    expect(fastest).toBeLessThan(0.6);
  });

  it("turns the way the rudder says: + to starboard, − to port", () => {
    const reaching = sail(ship, {
      state: ship.rest({ yaw: -90 * DEG }),
      env,
      controls: { sail: 1, sheet: 0.4 },
      seconds: 30,
      helm: helmsman(90 * DEG),
    });
    const heading = (s) => ship.read(s, {}, env).heading;
    const h0 = heading(reaching);
    const starboard = sail(ship, { state: reaching, env, controls: { sail: 1, sheet: 0.4, rudder: 0.5 }, seconds: 4 });
    const port = sail(ship, { state: reaching, env, controls: { sail: 1, sheet: 0.4, rudder: -0.5 }, seconds: 4 });
    expect(wrap(heading(starboard) - h0)).toBeGreaterThan(10 * DEG);
    expect(wrap(heading(port) - h0)).toBeLessThan(-10 * DEG);
    // and with no speed through the water the rudder does nothing
    const still = sail(ship, { state: ship.rest(), env: { water: calm }, controls: { rudder: 1 }, seconds: 4 });
    expect(Math.abs(heading(still))).toBeLessThan(0.5 * DEG);
  });

  it("anchored, swings to its anchor and stays within the rode", () => {
    const anchor = { at: [0, -6, -4], rode: 20 };
    const bow = (s) => {
      // the stem head, from the body origin
      const [x, y, z, w] = s.quaternion;
      const b = [0, SLOOP.freeboard, -SLOOP.length / 2 + 0.03 * SLOOP.length];
      // rotate b by q
      const tx = 2 * (y * b[2] - z * b[1]), ty = 2 * (z * b[0] - x * b[2]), tz = 2 * (x * b[1] - y * b[0]);
      return [
        s.position[0] + b[0] + w * tx + (y * tz - z * ty),
        s.position[1] + b[1] + w * ty + (z * tx - x * tz),
        s.position[2] + b[2] + w * tz + (x * ty - y * tx),
      ];
    };
    let worst = 0, last;
    sail(ship, {
      state: ship.rest({ yaw: -90 * DEG }),
      env,
      controls: { sail: 0, anchor },
      seconds: 180,
      each(d, s, t) {
        const p = bow(s);
        worst = Math.max(worst, Math.hypot(p[0] - anchor.at[0], p[1] - anchor.at[1], p[2] - anchor.at[2]));
        last = { d, s };
      },
    });
    expect(worst).toBeLessThan(anchor.rode + 0.5);
    // lying downwind of it, bow to the wind
    expect(last.s.position[2]).toBeGreaterThan(anchor.at[2] + 10);
    expect(Math.abs(last.d.heading)).toBeLessThan(30 * DEG);
  });
});

// (the polar, a minute of sailing at each of a dozen angles: physics.slow.test.js)

describe("in waves", () => {
  const ship = createShip();

  it("rides a long swell: heaves with it, pitches to its slope, and stays afloat", () => {
    const sea = swell({ amp: 0.6, length: 60, toward: 0 });
    let hi = -Infinity, lo = Infinity, pitch = 0, gap = 0;
    sail(ship, {
      state: ship.rest(),
      env: { water: sea },
      seconds: 40,
      each(d, s, t) {
        if (t < 10) return;
        hi = Math.max(hi, s.position[1]);
        lo = Math.min(lo, s.position[1]);
        pitch = Math.max(pitch, Math.abs(d.pitch));
        gap = Math.max(gap, Math.abs(s.position[1] - sea.heightAt(s.position[0], s.position[2], t)));
      },
    });
    // a 60 m wave is five boat lengths: the boat follows it up and down
    expect(hi - lo).toBeGreaterThan(0.8);
    expect(hi - lo).toBeLessThan(1.5);
    expect(gap).toBeLessThan(0.3);
    expect(pitch).toBeGreaterThan(1 * DEG);
    expect(pitch).toBeLessThan(10 * DEG);
  });

  it("surfs a little on a following sea", () => {
    const wind = steady(8, 0);
    const run = (water) => {
      let top = 0;
      sail(ship, {
        state: ship.rest({ yaw: -180 * DEG }),
        env: { water, wind },
        controls: { sail: 1, sheet: 1 },
        seconds: 60,
        helm: helmsman(180 * DEG),
        each(d, s, t) {
          if (t > 30) top = Math.max(top, Math.hypot(s.velocity[0], s.velocity[2]));
        },
      });
      return top;
    };
    const flat = run(calm);
    // a swell running the same way the boat is (toward +Z, from the north)
    const following = run(swell({ amp: 0.8, length: 50, toward: 180 }));
    expect(following).toBeGreaterThan(flat + 0.3);
  });
});

describe("integration", () => {
  const ship = createShip();
  const env = { water: swell({ amp: 0.4, length: 40, toward: 30 }), wind: steady(8, 20) };
  const controls = { sail: 1, sheet: 0.4, rudder: 0.1 };

  it("gives the same motion at any frame rate (fixed 120 Hz substeps)", () => {
    const run = (dt, seconds = 6) => {
      let s = ship.rest({ yaw: -1.2 });
      for (let i = 0; i < Math.round(seconds / dt); i++) s = ship.step(s, controls, env, dt);
      return s;
    };
    const fine = run(1 / 120);
    for (const dt of [1 / 30, 1 / 60, 1 / 40, 1 / 24]) {
      const coarse = run(dt);
      expect(coarse.t).toBeCloseTo(fine.t, 9);
      for (const k of ["position", "quaternion", "velocity", "spin"])
        coarse[k].forEach((v, i) => expect(v).toBeCloseTo(fine[k][i], 9));
    }
  });

  it("carries a part-substep remainder to the next step", () => {
    const s0 = ship.rest();
    const a = ship.step(s0, controls, env, SUBSTEP / 2);
    expect(a.t).toBe(0);
    expect(a.acc).toBeCloseTo(SUBSTEP / 2, 12);
    const b = ship.step(a, controls, env, SUBSTEP / 2);
    expect(b.t).toBeCloseTo(SUBSTEP, 12);
    expect(b.acc).toBe(0);
  });

  it("is pure: step returns a new state and leaves the old one alone", () => {
    const s0 = ship.rest();
    const copy = JSON.parse(JSON.stringify(s0));
    const s1 = ship.step(s0, controls, env, 1 / 60);
    expect(s0).toEqual(copy);
    expect(s1).not.toBe(s0);
    // and the same input gives the same output
    expect(ship.step(s0, controls, env, 1 / 60)).toEqual(s1);
  });

  it("a 1/60 s step takes well under a millisecond", () => {
    let s = ship.rest();
    const quick = { water: calm, wind: steady(8, 0) };
    for (let i = 0; i < 300; i++) s = ship.step(s, controls, quick, 1 / 60);
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) s = ship.step(s, controls, quick, 1 / 60);
    const ms = (performance.now() - t0) / n;
    expect(ms).toBeLessThan(0.5);
  });
});

describe("the boom", () => {
  it("swings across in a gybe over most of a second, not in a frame", () => {
    const ship = createShip();
    const env = { water: calm, wind: steady(8, 0) };
    // running, wind on the starboard quarter, turning to starboard: the wind crosses the stern
    let s = ship.rest({ yaw: -165 * DEG });
    s.velocity = [3 * Math.sin(165 * DEG), 0, -3 * Math.cos(165 * DEG)];
    const c = { sail: 1, sheet: 1, rudder: 1 };
    let prev = null, biggest = 0, crossed = null;
    for (let i = 0; i < 60 * 20; i++) {
      s = ship.step(s, c, env, 1 / 60);
      const b = ship.read(s, c, env).boom;
      if (prev != null) biggest = Math.max(biggest, Math.abs(b - prev));
      if (prev != null && Math.sign(b) !== Math.sign(prev) && crossed == null) crossed = i;
      prev = b;
    }
    expect(crossed).not.toBeNull();
    expect(biggest).toBeLessThan(4 * DEG); // per 1/60 s frame: 170° takes most of a second
    expect(Number.isFinite(s.boom)).toBe(true);
  });
});

describe("the anchor", () => {
  it("a far-off anchor pulls no harder than it holds, and nothing goes to NaN", () => {
    const ship = createShip();
    let s = ship.rest();
    const c = { sail: 0, anchor: { at: [0, -10, -300], rode: 15 } };
    let fastest = 0;
    for (let i = 0; i < 60 * 10; i++) {
      s = ship.step(s, c, { water: calm }, 1 / 60);
      fastest = Math.max(fastest, Math.hypot(...s.velocity));
    }
    for (const v of [...s.position, ...s.velocity, ...s.quaternion, ...s.spin]) expect(Number.isFinite(v)).toBe(true);
    expect(fastest).toBeLessThan(15);
  });

  it("snubbing up at speed stops her without throwing her back", () => {
    const ship = createShip();
    let s = ship.rest();
    s.velocity = [0, 0, -4];
    const c = { sail: 0, anchor: { at: [0, -10, 0], rode: 25 } };
    let astern = 0;
    for (let i = 0; i < 60 * 30; i++) {
      s = ship.step(s, c, { water: calm }, 1 / 60);
      astern = Math.max(astern, s.velocity[2]); // + is back toward the anchor
    }
    expect(astern).toBeLessThan(0.6);
  });
});
