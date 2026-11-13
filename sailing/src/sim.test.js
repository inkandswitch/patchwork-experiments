// The ships' physics as a process of the doc's clock, and the stations'
// controls: the pure parts, then createSim with createSeaView on a fake
// stage (test/fakes.js, whose clock is the stage's) with two views on one doc.
import { describe, it, expect, afterEach } from "vitest";
import { SLOOP, createShip, MAX_SUBSTEPS, SUBSTEP } from "./physics.js";
import { headTo } from "./layout.js";
import { createSeaView } from "./sea-view.js";
import {
  DEPTH,
  SLACK,
  anchorReaches,
  bowOf,
  catchUp,
  controlsOf,
  createSim,
  dropPoint,
  finiteState,
  movedByEditor,
  sameTransform,
  specFor,
  transformOf,
} from "./sim.js";
import { ANCHOR, HELM, SAIL, SHIP, WHEEL_TURNS, stationValue } from "./traits.js";
import { quatFromEuler } from "./frames.js";
import { fakeWorld } from "./test/fakes.js";

const DIMS = { length: 12, beam: 3.8, draft: 1.9, freeboard: 1.2 };

describe("a ship's spec", () => {
  it("comes from the dimensions its GLB declares: the sloop's own", () => {
    const spec = specFor({ box: { min: [-2.5, -2, -6.4], max: [2.5, 3, 6.1] }, extras: { ship: DIMS } });
    for (const k of ["length", "beam", "draft", "freeboard", "mass", "cg"]) expect(spec[k]).toBeCloseTo(SLOOP[k]);
    expect(spec.sail.area).toBeCloseTo(SLOOP.sail.area);
    expect(spec.keel.depth).toBeCloseTo(SLOOP.keel.depth);
  });

  it("else from its box, and the sloop's with neither; the trait's overrides win", () => {
    const box = specFor({ box: { min: [-1, -0.5, -3], max: [1, 0.6, 3] }, extras: null });
    expect(box.length).toBeCloseTo(6);
    expect(box.beam).toBeCloseTo(2);
    expect(box.draft).toBeCloseTo(0.5);
    expect(specFor(null).length).toBe(SLOOP.length);
    expect(specFor({ extras: { ship: DIMS } }, { mass: 5000 }).mass).toBe(5000);
    // dimensions that aren't all there don't count
    expect(specFor({ box: { min: [-1, -0.5, -3], max: [1, 0.6, 3] }, extras: { ship: { length: 12 } } }).length).toBeCloseTo(6);
  });

  it("at the object's scale, as she's drawn: twice the size, eight times the mass", () => {
    const one = specFor({ extras: { ship: DIMS } });
    const two = specFor({ extras: { ship: DIMS } }, undefined, 2);
    expect(two.length).toBeCloseTo(2 * one.length);
    expect(two.draft).toBeCloseTo(2 * one.draft);
    expect(two.mass / one.mass).toBeCloseTo(8, 5);
    expect(specFor(null, undefined, 2).length).toBeCloseTo(2 * SLOOP.length);
  });
});

describe("controls", () => {
  const spec = SLOOP;

  it("a station's value is its defaults, then its trait, then its holder's input", () => {
    expect(stationValue(SAIL, {}, null)).toEqual({ raised: 1, sheet: 0.5 });
    expect(stationValue(SAIL, { raised: 0.3 }, null)).toEqual({ raised: 0.3, sheet: 0.5 });
    expect(stationValue(SAIL, { raised: 0.3 }, { sheet: 0.9 })).toEqual({ raised: 0.3, sheet: 0.9 });
    expect(stationValue(HELM, { angle: 0.2 }, { angle: -1 })).toEqual({ angle: -1 });
  });

  it("the helm is the rudder, the sail its raise and sheet, each clamped", () => {
    const c = controlsOf({ helm: { angle: 2 }, sail: { raised: 0.4, sheet: -1 }, anchor: null }, null, spec);
    expect(c).toEqual({ rudder: 1, sail: 0.4, sheet: 0, anchor: null });
  });

  it("a missing station leaves the rudder amidships, no sail set and no anchor", () => {
    expect(controlsOf({}, null, spec)).toEqual({ rudder: 0, sail: 0, sheet: 0.5, anchor: null });
  });

  it("the anchor holds only while down and lying somewhere, on at least the drop and some slack", () => {
    const at = [3, -DEPTH, 4];
    expect(controlsOf({ anchor: { down: false, rode: 30 } }, at, spec).anchor).toBeNull();
    expect(controlsOf({ anchor: { down: true, rode: 30 } }, null, spec).anchor).toBeNull();
    expect(controlsOf({ anchor: { down: true, rode: 30 } }, at, spec).anchor).toEqual({ at, rode: 30 });
    expect(controlsOf({ anchor: { down: true, rode: 0 } }, at, spec).anchor.rode).toBeCloseTo(DEPTH + spec.freeboard + SLACK);
  });

  it("an anchor further off than her rode isn't hers (written before she was moved, or copied with her)", () => {
    const state = createShip().rest({ position: [0, 0, 0] });
    const near = dropPoint(state, SLOOP);
    expect(anchorReaches(near, state, SLOOP, 0)).toBe(true);
    expect(anchorReaches([near[0], -DEPTH, near[2] - 25], state, SLOOP, 25)).toBe(true);
    expect(anchorReaches([near[0] + 150, -DEPTH, near[2]], state, SLOOP, 25)).toBe(false);
    expect(anchorReaches(null, state, SLOOP, 25)).toBe(false);
  });

  it("an anchor let go lies on the bottom under the bow", () => {
    const yaw = 0.7;
    const state = createShip().rest({ position: [10, 0, -5], yaw });
    const at = dropPoint(state, SLOOP);
    const bow = bowOf(SLOOP); // body: forward is −Z
    expect(at[1]).toBe(-DEPTH);
    expect(at[0]).toBeCloseTo(10 + bow[2] * Math.sin(yaw), 2);
    expect(at[2]).toBeCloseTo(-5 + bow[2] * Math.cos(yaw), 2);
  });
});

