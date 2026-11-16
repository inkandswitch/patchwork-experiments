// The weather (weather.js), the sea (sea.js) and ctx.sea (sea-view.js):
// what the weather offers (the wind and the sky as ambients), what a sea on
// a water body gives away (that body's waves, from the world's wind, for the
// water package), W20 (the settle: waves follow the world's wind in at most
// two flushes, compared by value), and how a boat reads her water and wind,
// alone (exactly her own sea: W1) and through a link's frame (the wind's half
// of W5), on a fake stage (test/fakes.js) whose doc is its own world.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { createOcean } from "./test/ocean.js";
import { GUSTINESS, createWind } from "./wind.js";
import sea, { seaBodies, seaParams, seaWavesFor } from "./sea.js";
import weather, { ATMOSPHERE, WIND_AMBIENT, weatherOffer, weatherParams } from "./weather.js";
import { createSeaView, levelOf, meanWindHere, windFor } from "./sea-view.js";
import { FLOAT, SEA, WEATHER } from "./traits.js";
import { emptyScene, fakeWorld } from "./test/fakes.js";

const object = (extra) => ({ name: "Object", parent: null, group: null, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, ...extra });
const place = (yaw, t, s = 1) => [Math.cos(yaw) * s, 0, -Math.sin(yaw) * s, 0, 0, s, 0, 0, Math.sin(yaw) * s, 0, Math.cos(yaw) * s, 0, t[0], t[1], t[2], 1];

describe("the weather from the doc", () => {
  it("fills in what the trait leaves out", () => {
    expect(weatherParams(undefined)).toEqual({ wind: { speed: 7, from: 45 }, seed: 1 });
    expect(weatherParams({ wind: { speed: 12 }, seed: 9 })).toEqual({ wind: { speed: 12, from: 45 }, seed: 9 });
    expect(weatherParams({ wind: { speed: -3, from: "x" } })).toEqual({ wind: { speed: 0, from: 45 }, seed: 1 });
  });

  it("offers plain data: the world's wind once, and the sky", () => {
    const o = weatherOffer({ wind: { speed: 8, from: 90 }, seed: 2 });
    expect(WIND_AMBIENT).toBe("wind");
    expect(o).toEqual({ wind: { speed: 8, from: 90, seed: 2, gustiness: GUSTINESS }, atmosphere: ATMOSPHERE });
    const made = createWind(o.wind);
    expect(made.at(3, 4, 5)).toEqual(createWind({ speed: 8, from: 90, seed: 2 }).at(3, 4, 5));
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    expect(weatherOffer(null)).toBeNull();
  });

  it("as an extension: offers them for the doc's trait, the same value until it changes, nothing without one", () => {
    let doc = { traits: { [WEATHER]: { wind: { speed: 8, from: 90 }, seed: 2 } } };
    const x = weather.create({ doc: () => doc });
    const a = x.ambient();
    expect(x.ambient()).toBe(a);
    expect(a.atmosphere).toBe(ATMOSPHERE);
    doc = { traits: { [WEATHER]: { wind: { speed: 14, from: 90 }, seed: 2 } } };
    expect(x.ambient()).not.toBe(a);
    doc = { traits: {} };
    expect(x.ambient()).toBeNull();
  });
});

