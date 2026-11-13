// The play extension against a stand-in for the scene's api: what it asks of
// the stage when you walk in, pick up the gun, shoot and put it down.
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
  const calls = { listen: {}, entered: [], loops: [], sends: [], notices: [], held: null, put: 0 };
  const world = new Obj();
  let local = { body: { id: "orbit" } };
  let x = null;
  const api = {
    id: "arena",
    THREE,
    viewer: "me",
    repo: { find: async () => ({ doc: () => ({}) }) },
    style() {},
    overlay: () => (calls.overlay = document.createElement("div")),
    world: () => world,
    labels: () => ({ set: (items) => (calls.labels = items) }),
    listen: (target, type, fn) => (calls.listen[type] = fn),
    invalidate() {},
    notify: (t) => calls.notices.push(t),
    doc: () => doc,
    change: (fn) => fn(doc),
    raycast: () => null,
    worldOf: () => null,
    local: { get: () => local },
    body: {
      enter(id, place) {
        calls.entered.push([id, place]);
        local = { body: { id } };
        return true;
      },
      eye: () => ({ position: [0, 1.6, 0], direction: [0, 0, -1] }),
    },
    // the stage's run of a tool command: its input goes in the slot
    run({ command }) {
      const c = x.commands.find((k) => k.id === command);
      const input = c.run(null);
      if (c.tool) calls.held = input;
      return true;
    },
    loop(fn) {
      calls.loops.push(fn);
      return () => (calls.loops = calls.loops.filter((f) => f !== fn));
    },
    send: (type, data) => calls.sends.push({ type, data }),
  };
  return { api, calls, world, bind: (inst) => (x = inst), setLocal: (l) => (local = l) };
}

const T = (position, yaw = 0) => ({ position, rotation: [0, yaw, 0], scale: 1 });
const scene = (doc) => ({ d: doc, objects: doc.objects });
const ray = (dir = [0, 0, -1]) => ({ origin: [0, 1.6, 0], dir });