describe("stepping", () => {
  it("skips what one step can't catch up, as the sea's clock does, so she stays on the waves drawn", () => {
    const cap = MAX_SUBSTEPS * SUBSTEP;
    const [s1, dt1] = catchUp({ t: 10, acc: 0.002 }, 10.1);
    expect(s1.t).toBe(10);
    expect(dt1).toBeCloseTo(0.098);
    const [s2, dt2] = catchUp({ t: 10, acc: 0 }, 13);
    expect(s2.t).toBeCloseTo(13 - cap);
    expect(dt2).toBeCloseTo(cap);
    // at 3 frames a second she keeps up with the clock (if slowly), never falling further behind
    const ship = createShip();
    let s = ship.rest();
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += 1 / 3;
      const [from, dt] = catchUp(s, t);
      s = ship.step(from, {}, {}, dt);
    }
    expect(t - s.t).toBeLessThan(cap);
  });

  it("knows a state that has gone to NaN", () => {
    const s = createShip().rest();
    expect(finiteState(s)).toBe(true);
    expect(finiteState({ ...s, velocity: [NaN, 0, 0] })).toBe(false);
  });
});

describe("saving", () => {
  it("knows its own writes: a transform as written reads back the same", () => {
    const s = { position: [1.23456, 0.1, -2], quaternion: quatFromEuler([0.01, 2, -0.03]) };
    const t = transformOf(s, 1);
    expect(sameTransform(t, JSON.parse(JSON.stringify(t)))).toBe(true);
    expect(sameTransform(t, { ...t, position: [1.3, 0.1, -2] })).toBe(false);
    expect(sameTransform(null, null)).toBe(true);
  });

  it("a transform written with the checkpoint's stamp is a save (perhaps a late one); without, a move", () => {
    const t = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
    const moved = { ...t, position: [5, 0, 0] };
    const seen = { transform: t, saved: 30 };
    expect(movedByEditor(t, 30, seen)).toBe(false);
    expect(movedByEditor(moved, 30, seen)).toBe(true);
    expect(movedByEditor(moved, 60, seen)).toBe(false);
    expect(movedByEditor(moved, undefined, { transform: t, saved: null })).toBe(true);
  });
});

// ─── on a fake stage ────────────────────────────────────────────────────────

import { heldAt, play, sloop } from "./test/sim-stage.js";

