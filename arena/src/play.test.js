// The play extension against a stand-in for the scene's api: what it asks of
// the stage when you start, walk, shoot and stop.
import { describe, it, expect, beforeEach } from "vitest";
import play, { hueOf, scores } from "./play.js";

class Obj {
  constructor() {
    this.children = [];
    this.userData = {};
    this.position = { set: (...v) => (this.pos = v) };
    this.rotation = { set: (...v) => (this.rot = v) };
    this.parent = null;
  }
  add(...o) {
    for (const c of o) (c.parent = this), this.children.push(c);
  }
  removeFromParent() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  traverse(fn) {
    fn(this);
    for (const c of this.children) c.traverse(fn);
  }
}
class Mesh extends Obj {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}
const disposable = class {
  dispose() {}
};
const THREE = {
  Group: Obj,
  Mesh,
  Line: Mesh,
  BufferGeometry: class {
    setFromPoints(p) {
      this.points = p;
      return this;
    }
    dispose() {}
  },
  LineBasicMaterial: disposable,
  MeshStandardMaterial: disposable,
  MeshBasicMaterial: disposable,
  CylinderGeometry: disposable,
  SphereGeometry: disposable,
  BoxGeometry: disposable,
  Vector3: class {
    constructor(...v) {
      this.v = v;
    }
  },
  Color: class {
    setHSL() {
      return this;
    }
  },
};

function fakeApi(doc) {
  const calls = { listen: {}, arms: [], disarmed: 0, holds: 0, released: 0, loops: [], camera: [], sends: [], presence: {}, rate: [] };
  const world = new Obj();
  const peers = {};
  const api = {
    THREE,
    viewer: "me",
    repo: { find: async () => ({ doc: () => ({}) }) },
    style() {},
    overlay: () => document.createElement("div"),
    world: () => world,
    labels: () => ({ set: (items) => (calls.labels = items) }),
    listen: (target, type, fn) => (calls.listen[type] = fn),
    invalidate() {},
    notify() {},
    doc: () => doc,
    change: (fn) => fn(doc),
    raycast: () => null,
    worldOf: () => null,
    sceneBox: () => ({ min: [-1, 0, -1], max: [1, 0, 1] }),
    camera: { hold: () => (calls.holds++, () => calls.released++), set: (c) => calls.camera.push(c) },
    arm(handlers, opts) {
      calls.arms.push({ handlers, opts });
      return () => (calls.disarmed++, handlers.disarmed?.());
    },
    relock: async () => {},
    loop(fn) {
      calls.loops.push(fn);
      return () => (calls.loops = calls.loops.filter((f) => f !== fn));
    },
    send: (type, data) => calls.sends.push({ type, data }),
    presence: { set: (k, v) => (calls.presence[k] = v), rate: (hz) => calls.rate.push(hz), get: () => peers, watch: () => () => {} },
    local: { swap() {} },
  };
  return { api, calls, world, peers };
}

const T = (position, yaw = 0) => ({ position, rotation: [0, yaw, 0], scale: 1 });
const scene = (doc) => ({ d: doc, objects: doc.objects });