describe("playing", () => {
  let doc, f, x;
  beforeEach(() => {
    doc = { objects: { t1: { name: "Target", traits: { "arena.target": {} }, transform: T([0, 0, -5]) }, floor: { name: "Floor", transform: T([0, 0, 0]) }, sp: { name: "Spawn", traits: { "walk.spawn": {} }, transform: T([1, 0, 1]) } } };
    f = fakeApi(doc);
    x = f.bind(play.create(f.api));
    x.update(scene(doc), {}, { scene: null });
  });

  it("Play walks in at a spawn point (the walk body) with the gun in hand (the held tool)", () => {
    x.commands.find((c) => c.id === "play").run(null);
    expect(f.calls.entered).toEqual([["walk", "sp"]]);
    expect(f.calls.held).toBeTruthy();
    expect(x.commands.find((c) => c.id === "gun").state(null)).toMatchObject({ checked: true });
    expect(x.commands.find((c) => c.id === "play").state(null)).toBeNull();
    // walking already: Play only picks the gun up
    f.calls.held.put();
    f.calls.entered.length = 0;
    x.commands.find((c) => c.id === "play").run(null);
    expect(f.calls.entered).toEqual([]);
  });

  it("without the walk package, Play says so and still hands you the gun", () => {
    f.api.body.enter = () => false;
    x.commands.find((c) => c.id === "play").run(null);
    expect(f.calls.notices[0]).toMatch(/walk package/);
    expect(f.calls.held).toBeTruthy();
  });

  it("the gun is a tool: R is its key, and it wants nothing of the pointer", () => {
    const gun = x.commands.find((c) => c.id === "gun");
    expect(gun.tool).toEqual({ keys: [{ code: "KeyR", label: "Reload" }] });
    expect(gun.key).toBe("g");
    expect(gun.state("t1")).toBeNull();
  });

  it("counts targets only where there are some: a level without any (an imported map) shows no count, in the lobby or holding the gun", () => {
    expect(f.calls.overlay.textContent).toMatch(/1 of 1 targets standing/);
    const bare = { objects: { floor: { name: "Floor", transform: T([0, 0, 0]) } } };
    const g = fakeApi(bare);
    const y = g.bind(play.create(g.api));
    y.update(scene(bare), {}, { scene: null });
    expect(g.calls.overlay.textContent).toMatch(/Play/);
    expect(g.calls.overlay.textContent).not.toMatch(/target|standing/i);
    y.commands.find((c) => c.id === "play").run(null);
    expect(g.calls.overlay.textContent).not.toMatch(/standing/);
    expect(g.calls.overlay.textContent).toMatch(/Esc put the gun down/);
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
    const gun = f.calls.held;
    const session = gun.press({ button: 0, locked: true, ray: ray() });
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
    gun.press({ button: 0, locked: true, ray: ray() });
    expect(JSON.stringify(doc.objects.t1)).toBe(before);
  });

  it("the lobby's Stand them up stands knocked-over targets back up", () => {
    doc.objects.t1.traits["arena.target"] = { down: { by: "me", at: 1 }, stand: { rotation: [0, 0, 0] } };
    doc.objects.t1.transform = { position: [0, 0, -5], rotation: [1.5, 0, 0], scale: 1 };
    x.update(scene(doc), {}, { scene: null });
    // the button, and the menu's Stand targets up (reset.js)
    expect(x.commands.map((c) => c.id)).toEqual(["play", "gun", "reset"]);
    f.calls.overlay.querySelector(".arena-reset").click();
    expect(doc.objects.t1.transform.rotation).toEqual([0, 0, 0]);
    expect(doc.objects.t1.traits["arena.target"].down).toBeUndefined();
  });

  it("put down (Escape, the stage's): back to the lobby; walking goes on", () => {
    x.commands.find((c) => c.id === "play").run(null);
    f.calls.held.put();
    expect(x.commands.find((c) => c.id === "gun").state(null)).toMatchObject({ checked: false });
    expect(f.calls.overlay.querySelector(".arena-play").textContent).toMatch(/Pick up the gun/);
  });

  it("under the lock a press shoots at once; without it the press is the body's (a drag looks) and the tap's click shoots", () => {
    x.commands.find((c) => c.id === "play").run(null);
    const shots = () => f.calls.sends.filter((m) => m.type === "shot").length;
    const gun = f.calls.held;
    gun.press({ button: 0, locked: true, ray: ray() });
    expect(shots()).toBe(1);
    const real = performance.now;
    const t0 = real.call(performance);
    performance.now = () => t0 + 500;
    expect(gun.press({ button: 0, locked: false, ray: ray() })).toBeNull();
    expect(shots()).toBe(1);
    expect(gun.click({ ray: ray() })).toBe(true);
    performance.now = real;
    expect(shots()).toBe(2);
  });

  it("the other mouse button reloads, and so does R (the gun's declared key); the menu is the gun's while it's held", () => {
    x.commands.find((c) => c.id === "play").run(null);
    const gun = f.calls.held;
    const ammo = () => f.calls.overlay.querySelector(".arena-ammo")?.textContent;
    gun.press({ button: 0, locked: true, ray: ray() });
    expect(ammo()).toBe("11 / 12");
    expect(gun.press({ button: 2, locked: true })).toBeTruthy();
    expect(ammo()).toBe("Reloading…");
    expect(gun.key({ code: "KeyR" })).toBe(true);
    expect(gun.key({ code: "KeyF" })).toBe(false);
    expect(gun.menu()).toBe(true);
  });

  it("draws the others' shots", () => {
    x.receive("shot", { from: [0, 1, 0], to: [0, 1, -9] }, { session: "s2", viewer: "them" });
    expect(f.world.children.length).toBe(1);
  });

  it("a shot flashes at the muzzle, ahead of the eye, and the flash goes before the tracer", () => {
    x.commands.find((c) => c.id === "play").run(null);
    f.calls.held.press({ button: 0, locked: true, ray: ray() });
    const line = f.world.children.find((c) => c.geometry?.points);
    const flash = line.children[0];
    expect(flash.material).toBeTruthy();
    // looking down -z: the muzzle is ahead (-z), right (+x) and below the eye
    const [fx, fy, fz] = flash.pos;
    const eye = ray().origin;
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
    x.commands.find((c) => c.id === "play").run(null);
    f.api.raycast = (from, dir) => (dir[2] < -0.9 ? { id: "t1", point: [0, 1.4, -5], normal: [0, 0, 1], distance: 5 } : null);
    expect(f.calls.overlay.querySelector(".arena-hit")).toBeNull();
    f.calls.held.press({ button: 0, locked: true, ray: ray() });
    expect(f.calls.overlay.querySelector(".arena-hit")).not.toBeNull();
    expect(f.calls.overlay.querySelector(".arena-crosshair")).not.toBeNull();
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
