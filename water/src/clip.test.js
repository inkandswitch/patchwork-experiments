// Clipped open water (WATER.md, "Clipped open water"): W27 to W35, and the
// amended W13 and W17, on the fake view of linked stages. Every space is
// enumerated; nothing is randomized. The expectations are written out apart
// from the code.
import { afterEach, describe, expect, it } from "vitest";
import golden from "./test/golden.json";
import water, { TRAIT, WAVES, WIND, outlineSegments, patchExtent, patchGeometry } from "./extension.js";
import { amplitudeBound, bodiesOf, boxOf, clipBody, clipToSpan, floorAt, rigidVelocity, shapeOf } from "./bodies.js";
import { boundedReader } from "./bounded.js";
import { createOceanSurface, drawnVertex, patchGrid } from "./material.js";
import { createSurface } from "./surface.js";
import { fakeThree } from "./test/fake-three.js";
import { compose, fakeView, mulM, outlines, patches, placement, surfaces, waves, windOf } from "./test/fake-view.js";

const sea = (name) => golden.seas.find((s) => s.name === name);
const A_SEA = sea("Ship at sea");
const B_SEA = sea("Ship at anchor");
const H_SEA = sea("Harbour");
const deg = (d) => (d * Math.PI) / 180;
const AT_A = placement(0, [-40, 0, 0]);
const AT_B = placement(deg(30), [40, 0, 0]);
const obj = (name, transform, traits = {}, parent = null) => ({ name, parent, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, ...transform }, traits });
const HULL = () => obj("Hull", {});
const TANK = () => obj("Tank", { position: [0, -0.5, 2] }, { [TRAIT]: { size: [2, 1, 3] } }, "hull");
const inst = (v, n) => v.stages[n].instances.at(-1);
const r9 = (x) => Math.round(x * 1e9) / 1e9 + 0;

let v = null;
afterEach(() => {
  v?.dispose();
  v = null;
});

/**
 * A boat doc G: its Sea `seaId` with `water` as given at a pose, waves on its Sea (and its tank), her own
 * weather, and a tank aboard when asked.
 */
function boat({ title = "G", seaId = "sea", trait, pose = {}, tank = false, components = A_SEA.components, wind = A_SEA.wind, ownWind = true } = {}) {
  const objects = { [seaId]: obj("Sea", pose, { [TRAIT]: trait }) };
  if (tank) Object.assign(objects, { hull: HULL(), tank: TANK() });
  const ext = [waves(components, { seed: 1 }, [seaId, "tank"]), ...(ownWind ? [windOf(wind)] : []), water];
  return { doc: { title, traits: {}, objects }, extensions: ext };
}
const dry = (title = "R", objects = {}, extra = []) => ({ doc: { title, traits: {}, objects }, extensions: [...extra, ...(Object.keys(objects).length ? [water] : [])] });
const harbour = () => ({ doc: { title: "Harbour", traits: {}, objects: { hsea: obj("Sea", {}, { [TRAIT]: {} }) } }, extensions: [waves(H_SEA.components, { seed: 7 }, ["hsea"]), windOf(H_SEA.wind), water] });

/** Every way W27 places G in a world offering no open water: [label, specs from G]. */
const DRY_PLACEMENTS = [
  ["in a dry room", (g) => [dry(), { ...g, matrix: AT_A }]],
  ["mirrored in a dry room", (g) => [dry(), { ...g, matrix: AT_A }, { ...g, matrix: AT_B, drawn: true }]],
  ["pinned in a dry room", (g) => [dry(), { ...g, matrix: AT_B, drawn: true, running: false }]],
  ["two deep, R → R′ → G", (g) => [dry(), { ...dry("R′"), matrix: AT_B }, { ...g, matrix: mulM(AT_B, AT_A) }]],
];

/** Everything in a value, depth first, as a flat list of its leaves (keys included). */
function flat(v, out = []) {
  if (v === null || typeof v !== "object") out.push(v);
  else if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    out.push(`[${v.length}`);
    for (const x of v) flat(x, out);
  } else for (const k of Object.keys(v)) out.push(k), flat(v[k], out);
  return out;
}

/** A reader's answers at a point, as numbers (null for no reader). */
function reading(R, p, t) {
  if (!R) return [null];
  const [x, y, z] = p;
  return [R.body, ...R.sampleAt(x, z, t), ...R.normalAt(x, z, t), ...R.velocityAt(x, y ?? 0, z, t), ...R.displaced(x, z, t), R.heightAt(x, z, t), R.level, R.components.length];
}

// ─── W27 ───────────────────────────────────────────────────────────────────