describe("playing", () => {
  let doc, f, x;
  beforeEach(() => {
    doc = { objects: { t1: { name: "Target", traits: { "arena.target": {} }, transform: T([0, 0, -5]) }, floor: { name: "Floor", transform: T([0, 0, 0]) } } };
    f = fakeApi(doc);
    x = play.create(f.api);
    x.update(scene(doc), {}, { scene: null });
  });

  it("starts: arms with the pointer locked, holds the camera, runs a loop, and says where you are", () => {
    x.commands.find((c) => c.id === "play").run(null);
    expect(f.calls.arms).toHaveLength(1);
    expect(f.calls.arms[0].opts).toMatchObject({ lock: true });
    expect(f.calls.holds).toBe(1);
    expect(f.calls.loops).toHaveLength(1);
    // standing on the floor the raycasts find
    f.api.raycast = (from, dir, { far }) => (dir[1] === -1 && from[1] <= far ? { distance: from[1], point: [from[0], 0, from[2]], normal: [0, 1, 0], id: "floor" } : null);
    for (let i = 0; i < 90; i++) f.calls.loops[0](1 / 60);
    expect(f.calls.camera.at(-1).position[1]).toBeCloseTo(1.6, 1);
    expect(f.calls.presence.avatar.feet).toHaveLength(3);
    expect(f.calls.rate).toContain(20);
  });

  it("walks forward on W, turns with the mouse", () => {
    x.commands.find((c) => c.id === "play").run(null);
    f.api.raycast = (from, dir, { far }) => (dir[1] === -1 && from[1] <= far ? { distance: from[1], point: [from[0], 0, from[2]], normal: [0, 1, 0], id: "floor" } : null);
    const h = f.calls.arms[0].handlers;
    h.move({ locked: true, dx: 100, dy: 0 });
    h.key({ key: "w", code: "KeyW" });
    for (let i = 0; i < 30; i++) f.calls.loops[0](1 / 60);
    const cam = f.calls.camera.at(-1);
    const moved = Math.hypot(cam.position[0], cam.position[2]);
    expect(moved).toBeGreaterThan(0.5);
    h.keyup({ key: "w", code: "KeyW" });
  });

  it("a shot that hits a target knocks it down, scores it for you, and tells the others", () => {
    x.commands.find((c) => c.id === "play").run(null);
    f.api.raycast = (from, dir) => (dir[2] < -0.9 ? { id: "t1", point: [0, 1.4, -5], normal: [0, 0, 1], distance: 5 } : null);
    const h = f.calls.arms[0].handlers;
    const session = h.press({ button: 0 });
    expect(session.tap()).toBe(true);
    expect(doc.objects.t1.traits["arena.target"].down.by).toBe("me");
    expect(doc.objects.t1.traits["arena.target"].stand.position).toEqual([0, 0, -5]);
    expect(Math.abs(doc.objects.t1.transform.rotation[0])).toBeGreaterThan(1);
    expect(f.calls.sends.at(-1).type).toBe("shot");
    expect(scores(doc.objects)).toEqual({ me: 1 });
    // a second hit on a fallen target changes nothing
    const before = JSON.stringify(doc.objects.t1);
    h.press({ button: 0, locked: true });
    expect(JSON.stringify(doc.objects.t1)).toBe(before);
  });

  it("standing the targets up puts them back where they stood", () => {
    doc.objects.t1.traits["arena.target"] = { down: { by: "me", at: 1 }, stand: T([0, 0, -5]) };
    doc.objects.t1.transform = { position: [0, 0, -5], rotation: [1.5, 0, 0], scale: 1 };
    x.update(scene(doc), {}, { scene: null });
    x.commands.find((c) => c.id === "reset").run(null);
    expect(doc.objects.t1.transform.rotation).toEqual([0, 0, 0]);
    expect(doc.objects.t1.traits["arena.target"].down).toBeUndefined();
  });

  it("Escape stops: disarms, gives the camera back, and clears your avatar", () => {
    x.commands.find((c) => c.id === "play").run(null);
    f.calls.arms[0].handlers.key({ key: "Escape", code: "Escape" });
    expect(f.calls.disarmed).toBe(1);
    expect(f.calls.released).toBe(1);
    expect(f.calls.loops).toHaveLength(0);
    expect(f.calls.presence.avatar).toBeUndefined();
  });

  it("under the lock a press shoots at once; without it a tap shoots and a drag looks", () => {
    x.commands.find((c) => c.id === "play").run(null);
    const shots = () => f.calls.sends.filter((m) => m.type === "shot").length;
    const h = f.calls.arms[0].handlers;
    h.press({ button: 0, locked: true });
    expect(shots()).toBe(1);
    const drag = h.press({ button: 0, locked: false, clientX: 100, clientY: 100 });
    const cam0 = f.calls.camera.length;
    drag.move({ clientX: 300, clientY: 100 });
    drag.end({});
    expect(shots()).toBe(1);
    f.calls.loops[0](1 / 60);
    const c = f.calls.camera.at(-1);
    expect(f.calls.camera.length).toBeGreaterThan(cam0);
    // turned right: looking off -Z toward +X
    expect(c.target[0] - c.position[0]).toBeGreaterThan(0.3);
  });

  it("a refused lock plays on without it; a lost one pauses until it comes back", () => {
    x.commands.find((c) => c.id === "play").run(null);
    expect(f.calls.arms[0].opts).toMatchObject({ lock: true, immersive: true });
    const h = f.calls.arms[0].handlers;
    // refused: the stage says so
    h.lockLost({ refused: true });
    expect(h.press({ button: 0 })).not.toBeNull();
    // granted later, then lost (Esc): paused, presses go to the resume button
    Object.defineProperty(document, "pointerLockElement", { value: document.body, configurable: true });
    f.calls.listen.pointerlockchange();
    Object.defineProperty(document, "pointerLockElement", { value: null, configurable: true });
    h.lockLost({ refused: false });
    expect(h.press({ button: 0 })).toBeNull();
    delete document.pointerLockElement;
  });

  it("draws other players from presence, and their shots", () => {
    f.peers.s2 = { viewer: "them", keys: { arena: { avatar: { feet: [3, 0, 3], yaw: 1 } } } };
    x.update(scene(doc), {}, { scene: scene(doc) });
    expect(f.world.children.length).toBe(1);
    expect(f.calls.labels[0].position[1]).toBeGreaterThan(2);
    x.receive("shot", { from: [0, 1, 0], to: [0, 1, -9] }, { session: "s2", viewer: "them" });
    expect(f.world.children.length).toBe(2);
    delete f.peers.s2;
    x.update(scene(doc), {}, { scene: scene(doc) });
    expect(f.world.children.length).toBe(1); // only the tracer is left
  });

  it("colours are stable per player", () => {
    expect(hueOf("a")).toBe(hueOf("a"));
    expect(hueOf("a")).not.toBe(hueOf("b"));
  });
});
