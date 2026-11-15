// The sea part (sea.js) and ctx.sea (sea-view.js): what a sea trait gives
// away (waves for the water package, the wind and the sky as ambients), and
// how a boat reads her world's water and wind, alone (exactly her own sea:
// W1) and through a link's frame (the wind's half of W5), on a fake stage
// (test/fakes.js) whose doc is its own world.
import { describe, it, expect, afterEach } from "vitest";
import { createOcean } from "./test/ocean.js";
import { GUSTINESS, createWind } from "./wind.js";
import sea, { ATMOSPHERE, WIND_AMBIENT, seaOffer, seaParams } from "./sea.js";
import { createSeaView, levelOf, windFor } from "./sea-view.js";
import { FLOAT, SEA } from "./traits.js";
import { emptyScene, fakeWorld } from "./test/fakes.js";

describe("the sea from the doc", () => {
  it("fills in what the trait leaves out", () => {
    expect(seaParams(undefined)).toEqual({ wind: { speed: 7, from: 45 }, seed: 1, scale: 1 });
    expect(seaParams({ wind: { speed: 12 }, seed: 9 })).toEqual({ wind: { speed: 12, from: 45 }, seed: 9, scale: 1 });
    expect(seaParams({ wind: { speed: -3, from: "x" }, scale: -1 })).toEqual({ wind: { speed: 0, from: 45 }, seed: 1, scale: 0 });
  });

  it("gives away plain data: the spectrum's components and what only it knows of them (seed, stats) as water.waves; the world's wind and the sky as ambients, the wind once", () => {
    const trait = { wind: { speed: 8, from: 90 }, seed: 2, scale: 1 };
    const o = seaOffer(trait);
    const ocean = createOcean(seaParams(trait));
    expect(o.waves.components).toEqual(ocean.components);
    expect(o.waves.look).toEqual({ seed: 2, stats: ocean.stats });
    expect(WIND_AMBIENT).toBe("wind");
    expect(o.ambient).toEqual({ wind: { speed: 8, from: 90, seed: 2, gustiness: GUSTINESS }, atmosphere: ATMOSPHERE });
    // one copy of one fact: nothing but the wind ambient says how the wind blows
    const says = (v, path = "") => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => says(x, `${path}.${k}`)) : [path]);
    expect(says(o).filter((p) => /speed|from|gust/.test(p))).toEqual([".ambient.wind.speed", ".ambient.wind.from", ".ambient.wind.gustiness"]);
    // and it makes the wind sailing sails in, exactly
    const made = createWind(o.ambient.wind);
    const own = createWind({ speed: 8, from: 90, seed: 2 });
    expect(made.at(3, 4, 5)).toEqual(own.at(3, 4, 5));
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    expect(seaOffer(null)).toBeNull();
  });

  it("as an extension: offers them for the doc's trait, made again only when it changes, nothing without one", () => {
    let doc = { traits: { [SEA]: { wind: { speed: 8, from: 90 }, seed: 2 } } };
    const x = sea.create({ doc: () => doc });
    const w1 = x["water.waves"];
    expect(x["water.waves"]).toBe(w1);
    expect(x.ambient().atmosphere).toBe(ATMOSPHERE);
    doc = { traits: { [SEA]: { wind: { speed: 14, from: 90 }, seed: 2 } } };
    expect(x["water.waves"]).not.toBe(w1);
    doc = { traits: {} };
    expect(x["water.waves"]).toBeUndefined();
    expect(x.ambient()).toBeNull();
  });
});

// ─── ctx.sea on a fake stage ────────────────────────────────────────────────

const object = (extra) => ({ name: "Object", parent: null, group: null, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, ...extra });
function scene() {
  return {
    ...emptyScene(),
    objects: { buoy: object({ name: "Buoy", transform: { position: [8, 0, -20], rotation: [0, 0.3, 0], scale: 1 }, traits: { [FLOAT]: {} } }) },
    order: ["buoy"],
    traits: { [SEA]: { wind: { speed: 8, from: 90 }, seed: 2, scale: 1 }, water: { level: 0 } },
  };
}

