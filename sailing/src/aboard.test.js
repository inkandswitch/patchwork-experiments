// Two people aboard one sloop, through play.js's whole join (sea, sim, crew,
// stations, HUD) on the package's fake stage (test/fakes.js), with the
// hull's deck as a box the rays see where it's drawn.
import { describe, it, expect, afterEach } from "vitest";
import play from "./play.js";
import { layOutShip, headTo } from "./layout.js";
import { apply, invert, unrotateM as unrotate, rotateM as rotate } from "./frames.js";
import { fakeNode, fakeWorld } from "./test/fakes.js";

const DIMS = { length: 12, beam: 3.8, draft: 1.9, freeboard: 1.2 };
const DECK = { min: [-1.8, -1.9, -6], max: [1.8, 1.25, 6] };

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
  const doc = { objects: {}, order: [], traits: {}, view: {}, dimensions: {} };
  let n = 0;
  const hull = await layOutShip(
    { repo: { create2: async () => ({ url: `automerge:f${++n}` }) }, change: (fn) => fn(doc), newId: (p) => `${p}${++n}` },
    { wind: { speed: 7, from: 45 }, seed: 3 },
  );
  doc.objects[hull].transform.rotation = [0, headTo(-45), 0];
  const byName = (name) => Object.keys(doc.objects).find((id) => doc.objects[id].name === name);
  const ids = { hull, rig: byName("Boom and sail"), wheel: byName("Wheel"), windlass: byName("Windlass"), ladder: byName("Ladder") };
  doc.objects[ids.windlass].traits["sailing.anchor"].down = false;
  doc.objects[ids.rig].traits["sailing.sail"].raised = 1; // the template leaves it down
  const content = {
    [hull]: { loaded: true, box: doc.objects[hull].hint.bounds, extras: { ship: DIMS }, root: fakeNode() },
    [ids.rig]: { loaded: true, box: null, extras: {}, root: fakeNode({ Sail: fakeNode() }) },
  };
  return { doc, ids, content };
}

/** A view in play: play.js's instance on the fake stage, with what the crew and HUD ask of it. */
function join(w, session, hull) {
  const base = w.join(session);
  const s = { arms: [], cam: { position: [10, 6, 10], target: [0, 0, 0] }, held: 0, groups: [] };
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
    arm(handlers, opts = {}) {
      const e = { handlers, opts };
      s.arms.push(e);
      return () => {
        const i = s.arms.indexOf(e);
        if (i >= 0) s.arms.splice(i, 1), handlers.disarmed?.();
      };
    },
    relock: () => Promise.resolve(),
    camera: {
      object: base.camera.object,
      get: () => ({ ...s.cam }),
      set: (c) => (s.cam = { ...s.cam, ...c }),
      hold: () => (s.held++, () => s.held--),
    },
  });
  s.api = api;
  s.instance = play.create(api);
  s.top = () => s.arms.at(-1)?.handlers;
  s.command = (id) => s.instance.commands.find((c) => c.id === id);
  return s;
}

describe("aboard, together", () => {
  let w;
  afterEach(() => w?.done());

  it("one sails, one steers: the deck carries both, each sees the other, and the helm's input steers her", async () => {
    const { doc, ids, content } = await sloop();
    w = fakeWorld(doc, { content });
    const a = join(w, "A", ids.hull);
    const b = join(w, "B", ids.hull);
    for (const v of [a, b]) v.instance.update(w.scene(), {}, { scene: null, local: null });
    w.tick(1 / 60, 30);

    // Enter comes aboard (the key map runs "aboard" on the scene)
    expect(a.command("aboard").state(null, {})).toBeTruthy();
    a.command("aboard").run(null);
    b.instance.input.click({});
    expect(a.arms.length).toBe(1);
    w.tick(1 / 60, 30);
    // one owner of the presence rate: the simulator streams, the crew sends where they stand
    expect(w.view("A").rate).toBe(30);
    expect(w.view("B").rate).toBe(20);

    // both on deck by the wheel, in the hull's frame
    const crewOf = (s) => w.view(s).keys.sailing?.crew;
    expect(crewOf("A")).toMatchObject({ on: ids.hull });
    expect(crewOf("B")).toMatchObject({ on: ids.hull });
    const before = crewOf("B").position;

    // B takes the helm from where it stands: in reach of the wheel
    const eyeB = b.cam.position;
    const look = { scene: w.scene(), local: {}, from: eyeB, hit: null };
    expect(b.command("helm").state(ids.wheel, look)).toEqual({});
    b.command("helm").run(ids.wheel);
    expect(doc.objects[ids.wheel].claims.station.session).toBe("B");
    expect(a.command("helm").state(ids.wheel, { ...look, from: a.cam.position })).toEqual({ disabled: true, label: "Someone's at the helm" });
    expect(crewOf("B").station).toBe(ids.wheel);

    // hard to starboard for a few seconds: B's input reaches A's physics
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

    // the deck carried them: A never moved on it, and stands on its top
    expect(crewOf("A").position[1]).toBeCloseTo(DECK.max[1], 2);
    expect(Math.hypot(crewOf("B").position[0] - before[0], crewOf("B").position[2] - before[2])).toBeLessThan(0.05);

    // F leaves the helm and writes where the wheel was left
    b.top().key({ code: "KeyF", key: "f" });
    expect(doc.objects[ids.wheel].traits["sailing.helm"].angle).toBe(1);
    expect(doc.objects[ids.wheel].claims?.station).toBe(undefined);
    expect(crewOf("B").station).toBe(null);

    // each draws the other where they stand (and never themselves)
    w.tick(1 / 60, 2);
    const avatars = (v) => v.groups.flatMap((g) => g.children.filter((c) => c.userData?.noPick && c.children?.length === 2));
    expect(avatars(a).length).toBe(1);
    expect(avatars(b).length).toBe(1);
  });
});
