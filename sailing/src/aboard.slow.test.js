// Two people aboard one sloop, through play.js's whole join (sea, sim, crew,
// stations, HUD) on the package's fake stage (test/fakes.js), with the
// hull's deck as a box (what the rays see where it's drawn), and a stand-in
// for walk (another package's body: its avatar here, its `stand`, and where
// it is resumed from), over which the station body is pushed.
import { describe, it, expect, afterEach } from "vitest";
import play from "./play.js";
import { layOutShip, headTo } from "./layout.js";
import { apply, invert, unrotateM as unrotate, rotateM as rotate } from "./frames.js";
import { emptyScene, fakeDrop, fakeNode, fakeWorld, meshNode } from "./test/fakes.js";

const DIMS = { length: 12, beam: 3.8, draft: 1.9, freeboard: 1.2 };
const DECK = { min: [-1.8, -1.9, -6], max: [1.8, 1.25, 6] };

/** A box's triangles (12, 9 numbers each), for the hull's stand-in model. */
function boxTriangles(min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 6, 2], [3, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
  return f.flatMap((t) => t.flatMap((i) => v[i]));
}

/** The deck box in the hull's displayed frame, answered as the stage's raycast would be. */
function rays(worldOf, hull) {
  const hitBox = (o, d, b, max) => {
    let t0 = 0;
    let t1 = max;
    let n = null;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-12) {
        if (o[i] < b.min[i] || o[i] > b.max[i]) return null;
        continue;
      }
      let a = (b.min[i] - o[i]) / d[i];
      let c = (b.max[i] - o[i]) / d[i];
      const side = -Math.sign(d[i]);
      if (a > c) [a, c] = [c, a];
      if (a > t0) {
        t0 = a;
        n = [0, 0, 0];
        n[i] = side;
      }
      t1 = Math.min(t1, c);
      if (t0 > t1) return null;
    }
    return { distance: t0, normal: n };
  };
  return (o, d, { far = Infinity, skip } = {}) => {
    if (skip?.(hull)) return null;
    const m = worldOf(hull);
    const l = Math.hypot(...d);
    const lo = apply(invert(m), o);
    const ld = unrotate(m, d.map((v) => v / l));
    const h = hitBox(lo, ld, DECK, far);
    if (!h) return null;
    return { id: hull, distance: h.distance, normal: h.normal && rotate(m, h.normal), point: apply(m, lo.map((v, i) => v + ld[i] * h.distance)) };
  };
}

async function sloop() {
  const doc = emptyScene();
  const hull = await layOutShip(
    fakeDrop(doc).ctx,
    { wind: { speed: 7, from: 45 }, seed: 3 },
  );
  doc.objects[hull].transform.rotation = [0, headTo(-45), 0];
  const byName = (name) => Object.keys(doc.objects).find((id) => doc.objects[id].name === name);
  const ids = { hull, rig: byName("Boom and sail"), wheel: byName("Wheel"), windlass: byName("Windlass"), ladder: byName("Ladder") };
  doc.objects[ids.windlass].traits["sailing.anchor"].down = false;
  doc.objects[ids.rig].traits["sailing.sail"].raised = 1; // the template leaves it down
  const content = {
    [hull]: { loaded: true, box: doc.objects[hull].hint.bounds, extras: { ship: DIMS }, root: meshNode(boxTriangles(DECK.min, DECK.max)) },
    [ids.rig]: { loaded: true, box: null, extras: {}, root: fakeNode({ Sail: fakeNode() }) },
  };
  return { doc, ids, content };
}