describe("createSeaView: a boat alone is her own world", () => {
  let w;
  afterEach(() => w?.done());

  it("reads the world's water and wind, which are her own sea's exactly (W1), and knows her doc is the world", () => {
    w = fakeWorld(scene());
    const api = w.join("A");
    const s = createSeaView(api);
    const own = createOcean(seaParams(scene().traits[SEA]));
    const wind = createWind({ speed: 8, from: 90, seed: 2 });
    for (const [x, z, t] of [[0, 0, 0], [37.5, -100, 13.37], [1000, 5, 1e4]]) {
      expect(s.ocean.heightAt(x, z, t) === own.heightAt(x, z, t)).toBe(true);
      const [a, b] = s.wind.at(x, z, t);
      const [c, d] = wind.at(x, z, t);
      expect(a === c && b === d).toBe(true);
    }
    expect(s.world()).toBe(true);
  });

  it("no water trait, no water: nothing sails, though the sea's wind still blows; her doc is still the world (her ride and HUD don't hang on water)", () => {
    const doc = scene();
    delete doc.traits.water;
    w = fakeWorld(doc);
    const s = createSeaView(w.join("A"));
    expect(s.ocean).toBeNull();
    expect(s.wind).not.toBeNull();
    expect(s.world()).toBe(true);
  });

  it("whether her doc is the world is the wind's `mine` alone: every combination of the water and wind ambients × mine", () => {
    for (const water of [null, false, true])
      for (const wind of [null, false, true]) {
        const amb = { water, wind };
        const api = { ambient: (name) => (amb[name] == null ? null : { value: {}, mine: amb[name], frame: { matrix: null }, clock: { t: 0, running: true } }), collect: () => [], clock: { t: () => 0 } };
        expect([water, wind, createSeaView(api).world()]).toEqual([water, wind, wind === true]);
      }
  });

  it("its time is the doc's world time, the same on every view; paused, it stands still", () => {
    w = fakeWorld(scene());
    const a = w.join("A");
    const sa = createSeaView(a);
    const sb = createSeaView(w.join("B"));
    a.clock.process({ step() {} });
    a.loop(() => sa.tick());
    w.tick(1 / 60, 60);
    expect(sa.clock()).toBeCloseTo(1, 6);
    expect(sb.clock()).toBe(sa.clock());
    w.join("C").clock.pause();
    w.tick(1 / 60, 60);
    expect(sa.clock()).toBeCloseTo(1, 6);
  });
});

describe("the world's wind through a link (windFor): mapped by the frame, at the world's time", () => {
  const value = { speed: 9, from: 250, seed: 7 };
  const raw = createWind(value);
  const place = (yaw, t, s = 1) => [Math.cos(yaw) * s, 0, -Math.sin(yaw) * s, 0, 0, s, 0, 0, Math.sin(yaw) * s, 0, Math.cos(yaw) * s, 0, t[0], t[1], t[2], 1];
  for (const yawDeg of [0, 30, 90, 137, 180])
    for (const s of [0.5, 1, 2])
      it(`yaw ${yawDeg}°, scale ${s}: the wind at a point is the world's there, turned and scaled into the frame`, () => {
        const yaw = (yawDeg * Math.PI) / 180;
        for (const t0 of [[0, 0, 0], [40, 0, 25], [-40, 2, -25]]) {
          const M = place(yaw, t0, s);
          const timing = { mine: false, delta: 50, running: true, worldT: 0 };
          const wf = windFor(value, { matrix: M }, timing);
          for (const x of [-30, 0, 30])
            for (const z of [-30, 0, 30])
              for (const t of [0, 3.7, 1000]) {
                const xw = M[0] * x + M[8] * z + M[12], zw = M[2] * x + M[10] * z + M[14];
                const [vx, vz] = raw.at(xw, zw, t + 50);
                // back into the frame: Rᵀ v / s
                const ex = (M[0] * vx + M[2] * vz) / (s * s), ez = (M[8] * vx + M[10] * vz) / (s * s);
                const [gx, gz] = wf.at(x, z, t);
                expect(Math.abs(gx - ex)).toBeLessThan(1e-9);
                expect(Math.abs(gz - ez)).toBeLessThan(1e-9);
              }
        }
      });

  it("a tilted frame has no wind; no value, none; the world's own is the wind as made", () => {
    const tilt = (5 * Math.PI) / 180;
    expect(levelOf({ matrix: [1, 0, 0, 0, 0, Math.cos(tilt), Math.sin(tilt), 0, 0, -Math.sin(tilt), Math.cos(tilt), 0, 0, 0, 0, 1] })).toBeNull();
    expect(windFor(value, { matrix: [1, 0, 0, 0, 0, Math.cos(tilt), Math.sin(tilt), 0, 0, -Math.sin(tilt), Math.cos(tilt), 0, 0, 0, 0, 1] }, { mine: false })).toBeNull();
    expect(windFor(null, null, { mine: true })).toBeNull();
    const mine = windFor(value, { matrix: null }, { mine: true });
    expect(mine.at(3, 4, 5)).toEqual(raw.at(3, 4, 5));
  });

  it("its speed and from are in the frame too: with no gusts, at() blows `speed` from `from`, every yaw × scale × bearing", () => {
    for (const yawDeg of [0, 30, 90, 137, 180, 270])
      for (const s of [0.5, 1, 2])
        for (const from of [0, 45, 250, 359]) {
          const yaw = (yawDeg * Math.PI) / 180;
          const wf = windFor({ speed: 9, from, seed: 7, gustiness: 0 }, { matrix: place(yaw, [40, 0, 25], s) }, { mine: false, delta: 0, running: true, worldT: 0 });
          const [vx, vz] = wf.at(3, -4, 5);
          expect(Math.hypot(vx, vz)).toBeCloseTo(wf.speed, 9);
          const a = (wf.from * Math.PI) / 180;
          // downwind is (−sin from, cos from)
          expect(vx / wf.speed).toBeCloseTo(-Math.sin(a), 9);
          expect(vz / wf.speed).toBeCloseTo(Math.cos(a), 9);
          expect(wf.from >= 0 && wf.from < 360).toBe(true);
        }
  });

  it("a paused world's wind is frozen at its latched time", () => {
    const wf = windFor(value, { matrix: place(0.3, [5, 0, 5]) }, { mine: false, delta: 9, running: false, worldT: 42 });
    expect(wf.at(1, 2, 0)).toEqual(wf.at(1, 2, 100));
  });
});