describe("a live clip is a box (W27): G with { clip: c } in a dry world is, bit for bit, G with { size: c }", () => {
  const CLIPS = [[10, 3, 10], [60, 6, 60], [37.5, 2, 200]];
  const KINDS = { "inside, below the level": 0.4, "in the band": -0.2, above: -5, "below the floor": null };
  for (const [label, place] of DRY_PLACEMENTS)
    for (const c of CLIPS)
      for (const yawD of [0, 30])
        for (const scale of [1, 2])
          for (const at of [[0, 0, 0], [12, 0, -7]])
            for (const tank of [false, true])
              it(`${label}, clip ${c.join("×")}, yaw ${yawD}°, scale ${scale}, at ${at.join(",")}${tank ? ", a tank aboard" : ""}`, () => {
                const pose = { position: at, rotation: [0, deg(yawD), 0], scale };
                const run = (trait) => {
                  const view = fakeView(place(boat({ trait, pose, tank })));
                  for (let i = 0; i < 3; i++) view.frame();
                  const out = { patches: patches(view), surfaces: surfaces(view), stages: [] };
                  for (const s of view.stages.filter((s) => s.doc.title === "G")) {
                    const x = s.instances.at(-1);
                    const M = s.api.worldOf("sea");
                    const sv = { processes: s.processes, extent: s.extent, readings: [], faces: [] };
                    for (const g of s.groups) for (const m of g.children.filter((m) => m.name === "water-patch")) sv.faces.push(Array.from(m.geometry.attributes.position.array), [m.position.x, m.position.y, m.position.z]);
                    for (let i = 0; i < 7; i++)
                      for (let j = 0; j < 7; j++) {
                        // a 7×7 grid reaching past the box's footprint, in its own frame, to the stage's
                        const u = (-0.75 + (1.5 * i) / 6) * c[0], w = (-0.75 + (1.5 * j) / 6) * c[2];
                        for (const [, below] of Object.entries(KINDS)) {
                          const y = below === null ? -c[1] - 0.5 : -below;
                          const p = [M[0] * u + M[4] * y + M[8] * w + M[12], M[1] * u + M[5] * y + M[9] * w + M[13], M[2] * u + M[6] * y + M[10] * w + M[14]];
                          for (const t of [0, 3.7, 1000]) sv.readings.push(reading(x.water.at(p), p, t), reading(x.water.at(p, { not: "hull" }), p, t));
                        }
                        const top = [M[0] * u + M[8] * w + M[12], null, M[2] * u + M[10] * w + M[14]];
                        sv.readings.push(reading(x.water.at(top), [top[0], 0, top[2]], 3.7));
                      }
                    out.stages.push(sv);
                  }
                  view.dispose();
                  return out;
                };
                const clipped = run({ clip: c });
                const sized = run({ size: c });
                expect(clipped.stages.length).toBeGreaterThan(0);
                // bit for bit: the first difference, if any, named (a failing deep diff of this much would take minutes)
                const a = flat(clipped), b = flat(sized);
                const k = a.findIndex((x, i) => !Object.is(x, b[i]));
                expect([a.length, k === -1 ? null : { k, clipped: a[k], sized: b[k] }]).toEqual([b.length, null]);
                // and it is there: one block per occurrence of G (with its tank's)
                expect(clipped.patches).toBe(clipped.stages.length * (tank ? 2 : 1));
                expect(clipped.surfaces).toBe(0);
              });

  it("the conversion is pure: clipBody(O, c) is { id: O, size: c }, a copy", () => {
    const c = [1, 2, 3];
    const b = clipBody("sea", c);
    expect(b).toEqual({ id: "sea", size: [1, 2, 3] });
    expect(b.size).not.toBe(c);
  });
});

// ─── W28 ───────────────────────────────────────────────────────────────────

/** What the world offers: [label, the outermost's spec, does it offer open water (a value of any version)]. */
const WORLDS = [
  ["nothing", () => dry(), false],
  ["open flat water", () => ({ doc: { title: "W", traits: {}, objects: { wsea: obj("Sea", {}, { [TRAIT]: {} }) } }, extensions: [water] }), true],
  ["open waved water", () => ({ doc: { title: "W", traits: {}, objects: { wsea: obj("Sea", {}, { [TRAIT]: {} }) } }, extensions: [waves(H_SEA.components, {}, ["wsea"]), water] }), true],
  ["a value of another version", () => ({ doc: { title: "W", traits: {}, objects: {} }, extensions: [{ create: () => ({ ambient: () => ({ [TRAIT]: { v: 1, level: 0, components: [] } }) }) }] }), true],
  ["a tilted open body (offers nothing)", () => ({ doc: { title: "W", traits: {}, objects: { wsea: obj("Sea", { rotation: [0.2, 0, 0] }, { [TRAIT]: {} }) } }, extensions: [water] }), false],
  ["only a pond (offers nothing)", () => dry("W", { pond: obj("Pond", { position: [100, 0, 100] }, { [TRAIT]: { size: [10, 1.5, 10] } }) }), false],
];
const PLACED = [
  ["alone", (w, g) => [g]],
  ["linked", (w, g) => [w, { ...g, matrix: AT_A }]],
  ["mirrored", (w, g) => [w, { ...g, matrix: AT_A }, { ...g, matrix: AT_B, drawn: true }]],
  ["pinned", (w, g) => [w, { ...g, matrix: AT_B, drawn: true, running: false }]],
  ["two deep", (w, g) => [w, { ...dry("S"), matrix: AT_B }, { ...g, matrix: mulM(AT_B, AT_A) }]],
];
const CLIP = [20, 3, 20];
/** G's water: [label, objects, does G have a keeper open body with a valid clip, level; does G have a box (size)]. */
const G_WATER = [
  ["no open body", {}, false, false],
  ["open, no clip", { sea: obj("Sea", {}, { [TRAIT]: {} }) }, false, false],
  ["open with a clip", { sea: obj("Sea", {}, { [TRAIT]: { clip: CLIP } }) }, true, false],
  ["open with an invalid clip", { sea: obj("Sea", {}, { [TRAIT]: { clip: [20, -3, 20] } }) }, false, false],
  ["a size with a clip", { sea: obj("Box", {}, { [TRAIT]: { size: CLIP, clip: [99, 9, 99] } }) }, false, true],
  ["two open, the clip on the one that isn't the keeper", { a: obj("Sea", {}, { [TRAIT]: {} }), sea: obj("Sea 2", {}, { [TRAIT]: { clip: CLIP } }) }, false, false],
  ["tilted open with a clip", { sea: obj("Sea", { rotation: [0.2, 0, 0] }, { [TRAIT]: { clip: CLIP } }) }, false, false],
];

