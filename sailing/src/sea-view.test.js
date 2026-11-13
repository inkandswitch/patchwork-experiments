// The sea: the sea from the doc, the water's extent, and createSeaView on a
// fake stage (test/fakes.js), drawn at the doc's world time (the clock is the
// stage's: scene/src/stage/clock.js), the same for everyone, editing or not.
import { describe, it, expect, afterEach } from "vitest";
import { createOcean } from "./ocean.js";
import { ATMOSPHERE, WATER_REACH, createSeaView, seaParams, waterExtent } from "./sea-view.js";
import { FLOAT, SEA } from "./traits.js";
import { emptyScene, fakeWorld } from "./test/fakes.js";

describe("the sea from the doc", () => {
  it("fills in what the trait leaves out", () => {
    expect(seaParams(undefined)).toEqual({ wind: { speed: 7, from: 45 }, seed: 1, scale: 1 });
    expect(seaParams({ wind: { speed: 12 }, seed: 9 })).toEqual({ wind: { speed: 12, from: 45 }, seed: 9, scale: 1 });
    expect(seaParams({ wind: { speed: -3, from: "x" }, scale: -1 })).toEqual({ wind: { speed: 0, from: 45 }, seed: 1, scale: 0 });
  });
});

describe("the water's extent (what the stage's near plane mustn't cut)", () => {
  it("holds every crest and trough: the sum of the amplitudes bounds the surface, for calm to a gale", () => {
    for (const speed of [0, 4, 8, 14, 22]) {
      const ocean = createOcean({ wind: { speed, from: 30 }, seed: 3 });
      const { min, max } = waterExtent(ocean);
      expect(min).toEqual([-WATER_REACH, -max[1], -WATER_REACH]);
      let hi = 0;
      for (let i = 0; i < 400; i++) {
        const h = ocean.heightAt((i * 7.31) % 200 - 100, (i * 13.7) % 200 - 100, i * 0.37);
        hi = Math.max(hi, Math.abs(h));
      }
      expect(hi).toBeLessThan(max[1]);
    }
    expect(waterExtent(null).max[1]).toBe(0.5);
  });
});

// ─── on a fake stage ────────────────────────────────────────────────────────

const object = (extra) => ({ name: "Object", parent: null, group: null, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, ...extra });

function scene() {
  return {
    ...emptyScene(),
    objects: { buoy: object({ name: "Buoy", transform: { position: [8, 0, -20], rotation: [0, 0.3, 0], scale: 1 }, traits: { [FLOAT]: {} } }), rock: object({ name: "Rock" }) },
    order: ["buoy", "rock"],
    traits: { [SEA]: { wind: { speed: 8, from: 90 }, seed: 2, scale: 1 } },
  };
}

describe("createSeaView", () => {
  let w;
  afterEach(() => w?.done());

  /** A sea view, ticked as play.js ticks it, with a process of its own (so its view can compute the clock). */
  function seaOn(api) {
    const sea = createSeaView(api);
    api.clock.process({ step() {} });
    api.loop(() => sea.tick());
    return sea;
  }

  it("draws the ocean from the doc, lit as the sky is, and rebuilds it when the sea changes", () => {
    const doc = scene();
    w = fakeWorld(doc);
    const api = w.join("A");
    const sea = createSeaView(api);
    expect(sea.atmosphere()).toBe(ATMOSPHERE);
    expect(ATMOSPHERE.fog.color).toBe(ATMOSPHERE.sky.horizon);
    expect(sea.ocean.heightAt(0, 0, 0)).toBeTypeOf("number");
    expect(sea.wind.at(0, 0, 0)).toHaveLength(2);
    const before = sea.ocean;
    sea.update(w.scene());
    expect(sea.ocean).toBe(before); // the same sea: not rebuilt
    w.change((d) => (d.traits[SEA].wind.speed = 14));
    sea.update(w.scene());
    expect(sea.ocean).not.toBe(before);
    expect(sea.ocean.stats.hs).toBeGreaterThan(before.stats.hs);
  });

  it("no sea trait, no sea: no surface and no sky, until one is added", () => {
    const doc = scene();
    delete doc.traits[SEA];
    w = fakeWorld(doc);
    const api = w.join("A");
    const sea = createSeaView(api);
    expect(sea.ocean).toBe(null);
    expect(sea.atmosphere()).toBe(null);
    sea.tick(); // draws nothing, and doesn't throw
    w.change((d) => (d.traits[SEA] = {}));
    sea.update(w.scene());
    expect(sea.ocean).not.toBe(null);
    expect(sea.atmosphere()).toBe(ATMOSPHERE);
    w.change((d) => delete d.traits[SEA]);
    sea.update(w.scene());
    expect(sea.ocean).toBe(null);
  });

  it("is drawn at the doc's world time, the same on every view, and keeps nothing of its own in presence", () => {
    const doc = scene();
    w = fakeWorld(doc);
    const sa = seaOn(w.join("A"));
    const sb = seaOn(w.join("B"));
    w.tick(1 / 60, 60);
    expect(sa.clock()).toBeCloseTo(1, 6);
    expect(sb.clock()).toBe(sa.clock());
    expect(w.view("A").keys.sailing?.clock).toBeUndefined();
    // paused, the sea stands still
    w.join("C").clock.pause();
    w.tick(1 / 60, 60);
    expect(sa.clock()).toBeCloseTo(1, 6);
  });
});

describe("the sea while someone edits", () => {
  let w;
  afterEach(() => w?.done());
  // each view runs the whole extension: its sea, and the ships' process
  function seaOn(api) {
    const sea = createSeaView(api);
    api.clock.process({ step() {} });
    api.loop(() => sea.tick());
    return sea;
  }

  // There is no editing sea: every view runs the same sailing extension, so
  // one that is selecting things and holding a tool draws the same sea at
  // the same world time as the one sailing her, and it runs on; only a
  // pause stops it (scene TOOLS.md §7: editing never stops the sea).
  it("an editor's view draws the sailor's sea at the sailor's time; it runs on, and only a pause stops it", () => {
    const doc = scene();
    w = fakeWorld(doc);
    const sailor = w.join("P");
    const sp = seaOn(sailor);
    w.tick(1 / 60, 60);
    const editor = w.join("E");
    // (what the editor selects or holds runs nothing different: scene's H1)
    const se = seaOn(editor);
    w.tick(1 / 60, 60);
    expect(se.clock()).toBeCloseTo(sp.clock(), 6);
    expect(se.clock()).toBeGreaterThan(1.5);
    editor.clock.pause();
    const t = se.clock();
    w.tick(1 / 60, 60);
    expect(se.clock()).toBeCloseTo(t, 6);
    expect(sp.clock()).toBeCloseTo(t, 6);
  });
});
