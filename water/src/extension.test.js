// The water extension on a fake view of linked stages (test/fake-view.js):
// W17 (the draw count, replacing W3), W10 (the same water for two boats in a
// harbour), W11 (no water holds still, never the wrong water), W16 (things
// travel, weather doesn't), W18 (bounded water ignores placement), W21 (the
// extent is data), W24 (one open body per doc), the processes (W13 widened),
// and what it offers (waterValue). Every configuration is enumerated;
// nothing is randomized.
import { afterEach, describe, expect, it } from "vitest";
import golden from "./test/golden.json";
import water, { TRAIT, WAVES, WIND, isUnder, patchExtent, unionOf, waterExtent, waterValue, wavesByBody } from "./extension.js";
import { boxOf } from "./bodies.js";
import { compose, fakeView, mulM, patches, placement, surfaces, waves, windOf } from "./test/fake-view.js";
import { createSurface } from "./surface.js";

const sea = (name) => golden.seas.find((s) => s.name === name);
const H_SEA = sea("Harbour");
const A_SEA = sea("Ship at sea");
const B_SEA = sea("Ship at anchor");
const at = (position, extra = {}) => ({ name: "Object", parent: null, transform: { position, rotation: [0, 0, 0], scale: 1 }, ...extra });
const seaObject = (level = 0) => at([0, level, 0], { name: "Sea", traits: { [TRAIT]: {} } });
// a hull, and a tank attached under it (2 × 1 × 3 m, its surface 0.5 m below her origin, 2 m aft)
const HULL = () => at([0, 0, 0], { name: "Hull" });
const TANK = () => at([0, -0.5, 2], { name: "Tank", parent: "hull", traits: { [TRAIT]: { size: [2, 1, 3] } } });
const wet = (s, level = 0, objects = {}) => ({ doc: { title: s.name, traits: {}, objects: { sea: seaObject(level), ...objects } }, extensions: [waves(s.components, { seed: s.seed }), windOf(s.wind), water] });
const flat = (title, level = 0) => ({ doc: { title, traits: {}, objects: { sea: seaObject(level) } }, extensions: [water] });
const dry = (title, objects = {}) => ({ doc: { title, traits: {}, objects }, extensions: Object.keys(objects).length ? [water] : [] });
const withTank = (spec) => ({ ...spec, doc: { ...spec.doc, objects: { ...spec.doc.objects, hull: HULL(), tank: TANK() } } });
// the harbour's link poses (WATER.md, "Which doc holds what")
const AT_A = placement(0, [-40, 0, 0]);
const AT_B = placement((30 * Math.PI) / 180, [40, 0, 0]);
const inst = (v, n) => v.stages[n].instances.at(-1);

let v = null;
afterEach(() => {
  v?.dispose();
  v = null;
});