describe("the sea on a water body", () => {
  it("fills in what the trait leaves out", () => {
    expect(seaParams(undefined)).toEqual({ seed: 1, scale: 1 });
    expect(seaParams({ seed: 9, scale: -1 })).toEqual({ seed: 9, scale: 0 });
  });

  it("its waves are the spectrum of the wind it's given, and what only it knows of them; no wind is flat water", () => {
    const trait = { seed: 2, scale: 1 };
    const w = seaWavesFor(trait, { speed: 8, from: 90 });
    const ocean = createOcean({ wind: { speed: 8, from: 90 }, seed: 2, scale: 1 });
    expect(w.components).toEqual(ocean.components);
    expect(w.look).toEqual({ seed: 2, stats: ocean.stats });
    expect(seaWavesFor(trait, null).components).toEqual([]);
    expect(seaWavesFor(trait, { speed: 0, from: 90 }).components).toEqual([]);
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  it("makes waves only for objects carrying both a sea and water, keyed by body", () => {
    const objects = { b: object({ traits: { water: { size: [3, 1, 3] }, [SEA]: { seed: 4 } } }), a: object({ traits: { water: {}, [SEA]: { seed: 2 } } }), c: object({ traits: { [SEA]: { seed: 3 } } }), d: object({ traits: { water: {} } }) };
    const wind = { speed: 8, from: 90 };
    expect(seaBodies(objects, wind)).toEqual({ a: seaWavesFor({ seed: 2 }, wind), b: seaWavesFor({ seed: 4 }, wind) });
  });

  /** A stand-in stage for the sea extension: its doc's objects, the world's wind ambient in a frame, and schedule. */
  function stage(objects, wind, frame = null) {
    const st = { objects, wind, frame, scheduled: 0, notices: [] };
    st.api = {
      scene: () => ({ objects: st.objects }),
      doc: () => ({ objects: st.objects, traits: { [WEATHER]: { wind: { speed: 1, from: 0 }, seed: 1 } } }),
      // a fresh object every call: the sea must compare the wind by value
      ambient: (name) => (name === WIND_AMBIENT && st.wind ? { value: { ...st.wind }, mine: !frame, frame: { matrix: st.frame } } : null),
      schedule: () => st.scheduled++,
      notify: (t) => st.notices.push(t),
    };
    return st;
  }

  it("as an extension: the world's wind in its own frame, not its doc's weather (the mutation: read the doc's weather, which fails in a harbour); it offers no wind of its own. W34: a clipped Sea's waves are the world's wind's too, and none in a still world", () => {
    for (const yawD of [0, 30])
      for (const holder of [{}, { size: [30, 3, 30] }, { clip: [60, 6, 60] }])
        for (const wind of [{ speed: 8, from: 250, seed: 7 }, null]) {
          const frame = yawD ? place((yawD * Math.PI) / 180, [5, 0, 5]) : null;
          const st = stage({ s: object({ traits: { water: holder, [SEA]: { seed: 2 } } }) }, wind, frame);
          const x = sea.create(st.api);
          const here = wind ? meanWindHere({ speed: 8, from: 250 }, { matrix: frame }) : null;
          expect(x["water.waves"]).toEqual({ bodies: { s: seaWavesFor({ seed: 2 }, here) } });
          // the doc's own weather (a 1 m/s breeze from the north, in the stage stub) reaches nothing
          if (!wind) expect(x["water.waves"].bodies.s.components).toEqual([]);
          expect(x.ambient).toBeUndefined();
        }
  });

  it("the settle (W20): built on a new wind, it asks for one more flush; on the same wind (by value), never", () => {
    const st = stage({ s: object({ traits: { water: {}, [SEA]: { seed: 2 } } }) }, null);
    const x = sea.create(st.api);
    const flat = x["water.waves"];
    expect(flat.bodies.s.components).toEqual([]);
    const after1 = st.scheduled;
    expect(x["water.waves"]).toBe(flat);
    expect(st.scheduled).toBe(after1);
    st.wind = { speed: 8, from: 90, seed: 1 };
    const waved = x["water.waves"];
    expect(waved.bodies.s.components.length).toBeGreaterThan(0);
    expect(st.scheduled).toBe(after1 + 1);
    // the same wind, a new object each read: nothing more
    for (let i = 0; i < 5; i++) expect(x["water.waves"]).toBe(waved);
    expect(st.scheduled).toBe(after1 + 1);
  });

  it("the settle (W20) in a flush loop: every arrival order of the weather, the Sea object and its water; the world's components equal the spectrum of its wind after at most two flushes once all are there, and stay", () => {
    const steps = ["weather", "object", "water"];
    const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
    for (const order of perms(steps))
      for (const wind of [{ speed: 8, from: 90 }, { speed: 5, from: 250 }]) {
        // the doc as it arrives, a step at a time; the stage flushes: ambients read from the last flush, offers stacked, scheduled work run
        const doc = { traits: {}, objects: {} };
        let ambients = {};
        let scheduled = false;
        const api = {
          scene: () => ({ objects: doc.objects }),
          doc: () => doc,
          ambient: (name) => (ambients[name] ? { value: JSON.parse(JSON.stringify(ambients[name])), mine: true, frame: { matrix: null } } : null),
          schedule: () => (scheduled = true),
          notify: () => {},
        };
        const w = weather.create(api);
        const s = sea.create(api);
        const flush = () => {
          scheduled = false;
          const waves = s["water.waves"];
          const open = Object.keys(doc.objects).find((id) => doc.objects[id].traits?.water && !doc.objects[id].traits.water.size);
          ambients = { ...(w.ambient() ?? {}), ...(open ? { water: { components: waves?.bodies?.[open]?.components ?? [] } } : {}) };
          return scheduled;
        };
        for (const step of order) {
          if (step === "weather") doc.traits[WEATHER] = { wind, seed: 3 };
          if (step === "object") doc.objects.sea = object({ traits: { ...(doc.objects.sea?.traits ?? {}), [SEA]: { seed: 3 } } });
          if (step === "water") doc.objects.sea = object({ traits: { ...(doc.objects.sea?.traits ?? {}), water: {} } });
          // a doc change: one flush, then as many as were asked for
          let n = 0;
          while (flush() && n < 10) n++;
        }
        const want = seaWavesFor({ seed: 3 }, wind).components;
        // all arrived: settled already, or within two more flushes
        let flushes = 0;
        while (JSON.stringify(ambients.water?.components) !== JSON.stringify(want) && flushes < 5) (flush(), flushes++);
        expect([order, flushes <= 2]).toEqual([order, true]);
        // and it stays: no flush asks for another
        expect(flush()).toBe(false);
        expect(ambients.water.components).toEqual(want);
      }
  });

  it("on an object without water: nothing, and it says so once", () => {
    const st = stage({ s: object({ name: "Rock", traits: { [SEA]: { seed: 2 } } }) }, { speed: 8, from: 90 });
    const x = sea.create(st.api);
    expect(x["water.waves"]).toBeUndefined();
    expect(x["water.waves"]).toBeUndefined();
    expect(st.notices).toEqual(["A sea needs water: add Water to “Rock”"]);
  });
});

// ─── ctx.sea on a fake stage ────────────────────────────────────────────────

function scene() {
  return {
    ...emptyScene(),
    objects: { sea: object({ name: "Sea", traits: { water: {}, [SEA]: { seed: 2, scale: 1 } } }), buoy: object({ name: "Buoy", transform: { position: [8, 0, -20], rotation: [0, 0.3, 0], scale: 1 }, traits: { [FLOAT]: {} } }) },
    order: ["sea", "buoy"],
    traits: { [WEATHER]: { wind: { speed: 8, from: 90 }, seed: 2 } },
  };
}

describe("createSeaView: a boat alone is her own world", () => {
  let w;
  afterEach(() => w?.done());

  it("reads the world's water and wind, which are her own sea's exactly (W1), and knows her doc is the world", () => {
    w = fakeWorld(scene());
    const api = w.join("A");
    const s = createSeaView(api);
    const own = createOcean({ wind: { speed: 8, from: 90 }, seed: 2, scale: 1 });
    const wind = createWind({ speed: 8, from: 90, seed: 2 });
    for (const [x, z, t] of [[0, 0, 0], [37.5, -100, 13.37], [1000, 5, 1e4]]) {
      expect(s.oceanAt([x, 0, z]).heightAt(x, z, t) === own.heightAt(x, z, t)).toBe(true);
      const [a, b] = s.wind.at(x, z, t);
      const [c, d] = wind.at(x, z, t);
      expect(a === c && b === d).toBe(true);
    }
    expect(s.world()).toBe(true);
  });

  it("no water, no water: nothing sails, though the weather's wind still blows; her doc is still the world (her ride and HUD don't hang on water)", () => {
    const doc = scene();
    delete doc.objects.sea;
    doc.order = ["buoy"];
    w = fakeWorld(doc);
    const s = createSeaView(w.join("A"));
    expect(s.oceanAt([0, 0, 0])).toBeNull();
    expect(s.wind).not.toBeNull();
    expect(s.world()).toBe(true);
  });

  it("asks the water package which water a point is in, with what she carries left out, and refuses the world's open water at another scale", () => {
    const asked = [];
    const open = { body: null, heightAt: () => 0 };
    const tank = { body: "tank", heightAt: () => -1 };
    for (const [scale, answer, want] of [[1, open, open], [1, tank, tank], [2, open, null], [2, tank, tank], [1, null, null]]) {
      const api = {
        collect: (name) => (name === "water" ? [{ id: "water", value: { at: (p, o) => (asked.push([p, o]), answer) } }] : []),
        ambient: (name) => (name === "water" ? { value: {}, mine: false, frame: { matrix: place(0, [0, 0, 0], scale) }, clock: { t: 0, running: true } } : null),
        clock: { t: () => 0 },
        notify: () => {},
      };
      expect(createSeaView(api).oceanAt([1, 2, 3], "hull")).toBe(want);
      expect(asked.at(-1)).toEqual([[1, 2, 3], { not: "hull" }]);
    }
  });

  it("whether her doc is the world is the wind's `mine` alone: every combination of the water and wind ambients × mine", () => {
    for (const water of [null, false, true])
      for (const wind of [null, false, true]) {
        const amb = { water, wind };
        const api = { ambient: (name) => (amb[name] == null ? null : { value: {}, mine: amb[name], frame: { matrix: null }, clock: { t: 0, running: true } }), collect: () => [], clock: { t: () => 0 } };
        expect([water, wind, createSeaView(api).world()]).toEqual([water, wind, wind === true]);
      }
  });

  it("is the water, the wind, whether she's the world, and its frame's tick: no clock of its own (the sea's time is api.clock.t())", () => {
    w = fakeWorld(scene());
    const sea = createSeaView(w.join("A"));
    expect(Object.keys(sea).sort()).toEqual(["oceanAt", "tick", "wind", "world"]);
  });

  it("its tick answers the doc's world time, at every t of the table", () => {
    for (const t of [0, 1.5, 30]) {
      w?.done();
      w = fakeWorld({ ...scene(), clock: { running: false, t } });
      const api = w.join("A");
      const sea = createSeaView(api);
      let seen = null;
      api.loop(() => (seen = sea.tick()));
      w.tick(1 / 60, 1);
      expect([t, api.clock.t(), seen]).toEqual([t, t, t]);
    }
  });
});

describe("the world's mean wind in a frame (meanWindHere): what a sea builds its waves from", () => {
  it("is windFor's mean wind, every yaw × scale × bearing; the world's own, as offered; tilted or none, null", () => {
    for (const yawDeg of [0, 30, 90, 137, 180, 270])
      for (const s of [0.5, 1, 2])
        for (const from of [0, 45, 250, 359]) {
          const frame = { matrix: place((yawDeg * Math.PI) / 180, [40, 0, 25], s) };
          const here = meanWindHere({ speed: 9, from }, frame);
          const wf = windFor({ speed: 9, from, seed: 7, gustiness: 0 }, frame, { mine: false, delta: 0, running: true, worldT: 0 });
          expect(here.speed).toBeCloseTo(wf.speed, 12);
          expect(here.from).toBeCloseTo(wf.from, 9);
        }
    expect(meanWindHere({ speed: 9, from: 250 }, { matrix: null })).toEqual({ speed: 9, from: 250 });
    expect(meanWindHere(null, null)).toBeNull();
    const tilt = (5 * Math.PI) / 180;
    expect(meanWindHere({ speed: 9, from: 0 }, { matrix: [1, 0, 0, 0, 0, Math.cos(tilt), Math.sin(tilt), 0, 0, -Math.sin(tilt), Math.cos(tilt), 0, 0, 0, 0, 1] })).toBeNull();
  });
});

describe("the world's wind through a link (windFor): mapped by the frame, at the world's time", () => {
  const value = { speed: 9, from: 250, seed: 7 };
  const raw = createWind(value);
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

// The sea's time is the doc's world time and nothing else: ctx.sea has no
// clock, and nothing in the package (source, tests, probes) reads one off
// it or defaults a missing clock. Every .js, .mjs and .html file is read,
// as standalone.test.js reads them: the whole package, nothing sampled,
// but for this file, whose table below names the forms on purpose.
describe("the sea's time is api.clock.t(), read the one way", () => {
  const SELF = fileURLToPath(import.meta.url);
  const ROOT = resolve(dirname(SELF), "..");
  const SKIP = new Set(["node_modules", "dist", ".pushwork", ".git"]);
  const files = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) files(p, out);
      else if (/\.(m?js|html)$/.test(e.name) && p !== SELF) out.push(p);
    }
    return out;
  };
  /** a clock read off the sea */
  const SEA_CLOCK = /\bsea\??\.clock\b/;
  /** the stage's clock (api.clock, its t()) read as if it might be missing; a doc's stored clock field (doc.clock?.t) may be */
  const DEFAULTED = /\bapi\??\.clock\?\.|\bclock\.t\?\.\(|\bclock\.t\(\)\s*\?\?/;

  it("the patterns find every form they name, and nothing else", () => {
    const hits = (re) => (line) => re.test(line);
    expect(["ctx.sea.clock()", "s.sea?.clock?.()", "ctx.sea.clock", "x.sea.clockwise", "x.overseas.clock"].map(hits(SEA_CLOCK))).toEqual([true, true, true, false, false]);
    expect(["api.clock?.t()", "api.clock.t?.()", "api.clock.t() ?? 0", "a.api?.clock?.t()", "api.clock.t()", "doc.clock?.running", "doc.clock?.t", "api ? api.clock.t() : null"].map(hits(DEFAULTED))).toEqual([true, true, true, true, false, false, false, false]);
  });

  const all = files(ROOT);
  it(`reads every file (${all.length})`, () => expect(all.length).toBeGreaterThan(10));
  it("no file reads a clock off the sea, or defaults a missing clock", () => {
    const found = [];
    for (const f of all)
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (SEA_CLOCK.test(line) || DEFAULTED.test(line)) found.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
        });
    expect(found).toEqual([]);
  });
});