describe("liveness is exactly “the world offers no open water” (W28)", () => {
  for (const [wl, world, offers] of WORLDS)
    for (const [pl, place] of PLACED)
      for (const [gl, objects, clips, sized] of G_WATER) {
        if (pl === "alone" && wl !== "nothing") continue; // alone, G is its own world
        it(`world offers ${wl}; G ${pl}; G's water: ${gl}`, () => {
          const g = { doc: { title: "G", traits: {}, objects: structuredClone(objects) }, extensions: [waves(A_SEA.components.slice(-4), {}, ["sea", "a"]), water] };
          const specs = place(world(), g);
          v = fakeView(specs);
          for (let i = 0; i < 3; i++) v.frame();
          const live = pl !== "alone" && !offers && clips;
          const gs = v.stages.filter((s) => s.doc.title === "G");
          for (const s of gs) {
            const x = s.instances.at(-1);
            expect(x.debug.clip()).toBe(live ? "sea" : null);
            for (const u of [-14, -7, 0, 7, 14])
              for (const w of [-14, -7, 0, 7, 14]) {
                const r = x.water.at([u, -0.5, w]);
                const inside = Math.abs(u) <= 10 && Math.abs(w) <= 10;
                // by hand: G's box or live clip holds it; else the world's open water (none for another version, none when alone it's G's own)
                let want;
                if ((live || sized) && inside) want = "sea";
                else if (pl === "alone") want = gl === "no open body" || gl === "a size with a clip" || gl.startsWith("tilted") ? null : "open";
                else want = offers && wl !== "a value of another version" ? "open" : null;
                expect([u, w, r === null ? null : (r.body ?? "open")]).toEqual([u, w, want]);
              }
          }
          const pond = wl.startsWith("only a pond") ? 1 : 0;
          expect(patches(v)).toBe(pond + gs.length * ((live ? 1 : 0) + (sized ? 1 : 0)));
          // an invalid clip keeps the open offer: alone, G's open water is the world's
          if (pl === "alone" && gl === "open with an invalid clip") expect(surfaces(v)).toBe(1);
        });
      }
});

// ─── W29 ───────────────────────────────────────────────────────────────────

describe("wet worlds draw no blocks (W29): every boat given a clip, under an outermost that offers open water", () => {
  const G = (title, s, extra = {}) => boat({ title, trait: { clip: [50, 6, 50] }, components: s.components, wind: s.wind, ...extra });
  const T = (title, s) => G(title, s, { tank: true });
  const CONFIGS = [
    ["one boat alone", [G("A", A_SEA)]],
    ["one boat in a harbour", [harbour(), { ...G("A", A_SEA), matrix: AT_A }]],
    ["two boats in a harbour", [harbour(), { ...G("A", A_SEA), matrix: AT_A }, { ...G("B", B_SEA), matrix: AT_B }]],
    ["a boat two links deep in a harbour", [harbour(), { ...dry("Shed"), matrix: AT_B }, { ...G("A", A_SEA), matrix: mulM(AT_B, AT_A) }]],
    ["a boat mirrored in a harbour", [harbour(), { ...G("A", A_SEA), matrix: AT_A }, { ...G("A", A_SEA), matrix: AT_B, drawn: true }]],
    ["a boat linked into another boat", [G("B", B_SEA), { ...G("A", A_SEA), matrix: AT_A }]],
    ["a boat with a tank alone", [T("A", A_SEA)]],
    ["a harbour with A and B each holding a tank", [harbour(), { ...T("A", A_SEA), matrix: AT_A }, { ...T("B", B_SEA), matrix: AT_B }]],
    ["A mirrored in a harbour, with a tank", [harbour(), { ...T("A", A_SEA), matrix: AT_A }, { ...T("A", A_SEA), matrix: AT_B, drawn: true }]],
    ["A pinned in a harbour, with a tank", [harbour(), { ...T("A", A_SEA), matrix: AT_B, drawn: true, running: false }]],
    ["A two links deep in a harbour, with a tank", [harbour(), { ...dry("Shed"), matrix: AT_B }, { ...T("A", A_SEA), matrix: mulM(AT_B, AT_A) }]],
    ["the harbour-run shape: two boats at anchor in a harbour", [harbour(), { ...G("A", B_SEA), matrix: placement(0, [-13, 0, 4]) }, { ...G("B", B_SEA), matrix: placement(deg(30), [24, 0, -6]) }]],
  ];
  for (const [label, specs] of CONFIGS)
    it(label, () => {
      v = fakeView(specs);
      for (let i = 0; i < 3; i++) v.frame();
      expect(surfaces(v)).toBe(1);
      const tanks = specs.reduce((n, s) => n + Object.values(s.doc.objects).filter((o) => o.traits?.[TRAIT]?.size).length, 0);
      expect(patches(v)).toBe(tanks);
      for (const s of v.stages) {
        const x = s.instances.at(-1);
        if (!x?.water) continue;
        expect(x.debug.clip()).toBeNull();
        // no answer is a clip's body: only the world's open water (body null) or a tank
        for (const p of [[0, -0.5, 0], [10, -1, -10], [-20, 0, 5], [0, -0.7, 2]]) expect([null, "tank"]).toContain(x.water.at(p)?.body ?? null);
      }
    });
});

// ─── W30 and W34 ───────────────────────────────────────────────────────────