describe("what a doc offers (waterValue, wavesByBody)", () => {
  it("its level, and the waves whole; none is flat water at the level; a current rides in it", () => {
    expect(waterValue(1.5, null)).toEqual({ v: 2, level: 1.5, components: [] });
    expect(waterValue(0, { components: [{ amp: 2 }], look: { seed: 3 } })).toEqual({ v: 2, level: 0, components: [{ amp: 2 }], look: { seed: 3 } });
    expect(waterValue(NaN, undefined)).toEqual({ v: 2, level: 0, components: [] });
    const c = { dir: [1, 0], k: 0.5, omega: 2, amp: 1, steep: 0.5, phase: 0 };
    expect(waterValue(0, { components: [c] }, [1, 0])).toEqual({ v: 2, level: 0, components: [{ ...c, omega: 2.5 }], current: [1, 0] });
  });

  it("per body, the last contributor's waves whole", () => {
    const got = wavesByBody([
      { id: "x", value: { bodies: { a: { components: [{ amp: 1 }], look: { seed: 3 } }, b: { components: [{ amp: 5 }] } } } },
      { id: "y", value: { bodies: { a: { components: [{ amp: 2 }] } } } },
      { id: "z", value: { nope: 1 } },
      { id: "w", value: { bodies: { b: { nope: 1 } } } },
    ]);
    expect(got).toEqual({ a: { components: [{ amp: 2 }] }, b: { components: [{ amp: 5 }] } });
  });

  it("the extent holds every crest and trough about the level", () => {
    const e = waterExtent(H_SEA.components, 2);
    const amp = H_SEA.components.reduce((s, c) => s + c.amp, 0);
    expect(e.max[1]).toBeCloseTo(2 + amp + 0.5, 12);
    expect(e.min[1]).toBeCloseTo(2 - amp - 0.5, 12);
    const w = createSurface(H_SEA.components);
    for (const x of [-100, 0, 37.5]) for (const t of [0, 13.37, 1e4]) expect(Math.abs(w.heightAt(x, x / 2, t))).toBeLessThan(amp + 0.5);
  });

  it("a patch's extent is its footprint's corners, turned, and the band about its level; the union holds them all", () => {
    const box = boxOf([2, 1, 4], compose({ position: [10, 3, -5], rotation: [0, Math.PI / 2, 0] }));
    const e = patchExtent(box, 0.5);
    const r = (a) => a.map((x) => Math.round(x * 1e9) / 1e9 + 0);
    expect(r(e.min)).toEqual([8, 2.5, -6]);
    expect(r(e.max)).toEqual([12, 3.5, -4]);
    expect(unionOf([null, e, { min: [0, 0, 0], max: [1, 1, 1] }])).toEqual({ min: [0, 0, e.min[2]], max: [e.max[0], e.max[1], 1] });
    expect(unionOf([null])).toBeNull();
  });

  it("isUnder walks the resolved tree, any depth, and nothing is under no one", () => {
    const sc = { parents: new Map([["a", null], ["b", "a"], ["c", "b"]]) };
    expect(["a", "b", "c"].map((id) => isUnder(sc, id, "a"))).toEqual([true, true, true]);
    expect(["a", "b", "c"].map((id) => isUnder(sc, id, "b"))).toEqual([false, true, true]);
    expect(isUnder(sc, "c", null)).toBe(false);
  });
});

/** W3's configurations: [label, specs (outermost first), does the outermost offer open water]. */
function configurations() {
  return [
    ["one boat alone", [wet(A_SEA)], true],
    ["a dry room alone", [dry("Room")], false],
    ["one boat in a harbour", [wet(H_SEA), { ...wet(A_SEA), matrix: AT_A }], true],
    ["two boats in a harbour", [wet(H_SEA), { ...wet(A_SEA), matrix: AT_A }, { ...wet(B_SEA), matrix: AT_B }], true],
    ["one boat in a dry room", [dry("Room"), { ...wet(A_SEA), matrix: AT_A }], false],
    ["two boats in a dry room", [dry("Room"), { ...wet(A_SEA), matrix: AT_A }, { ...wet(B_SEA), matrix: AT_B }], false],
    ["a boat two links deep in a harbour", [wet(H_SEA), { ...dry("Shed"), matrix: AT_B }, { ...wet(A_SEA), matrix: mulM(AT_B, AT_A) }], true],
    ["a boat mirrored in a harbour", [wet(H_SEA), { ...wet(A_SEA), matrix: AT_A }, { ...wet(A_SEA), matrix: AT_B, drawn: true }], true],
    ["a boat linked into another boat", [wet(B_SEA), { ...wet(A_SEA), matrix: AT_A }], true],
  ];
}

/** W16's configurations, each boat with a tank: [label, specs, the outermost offers open water]. */
function tankConfigurations() {
  const A = (m, extra = {}) => ({ ...withTank(wet(A_SEA)), matrix: m, ...extra });
  const B = (m) => ({ ...withTank(wet(B_SEA)), matrix: m });
  return [
    ["a boat with a tank alone", [withTank(wet(A_SEA))], true],
    ["a harbour with A and B each holding a tank", [wet(H_SEA), A(AT_A), B(AT_B)], true],
    ["a dry room with A and B each holding a tank", [dry("Room"), A(AT_A), B(AT_B)], false],
    ["A mirrored in a harbour", [wet(H_SEA), A(AT_A), A(AT_B, { drawn: true })], true],
    ["A pinned in a harbour", [wet(H_SEA), A(AT_B, { drawn: true, running: false })], true],
    ["A two links deep in a harbour", [wet(H_SEA), { ...dry("Shed"), matrix: AT_B }, A(mulM(AT_B, AT_A))], true],
  ];
}