describe("createSim on a stage", () => {
  let w;
  afterEach(() => w?.done());

  it("input from someone not at the station doesn't count", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const b = play(w.join("B"));
    w.tick(1 / 60, 2);
    b.sim.input(ids.wheel, { angle: 1 });
    w.tick(1 / 60, 2);
    expect(a.sim.value(ids.wheel).angle).toBe(0);
  });

  it("steps on the clock's grid but holds each pose once a frame: a frame of fifteen steps is one hold each, where fifteen frames of one step would leave her", async () => {
    const run = async (dt, frames) => {
      const { doc, ids, content } = await sloop();
      w = fakeWorld(doc, { content });
      const api = w.join("A");
      const holds = [];
      const hold = api.pose.hold;
      api.pose = { ...api.pose, hold: (id, t, o) => (holds.push(id), hold(id, t, o)) };
      play(api);
      w.tick(1 / 60, 2);
      holds.length = 0;
      w.tick(dt, frames);
      const out = { t: w.clock.t, hull: holds.filter((h) => h === ids.hull).length, rig: holds.filter((h) => h === ids.rig).length, at: structuredClone(w.holds.get(ids.hull).transform) };
      w.done();
      w = null;
      return out;
    };
    const slow = await run(0.25, 1);
    const fast = await run(1 / 60, 15);
    expect(slow.t).toBeCloseTo(fast.t, 9);
    expect([slow.hull, slow.rig, fast.hull, fast.rig]).toEqual([1, 1, 15, 15]);
    for (const k of ["position", "rotation"]) for (let i = 0; i < 3; i++) expect(slow.at[k][i]).toBeCloseTo(fast.at[k][i], 9);
  });

  it("the follower takes over when the simulator leaves, from where the ship was, still moving", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const b = play(w.join("B"));
    w.tick(1 / 60, 6 * 60);
    const before = heldAt(w, ids.hull).position;
    const speed = a.sim.read(ids.hull).speed;
    w.leave("A");
    // its last save is the doc's now
    expect(sameTransform(doc.objects[ids.hull].transform, heldAt(w, ids.hull) ?? doc.objects[ids.hull].transform)).toBe(true);
    w.tick(1 / 60, 1);
    expect(b.sim.simulating()).toBe(true);
    expect(doc.claims.clock.session).toBe("B");
    const after = heldAt(w, ids.hull).position;
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThan(0.1);
    w.tick(1 / 60, 30);
    expect(b.sim.read(ids.hull).speed).toBeGreaterThan(speed * 0.7);
  });

  it("after a crash too: from the pose it was showing", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    play(w.join("A"));
    const b = play(w.join("B"));
    w.tick(1 / 60, 4 * 60);
    const before = heldAt(w, ids.hull).position;
    w.leave("A", { bye: false });
    w.tick(1 / 60, 1);
    expect(b.sim.simulating()).toBe(true);
    const after = heldAt(w, ids.hull).position;
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThan(0.1);
  });

  it("two that claim at once: the one that loses the merge stops", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    w.tick(1 / 60, 10);
    expect(a.sim.simulating()).toBe(true);
    // the merge settled on someone else (a view that's here)
    w.join("Z");
    w.change((d) => (d.claims.clock = { viewer: "x", session: "Z" }));
    w.tick(1 / 60, 1);
    expect(a.sim.simulating()).toBe(false);
    expect(w.holds.get(ids.hull)?.session).not.toBe("A");
  });

  it("a ship someone moved in the editor starts again from there", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    play(w.join("A"));
    w.tick(1 / 60, 3 * 60);
    w.change((d) => {
      d.objects[ids.hull].transform.position[0] = 100;
      d.objects[ids.hull].transform.position[2] = -40;
    });
    w.tick(1 / 60, 1);
    const p = heldAt(w, ids.hull).position;
    expect(p[0]).toBeCloseTo(100, 0);
    expect(p[2]).toBeCloseTo(-40, 0);
  });

  it("an anchor lies where the windlass says it was let go, and is let go again where she's moved to", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    play(w.join("A"));
    w.tick(1 / 60, 10);
    const spot = [4, -6, -9];
    w.change((d) => Object.assign(d.objects[ids.windlass].traits[ANCHOR], { down: true, rode: 25, at: spot }));
    w.tick(1 / 60, 10);
    expect(doc.objects[ids.windlass].traits[ANCHOR].at).toEqual(spot);
    w.change((d) => (d.objects[ids.hull].transform.position[0] = 200));
    w.tick(1 / 60, 1);
    const at = doc.objects[ids.windlass].traits[ANCHOR].at;
    expect(at[0]).toBeGreaterThan(190);
    expect(at[1]).toBe(-DEPTH);
  });

  it("each view bellies the sail to leeward of the boom, flat while it luffs, and lowers it as it's taken in", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const b = play(w.join("B"));
    w.tick(1 / 60, 3 * 60);
    const port = a.sim.read(ids.hull).boom < 0;
    const x = content[ids.rig].root.scale.x;
    expect(Math.sign(x)).toBe(port ? -1 : 1);
    expect(Math.abs(x)).toBeLessThanOrEqual(1);
    b.sim.commit(ids.rig, { raised: 0 });
    w.tick(1 / 60, 1);
    const sail = content[ids.rig].root.getObjectByName("Sail");
    expect(sail.visible).toBe(false);
    b.sim.commit(ids.rig, { raised: 0.5 });
    w.tick(1 / 60, 1);
    expect(sail.visible).toBe(true);
    expect(sail.scale.y).toBe(0.5);
    a.looks.dispose();
    expect(content[ids.rig].root.scale.x).toBe(1);
    expect(sail.scale.y).toBe(1);
  });

  it("finds a ship's stations and its ladder", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const ladder = Object.keys(doc.objects).find((id) => doc.objects[id].name === "Ladder");
    const mainsheet = Object.keys(doc.objects).find((id) => doc.objects[id].name === "Mainsheet");
    const jib = Object.keys(doc.objects).find((id) => doc.objects[id].name === "Jib");
    const winches = ["Port jib winch", "Starboard jib winch"].map((n) => Object.keys(doc.objects).find((id) => doc.objects[id].name === n));
    expect(a.sim.stationsOf(ids.hull)).toEqual({ helm: ids.wheel, sail: ids.rig, anchor: ids.windlass, mainsheet, jib, ladder, winches });
    expect(a.sim.ships()).toEqual([ids.hull]);
  });

  it("a stale anchor spot (she was moved while nobody sailed) is let go again where she is, and nothing goes to NaN", async () => {
    const { doc, ids, content } = await sloop({ down: true, yaw: headTo(45) });
    // written when she lay 160 m off, toward the islet
    doc.objects[ids.windlass].traits[ANCHOR].at = [-45, -DEPTH, -160];
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    w.tick(1 / 60, 5 * 60);
    const at = doc.objects[ids.windlass].traits[ANCHOR].at;
    expect(Math.hypot(at[0], at[2])).toBeLessThan(10);
    const p = heldAt(w, ids.hull).position;
    expect(p.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(p[0], p[2])).toBeLessThan(15);
    expect(a.sim.read(ids.hull).speed).toBeLessThan(2);
  });

  it("a late save from the last simulator isn't taken for an editor's move: she sails on", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    w.tick(1 / 60, 6 * 60);
    const speed = a.sim.read(ids.hull).speed;
    // a checkpoint of where she was a few seconds ago (stamped, motion and all) lands now
    w.change((d) => {
      d.objects[ids.hull].transform.position[0] -= 8;
      d.objects[ids.hull].traits[SHIP].motion = { velocity: [0.5, 0, 0.5], spin: [0, 0, 0] };
      d.objects[ids.hull].saved = 1.5;
    });
    w.tick(1 / 60, 1);
    expect(a.sim.read(ids.hull).speed).toBeGreaterThan(speed * 0.8);
  });

  it("stopping lets the hulls go where they were written, so peers don't see her jump back", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    play(w.join("A"));
    play(w.join("B"));
    w.tick(1 / 60, 6 * 60);
    const shown = heldAt(w, ids.hull);
    w.view("A").abort.abort(); // her extension stopped (the doc stopped calling for it): the stage removes its process, saved first
    // written down, then let go as landed there (not put back to the last save)
    expect(sameTransform(doc.objects[ids.hull].transform, shown)).toBe(true);
    expect(w.released.filter((r) => r.session === "A" && r.id === ids.hull).at(-1)?.landed).toBe(true);
    w.tick(1 / 60, 1);
    expect(doc.claims.clock.session).toBe("B");
  });

  it("a simulator whose tab is hidden writes her down and lets go; a visible peer carries on from there", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const b = play(w.join("B"));
    w.tick(1 / 60, 6 * 60);
    const before = heldAt(w, ids.hull).position;
    w.hide("A");
    expect(a.sim.simulating()).toBe(false);
    expect(doc.claims.clock).toBeUndefined();
    w.tick(1 / 60, 1);
    expect(b.sim.simulating()).toBe(true);
    const after = heldAt(w, ids.hull).position;
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThan(0.2);
    // back, it follows: it doesn't take the claim back
    w.hide("A", false);
    w.tick(1 / 60, 2);
    expect(a.sim.simulating()).toBe(false);
    expect(doc.claims.clock.session).toBe("B");
  });

  it("paused, she stops where she is: written down, let go landed, nobody computing; resumed, she carries on from there", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const bApi = w.join("B");
    const b = play(bApi);
    w.tick(1 / 60, 4 * 60);
    const shown = heldAt(w, ids.hull);
    const speed = a.sim.read(ids.hull).speed;
    bApi.clock.pause(); // anyone may pause; the computer hears of it and lets go
    w.tick(1 / 60, 1);
    expect(doc.clock).toMatchObject({ running: false, by: "viewer-B" });
    expect(a.sim.simulating()).toBe(false);
    expect(sameTransform(doc.objects[ids.hull].transform, shown)).toBe(true);
    expect(w.released.filter((r) => r.session === "A" && r.id === ids.hull).at(-1)?.landed).toBe(true);
    const t = doc.clock.t;
    w.tick(1 / 60, 3 * 60);
    expect(bApi.clock.t()).toBe(t); // no time passes
    expect(a.sim.simulating() || b.sim.simulating()).toBe(false);
    bApi.clock.resume();
    w.tick(1 / 60, 1);
    expect(a.sim.simulating()).toBe(true); // (the first here takes it again)
    const p = heldAt(w, ids.hull).position;
    expect(Math.hypot(p[0] - shown.position[0], p[2] - shown.position[2])).toBeLessThan(0.1);
    w.tick(1 / 60, 30);
    expect(a.sim.read(ids.hull).speed).toBeGreaterThan(speed * 0.7);
  });

  it("a hull nobody steers yields to a person: carried, it's theirs, and put down it starts again at rest there", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const bApi = w.join("B");
    play(bApi);
    w.tick(1 / 60, 3 * 60);
    expect(w.holds.get(ids.hull)).toMatchObject({ session: "A", yields: true });
    expect(bApi.heldBy(ids.hull)).toBeNull(); // a person isn't kept off by a process
    const put = { position: [40, 0, -30], rotation: [0, 0, 0], scale: 1 };
    expect(bApi.pose.hold(ids.hull, put)).toBe(true);
    w.tick(1 / 60, 10);
    expect(w.holds.get(ids.hull).session).toBe("B"); // the process's holds are refused meanwhile
    // put down: written where it landed, then the process starts her again from there
    w.change((d) => Object.assign(d.objects[ids.hull].transform, put));
    bApi.pose.release(ids.hull, { landed: true });
    w.tick(1 / 60, 2);
    const p = heldAt(w, ids.hull).position;
    expect(Math.hypot(p[0] - 40, p[2] + 30)).toBeLessThan(0.5);
    expect(a.sim.read(ids.hull).speed).toBeLessThan(0.3);
  });

  it("held by a person, she isn't stepped: put back (not landed), she goes on from where she was taken, still moving", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = play(w.join("A"));
    const bApi = w.join("B");
    play(bApi);
    w.tick(1 / 60, 6 * 60);
    const before = heldAt(w, ids.hull).position;
    const speed = a.sim.read(ids.hull).speed;
    expect(speed).toBeGreaterThan(0.5); // under way: three seconds stepped would move her metres
    expect(bApi.pose.hold(ids.hull, { position: [40, 0, -30], rotation: [0, 0, 0], scale: 1 })).toBe(true);
    w.tick(1 / 60, 3 * 60);
    expect(w.holds.get(ids.hull).session).toBe("B");
    // Escape: put back, the doc unchanged (no move for movedByEditor to see)
    bApi.pose.release(ids.hull);
    w.tick(1 / 60, 1);
    expect(w.holds.get(ids.hull).session).toBe("A");
    const after = heldAt(w, ids.hull).position;
    // at most the frame before the refusal was heard and the frame after the release: a few centimetres
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThan(3 * speed / 60 + 0.01);
    expect(a.sim.read(ids.hull).speed).toBeGreaterThan(speed * 0.7);
  });

  it("a hull at the helm doesn't yield: nobody takes it from her helmsman's ship", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    play(w.join("A"));
    const bApi = w.join("B");
    play(bApi);
    w.tick(1 / 60, 30);
    bApi.claim(ids.wheel, "station");
    w.tick(1 / 60, 2);
    expect(w.holds.get(ids.hull)).toMatchObject({ session: "A", yields: false });
    expect(bApi.heldBy(ids.hull)).toBe("A");
    expect(bApi.pose.hold(ids.hull, { position: [40, 0, -30], rotation: [0, 0, 0], scale: 1 })).toBe(false);
  });

  it("the wheel is its helmsman's to hold while someone's at the helm; the simulator holds it otherwise", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    play(w.join("A"));
    const bApi = w.join("B");
    play(bApi);
    w.tick(1 / 60, 2);
    expect(w.holds.get(ids.wheel)?.session).toBe("A");
    doc.objects[ids.wheel].traits[HELM].angle = 0.4;
    w.change(() => {});
    w.tick(1 / 60, 1);
    expect(heldAt(w, ids.wheel).rotation[2]).toBeCloseTo(-0.4 * WHEEL_TURNS * 2 * Math.PI);
    bApi.claim(ids.wheel, "station");
    w.tick(1 / 60, 2);
    expect(w.holds.get(ids.wheel)?.session).not.toBe("A");
  });
});