/** The outermosts W30 takes: dry, dry with weather, wet. */
const OUTERMOSTS = [
  ["dry", () => dry(), false, null],
  ["dry with weather", () => ({ doc: { title: "R", traits: {}, objects: {} }, extensions: [windOf({ speed: 5, from: 270 })] }), false, { speed: 5, from: 270 }],
  ["wet", () => harbour(), true, H_SEA.wind],
];
/** The occurrences W30 combines: G and H each with a clip (their Seas named apart), acting, mirrored, pinned, deeper. */
const OCCURRENCES = [
  ["G acting", (G) => [{ ...G("G"), matrix: AT_A }]],
  ["G mirrored", (G) => [{ ...G("G"), matrix: placement(0, [0, 0, 60]), drawn: true }]],
  ["G pinned", (G) => [{ ...G("G"), matrix: placement(0, [0, 0, -60]), drawn: true, running: false }]],
  ["H acting", (G) => [{ ...G("H"), matrix: AT_B }]],
  ["G two deep", (G) => [{ ...dry("S"), matrix: AT_B }, { ...G("G"), matrix: mulM(AT_B, AT_A) }]],
  ["H three deep", (G) => [{ ...dry("S"), matrix: AT_B }, { ...dry("S′"), matrix: mulM(AT_B, AT_A) }, { ...G("H"), matrix: mulM(mulM(AT_B, AT_A), AT_A) }]],
];
/** Every combination of one to three occurrences that keeps to ≤ 4 docs and ≤ 3 deep. */
function shapes() {
  const out = [];
  const n = OCCURRENCES.length;
  for (let m = 1; m < 1 << n; m++) {
    const pick = OCCURRENCES.filter((_, i) => m & (1 << i));
    if (pick.length > 3) continue;
    const docs = new Set(["R"]);
    for (const [l] of pick) {
      docs.add(l[0]);
      if (l.includes("deep")) docs.add("S");
      if (l.includes("three")) docs.add("S′");
    }
    if (docs.size > 4) continue;
    out.push(pick);
  }
  return out;
}

describe("every occurrence agrees; siblings stay apart (W30); weather is not clipped (W34)", () => {
  const G = (title, ownWind) => boat({ title, seaId: title === "G" ? "sea" : "hsea2", trait: { clip: [40, 6, 40] }, components: A_SEA.components, wind: ownWind, ownWind: !!ownWind });
  for (const [ol, outer, wet, worldWind] of OUTERMOSTS)
    for (const pick of shapes())
      for (const ownWind of [null, B_SEA.wind])
        it(`${ol}: ${pick.map(([l]) => l).join(", ")}${ownWind ? ", each with weather of its own" : ""}`, () => {
          const specs = [outer(), ...pick.flatMap(([, make]) => make((t) => G(t, ownWind)))];
          v = fakeView(specs);
          for (let i = 0; i < 3; i++) v.frame();
          for (const s of v.stages) {
            const title = s.doc.title;
            if (title !== "G" && title !== "H") continue;
            const own = title === "G" ? "sea" : "hsea2";
            const x = s.instances.at(-1);
            // live at every occurrence or none, and exactly when the outermost offers no open water
            expect([title, x.debug.clip()]).toEqual([title, wet ? null : own]);
            // never another doc's clip
            for (const p of [[0, -1, 0], [15, -2, 15], [-19, -0.3, 19], [60, -1, 0], [-40, -1, 0]]) {
              const r = x.water.at(p);
              if (r && r.body !== null) expect([title, r.body]).toEqual([title, own]);
            }
            // W34: the wind and atmosphere this stage reads are the outermost's; its own weather reaches nothing
            expect(s.api.ambient(WIND)?.value ?? null).toEqual(worldWind);
            // a live clip's waves are what the stage's wave maker gives, clipped to its span (sailing makes them from the world's wind: sea-view.test)
            if (!wet) expect(x.water.at([0, -1, 0]).components).toEqual(clipToSpan(A_SEA.components, 40));
          }
          // a block per occurrence of a doc with a live clip, none under a wet outermost
          const occurrences = v.stages.filter((s) => s.doc.title === "G" || s.doc.title === "H").length;
          expect(patches(v)).toBe(wet ? 0 : occurrences);
        });
});

// ─── W31 ───────────────────────────────────────────────────────────────────