/** The Model basin (no open water, no weather) beside Ship at sea, in a dry room. */
const BASIN = () => ({ doc: { title: "Model basin", traits: {}, objects: { basin: at([0, 0, 0], { name: "Basin", traits: { [TRAIT]: { size: [30, 3, 30] } } }), sloop: at([0, 0, 0], { name: "Sloop" }) } }, extensions: [water] });

describe("the draw count (W17): one open surface where the outermost has an open body, and a patch per bounded body per placement that draws its doc", () => {
  const all = [
    ...configurations(),
    ...tankConfigurations(),
    ["the Model basin beside Ship at sea, in a dry room", [dry("Room"), { ...BASIN(), matrix: AT_A }, { ...wet(A_SEA), matrix: AT_B }], false],
  ];
  for (const [label, specs, offers] of all)
    it(label, () => {
      v = fakeView(specs);
      for (let i = 0; i < 3; i++) v.frame();
      expect(surfaces(v)).toBe(offers ? 1 : 0);
      const want = specs.reduce((n, s) => n + Object.values(s.doc.objects ?? {}).filter((o) => o.traits?.[TRAIT]?.size).length, 0);
      expect(patches(v)).toBe(want);
      // only the outermost sets the open slab; a stage drawing patches sets its own extent, else none is set
      v.stages.forEach((s, n) => {
        const own = Object.values(specs[n].doc.objects ?? {}).some((o) => o.traits?.[TRAIT]?.size);
        if ((n === 0 && offers) || own) expect(s.extent).not.toBeNull();
        else expect(s.extentSets).toBe(0);
        if (n === 0 && offers) expect(s.extent.max[0]).toBe(20_000);
        else if (own) expect(s.extent.max[0]).toBeLessThan(100);
      });
      if (offers) {
        const drawn = inst(v, 0).debug.surface;
        expect(drawn.object.position.y).toBe(specs[0].doc.objects.sea.transform.position[1]);
      }
    });

  it("the outermost's open water going away takes the surface and the extent with it", () => {
    v = fakeView(configurations()[2][1]);
    v.frame();
    expect(surfaces(v)).toBe(1);
    delete v.stages[0].doc.objects.sea;
    v.frame();
    expect(surfaces(v)).toBe(0);
    expect(v.stages[0].extent).toBeNull();
  });

  it("a tank going away takes its patch with it", () => {
    v = fakeView([withTank(wet(A_SEA))]);
    v.frame();
    expect(patches(v)).toBe(1);
    delete v.stages[0].doc.objects.tank;
    v.frame();
    expect(patches(v)).toBe(0);
  });
});