/** A view in play: play.js's instance on the fake stage, with what the crew and HUD ask of it. */
function join(w, session, hull) {
  const base = w.join(session);
  const collect = base.collect;
  // walk's eye at a stand spot is walk's to work out: the stand-in's is a point on her helm's spot, 1.7 m up her up
  const standEye = (W) => [0, 1, 2].map((i) => W[12 + i] + W[4 + i] * (0.72 + 1.7) + W[8 + i] * 4.85);
  const s = { bodies: [{ id: "look" }], cam: { position: [10, 6, 10], target: [0, 0, 0] }, held: 0, groups: [], standEye, stood: null };
  // what the crew's avatars are made of, beside what the sea asks for
  const T = base.THREE;
  class Group {
    constructor() {
      Object.assign(this, { children: [], userData: {}, visible: true, parent: null, position: new T.Vector3(), rotation: new T.Vector3() });
    }
    add(...o) {
      for (const c of o) (c.parent = this), this.children.push(c);
    }
    removeFromParent() {
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    }
  }
  const disposable = class {
    dispose() {}
  };
  class Color extends T.Color {
    setHSL() {
      return this;
    }
  }
  const api = Object.assign(base, {
    THREE: { ...T, Group, Color, CapsuleGeometry: disposable, SphereGeometry: disposable, BoxGeometry: disposable, MeshStandardMaterial: disposable, MeshBasicMaterial: disposable },
    world: () => {
      const g = new Group();
      s.groups.push(g);
      return g;
    },
    port: document.createElement("div"),
    style() {},
    overlay: () => document.createElement("div"),
    labels: () => ({ set: (items) => (s.labels = items) }),
    listen: (t, type, fn, o) => t.addEventListener(type, fn, o),
    raycast: rays(base.worldOf, hull),
    // the stage's body stack, as far as the crew meets it (scene/TOOLS.md §4)
    local: { get: () => ({ body: { id: s.bodies.at(-1).id, depth: s.bodies.length - 1 }, pointer: { locked: true, released: false } }) },
    view: { get: () => ({ body: { id: s.bodies.at(-1).id, depth: s.bodies.length - 1 }, pointer: { locked: true, released: false } }) },
    // walk's avatar here, while its stand-in is on the stack (on her deck, at her helm's stand spot)
    collect: (name) =>
      name === "avatar"
        ? [{ id: "walk", value: () => (s.bodies.some((b) => b.id === "walk") ? { on: hull, feet: [0, 0.72, 4.85], yaw: 0, pitch: 0, swimming: false } : null) }]
        : name === "stand"
          ? [{ id: "walk", value: (id) => (s.bodies.some((b) => b.id === "walk") ? ((s.stood = id), { eye: () => s.standEye(base.worldOf(hull)), yaw: 0 }) : null) }]
          : collect(name),
    body: {
      current: () => ({ id: s.bodies.at(-1).id, ext: s.bodies.at(-1).ext ?? "sailing", depth: s.bodies.length - 1 }),
      enter(id, place = null) {
        // walk (another package's): resumed from where the eye was left
        const walk = { id: "walk", enter: () => ({ input: { resumed: () => (s.resumed = [...s.cam.position]) }, leave() {} }) };
        const sitting = (id === "walk" ? walk : s.instance.bodies.find((b) => b.id === id))?.enter(place);
        if (!sitting) return false;
        const prev = s.bodies.at(-1);
        s.bodies.push({ id, sitting, ext: id === "walk" ? "walk" : "sailing" });
        prev.sitting?.input?.suspended?.();
        return true;
      },
      leave() {
        if (s.bodies.length <= 1) return false;
        s.bodies.pop().sitting.leave?.();
        s.bodies.at(-1).sitting?.input?.resumed?.();
        return true;
      },
      eye: () => s.bodies.at(-1).sitting?.eye?.() ?? null,
    },
    camera: {
      get: () => ({ ...s.cam }),
      set: (c) => (s.cam = { ...s.cam, ...c }),
      hold: () => (s.held++, () => s.held--),
      // the stage carries the camera with what it rides (STAGE.md, "Riding"): here, only asked and let go
      ride: () => () => {},
    },
  });
  s.api = api;
  s.instance = play.create(api);
  s.top = () => s.bodies.at(-1).sitting?.input;
  s.command = (id) => s.instance.commands.find((c) => c.id === id);
  return s;
}

