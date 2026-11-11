// The sea in play: the shared clock (pure), floating, the sea from the doc,
// and createSeaView and the editor's sea on a fake stage (test/fakes.js).
import { describe, it, expect, afterEach } from "vitest";
import { createOcean } from "./ocean.js";
import { ATMOSPHERE, MAX_STEP_S, RESYNC_S, WATER_REACH, createClock, createSeaView, follow, seaClock, seaParams, seaTime, slew, waterExtent } from "./sea-view.js";
import { FLOAT, SEA } from "./traits.js";
import edit from "./edit.js";
import { emptyScene, fakeWorld } from "./test/fakes.js";

describe("the followed time", () => {
  it("is the simulator's clock run on to the moment its poses are drawn at", () => {
    const sample = { t: 10, at: 5000 };
    expect(seaTime(sample, 5000)).toBe(10);
    expect(seaTime(sample, 5950)).toBeCloseTo(10.95);
  });
});

describe("slewing", () => {
  it("never runs backwards and never more than twice as fast", () => {
    expect(slew(10, 0, 0.1)).toBe(10);
    expect(slew(10, 100, 0.1)).toBeCloseTo(10.2);
    expect(slew(10, 10.1, 0.1)).toBeCloseTo(10.1); // on time: just dt
  });

  it("works an error off smoothly", () => {
    let shown = 0;
    let target = 0.5;
    for (let i = 0; i < 300; i++) {
      target += 1 / 60;
      const next = slew(shown, target, 1 / 60);
      expect(next).toBeGreaterThan(shown);
      shown = next;
    }
    expect(Math.abs(target - shown)).toBeLessThan(0.01);
  });
});

describe("the sea clock", () => {
  it("runs its own time while nobody's to follow", () => {
    const c = createClock();
    for (let i = 0; i < 60; i++) c.tick(1 / 60, null);
    expect(c.now()).toBeCloseTo(1);
  });

  it("catches on to the simulator's at once, then follows it through jitter without going back", () => {
    const c = createClock();
    c.tick(0.5, null); // nobody yet: its own
    expect(c.now()).toBeCloseTo(0.5);
    let target = 100;
    let shown = null;
    for (let i = 0; i < 300; i++) {
      target += 1 / 60 + (((i * 7) % 5) - 2) * 0.002; // the followed time, a little ragged
      const t = c.tick(1 / 60, target);
      if (shown != null) expect(t).toBeGreaterThanOrEqual(shown);
      shown = t;
    }
    expect(shown).toBeCloseTo(target, 1);
  });

  it("slews a small error away, and jumps a big one (back from a hidden tab, or a stalled simulator)", () => {
    expect(follow(10, 10.2, 1 / 60)).toBeLessThan(10.03); // slewed: never more than twice as fast
    expect(follow(10, 70, 1 / 60)).toBe(70); // a minute behind: put right at once
    expect(follow(10, 9, 1 / 60)).toBe(9); // a second ahead of it, too
    // a follower hidden for a minute catches up in a frame, not a minute
    const c = createClock();
    c.tick(1 / 60, 100);
    c.tick(1, 160 + RESYNC_S * 2);
    expect(c.now()).toBe(160 + RESYNC_S * 2);
  });
});

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

  /** A sea view, ticked as play.js ticks it, with whoever this view says simulates. */
  function seaOn(api, sim) {
    const sea = createSeaView(api);
    api.loop((dt, now) => sea.tick(dt, now, sim.own(), sim.other?.() ?? null));
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
    sea.tick(1 / 60, 1000, true, null); // draws nothing, and doesn't throw
    w.change((d) => (d.traits[SEA] = {}));
    sea.update(w.scene());
    expect(sea.ocean).not.toBe(null);
    expect(sea.atmosphere()).toBe(ATMOSPHERE);
    w.change((d) => delete d.traits[SEA]);
    sea.update(w.scene());
    expect(sea.ocean).toBe(null);
  });

  it("keeps the clock while simulating and publishes it; else follows and publishes nothing", () => {
    const doc = scene();
    w = fakeWorld(doc);
    const a = w.join("A");
    const b = w.join("B");
    let simulating = false;
    const sa = seaOn(a, { own: () => simulating });
    const sb = seaOn(b, { own: () => false, other: () => (simulating ? "A" : null) });
    w.tick(1 / 60, 30);
    expect(w.view("A").keys.sailing?.clock).toBeUndefined();
    simulating = true;
    w.tick(1 / 60, 60);
    expect(w.view("A").keys.sailing.clock.t).toBeCloseTo(sa.clock());
    expect(w.view("B").keys.sailing?.clock).toBeUndefined();
    // the fake stage draws a peer's poses as they come (shownAt is now): so does the sea
    expect(sb.clock()).toBeCloseTo(sa.clock(), 1);
    simulating = false;
    w.tick(1 / 60, 1);
    expect(w.view("A").keys.sailing.clock).toBeUndefined();
  });

  it("keeps the wall's time at a slow frame rate (the stage clamps dt), skipping only a stall", () => {
    const doc = scene();
    w = fakeWorld(doc);
    const a = w.join("A");
    const sea = seaOn(a, { own: () => true });
    const loops = w.view("A").loops;
    // three frames a second: the stage says dt = 0.1, the frame clock moves 333 ms
    for (let i = 0; i <= 9; i++) for (const fn of loops) fn(0.1, 5000 + i * 333);
    expect(sea.clock()).toBeCloseTo(0.1 + 9 * 0.333, 6); // (the first frame has only the stage's dt)
    // a hidden tab comes back after a minute: a second of it, at most
    const t = sea.clock();
    for (const fn of loops) fn(0.1, 5000 + 9 * 333 + 60_000);
    expect(sea.clock() - t).toBeCloseTo(MAX_STEP_S, 6);
  });
});

describe("the sea while editing", () => {
  let w;
  afterEach(() => w?.done());

  it("draws the same sea and sky at its own clock, holding nothing and saying nothing", () => {
    const doc = scene();
    w = fakeWorld(doc);
    const api = w.join("E");
    const part = edit.create(api);
    expect(part.atmosphere()).toBe(ATMOSPHERE);
    w.tick(1 / 60, 30);
    expect(w.holds.size).toBe(0);
    expect(w.view("E").keys).toEqual({});
    expect(doc.claims).toBeUndefined();
    part.dispose();
  });

  it("follows the sailors' clock while someone sails her (the clock edit.js keeps)", () => {
    const doc = scene();
    w = fakeWorld(doc);
    const p = w.join("P");
    const sailor = createSeaView(p);
    p.loop((dt, now) => sailor.tick(dt, now, true, null));
    w.tick(1 / 60, 120); // two seconds of sailing before the editor opens
    const e = w.join("E");
    const clock = seaClock(e);
    e.loop((dt, now) => clock.tick(dt, now, "P"));
    w.tick(1 / 60, 30);
    expect(clock.now()).toBeGreaterThan(2);
    expect(clock.now()).toBeCloseTo(sailor.clock(), 1);
    // nobody sailing: its own
    const alone = seaClock(e);
    alone.tick(0.5, null, null);
    expect(alone.now()).toBe(0.5);
  });
});