/** Every order of a list. */
function permutations(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe("arrival order (W31): settled is the same in every order; no step reads a clip after the outermost's first flush with water running; alone, never", () => {
  const G = () => boat({ trait: { clip: [30, 6, 30] }, components: A_SEA.components.slice(-6) });
  const OUTER = [
    ["G itself", null],
    ["a dry room", () => dry()],
    ["a wet harbour", () => harbour()],
  ];
  const settled = (view) => {
    for (let i = 0; i < 2; i++) view.frame();
    const g = view.stages.at(-1).instances.at(-1);
    return { clip: g.debug.clip(), patches: patches(view), surfaces: surfaces(view), at: [[0, -1, 0], [20, -1, 20]].map((p) => g.water.at(p)?.body ?? (g.water.at(p) ? "open" : null)) };
  };
  for (const [ol, outer] of OUTER) {
    const events = outer ? ["start 0", "flush 0", "start 1", "flush 1"] : ["start 0", "flush 0"];
    const orders = permutations(events);
    it(`${ol}: every one of ${orders.length} orders`, () => {
      let first = null;
      for (const order of orders) {
        const specs = outer ? [outer(), { ...G(), matrix: AT_A }] : [G()];
        const view = fakeView(specs, { start: false });
        const gN = specs.length - 1;
        let outerFlushedWithWater = false;
        let liveSteps = 0;
        for (const e of order) {
          const [verb, n] = e.split(" ");
          if (verb === "start") view.start(+n);
          else {
            view.flush(+n);
            if (+n === 0 && view.stages[0].instances.length) outerFlushedWithWater = true;
          }
          // a step of G's, after each event: does it read the clip?
          const g = view.stages[gN].instances.at(-1);
          const r = g?.water.at([0, -1, 0]);
          if (r?.body === "sea") {
            liveSteps++;
            // alone, never; under a wet outermost, never once its offer is out
            expect([order.join(" → "), ol]).not.toEqual([order.join(" → "), "G itself"]);
            if (ol === "a wet harbour") expect([order.join(" → "), outerFlushedWithWater]).toEqual([order.join(" → "), false]);
          }
        }
        const s = settled(view);
        view.dispose();
        if (!first) first = s;
        expect([order.join(" → "), s]).toEqual([order.join(" → "), first]);
      }
      // the settled state is the rule's
      expect(first.clip).toBe(ol === "a dry room" ? "sea" : null);
    });
  }

  it("the transient is bounded at one frame: under a wet outermost that flushes only after G's first frame, the next step of G's reads the harbour", () => {
    const specs = [harbour(), { ...G(), matrix: AT_A }];
    v = fakeView(specs, { start: false });
    v.start(1);
    v.flush(1);
    const g = inst(v, 1);
    // G's first frame, with the outermost not yet arrived: its clip is live (the transient)
    for (const fn of v.stages[1].loops) fn(1 / 60);
    expect(g.water.at([0, -1, 0]).body).toBe("sea");
    v.start(0);
    v.flush(0);
    // the very next step (before G's next loop) reads the harbour's open water
    expect(g.water.at([0, -1, 0]).body).toBeNull();
    v.frame();
    expect(patches(v)).toBe(0);
  });
});

// ─── W32 (the water's half; the hull's is sailing's sim.test) ─────────────────

describe("the edge, with a total reader (W32): a hull's columns read the continued surface while her origin is inside; outside, what holds her origin", () => {
  const LOA = 12, BEAM = 3.8;
  const BOX = [30, 3, 30]; // its edge at x = 15
  const ORIGINS = { centre: 0, "0.5 LOA inside the edge": 15 - LOA / 2, "on the edge": 15, "just outside": 15.01 };
  const HEADINGS = { along: 0, "45°": 45, "straight at it": 90 };
  const OUTSIDE = {
    "nothing (a dry room)": {},
    // from just past the edge: the edge itself is the box's alone
    "a basin beside": { basin: obj("Basin", { position: [30.005, 0, 0] }, { [TRAIT]: { size: [30, 3, 30] } }) },
    "open water below (a pond on the bay)": { bay: obj("Bay", { position: [0, -2, 0] }, { [TRAIT]: {} }) },
  };
  for (const body of ["clip", "size"])
    for (const waved of [false, true])
      for (const [ol, ox] of Object.entries(ORIGINS))
        for (const [hl, hd] of Object.entries(HEADINGS))
          for (const [sl, outside] of Object.entries(OUTSIDE)) {
            // a clip is live only where the world offers no open water: with a bay below it would be silent
            if (body === "clip" && sl.startsWith("open")) continue;
            it(`${body}, ${waved ? "waved" : "flat"}, her origin ${ol}, heading ${hl}, outside ${sl}`, () => {
              const comps = waved ? A_SEA.components.slice(-5) : [];
              const g = { doc: { title: "G", traits: {}, objects: { box: obj("Box", {}, { [TRAIT]: body === "clip" ? { clip: BOX } : { size: BOX } }), ...structuredClone(outside) } }, extensions: [waves(comps, {}, ["box", "basin"]), water] };
              v = fakeView(body === "clip" ? [dry(), { ...g, matrix: AT_A }] : [g]);
              v.frame();
              const x = inst(v, v.stages.length - 1);
              const o = [ox, 0, 3];
              const r = x.water.at(o, { not: "hull" });
              const inside = ox <= 15;
              const raw = createSurface(clipToSpan(comps, 30));
              if (inside) {
                expect(r.body).toBe("box");
                // her columns, bow, stern and either beam: the continued surface, as open water of the same waves reads it
                const a = deg(hd), f = [Math.sin(a), Math.cos(a)], s = [f[1], -f[0]];
                for (const [df, ds] of [[LOA / 2, 0], [-LOA / 2, 0], [0, BEAM / 2], [0, -BEAM / 2]])
                  for (const t of [0, 3.7, 1000]) {
                    const px = o[0] + f[0] * df + s[0] * ds, pz = o[2] + f[1] * df + s[1] * ds;
                    expect(r.heightAt(px, pz, t)).toBe(raw.heightAt(px, pz, t));
                    const n = r.normalAt(px, pz, t), m = raw.normalAt(px, pz, t);
                    for (let k = 0; k < 3; k++) expect(n[k]).toBeCloseTo(m[k], 12);
                  }
              } else if (sl.startsWith("nothing")) expect(r).toBeNull();
              else if (sl.startsWith("a basin")) expect(r.body).toBe("basin");
              else expect(r.body).toBeNull(); // the bay's open water, at its own level
            });
          }
});

// ─── W33 ───────────────────────────────────────────────────────────────────

describe("the drawn block is the read water (W33)", () => {
  // waves every patch cell here carries in full (the shader fades a wave shorter than about 2π cells: none of these)
  const SEA_A = A_SEA.components.filter((c) => (2 * Math.PI) / c.k >= 4 && (2 * Math.PI) / c.k <= 8).slice(0, 3);
  const SEA_B = B_SEA.components.filter((c) => (2 * Math.PI) / c.k >= 4 && (2 * Math.PI) / c.k <= 10).slice(-3);
  for (const [w, l] of [[8, 8], [16, 8], [8, 32]])
    for (const yawD of [0, 30, 137])
      for (const heelD of [0, 10])
        for (const [cl, comps] of [["none", []], ["sea a", SEA_A], ["sea b", SEA_B]])
          it(`${w}:${l}, yaw ${yawD}°, heel ${heelD}°, waves ${cl}`, () => {
            const M = mulM(compose({ position: [5, 1.5, -3], rotation: [0, deg(yawD), 0] }), compose({ rotation: [0, 0, deg(heelD)] }));
            const box = boxOf([w, 2, l], M);
            const geo = patchGeometry(box);
            const cell = Math.max(0.05, Math.min(0.5, Math.max(geo.w, geo.l) / 64));
            for (const c of comps) expect(c.k * cell).toBeLessThanOrEqual(1);
            const mesh = patchGrid(geo.w, geo.l, geo.yaw, cell, geo.floor);
            const R = boundedReader({ id: "b", components: comps, U: [0, 0] }, { box, rv: rigidVelocity(null, M, 0) });
            const ext = patchExtent(box, amplitudeBound(comps));
            const origin = [M[12], M[13], M[14]];
            const n = mesh.rim.length;
            expect(mesh.positions.length / 3).toBe(mesh.top + 2 * n + 4);
            for (let r = 0; r < n; r++) {
              const rim = mesh.rim[r], up = mesh.top + 2 * r, down = up + 1;
              // the skirt's top is the rim itself, bit for bit, and moves as it does
              for (let k = 0; k < 3; k++) expect(mesh.positions[up * 3 + k]).toBe(mesh.positions[rim * 3 + k]);
              expect([mesh.disp[up], mesh.disp[rim], mesh.disp[down]]).toEqual([1, 1, 0]);
              // its bottom on the body's floor, under the rim
              const X = origin[0] + mesh.positions[down * 3], Z = origin[2] + mesh.positions[down * 3 + 2];
              expect(mesh.positions[down * 3]).toBe(mesh.positions[rim * 3]);
              expect(mesh.positions[down * 3 + 1]).toBeCloseTo(floorAt(box, X, Z).y - box.level, 5);
            }
            for (let k = 0; k < 4; k++) {
              const f = mesh.top + 2 * n + k;
              const X = origin[0] + mesh.positions[f * 3], Z = origin[2] + mesh.positions[f * 3 + 2];
              expect(mesh.positions[f * 3 + 1]).toBeCloseTo(floorAt(box, X, Z).y - box.level, 5);
            }
            for (const t of [0, 3.7, 1000])
              for (let i = 0; i < mesh.positions.length / 3; i++) {
                const p = drawnVertex(mesh, i, comps, origin, t);
                // the drawn top and rim are the reader's displaced surface
                if (mesh.disp[i]) {
                  const d = R.displaced(origin[0] + mesh.positions[i * 3], origin[2] + mesh.positions[i * 3 + 2], t);
                  for (const [a, b] of [[p[0], d[0]], [p[1], d[1]], [p[2], d[2]]]) expect(Math.abs(a - b)).toBeLessThan(1e-9);
                }
                // and every face inside the extent
                for (let k = 0; k < 3; k++) {
                  expect(p[k]).toBeGreaterThanOrEqual(ext.min[k] - 1e-5);
                  expect(p[k]).toBeLessThanOrEqual(ext.max[k] + 1e-5);
                }
              }
          });
});

describe("the drawn block is the shader's, at its real spacing (W33, the GLSL side and capped sizes)", () => {
  // the vertex shader's displacement, line by line: the test reads these out of
  // the material's own source, and transcribes them below from its own uniforms
  const GLSL = [
    "float cell = uCell * max(1.0, 2.0 * max(abs(p.x), abs(p.y)) / uInner);",
    "float k = length(w.xy);",
    "float f = 1.0 - smoothstep(1.0, 2.0, k * cell);",
    "if (f <= 0.0 || k <= 0.0) continue;",
    "vec2 dir = w.xy / k;",
    "float th = dot(w.xy, p) + uPhase[i];",
    "d.xz -= f * w.w * dir * sin(th);",
    "d.y += f * w.z * cos(th);",
    "d *= aDisp;",
    "vec4 world = modelMatrix * vec4(p.x + d.x, position.y + d.y, p.y + d.z, 1.0);",
  ];
  const smoothstep = (a, b, x) => {
    const s = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return s * s * (3 - 2 * s);
  };
  /** GLSL above, in JavaScript, on the uniforms and attributes the surface really holds. */
  function shaderVertex(s, i) {
    const { uniforms, defines } = s.object.material;
    const g = s.object.geometry.attributes;
    const px = g.position.array[i * 3], py = g.position.array[i * 3 + 1], pz = g.position.array[i * 3 + 2];
    const cell = uniforms.uCell.value * Math.max(1, (2 * Math.max(Math.abs(px), Math.abs(pz))) / uniforms.uInner.value);
    let dx = 0, dy = 0, dz = 0;
    for (let n = 0; n < defines.WAVES; n++) {
      const w = uniforms.uWaves.value[n];
      const k = Math.hypot(w.x, w.y);
      const f = 1 - smoothstep(1, 2, k * cell);
      if (f <= 0 || k <= 0) continue;
      const th = w.x * px + w.y * pz + uniforms.uPhase.value[n];
      dx -= f * w.w * (w.x / k) * Math.sin(th);
      dz -= f * w.w * (w.y / k) * Math.sin(th);
      dy += f * w.z * Math.cos(th);
    }
    const a = g.aDisp.array[i];
    const P = s.object.position;
    return [P.x + px + a * dx, P.y + py + a * dy, P.z + pz + a * dz];
  }
  // the real vertex spacing of each top, worked out by hand: the requested cell is
  // max(0.05, min(0.5, longer side / 64)), and a side has at most 256 cells
  const SIZES = [
    [8, 8, 0.125], // 64 × 64 cells of 0.125
    [16, 8, 0.25], // 64 × 32 of 0.25
    [8, 32, 0.5], // 16 × 64 of 0.5
    [100, 207, 207 / 256], // 200 × 256 (capped): 0.5 across, 0.80859375 along
    [8192, 8192, 32], // Cadboro Bay's clip: 256 × 256 (capped) of 32
  ];
  const SEAS = [["Ship at sea", A_SEA], ["Ship at anchor", B_SEA], ["Cadboro Bay", sea("Cadboro Bay")]];
  const THREE = fakeThree();
  for (const [w, l, spacing] of SIZES)
    for (const yawD of [0, 30])
      for (const [sl, S] of SEAS)
        it(`${w}×${l}, yaw ${yawD}°, ${sl}'s waves: faded at the real spacing ${spacing}, and drawnVertex is the shader`, () => {
          const s = createOceanSurface(THREE, { seed: 1, stats: {}, ...S }, { patch: { w, l, yaw: deg(yawD), floor: 6 } });
          expect(s.object.material.uniforms.uInner.value).toBe(1e9);
          const src = s.object.material.vertexShader;
          for (const line of GLSL) expect(src).toContain(line);
          expect(s.object.material.uniforms.uCell.value).toBe(spacing);
          // wave by wave: under three vertices a wavelength (it would alias) none of it is
          // drawn; with 2π or more, all of it
          const U = s.object.material.uniforms;
          for (let n = 0; n < S.components.length; n++) {
            const k = Math.hypot(U.uWaves.value[n].x, U.uWaves.value[n].y);
            const perWave = (2 * Math.PI) / k / spacing;
            // a patch has no rings (uInner 1e9): the shader's cell is uCell everywhere on it
            const f = 1 - smoothstep(1, 2, k * U.uCell.value);
            if (perWave < 3) expect(f).toBe(0);
            if (perWave >= 2 * Math.PI + 1e-9) expect(f).toBe(1);
          }
          const g = s.object.geometry.attributes;
          const twin = { positions: g.position.array, disp: g.aDisp.array, spacing };
          for (const [origin, t] of [[[5, 1.5, -3], 0], [[1234.5, 0, -987.25], 1000]]) {
            s.update(t, origin);
            for (let i = 0; i < g.position.array.length / 3; i++) {
              const a = shaderVertex(s, i), b = drawnVertex(twin, i, S.components, origin, t);
              for (let k = 0; k < 3; k++) if (!(Math.abs(a[k] - b[k]) < 1e-3)) expect([i, k, a[k], b[k]]).toEqual("drawn as the twin says");
            }
          }
        });
});

// ─── W35 ───────────────────────────────────────────────────────────────────

describe("validity, and the outline (W35)", () => {
  const VALUES = { valid: [12, 2, 18], zero: [12, 0, 18], negative: [12, -2, 18], "two numbers": [12, 2], NaN: [12, NaN, 18], "a string": "12,2,18", null: null };
  for (const [vl, clip] of Object.entries(VALUES))
    for (const sized of [false, true])
      for (const tilted of [false, true])
        it(`clip ${vl}, ${sized ? "beside a size" : "open"}, ${tilted ? "tilted" : "level"}`, () => {
          const trait = { ...(sized ? { size: [6, 1, 6] } : {}), clip };
          const valid = vl === "valid";
          // the shape, by hand
          const sh = shapeOf(trait);
          if (sized) expect(sh).toEqual({ kind: "bounded", size: [6, 1, 6], ...(clip === null ? {} : { clipIgnored: true }) });
          else expect(sh).toEqual(valid ? { kind: "open", clip: [12, 2, 18] } : { kind: "open", clip: null, ...(clip === null ? {} : { badClip: true }) });
          const objects = { sea: obj("Sea", { rotation: [tilted ? 0.2 : 0, 0, 0] }, { [TRAIT]: trait }) };
          // alone: an open body offers its water whatever its clip, unless tilted; in a dry room: a valid clip, level, is live
          v = fakeView([{ doc: { title: "G", traits: {}, objects }, extensions: [water] }]);
          for (let i = 0; i < 3; i++) v.frame();
          expect(inst(v, 0).ambient()?.water?.level ?? null).toBe(!sized && !tilted ? 0 : null);
          const notices = v.stages[0].notices;
          expect(notices.filter((n) => n.startsWith("Water's clip is three positive numbers"))).toHaveLength(!sized && !valid && clip !== null ? 1 : 0);
          expect(notices.filter((n) => n.includes("its clip does nothing"))).toHaveLength(sized && clip !== null ? 1 : 0);
          v.dispose();
          v = fakeView([dry(), { doc: { title: "G", traits: {}, objects: structuredClone(objects) }, extensions: [water] }]);
          for (let i = 0; i < 3; i++) v.frame();
          expect(inst(v, 1).debug.clip()).toBe(!sized && valid && !tilted ? "sea" : null);
          // a size is a box tilted or level (its water stays level in its doc)
          expect(patches(v)).toBe(sized || (valid && !tilted) ? 1 : 0);
        });

  const SHAPES = { "open with a clip": { clip: [12, 2, 18] }, "open without": {}, bounded: { size: [6, 1, 6] } };
  for (const [sl, trait] of Object.entries(SHAPES))
    for (const where of ["alone", "in a dry room", "in a harbour"])
      it(`${sl}, ${where}: selected, one outline of its box at its pose; deselected, none`, () => {
        const objects = { sea: obj("Sea", { position: [4, 0.5, -2], rotation: [0, deg(30), 0], scale: 2 }, { [TRAIT]: trait }), other: HULL() };
        const g = { doc: { title: "G", traits: {}, objects }, extensions: [water] };
        v = fakeView(where === "alone" ? [g] : [where === "in a harbour" ? harbour() : dry(), { ...g, matrix: AT_A }]);
        const n = v.stages.length - 1;
        const s = v.stages[n];
        v.frame();
        expect(outlines(v)).toBe(0);
        s.selected = "sea";
        v.frame();
        const size = trait.clip ?? trait.size ?? null;
        // whether or not the clip is live here (alone and in a harbour it isn't)
        expect(outlines(v)).toBe(size ? 1 : 0);
        if (size) {
          const line = inst(v, n).debug.outline;
          expect(Array.from(line.geometry.attributes.position.array).map((x) => Math.round(x * 1e4) / 1e4 + 0)).toEqual(outlineSegments(size, s.api.worldOf("sea")).map((x) => Math.round(Math.fround(x) * 1e4) / 1e4 + 0));
          // its box's corners: twelve edges, each corner on three
          expect(line.geometry.attributes.position.array.length).toBe(72);
        }
        s.selected = "other";
        v.frame();
        expect(outlines(v)).toBe(0);
        s.selected = "sea";
        v.frame();
        s.selected = null;
        v.frame();
        expect(outlines(v)).toBe(0);
      });
});

// ─── W17 and W13, amended ───────────────────────────────────────────────────

describe("the draw count and the processes with clips (W17, W13 amended)", () => {
  const AT = (t) => ({ ...boat({ title: "At anchor", trait: { clip: [60, 6, 60] }, components: B_SEA.components }), ...t });
  const LC = (t) => ({ ...boat({ title: "Lost Cities aboard", seaId: "lsea", trait: { clip: [60, 6, 60] }, components: B_SEA.components }), ...t });
  const BASIN = (t) => ({ doc: { title: "Model basin", traits: {}, objects: { basin: obj("Basin", {}, { [TRAIT]: { size: [30, 3, 30] } }) } }, extensions: [water], ...t });
  const S = (x) => placement(0, [x, 6 / 25, 0], 1 / 25);
  const CASES = [
    // [label, specs, patches, processes per stage]
    ["the Model room: two boats at 1:25 in a dry room", () => [dry("Model room"), AT({ matrix: S(-2) }), LC({ matrix: S(2) })], 2, [0, 1, 1]],
    ["the Model room under a wet outermost", () => [harbour(), { ...dry("Model room"), matrix: AT_A }, AT({ matrix: mulM(AT_A, S(-2)) }), LC({ matrix: mulM(AT_A, S(2)) })], 0, [1, 0, 0, 0]],
    ["the Model basin beside Ship at sea, in a dry room", () => [dry("Room"), BASIN({ matrix: AT_A }), { ...boat({ title: "Ship at sea", trait: { clip: [80, 6, 120] } }), matrix: AT_B }], 2, [0, 0, 1]],
    ["a boat with a clip mirrored and pinned in a dry room", () => [dry(), AT({ matrix: AT_A }), AT({ matrix: AT_B, drawn: true }), AT({ matrix: placement(0, [0, 0, 80]), drawn: true, running: false })], 3, [0, 1, 0, 0]],
    ["a still boat in a dry room: a calm block holds no process", () => [dry(), { ...boat({ trait: { clip: [60, 6, 60] }, components: [] }), matrix: AT_A }], 1, [0, 0]],
  ];
  for (const [label, make, want, processes] of CASES)
    it(label, () => {
      v = fakeView(make());
      for (let i = 0; i < 3; i++) v.frame();
      expect(patches(v)).toBe(want);
      expect(v.stages.map((s) => s.processes)).toEqual(processes);
    });

  it("a live clip's block rests on the room's ground at 1:25 when its link is at depth × scale", () => {
    v = fakeView([dry("Model room"), AT({ matrix: placement(0, [0, 6 / 25, 0], 1 / 25) })]);
    v.frame();
    const e = v.stages[1].extent;
    // in the boat's frame its floor is at -6; through the link, at 0 in the room
    expect(r9(e.min[1])).toBeLessThanOrEqual(-6);
    expect(r9(6 / 25 + (1 / 25) * -6)).toBe(0);
  });
});

describe("bodiesOf and the clip", () => {
  it("the keeper's clip only; flags for a bad clip and a clip beside a size", () => {
    const f = bodiesOf({
      b: { traits: { [TRAIT]: { clip: [1, 1, 1] } } },
      a: { traits: { [TRAIT]: { clip: [2, 2, 2] } } },
      c: { traits: { [TRAIT]: { clip: "x" } } },
      d: { traits: { [TRAIT]: { size: [1, 1, 1], clip: [3, 3, 3] } } },
    });
    expect(f.open).toBe("a");
    expect(f.openClip).toEqual([2, 2, 2]);
    expect(f.extra).toEqual(["b", "c"]);
    expect(f.badClip).toEqual(["c"]);
    expect(f.clipIgnored).toEqual(["d"]);
    expect(f.bounded).toEqual([{ id: "d", size: [1, 1, 1] }]);
  });
});

void WAVES;

describe("the inspector's Clip row (Decision 101)", () => {
  it("Water describes a clip beside its size, both json, and says the three phrases", async () => {
    const { plugins } = await import("./index.js");
    const ext = plugins.find((p) => p.type === "scene:extension" && p.id === "water");
    const fields = ext.describes.water.fields;
    expect(fields.map((f) => [f.key, f.kind])).toEqual([["size", "json"], ["clip", "json"]]);
    expect(fields[1].label).toMatch(/Clip: keep this much where the world has no water/);
    for (const phrase of ["my sea, unless the world has one", "my sea, or this much of it", "this water, always"]) expect(ext.describes.water.blurb).toContain(phrase);
    expect(ext.describes.water.init).toEqual({});
  });
});