describe("the same water for two boats (W10)", () => {
  it("one view computing the harbour and both boats: each boat's reader, mapped to harbour coordinates, is the harbour's own, over 600 frames × a 5×5 grid", () => {
    v = fakeView([{ ...wet(H_SEA), t: 1000 }, { ...wet(A_SEA), matrix: AT_A, t: 3 }, { ...wet(B_SEA), matrix: AT_B, t: 77.5 }]);
    const reader = (n, p) => inst(v, n).water.at(p);
    const toHarbour = (M, p) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
    const fromHarbour = (M, p) => {
      const x = p[0] - M[12], z = p[2] - M[14];
      return [M[0] * x + M[2] * z, p[1] - M[13], M[8] * x + M[10] * z];
    };
    const GRID = [-60, -30, 0, 30, 60];
    let worst = 0;
    for (let f = 0; f < 600; f++) {
      v.frame(1 / 60);
      for (const [n, M] of [[1, AT_A], [2, AT_B]]) {
        const tOwn = v.stages[n].clock.t;
        for (const x of GRID)
          for (const z of GRID) {
            const p = fromHarbour(M, [x, 0, z]);
            const R = reader(n, p);
            const hOwn = R.heightAt(p[0], p[2], tOwn);
            const hHarbour = toHarbour(M, [p[0], hOwn, p[2]])[1];
            worst = Math.max(worst, Math.abs(hHarbour - reader(0, [x, 0, z]).heightAt(x, z, v.stages[0].clock.t)));
          }
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("each boat's own waves are never the ones she reads in a harbour (the mutation: give A her own open water)", () => {
    v = fakeView([wet(H_SEA), { ...wet(A_SEA), matrix: AT_A }]);
    v.frame();
    const R = inst(v, 1).water.at([0, 0, 0]);
    expect(R.components).toEqual(H_SEA.components);
    expect(R.components).not.toEqual(A_SEA.components);
    expect(R.body).toBeNull();
  });
});

describe("no water holds still, never the wrong water (W11)", () => {
  for (const [label, specs] of [
    ["one boat in a dry room", [dry("Room"), { ...wet(A_SEA), matrix: AT_A }]],
    ["two boats in a dry room", [dry("Room"), { ...wet(A_SEA), matrix: AT_A }, { ...wet(B_SEA), matrix: AT_B }]],
    // the outermost has open water but this view lacks its water package: nothing of it runs there, so nothing is offered
    ["the outermost's water package missing", [{ doc: { title: "Harbour", traits: {}, objects: { sea: seaObject() } }, extensions: [waves(H_SEA.components)] }, { ...wet(A_SEA), matrix: AT_A }]],
  ])
    it(`${label}: every boat's reader is null for 600 frames, wherever she asks`, () => {
      v = fakeView(specs);
      for (let f = 0; f < 600; f++) {
        v.frame();
        for (const s of v.stages.slice(1)) for (const p of [[0, 0, 0], [0, -5, 0], [3, null, 4]]) expect(s.instances.at(-1).water.at(p)).toBeNull();
      }
    });
});

describe("things travel, weather doesn't (W16)", () => {
  const GRID = [-0.8, -0.4, 0, 0.4, 0.8];
  for (const [label, specs, offers] of tankConfigurations())
    it(label, () => {
      v = fakeView(specs);
      for (let i = 0; i < 3; i++) v.frame();
      const H = offers ? inst(v, 0).water.at([0, 0, 0]) : null;
      v.stages.forEach((s, n) => {
        const x = s.instances.at(-1);
        if (!x?.water) return;
        const tanks = Object.entries(specs[n].doc.objects ?? {}).filter(([, o]) => o.traits?.[TRAIT]?.size).map(([id]) => id);
        for (const id of tanks) {
          const M = s.api.worldOf(id);
          for (const u of GRID)
            for (const w of GRID) {
              // a point in the tank, under its surface, in this stage's frame
              const p = [M[0] * u * 1 + M[8] * w * 1.5 + M[12], M[13] - 0.2, M[2] * u + M[10] * w * 1.5 + M[14]];
              const r = x.water.at(p);
              // its own tank answers for it at every placement
              expect([label, n, r?.body]).toEqual([label, n, id]);
              // and what carries it is left out of it: the world's open water, or none
              const carried = x.water.at(p, { not: "hull" });
              expect([label, n, carried?.body ?? null, carried === null ? null : carried.components]).toEqual([label, n, null, offers ? H.components : null].map((e, i) => (i === 3 && !offers ? null : e)));
            }
        }
        // every reader is the world's open water or a body of this doc
        for (const p of [[0, 0, 0], [0, -0.7, 2], [50, 0, 50], [0, null, 2]]) {
          const r = x.water.at(p);
          if (!r) continue;
          if (r.body === null) expect(offers && JSON.stringify(r.components) === JSON.stringify(H.components)).toBe(true);
          else expect(tanks).toContain(r.body);
        }
      });
    });
});

describe("bounded water ignores placement (W18): a doc's tank reads the same in its own frame wherever the doc sits", () => {
  const tilt = (20 * Math.PI) / 180;
  const heeled = [1, 0, 0, 0, 0, Math.cos(tilt), Math.sin(tilt), 0, 0, -Math.sin(tilt), Math.cos(tilt), 0, 5, 0, 5, 1];
  const G = (waved) => ({ doc: { title: "G", traits: {}, objects: { hull: HULL(), tank: TANK() } }, extensions: waved ? [waves(A_SEA.components.slice(-3), { seed: 1 }, ["tank"]), water] : [water] });
  for (const waved of [false, true])
    it(waved ? "with waves" : "flat", () => {
      const placements = [
        ["alone", (g) => [g]],
        ["in X yawed 30°", (g) => [dry("X"), { ...g, matrix: placement((30 * Math.PI) / 180, [7, 0, -3]) }]],
        ["in X′ with a 20° heeled frame", (g) => [dry("X′"), { ...g, matrix: heeled }]],
        ["mirrored", (g) => [dry("X"), { ...g, matrix: AT_A }, { ...g, matrix: AT_B, drawn: true }]],
        ["two deep", (g) => [dry("X"), { ...dry("Shed"), matrix: AT_B }, { ...g, matrix: mulM(AT_B, AT_A) }]],
      ];
      const readings = placements.map(([name, make]) => {
        v = fakeView(make(G(waved)));
        v.frame();
        const out = [];
        for (const s of v.stages.filter((s) => s.doc.title === "G")) {
          const R = s.instances.at(-1).water.at([0, -0.6, 2]);
          for (const x of [-0.5, 0, 0.5]) for (const z of [1, 2, 3]) for (const t of [0, 3.7, 1000]) out.push(R.heightAt(x, z, t), ...R.normalAt(x, z, t));
        }
        v.dispose();
        v = null;
        return [name, out];
      });
      const first = readings[0][1];
      for (const [name, out] of readings) for (let i = 0; i < out.length; i += first.length) expect([name, out.slice(i, i + first.length)]).toEqual([name, first]);
      // and level to G's own +Y: flat water reads its level exactly, the normal straight up
      if (!waved) expect(first.slice(0, 4)).toEqual([-0.5, 0, 1, 0]);
    });
});

describe("the extent is data (W21): no region or extent asks what has loaded", () => {
  for (const [label, specs] of [...configurations(), ...tankConfigurations()])
    it(label, () => {
      v = fakeView(specs);
      for (const s of v.stages) {
        s.api.content = () => {
          throw new Error("read content");
        };
        s.api.box = () => {
          throw new Error("read a box");
        };
      }
      for (let i = 0; i < 3; i++) v.frame();
      for (const s of v.stages) for (const x of s.instances) if (x.water) for (const p of [[0, 0, 0], [0, -0.7, 2], [0, null, 0]]) x.water.at(p);
    });
});

describe("one open body per doc (W24): the lowest id is its open water; the others are flagged and draw and offer nothing", () => {
  const orders = [["a"], ["a", "b"], ["b", "a"], ["a", "b", "c"], ["a", "c", "b"], ["b", "a", "c"], ["b", "c", "a"], ["c", "a", "b"], ["c", "b", "a"]];
  for (const ids of orders)
    for (const bounded of [false, true])
      it(`${ids.join(",")} written in that order${bounded ? ", with a tank" : ""}`, () => {
        const objects = {};
        // each open body at its own level: a 1, b 2, c 3
        for (const id of ids) objects[id] = at([0, { a: 1, b: 2, c: 3 }[id], 0], { name: id.toUpperCase(), traits: { [TRAIT]: {} } });
        if (bounded) Object.assign(objects, { hull: HULL(), tank: TANK() });
        v = fakeView([{ doc: { title: "D", traits: {}, objects }, extensions: [water] }]);
        v.frame();
        expect(inst(v, 0).ambient().water.level).toBe(1);
        expect(surfaces(v)).toBe(1);
        expect(patches(v)).toBe(bounded ? 1 : 0);
        expect(v.stages[0].notices.filter((n) => n.startsWith("Only one open water"))).toHaveLength(ids.length - 1);
      });

  it("a tilted open body offers nothing, and says so once", () => {
    v = fakeView([{ doc: { title: "D", traits: {}, objects: { sea: { ...seaObject(), transform: { position: [0, 0, 0], rotation: [0.1, 0, 0], scale: 1 } } } }, extensions: [water] }]);
    for (let i = 0; i < 3; i++) v.frame();
    expect(inst(v, 0).ambient()).toBeNull();
    expect(surfaces(v)).toBe(0);
    expect(v.stages[0].notices.filter((n) => n === "Tilted: no water here")).toHaveLength(1);
  });

  it("an open body's yaw and sideways place change nothing; a size that isn't three positive numbers is no water, flagged", () => {
    v = fakeView([{ doc: { title: "D", traits: {}, objects: { sea: { ...seaObject(2), transform: { position: [50, 2, -9], rotation: [0, 1.2, 0], scale: 3 } }, bad: at([0, 0, 0], { traits: { [TRAIT]: { size: [1, -1, 1] } } }) } }, extensions: [water] }]);
    v.frame();
    expect(inst(v, 0).ambient().water).toEqual({ v: 2, level: 2, components: [] });
    expect(patches(v)).toBe(0);
    expect(v.stages[0].notices.some((n) => n.startsWith("Water's size is three positive numbers"))).toBe(true);
  });
});

describe("a reason for time to pass (W13, widened)", () => {
  // a process is held where the doc is the world and its open water has waves, or where a stage acts for a doc whose
  // bounded body has waves (the fake's drawn stages, a mirror and a pin, hold none, as the stage's don't)
  const waved = (spec) => (spec.extensions ?? []).length > 1;
  const cases = [
    ...configurations(),
    ["flat water alone", [flat("Pond")], true],
    ["a boat in a flat-water harbour", [flat("Pond"), { ...wet(A_SEA), matrix: AT_A }], true],
    ["a waved tank in a dry room", [dry("Room"), { doc: { title: "G", traits: {}, objects: { hull: HULL(), tank: TANK() } }, extensions: [waves(A_SEA.components.slice(-3), {}, ["tank"]), water], matrix: AT_A }], false],
    ["a waved tank mirrored", [dry("Room"), { doc: { title: "G", traits: {}, objects: { hull: HULL(), tank: TANK() } }, extensions: [waves(A_SEA.components.slice(-3), {}, ["tank"]), water], matrix: AT_A, drawn: true }], false],
  ];
  for (const [label, specs] of cases)
    it(`${label}: a process only where the doc is the world and has waves, or acts for a waved tank`, () => {
      v = fakeView(specs);
      for (let i = 0; i < 3; i++) v.frame();
      v.stages.forEach((s, n) => {
        const objects = Object.values(specs[n].doc.objects ?? {});
        const open = objects.some((o) => o.traits?.[TRAIT] && !o.traits[TRAIT].size);
        const tank = objects.some((o) => o.traits?.[TRAIT]?.size);
        const want = !specs[n].drawn && waved(specs[n]) && ((n === 0 && open) || tank) ? 1 : 0;
        expect([label, n, s.processes]).toEqual([label, n, want]);
      });
    });

  it("waves stilled, or the water gone: the process goes; waves back: it comes back", () => {
    v = fakeView([wet(H_SEA)]);
    v.frame();
    expect(v.stages[0].processes).toBe(1);
    v.stages[0].instances[0]["water.waves"].bodies.sea.components = [];
    v.frame();
    expect(v.stages[0].processes).toBe(0);
    v.stages[0].instances[0]["water.waves"].bodies.sea.components = H_SEA.components;
    v.frame();
    expect(v.stages[0].processes).toBe(1);
    delete v.stages[0].doc.objects.sea;
    v.frame();
    expect(v.stages[0].processes).toBe(0);
  });

  it(`the drawn surface's wind is the world's ${WIND} ambient (none is calm), not the water's`, () => {
    const windOfSurface = () => {
      const u = inst(v, 0).debug.surface.object.material.uniforms.uWind.value;
      return [u.x, u.y].map((x) => Math.round(x * 1e9) / 1e9 + 0);
    };
    for (const [from, want] of [[0, [0, 1]], [90, [-1, 0]], [180, [0, -1]], [270, [1, 0]]]) {
      v = fakeView([{ ...wet(H_SEA), extensions: [waves(H_SEA.components, { seed: H_SEA.seed }), windOf({ speed: 9, from }), water] }]);
      v.frame();
      expect(windOfSurface()).toEqual(want);
      expect(inst(v, 0).ambient().water.look).toEqual({ seed: H_SEA.seed });
      v.dispose();
    }
    v = fakeView([{ ...wet(H_SEA), extensions: [waves(H_SEA.components, { seed: H_SEA.seed, wind: { speed: 9, from: 90 } }), water] }]);
    v.frame();
    expect(windOfSurface()).toEqual([0, 1]);
  });

  it("a tilted link: no open water there, and it says so once", () => {
    const tilt = (5 * Math.PI) / 180;
    const M = [1, 0, 0, 0, 0, Math.cos(tilt), Math.sin(tilt), 0, 0, -Math.sin(tilt), Math.cos(tilt), 0, 0, 0, 0, 1];
    v = fakeView([wet(H_SEA), { ...wet(A_SEA), matrix: M }]);
    for (let f = 0; f < 3; f++) v.frame();
    expect(inst(v, 1).water.at([0, 0, 0])).toBeNull();
    expect(v.stages[1].notices).toEqual(["Tilted: no water here"]);
  });

  it(`its waves come only from its own stage's ${WAVES}`, () => {
    v = fakeView([wet(H_SEA)]);
    v.frame();
    expect(inst(v, 0).ambient().water.components).toEqual(H_SEA.components);
  });
});
