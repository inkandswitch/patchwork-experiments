// The play extension against a stand-in for the scene's api: what it asks of
// the stage when you start, walk, shoot and stop.
import { describe, it, expect, beforeEach } from "vitest";
import play, { ATMOSPHERE, hueOf, scores } from "./play.js";
import { plugins } from "./index.js";

class Obj {
  constructor() {
    this.children = [];
    this.userData = {};
    this.position = { set: (...v) => (this.pos = v) };
    this.rotation = { set: (...v) => (this.rot = v) };
    this.scale = { set: (...v) => (this.scl = v) };
    this.lookAt = (...v) => (this.looking = v);
    this.visible = true;
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
  OctahedronGeometry: disposable,
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
    overlay: () => (calls.overlay = document.createElement("div")),
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

  it("takes only its own keys: every other key goes on to the use prompt", () => {
    x.commands.find((c) => c.id === "play").run(null);
    const h = f.calls.arms[0].handlers;
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]) expect(h.key({ key: code, code })).toBe(true);
    // R too (a die's Roll, a sail's Raise): reloading is the other mouse button
    for (const code of ["KeyF", "KeyR", "KeyE", "KeyQ", "KeyT", "KeyG", "Digit1", "Tab", "Enter"]) {
      expect(h.key({ key: code, code })).toBe(false);
      // and its keyup is not play's either
      expect(h.keyup({ key: code, code })).toBe(false);
    }
    expect(h.keyup({ key: "w", code: "KeyW" })).toBe(true);
  });

  it("a level's look: the arena's sky, haze and sun; the sky alone; or the scene's own", async () => {
    const { ATMOSPHERE, LOOKS } = await import("./play.js");
    const at = (look) => {
      x.update({ d: { traits: { "arena.level": look === undefined ? {} : { look } } }, objects: {} }, {}, {});
      return x.atmosphere();
    };
    expect(at("arena")).toBe(ATMOSPHERE);
    expect(at("sky")).toEqual({ sky: ATMOSPHERE.sky });
    expect(LOOKS.sky.fog).toBeUndefined();
    expect(at(undefined)).toBe(null);
    // only the looks it has: not a name it merely inherits
    for (const bad of ["nonsense", "constructor", "toString", "__proto__", "hasOwnProperty", 3, null]) expect(at(bad), String(bad)).toBe(null);
  });

  it("a shot that hits a target knocks it down, scores it for you, and tells the others", () => {
    x.commands.find((c) => c.id === "play").run(null);
    f.api.raycast = (from, dir) => (dir[2] < -0.9 ? { id: "t1", point: [0, 1.4, -5], normal: [0, 0, 1], distance: 5 } : null);
    const h = f.calls.arms[0].handlers;
    const session = h.press({ button: 0 });
    expect(session.tap()).toBe(true);
    expect(doc.objects.t1.traits["arena.target"].down.by).toBe("me");
    expect(doc.objects.t1.traits["arena.target"].stand).toEqual({ rotation: [0, 0, 0] });
    expect(doc.objects.t1.transform.position).toEqual([0, 0, -5]);
    expect(Math.abs(doc.objects.t1.transform.rotation[0])).toBeGreaterThan(1);
    expect(f.calls.sends.at(-1).type).toBe("shot");
    expect(scores(doc.objects)).toEqual({ me: 1 });
    // of what a shot writes into the trait, who shot it is play state, described
    // as runtime (the scene's copy rule leaves it behind); how it stood is kept
    const runtime = plugins.find((p) => p.id === "arena").describes["arena.target"].runtime;
    expect(Object.keys(doc.objects.t1.traits["arena.target"]).sort()).toEqual([...runtime, "stand"].sort());
    // a second hit on a fallen target changes nothing
    const before = JSON.stringify(doc.objects.t1);
    h.press({ button: 0, locked: true });
    expect(JSON.stringify(doc.objects.t1)).toBe(before);
  });

  it("the lobby's Stand them up stands knocked-over targets back up", () => {
    doc.objects.t1.traits["arena.target"] = { down: { by: "me", at: 1 }, stand: { rotation: [0, 0, 0] } };
    doc.objects.t1.transform = { position: [0, 0, -5], rotation: [1.5, 0, 0], scale: 1 };
    x.update(scene(doc), {}, { scene: null });
    // editing has its own command for this (edit.js); playing has the button
    expect(x.commands.map((c) => c.id)).toEqual(["play"]);
    f.calls.overlay.querySelector(".arena-reset").click();
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

  it("the other mouse button reloads (no key: R is the use prompt's)", () => {
    x.commands.find((c) => c.id === "play").run(null);
    const h = f.calls.arms[0].handlers;
    const ammo = () => f.calls.overlay.querySelector(".arena-ammo")?.textContent;
    h.press({ button: 0, locked: true });
    expect(ammo()).toBe("11 / 12");
    expect(h.key({ key: "r", code: "KeyR" })).toBe(false);
    expect(ammo()).toBe("11 / 12");
    h.press({ button: 2, locked: true });
    expect(ammo()).toBe("Reloading…");
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

  it("a shot flashes at the muzzle, ahead of the eye, and the flash goes before the tracer", () => {
    x.commands.find((c) => c.id === "play").run(null);
    f.calls.loops[0](1 / 60);
    f.calls.arms[0].handlers.press({ button: 0, locked: true });
    const line = f.world.children.find((c) => c.geometry?.points);
    const flash = line.children[0];
    expect(flash.material).toBeTruthy();
    // looking down -z: the muzzle is ahead (-z), right (+x) and below the eye
    const [fx, fy, fz] = flash.pos;
    const eye = f.calls.camera.at(-1).position;
    expect(fz).toBeLessThan(eye[2] - 0.3);
    expect(fx).toBeGreaterThan(eye[0]);
    expect(fy).toBeLessThan(eye[1]);
    expect(f.calls.sends.at(-1).data.from).toEqual([fx, fy, fz]);
    const t0 = performance.now();
    const real = performance.now;
    performance.now = () => t0 + 80;
    f.calls.loops[0](1 / 60);
    expect(flash.visible).toBe(false);
    expect(f.world.children).toContain(line);
    performance.now = () => t0 + 200;
    f.calls.loops[0](1 / 60);
    performance.now = real;
    expect(f.world.children).not.toContain(line);
  });

  it("a hit shows the hit marker for a moment", () => {
    const overlay = document.createElement("div");
    f.api.overlay = () => overlay;
    x = play.create(f.api);
    x.update(scene(doc), {}, { scene: null });
    x.commands.find((c) => c.id === "play").run(null);
    f.api.raycast = (from, dir) => (dir[2] < -0.9 ? { id: "t1", point: [0, 1.4, -5], normal: [0, 0, 1], distance: 5 } : null);
    expect(overlay.querySelector(".arena-hit")).toBeNull();
    f.calls.arms.at(-1).handlers.press({ button: 0, locked: true });
    expect(overlay.querySelector(".arena-hit")).not.toBeNull();
    expect(overlay.querySelector(".arena-crosshair")).not.toBeNull();
  });

  it("a laid-out level has the arena's sky, haze and shadowing sun; any other scene keeps its own", () => {
    expect(x.atmosphere()).toBeNull();
    // a target added to a boat: a bare level trait, no look
    doc.traits = { "arena.level": {} };
    x.update({ d: doc, objects: doc.objects }, {}, { scene: null });
    expect(x.atmosphere()).toBeNull();
    doc.traits = { "arena.level": { look: "arena" } };
    x.update({ d: doc, objects: doc.objects }, {}, { scene: null });
    const a = x.atmosphere();
    expect(a).toBe(ATMOSPHERE);
    expect(a.sun.shadows).toBe(true);
    expect(a.fog.far).toBeGreaterThan(a.fog.near);
    expect(Object.keys(a.sky)).toEqual(["top", "horizon", "bottom"]);
  });

  it("colours are stable per player", () => {
    expect(hueOf("a")).toBe(hueOf("a"));
    expect(hueOf("a")).not.toBe(hueOf("b"));
  });
});