describe("aboard, together", () => {
  let w;
  afterEach(() => w?.done());

  it("one sails, one steers: Come aboard is walk at her hull, the helm a station over it, and the helm's input steers her", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = join(w, "A", ids.hull);
    const b = join(w, "B", ids.hull);
    for (const v of [a, b]) v.instance.update(w.scene(), {}, { scene: null, local: null });
    w.tick(1 / 60, 30);

    // Enter comes aboard (the key map runs "aboard" on the scene): walk, at her hull
    expect(a.command("aboard").state(null, {})).toBeTruthy();
    a.command("aboard").run(null);
    b.instance.input.click({});
    expect(a.bodies.map((x) => x.id)).toEqual(["look", "walk"]);
    expect(a.command("aboard").state(null, {})).toBe(null);
    w.tick(1 / 60, 30);
    // one owner of the presence rate: the simulator streams, someone aboard 20 Hz
    expect(w.view("A").rate).toBe(30);
    expect(w.view("B").rate).toBe(20);
    expect(b.instance.debug.crew.me()).toMatchObject({ playing: true, on: ids.hull, station: null, swimming: false });

    // B takes the helm: the station body over walk, the eye at the helm's stand spot, its claim held
    const look = { scene: w.scene(), local: {}, from: [0, 0, 0], hit: null, reach: 2.5 };
    const near = (from) => ({ ...look, from: w.view("A").api.worldOf(ids.wheel).slice(12, 15) });
    expect(b.command("helm").state(ids.wheel, near())).toEqual({});
    b.command("helm").run(ids.wheel);
    expect(b.bodies.map((x) => x.id)).toEqual(["look", "walk", "station"]);
    expect(doc.objects[ids.wheel].claims.station.session).toBe("B");
    expect(b.stood).toBe(ids.wheel);
    expect(a.command("helm").state(ids.wheel, near())).toEqual({ disabled: true, label: "Someone's at the helm" });
    expect(b.instance.debug.crew.me().station).toBe(ids.wheel);

    // hard to starboard for a few seconds: B's input reaches A's physics, and B's eye rides her helm
    b.top().key({ code: "KeyD", key: "d" });
    const heading0 = (() => {
      const m = w.view("A").api.worldOf(ids.hull);
      return Math.atan2(m[8], m[10]);
    })();
    w.tick(1 / 60, 6 * 60);
    b.top().keyup({ code: "KeyD", key: "d" });
    const m = w.view("A").api.worldOf(ids.hull);
    const turned = Math.atan2(Math.sin(Math.atan2(m[8], m[10]) - heading0), Math.cos(Math.atan2(m[8], m[10]) - heading0));
    expect(turned).toBeLessThan(-0.05); // yaw down: her bow swings to starboard
    // the eye is walk's at the spot, wherever she has gone: the stand-in's
    expect(b.cam.position).toEqual(b.standEye(b.api.worldOf(ids.hull)));

    // F leaves the helm and writes where the wheel was left; walk is asked to stand B at the stand spot
    b.top().key({ code: "KeyF", key: "f" });
    expect(doc.objects[ids.wheel].traits["sailing.helm"].angle).toBe(1);
    expect(doc.objects[ids.wheel].claims?.station).toBe(undefined);
    expect(b.bodies.map((x) => x.id)).toEqual(["look", "walk"]);
    expect(b.resumed).toEqual(b.standEye(b.api.worldOf(ids.hull)));
    expect(b.instance.debug.crew.me()).toMatchObject({ playing: true, station: null });
  });

  // The probe page's clock (scene/src/stage/time.js manualTime: now() is start + frames × frameMs, start
  // MANUAL_EPOCH 1e6 ms, frameMs 1000/60) and the dt a loop gets from it (viewport.js: the difference of two
  // readings, over 1000), from its k0-th frame on. Copied, as packages don't import each other. Its last bits
  // depend on how far the clock has run (a handful of values for one 60 Hz frame, unevenly), so a page that
  // took one frame more to load hands the frames after it different dts, and the world's t, their sum, differs
  // in its last bits too.
  const pageFrames = (k0, n) => Array.from({ length: n }, (_, i) => ((1e6 + (k0 + i + 1) * (1000 / 60)) - (1e6 + (k0 + i) * (1000 / 60))) / 1000);

  it("the same keys held over the same frames sail her the same, whatever frame the page's clock had reached: every step bit for bit (DESIGN.md, \"Determinism\")", async () => {
    // B at the helm: the wheel to starboard (D), the halyard (R: the main comes part way down), the
    // sheet hauled (Q), each held for a whole number of frames; A computes, and every step her physics
    // takes is kept as taken (sim.stepped: the controls and the state, unrounded)
    const KEYS = [["KeyD", "d", 60], ["KeyR", "r", 90], ["KeyQ", "q", 75]];
    const sail = async (k0) => {
      const { doc, ids, content } = await sloop();
      w = fakeWorld(doc, { content });
      const frames = pageFrames(k0, 2000);
      let f = 0;
      const tick = (n) => { for (let i = 0; i < n; i++) w.tick(frames[f++], 1); };
      const a = join(w, "A", ids.hull);
      const b = join(w, "B", ids.hull);
      for (const v of [a, b]) v.instance.update(w.scene(), {}, { scene: null, local: null });
      const steps = [];
      w.view("A").api.clock.process({ step: (_dt, t) => { const st = a.instance.debug.sim.stepped(ids.hull); if (st) steps.push(JSON.stringify([t, st.controls, st.state])); } });
      tick(30);
      a.command("aboard").run(null);
      b.instance.input.click({});
      tick(30);
      b.command("helm").run(ids.wheel);
      for (const [code, key, n] of KEYS) {
        b.top().key({ code, key });
        tick(n);
        b.top().keyup({ code, key });
        tick(20);
      }
      tick(120);
      const out = { steps, frames: frames.slice(0, f), doc: structuredClone(doc.objects) };
      w.done();
      w = null;
      return { ...out, ids };
    };
    const runs = [];
    // (three offsets whose frames' dts differ, asserted below)
    for (const k0 of [0, 1, 2]) runs.push(await sail(k0));
    // the frames' dt differ from run to run (the case this is about) ...
    expect(new Set(runs.map((r) => r.frames.join())).size).toBe(3);
    // ... and each key moved what it works: the wheel over, the main part way down, the sheet in
    const { ids } = runs[0];
    const left = runs[0].doc;
    expect(left[ids.wheel].traits["sailing.helm"].angle).toBeCloseTo(60 / 60 * 0.6, 12);
    expect(left[ids.rig].traits["sailing.sail"].raised).toBeCloseTo(1 - 90 / 60 / 4, 12);
    expect(left[ids.rig].traits["sailing.sail"].sheet).toBeLessThan(0.5);
    // every step the same, to the bit
    expect(runs[0].steps.length).toBeGreaterThan(400);
    for (const r of runs.slice(1)) {
      expect(r.steps.length).toBe(runs[0].steps.length);
      const first = r.steps.findIndex((s, i) => s !== runs[0].steps[i]);
      expect(first, first < 0 ? "" : `step ${first}: ${r.steps[first]} vs ${runs[0].steps[first]}`).toBe(-1);
    }
  });
});
