// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, posesBy, settle } from "../test/stage-harness.js";
import carry from "./carry.js";
import touch from "../parts/touch.js";
import { applyMatrix, composeMatrix, multiplyMatrices } from "../shared/transform.js";

const BOX = { min: [-0.1, 0, -0.1], max: [0.1, 0.1, 0.1] };
const down = (x, z) => ({ origin: [x, 10, z], dir: [0, -1, 0] });
const CARRY_EXT = { meta: { id: "scene.carry", traits: ["scene.carry"] }, module: carry };
/** An object that can be carried: it has the trait. */
const piece = (extra = {}) => object({ traits: { "scene.carry": {} }, ...extra });

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  try {
    localStorage.clear();
  } catch {
    // no storage
  }
});

/**
 * Mount the hand (plus any fakes) and stub what needs WebGL: no hits, the
 * ground under every ray, content boxes for every object, and pose holds
 * recorded.
 */
async function mount({ doc = {}, before = [], extensions = [], content = {} } = {}) {
  const fake = {};
  s = await mountStage({ editor: true, natives: true, 
    extensions: [...before, CARRY_EXT, posesBy(fake), ...extensions],
    doc: { ...doc, objects: { a: piece({ name: "A" }), ...(doc.objects ?? {}) } },
  });
  const api = s.api("scene.carry");
  const holds = [];
  const releases = [];
  const stub = Object.assign(fake, {
    holds,
    releases,
    surfaces: [], // [{ id, top, min: [x, z], max: [x, z] }]: what a downward ray meets
  });
  api.raycast = (origin, dir, { skip } = {}) => {
    if (dir[1] >= 0) return null;
    let best = null;
    for (const f of stub.surfaces) {
      if (skip?.(f.id)) continue;
      const t = (origin[1] - f.top) / -dir[1];
      const x = origin[0] + dir[0] * t;
      const z = origin[2] + dir[2] * t;
      if (x < f.min[0] || x > f.max[0] || z < f.min[1] || z > f.max[1]) continue;
      if (!best || f.top > best.point[1]) best = { id: f.id, point: [x, f.top, z], normal: [0, 1, 0], distance: t };
    }
    return best;
  };
  api.content = (id) => ({ loaded: true, box: BOX, extras: content[id] ?? { connectors: [], snapRadius: null }, stats: null, root: null });
  api.box = (id) => ({ min: [-1, 0, -1], max: [1, 1, 1] });
  // scene.poses, as holds.js: a peer's hold that ranks ahead (`stub.heldBy`) refuses it, and so
  // does `stub.refuse`, something here that holds it ahead of the carry
  stub.heldBy = () => null;
  stub.hold = (id, t) => (holds.push([id, t]), !stub.refuse && stub.heldBy(id) == null);
  stub.release = (id, opts) => releases.push([id, opts ?? {}]);
  // frame loops, run by hand: stub.tick(dt)
  const loops = new Set();
  api.loop = (fn) => (loops.add(fn), () => loops.delete(fn));
  stub.loops = loops;
  stub.tick = (dt = 0.05, n = 1) => {
    for (let i = 0; i < n; i++) for (const fn of [...loops]) fn(dt);
  };
  return { api, x: () => s.instance("scene.carry"), stub };
}

// as the stage offers it: the holder is the hit's nearest link with the trait (here, the hit itself)
const press = (id, extra = {}) => ({ type: "press", button: 0, x: 10, y: 10, hit: id ? { id, point: [0, 0.1, 0], distance: 1 } : null, holder: id ?? null, ...extra });
const move = (x, z, extra = {}) => ({ type: "move", ray: down(x, z), alt: false, ...extra });
const command = (id) => s.instance("scene.carry").commands.find((c) => c.id === id);
const stateOf = (id, target = null) => command(id).state(target, { scene: s.api("scene.carry").scene(), view: s.api("scene.carry").view.get() });
const transformOf = (id) => JSON.parse(JSON.stringify(s.doc().objects[id].transform));

describe("scene.carry input", () => {
  // (the trait, a lock, a veto, a peer's hold and the holder over the hit: H11, below)
  it("claims a press on its holder only: not a group, not nothing, not a secondary button, not with a pointing tool held (a tool that only looks leaves it be)", async () => {
    const { x } = await mount({ doc: { objects: { g: piece({ kind: "group" }) } } });
    expect(x().input.press(press("a"))).toBeTruthy();
    expect(x().input.press(press("g"))).toBe(null);
    expect(x().input.press(press(null))).toBe(null);
    expect(x().input.press(press("a", { button: 2 }))).toBe(null);
    s.local.swap((m) => ({ ...m, held: [{ ext: "scene.xray", command: "xray", pointer: false }] }));
    const session = x().input.press(press("a"));
    expect(session).toBeTruthy();
    session.cancel();
    s.local.swap((m) => ({ ...m, held: [{ ext: "scene.measure", command: "measure", pointer: true }, { ext: "scene.xray", command: "xray", pointer: false }] }));
    expect(x().input.press(press("a"))).toBe(null);
  });

  it("shows a grab cursor over what it could pick up", async () => {
    const { x } = await mount({ doc: { objects: { l: piece({ locked: true }) } } });
    expect(x().input.cursor({ hit: { id: "a" }, holder: "a" })).toBe("grab");
    expect(x().input.cursor({ hit: { id: "l" }, holder: "l" })).toBe(null);
    expect(x().input.cursor({ hit: null, holder: null })).toBe(null);
    const session = x().input.press(press("a"));
    expect(session.cursor).toBe("grabbing");
  });

  it("a press that doesn't move is a tap it doesn't take (the click goes on), and holds nothing", async () => {
    const { x, stub } = await mount();
    const session = x().input.press(press("a"));
    expect(session.tap(press("a"))).toBe(false);
    session.cancel();
    expect(stub.holds).toEqual([]);
    expect(stub.releases).toEqual([]);
  });

  it("carry(id) from another extension carries only what has the trait", async () => {
    const { x } = await mount({ doc: { objects: { plain: object() } } });
    expect(x().carry("plain", press("plain"))).toBe(null);
    const session = x().carry("a", press("a"));
    expect(session).toBeTruthy();
    session.cancel();
  });
});

describe("scene.carry carrying", () => {
  it("lifts on the first move, follows the pointer floating, and writes only the final transform", async () => {
    const { x, stub } = await mount({ doc: { objects: { a: piece({ name: "A", color: "#ff0000" }) } } });
    const session = x().input.press(press("a"));
    session.move(move(1, 2));
    expect(stub.holds.length).toBe(1);
    const [id, held] = stub.holds[0];
    expect(id).toBe("a");
    expect(held.position[0]).toBeCloseTo(1);
    expect(held.position[2]).toBeCloseTo(2);
    expect(held.position[1]).toBeGreaterThan(0); // floating
    expect(transformOf("a").position).toEqual([0, 0, 0]); // nothing written yet
    session.move(move(2, 2));
    session.end(move(2, 2));
    await settle();
    expect(transformOf("a").position.map((v) => +v.toFixed(9))).toEqual([2, 0, 2]);
    expect(s.doc().objects.a.color).toBe("#ff0000"); // fields, not a replaced object
    expect(stub.releases).toEqual([["a", { landed: true }]]);
  });

  it("never lands on itself or what's attached to it", async () => {
    const { x, stub } = await mount({ doc: { objects: { kid: piece({ parent: "a" }) } } });
    stub.surfaces.push({ id: "a", top: 0.5, min: [-9, -9], max: [9, 9] }, { id: "kid", top: 0.7, min: [-9, -9], max: [9, 9] });
    const session = x().input.press(press("a"));
    session.move(move(1, 1));
    session.end(move(1, 1));
    await settle();
    expect(transformOf("a").position[1]).toBeCloseTo(0);
  });

  it("snaps to another object's connector, turning to its yaw; Alt and the pref place freely", async () => {
    const content = { board: { connectors: [{ position: [1, 0, 0], yaw: Math.PI / 2, tags: [] }], snapRadius: 0.5 } };
    const { x } = await mount({ doc: { objects: { board: piece({ name: "Board" }) } }, content });
    let session = x().input.press(press("a"));
    session.move(move(1.2, 0.1));
    session.end(move(1.2, 0.1));
    await settle();
    let t = transformOf("a");
    expect(t.position[0]).toBeCloseTo(1);
    expect(t.position[2]).toBeCloseTo(0);
    expect(t.rotation[1]).toBeCloseTo(Math.PI / 2);

    s.change((d) => (d.objects.a.transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }));
    session = x().input.press(press("a"));
    session.move(move(1.2, 0.1, { alt: true }));
    session.end(move(1.2, 0.1, { alt: true }));
    await settle();
    expect(transformOf("a").position[0]).toBeCloseTo(1.2);

    s.change((d) => (d.objects.a.transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }));
    s.api("scene.carry").use("prefs").set("snap", false);
    session = x().input.press(press("a"));
    session.move(move(1.2, 0.1));
    session.end(move(1.2, 0.1));
    await settle();
    expect(transformOf("a").position[0]).toBeCloseTo(1.2);
  });

  it("Q / E turn it 45° and F turns it over while carried", async () => {
    const { x } = await mount({ doc: {} });
    let session = x().input.press(press("a"));
    expect(session.key({ key: "q" })).toBe(false); // not lifted yet
    session.move(move(1, 1));
    expect(session.key({ key: "q" })).toBe(true);
    expect(session.key({ key: "Q" })).toBe(true);
    expect(session.key({ key: "e" })).toBe(true);
    session.end(move(1, 1));
    await settle();
    expect(transformOf("a").rotation[1]).toBeCloseTo(Math.PI / 4);

    session = x().input.press(press("a"));
    session.move(move(1, 1));
    expect(session.key({ key: "f" })).toBe(true);
    session.end(move(1, 1));
    await settle();
    const m = composeMatrix(transformOf("a"));
    expect(m[5]).toBeCloseTo(-1); // upside down
    expect(transformOf("a").position[1]).toBeCloseTo(0.1); // its box is below its origin now: lifted to rest on the ground
  });

  it("shows F turning it over in the air, though where it lands is already turned", async () => {
    const { x, stub } = await mount({ doc: {} });
    const session = x().input.press(press("a"));
    session.move(move(1, 1));
    const before = stub.holds.at(-1)[1];
    session.key({ key: "f" });
    // the first pose held is the turn's start: not yet over
    expect(composeMatrix(stub.holds.at(-1)[1])[5]).toBeCloseTo(composeMatrix(before)[5]);
    expect(stub.loops.size).toBe(1);
    stub.tick(0.15);
    const mid = stub.holds.at(-1)[1];
    expect(Math.abs(composeMatrix(mid)[5])).toBeLessThan(0.1); // on its edge
    expect(mid.position[1]).toBeGreaterThan(before.position[1]); // and up in the air
    stub.tick(0.2);
    expect(composeMatrix(stub.holds.at(-1)[1])[5]).toBeCloseTo(-1);
    expect(stub.loops.size).toBe(0); // done turning
    session.end(move(1, 1));
    await settle();
    expect(composeMatrix(transformOf("a"))[5]).toBeCloseTo(-1);
  });

  it("other keys go on down the chain", async () => {
    const { x } = await mount({ doc: {} });
    const session = x().input.press(press("a"));
    session.move(move(1, 1));
    expect(session.key({ key: "h" })).toBe(false);
    expect(session.keyup({ key: "q" })).toBe(false);
  });

  it("asks every running landing rule, and turns a face-down piece up only where one says so", async () => {
    const asked = [];
    const rules = {
      meta: { id: "t.rules" },
      module: { create: () => ({ landing: (id, p, hitId) => (asked.push({ id, p, hitId }), p[0] > 2 ? { faceUp: true } : null) }) },
    };
    const { x } = await mount({
      doc: { objects: { a: piece({ transform: { position: [0, 0.1, 0], rotation: [0, 0, Math.PI], scale: 1 } }) } },
      extensions: [rules],
    });
    let session = x().input.press(press("a"));
    session.move(move(3, 0));
    session.end(move(3, 0));
    await settle();
    expect(composeMatrix(transformOf("a"))[5]).toBeCloseTo(1); // face up over there
    expect(asked[0].id).toBe("a");
    expect(asked.some((q) => q.hitId === null)).toBe(true);

    session = x().input.press(press("a"));
    session.move(move(1, 0));
    session.end(move(1, 0));
    await settle();
    expect(composeMatrix(transformOf("a"))[5]).toBeCloseTo(1); // picked up face up: nothing turns it
  });

  it("writes the transform under its doc parent", async () => {
    const { x } = await mount({
      doc: { objects: { p: piece({ transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: 1 } }), a: piece({ parent: "p" }) } },
    });
    // grabbed at its middle (a grab off-centre keeps that offset)
    const session = x().input.press(press("a", { hit: { id: "a", point: [5, 0.1, 0], distance: 1 } }));
    session.move(move(6, 1));
    session.end(move(6, 1));
    await settle();
    expect(transformOf("a").position.map((v) => +v.toFixed(9))).toEqual([1, 0, 1]);
  });

  it("draws the landing ring on its world layer, accent when snapped, and hides it after", async () => {
    const content = { board: { connectors: [{ position: [1, 0, 0], yaw: null, tags: [] }], snapRadius: 0.5 } };
    const { api, x } = await mount({ doc: { objects: { board: object() } }, content });
    const layers = [];
    const world = api.world;
    api.world = (o) => {
      const g = world(o);
      layers.push([o, g]);
      return g;
    };
    const theme = s.local.get().theme;
    const tint = (rgb, c) => c.clone().setRGB(rgb[0], rgb[1], rgb[2], "srgb");
    const session = x().input.press(press("a"));
    session.move(move(3, 3));
    expect(layers.length).toBe(1);
    expect(layers[0][0]).toEqual({ onTop: true });
    const ring = layers[0][1].children[0];
    expect(ring.visible).toBe(true);
    expect(ring.userData.noPick).toBe(true);
    expect(ring.material.color.equals(tint(theme.muted, ring.material.color))).toBe(true);
    expect(ring.position.x).toBeCloseTo(3);
    session.move(move(1.1, 0));
    expect(ring.position.x).toBeCloseTo(1);
    expect(ring.material.color.equals(tint(theme.accent, ring.material.color))).toBe(true);
    session.end(move(1.1, 0));
    expect(ring.visible).toBe(false);
  });

  it("is a carry other extensions can start, through the router", async () => {
    const grabber = {
      meta: { id: "t.grab" },
      module: {
        create: (api) => ({
          input: {
            press: (ev) => api.collect("carry").find((c) => c.id === "scene.carry")?.value("a", ev) ?? null,
          },
        }),
      },
    };
    const { api, stub } = await mount({ before: [grabber] });
    s.debug.viewport.ray = (x, y) => down(x / 10, y / 10); // port px → a spot on the table
    s.pointer("pointerdown", 10, 10);
    s.pointer("pointermove", 30, 10);
    s.pointer("pointermove", 40, 20);
    expect(stub.holds.length).toBe(2);
    s.key("q");
    expect(stub.holds.length).toBe(3); // turned, and held again
    s.pointer("pointerup", 40, 20);
    await settle();
    const t = transformOf("a");
    expect(t.position.map((v) => +v.toFixed(9))).toEqual([4, 0, 2]);
    expect(t.rotation[1]).toBeCloseTo(Math.PI / 4);
    expect(stub.releases).toEqual([["a", { landed: true }]]);
  });

  it("Escape through the router puts a carried object back", async () => {
    const grabber = {
      meta: { id: "t.grab" },
      module: { create: (api) => ({ input: { press: (ev) => api.collect("carry")[0]?.value("a", ev) ?? null } }) },
    };
    const { api, stub } = await mount({ before: [grabber] });
    s.debug.viewport.ray = (x, y) => down(x / 10, y / 10);
    s.pointer("pointerdown", 10, 10);
    s.pointer("pointermove", 30, 10);
    s.key("Escape", { code: "Escape" });
    s.pointer("pointerup", 30, 10);
    await settle();
    expect(transformOf("a").position).toEqual([0, 0, 0]);
    expect(stub.releases).toEqual([["a", {}]]);
  });
});

describe("scene.carry by the touch pad (scene.touch: the pad is a keyboard)", () => {
  const TOUCH = { meta: { id: "scene.touch" }, module: touch };
  const grabber = {
    meta: { id: "t.grab" },
    module: { create: (api) => ({ input: { press: (ev) => api.collect("carry").find((c) => c.id === "scene.carry")?.value("a", ev) ?? null } }) },
  };
  const content = { board: { connectors: [{ position: [1, 0, 0], yaw: Math.PI / 2, tags: [] }], snapRadius: 0.5 } };
  const finger = (type, x, y) => s.pointer(type, x, y, { pointerType: "touch", pointerId: 1 });
  const pad = (type, label) => {
    const el = [...s.root.querySelectorAll(".touch-group[data-from=gesture] .touch-key")].find((b) => b.textContent === label);
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 2, pointerType: "touch" }));
  };
  // Place freely (Alt) held on the pad: none, from before the lift, from after it. Without the router's
  // modifier keys down (a keyboard's, whoever claims them) every touch move says alt is up, so it snaps;
  // before the lift the carry declines Alt, and its flag stands all the same.
  for (const [when, free] of [["never", false], ["before the lift", true], ["after the lift", true]]) {
    it(`a finger carries it; Place freely on the pad (${when}) places it freely`, async () => {
      const { api } = await mount({ before: [grabber], extensions: [TOUCH], doc: { objects: { board: piece({ name: "Board" }) } }, content });
      s.debug.viewport.ray = (x, y) => down(x / 100, y / 100);
      finger("pointerdown", 10, 10);
      await settle();
      // the carry's keys show while it's open: under the gesture, in its declared order
      expect([...s.root.querySelectorAll(".touch-group[data-from=gesture] .touch-key")].map((b) => b.textContent)).toEqual(["Turn left", "Turn right", "Turn over", "Place freely"]);
      if (when === "before the lift") pad("pointerdown", "Place freely");
      finger("pointermove", 60, 10);
      if (when === "after the lift") pad("pointerdown", "Place freely");
      finger("pointermove", 120, 10);
      finger("pointerup", 120, 10);
      if (when !== "never") pad("pointerup", "Place freely");
      await settle();
      expect([when, +transformOf("a").position[0].toFixed(6)]).toEqual([when, free ? 1.2 : 1]);
      // closed: its controls go
      expect(s.root.querySelector(".touch-group[data-from=gesture]")).toBe(null);
    });
  }
});

describe("scene.carry grab offset", () => {
  it("keeps where it was grabbed, in plan, so it doesn't jump on pickup", async () => {
    const { x } = await mount({ doc: {} });
    const session = x().input.press(press("a", { hit: { id: "a", point: [0.05, 0.1, -0.05], distance: 1 } }));
    session.move(move(1, 1));
    session.end(move(1, 1));
    await settle();
    expect(transformOf("a").position.map((v) => +v.toFixed(9))).toEqual([0.95, 0, 1.05]);
  });
});

describe("Flip: turning a piece over where it lies", () => {
  const lying = { position: [0.5, 0, 0.2], rotation: [0, 0, 0], scale: 1 };
  const run = () => s.api("scene.carry").run({ ext: "scene.carry", command: "flip", target: "a" });

  it("rises, turns over in the air and comes down where it was; only the landing is written", async () => {
    const { stub } = await mount({ doc: { objects: { a: piece({ transform: lying }) } } });
    expect(run()).toBe(true);
    expect(stateOf("flip", "a")).toBe(null); // not again while it's turning
    const writes = [];
    s.handle.on("change", () => writes.push(transformOf("a")));
    stub.tick(0.15);
    const mid = stub.holds.at(-1)[1];
    expect(mid.position[1]).toBeGreaterThan(0.1); // up in the air
    expect(writes).toEqual([]);
    stub.tick(0.05, 4);
    await settle();
    expect(stub.loops.size).toBe(0);
    expect(stub.releases.at(-1)).toEqual(["a", { landed: true }]);
    const m = composeMatrix(transformOf("a"));
    expect(m[5]).toBeCloseTo(-1); // face down
    expect(transformOf("a").position[0]).toBeCloseTo(0.5);
    expect(transformOf("a").position[2]).toBeCloseTo(0.2);
    expect(transformOf("a").position[1]).toBeCloseTo(0.1); // its box is below its origin now: resting on the ground
    expect(stateOf("flip", "a")).not.toBe(null);
  });

  it("refused by something here that holds it ahead, at the start or partway: nothing is written", async () => {
    for (const at of [0, 1]) {
      const { stub } = await mount({ doc: { objects: { a: piece({ transform: lying }) } } });
      stub.refuse = at === 0;
      run();
      for (let i = 1; i <= 3; i++) {
        if (i === at) stub.refuse = true;
        stub.tick(0.05);
      }
      stub.tick(0.05, 4);
      await settle();
      expect(stub.loops.size).toBe(0);
      expect(stub.releases.at(-1)).toEqual(["a", {}]);
      expect(transformOf("a")).toEqual(lying);
      s.unmount();
      s = null;
    }
  });

  it("gives way to a peer who picks it up meanwhile: nothing is written", async () => {
    const { api, stub } = await mount({ doc: { objects: { a: piece({ transform: lying }) } } });
    run();
    stub.tick(0.1);
    stub.heldBy = () => "peer";
    stub.tick(0.1);
    await settle();
    expect(stub.loops.size).toBe(0);
    expect(stub.releases.at(-1)).toEqual(["a", {}]);
    expect(transformOf("a")).toEqual(lying);
  });

  it("F over a piece flips it at a table, where nothing else answers F", async () => {
    const { default: keys } = await import("../parts/keys.js");
    const { stub } = await mount({ doc: { objects: { a: piece({ transform: lying }) } }, before: [{ meta: { id: "scene.keys" }, module: keys }] });
    s.local.swap((m) => ({ ...m, hovered: "a" }));
    s.key("f");
    stub.tick(0.05, 8);
    await settle();
    expect(composeMatrix(transformOf("a"))[5]).toBeCloseTo(-1);
  });
});

describe("scene.carry on something that moves: in its parent's frame", () => {
  // a table turned a quarter and moving: what's on it is carried on it
  const tableAt = (x, yaw = Math.PI / 2, roll = 0) => composeMatrix({ position: [x, 0, 0], rotation: [roll, yaw, 0] });
  const r6 = (a) => a.map((v) => Math.round(v * 1e6) / 1e6 + 0);

  async function onTable() {
    const m = await mount({ doc: { objects: { p: piece({ transform: { position: [5, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 1 } }), a: piece({ parent: "p" }) } } });
    const world = { p: tableAt(5) };
    m.api.worldOf = (id) => (id === "p" ? world.p : id === "a" ? multiplyMatrices(world.p, composeMatrix(s.doc().objects.a.transform)) : null);
    return { ...m, world };
  }
  // the pointer straight down onto a point given in the table's frame, as it is now
  const onto = (world, local) => {
    const w = applyMatrix(world.p, local);
    return { type: "move", ray: { origin: [w[0], w[1] + 10, w[2]], dir: [0, -1, 0] }, alt: false };
  };

  it("keeps its pose on the table as the table moves, and lands where the pointer is on the table as it is now", async () => {
    const { x, stub, world } = await onTable();
    const grab = applyMatrix(world.p, [0, 0.05, 0]);
    const session = x().input.press(press("a", { hit: { id: "a", point: grab, distance: 1 } }));
    session.move(onto(world, [0.3, 0, 0.2]));
    const held = stub.holds.at(-1)[1];
    expect(r6([held.position[0], held.position[2]])).toEqual([0.3, 0.2]);
    expect(held.position[1]).toBeGreaterThan(0); // floating
    expect(r6(held.rotation)).toEqual([0, 0, 0]); // square to the table, not to the world
    // the table sails on and turns: nothing about the card's pose on it changes
    world.p = tableAt(9, Math.PI / 2 + 0.3);
    stub.tick(0.05);
    expect(stub.holds.at(-1)[1]).toEqual(held);
    session.move(onto(world, [-0.1, 0, 0.4]));
    session.end(onto(world, [-0.1, 0, 0.4]));
    await settle();
    const t = transformOf("a");
    expect(r6(t.position)).toEqual([-0.1, 0, 0.4]);
    expect(r6(t.rotation)).toEqual([0, 0, 0]);
  });

  it("on a heeled table it goes down square to the table, along the table's down", async () => {
    const { x, world } = await onTable();
    world.p = tableAt(5, Math.PI / 2, 0.15); // heeled
    const session = x().input.press(press("a", { hit: { id: "a", point: applyMatrix(world.p, [0, 0.05, 0]), distance: 1 } }));
    session.move(onto(world, [0.2, 0, -0.1]));
    session.end(onto(world, [0.2, 0, -0.1]));
    await settle();
    const t = transformOf("a");
    expect(r6(t.position)).toEqual([0.2, 0, -0.1]);
    expect(r6(t.rotation)).toEqual([0, 0, 0]);
  });

  it("snaps to connectors on the table as they are on it", async () => {
    const content = { board: { connectors: [{ position: [0.5, 0, 0], yaw: 0, tags: [] }], snapRadius: 0.2 } };
    const m = await mount({
      doc: { objects: { p: object(), board: piece({ parent: "p" }), a: piece({ parent: "p" }) } },
      content,
    });
    const world = { p: tableAt(5) };
    m.api.worldOf = (id) => (id === "p" ? world.p : ["a", "board"].includes(id) ? multiplyMatrices(world.p, composeMatrix(s.doc().objects[id].transform)) : null);
    const session = m.x().input.press(press("a", { hit: { id: "a", point: applyMatrix(world.p, [0, 0.05, 0]), distance: 1 } }));
    // the table moves after the pickup: the slot is where it is on the table
    world.p = tableAt(6, Math.PI / 2 + 0.5);
    session.move(onto(world, [0.45, 0, 0.05]));
    session.end(onto(world, [0.45, 0, 0.05]));
    await settle();
    expect(r6(transformOf("a").position)).toEqual([0.5, 0, 0]);
  });

  it("draws the ring on the table, following it every frame", async () => {
    const { api, x, stub, world } = await onTable();
    const layers = [];
    const w0 = api.world;
    api.world = (o) => {
      const g = w0(o);
      layers.push(g);
      return g;
    };
    const session = x().input.press(press("a", { hit: { id: "a", point: applyMatrix(world.p, [0, 0.05, 0]), distance: 1 } }));
    session.move(onto(world, [0.3, 0, 0]));
    const ring = layers[0].children[0];
    const spot = (m) => r6([...applyMatrix(m, [0.3, 0.0005, 0])].map((v) => +v.toFixed(4)));
    expect(r6(ring.position.toArray().map((v) => +v.toFixed(4)))).toEqual(spot(world.p));
    world.p = tableAt(7);
    stub.tick(0.05);
    expect(r6(ring.position.toArray().map((v) => +v.toFixed(4)))).toEqual(spot(world.p));
    session.end(onto(world, [0.3, 0, 0]));
    expect(stub.loops.size).toBe(0);
  });

  it("Flip turns it over on the table: lands where it lay on it, the table's way up", async () => {
    const { x, stub, world } = await onTable();
    world.p = tableAt(5, Math.PI / 2, 0.15);
    s.api("scene.carry").run({ ext: "scene.carry", command: "flip", target: "a" });
    world.p = tableAt(8, Math.PI / 2 + 0.2, 0.1); // it moves while the card turns
    stub.tick(0.05, 8);
    await settle();
    const t = transformOf("a");
    expect(composeMatrix(t)[5]).toBeCloseTo(-1); // face down on the table
    expect(r6([t.position[0], t.position[2]])).toEqual([0, 0]);
    expect(t.position[1]).toBeCloseTo(0.1); // BOX turned over: resting on the table's top (y 0 in its frame)
  });
});

describe("scene.carry: what another extension says may not be carried", () => {
  it("a carryable rule returning false vetoes picking it up and flipping it; anything else allows", async () => {
    const veto = { meta: { id: "t.veto" }, module: { create: () => ({ carryable: (id) => (id === "a" ? false : undefined) }) } };
    const { x } = await mount({ doc: { objects: { b: piece() } }, extensions: [veto] });
    expect(x().input.press(press("a"))).toBe(null);
    expect(x().input.cursor({ hit: { id: "a" }, holder: "a" })).toBe(null);
    expect(stateOf("flip", "a")).toBe(null);
    expect(x().input.press(press("b", { hit: { id: "b", point: [0, 0.1, 0], distance: 1 } }))).not.toBe(null);
    expect(stateOf("flip", "b")).not.toBe(null);
  });
});

describe("H11: carry only with scene.carry, no veto, nobody holding it, in its own doc's stage", () => {
  // Through the stage's own input chain: a press on the hit object, a drag, a
  // release. The chain is l0 attached to l1 attached to l2; the hit is at
  // depth 0, 1 or 2 of it (l2, l1 or l0), every link of it with or without
  // the trait and locked or not, a veto on no link or on each, a peer holding
  // no link or each. What's carried must be the nearest link with the trait,
  // and only when it isn't locked, vetoed or held. (Focus: one stage until
  // links are open, so it's the scene's own in every case.)
  it("every case", async () => {
    const vetoed = new Set();
    const veto = { meta: { id: "t.veto" }, module: { create: () => ({ carryable: (id) => (vetoed.has(id) ? false : undefined) }) } };
    const { api, stub } = await mount({
      doc: { objects: { anchor: piece(), l2: object(), l1: object({ parent: "l2" }), l0: object({ parent: "l1" }) } },
      extensions: [veto],
    });
    let hit = null;
    s.debug.viewport.pick = () => (hit ? { id: hit, point: [0, 0.1, 0], distance: 1 } : null);
    s.debug.viewport.ray = (x, y) => down(x / 100, y / 100);
    let held = null;
    stub.heldBy = (id) => (id === held ? "peer" : null);
    const chains = [["l2"], ["l1", "l2"], ["l0", "l1", "l2"]];
    let cases = 0;
    for (const chain of chains) {
      for (let links = 0; links < 1 << (2 * chain.length); links++) {
        const traitOn = (i) => !!(links & (1 << (2 * i)));
        const lockedOn = (i) => !!(links & (1 << (2 * i + 1)));
        s.change((d) => {
          for (const id of ["l0", "l1", "l2"]) {
            const i = chain.indexOf(id);
            if (i >= 0 && traitOn(i)) d.objects[id].traits = { "scene.carry": {} };
            else d.objects[id].traits = {};
            d.objects[id].locked = i >= 0 && lockedOn(i);
          }
        });
        await settle();
        for (const v of [null, ...chain]) {
          for (const h of [null, ...chain]) {
            vetoed.clear();
            if (v) vetoed.add(v);
            held = h;
            stub.holds.length = 0;
            stub.releases.length = 0;
            hit = chain[0];
            s.pointer("pointerdown", 10, 10);
            s.pointer("pointermove", 40, 40);
            s.pointer("pointerup", 40, 40, { buttons: 0 });
            const at = chain.findIndex((_, i) => traitOn(i));
            const want = at >= 0 && !lockedOn(at) && chain[at] !== v && chain[at] !== h ? chain[at] : null;
            const got = [...new Set(stub.holds.map(([id]) => id))];
            expect([chain, links, v, h, got]).toEqual([chain, links, v, h, want ? [want] : []]);
            if (want) expect(stub.releases.at(-1)).toEqual([want, { landed: true }]);
            cases++;
          }
        }
      }
    }
    expect(cases).toBe(4 * 2 * 2 + 16 * 3 * 3 + 64 * 4 * 4);
  }, 60_000);
});

describe("How a carry ends: `ended` and `landed`", () => {
  // An ear: every running extension's `landed(id, on)`, with the doc's
  // transform as it is when it's told (so "after the write" is checked).
  const ear = (calls) => ({
    meta: { id: "t.ear" },
    module: { create: (api) => ({ landed: (id, on) => calls.push({ id, on, at: JSON.parse(JSON.stringify(api.doc().objects[id]?.transform ?? null)) }) }) },
  });
  /** Has the promise settled, and with what (a microtask turn later)? */
  const now = async (p) => {
    let v = "pending";
    p.then((x) => (v = x));
    await settle();
    return v;
  };

  // lifted {no, yes} × end path → (how, landed calls, writes). The block "b"
  // is the surface at (2, 2): a put there rests on it, so `on` is "b".
  const PATHS = {
    "end with a landing": (session) => session.end(move(2, 2)),
    // no ray from the pointer, ever: lifted, but it never had a landing
    "end with none": (session) => session.end({ type: "up" }),
    "cancel (Escape)": (session) => session.cancel(),
    "a peer took it first": (session, { stub }) => {
      stub.heldBy = () => "peer";
      session.end(move(2, 2));
    },
    // (something here holds it ahead: refused at the next hold, which is a move's; never lifted, there is none)
    "hold refused": (session, { stub }, lifted) => {
      stub.refuse = true;
      if (lifted) session.move(move(2.1, 2));
      session.end(move(2, 2));
    },
    "removed meanwhile": (session) => {
      s.change((d) => delete d.objects.a);
      session.end(move(2, 2));
    },
    // A peer's hold that ranks ahead, seen first as a refused hold (before
    // the stage's update shows it): it is theirs whichever hold says so.
    // Not lifted, the move lifts it, and its first hold is refused.
    "a peer's hold, then a move": (session, { stub }) => {
      stub.heldBy = () => "peer";
      session.move(move(2.1, 2));
      session.end(move(2, 2));
    },
    "a peer's hold, then a key (Q)": (session, { stub }) => {
      stub.heldBy = () => "peer";
      session.key({ key: "q" });
      session.end(move(2, 2));
    },
    // turned over with F, then a peer's hold while the turn shows: the turn's next hold
    "a peer's hold mid-turn": (session, { stub }) => {
      session.key({ key: "f" });
      stub.heldBy = () => "peer";
      stub.tick();
      session.end(move(2, 2));
    },
  };
  // the paths that lift it themselves when it wasn't yet
  const LIFTS = new Set(["a peer's hold, then a move"]);
  const WANT = {
    "end with a landing": [{ how: "back" }, { how: "put", on: "b" }],
    "end with none": [{ how: "back" }, { how: "back" }],
    "cancel (Escape)": [{ how: "back" }, { how: "back" }],
    "a peer took it first": [{ how: "back" }, { how: "yielded" }],
    "hold refused": [{ how: "back" }, { how: "refused" }],
    "removed meanwhile": [{ how: "back" }, { how: "back" }],
    "a peer's hold, then a move": [{ how: "yielded" }, { how: "yielded" }],
    "a peer's hold, then a key (Q)": [{ how: "back" }, { how: "yielded" }],
    "a peer's hold mid-turn": [{ how: "back" }, { how: "yielded" }],
  };

  it("every session ends exactly once with one outcome, and landed fires iff it was put, after its write, with what it rests on (18 cases)", async () => {
    let cases = 0;
    for (const [path, run] of Object.entries(PATHS)) {
      for (const lifted of [false, true]) {
        const calls = [];
        const m = await mount({ doc: { objects: { b: piece({ name: "Block" }) } }, extensions: [ear(calls)] });
        m.stub.surfaces.push({ id: "b", top: 0.4, min: [1.5, 1.5], max: [2.5, 2.5] });
        const writes = [];
        const change = m.api.change;
        m.api.change = (fn) => (writes.push(fn), change(fn));
        const session = m.x().input.press(press("a"));
        if (lifted) session.move(path === "end with none" ? { type: "move" } : move(1, 1));
        run(session, m, lifted);
        await settle();
        const want = { on: null, ...WANT[path][lifted ? 1 : 0] };
        const label = `${path}, ${lifted ? "lifted" : "not lifted"}`;
        expect(await now(session.ended), label).toEqual(want);
        expect(Object.isFrozen(await session.ended), label).toBe(true);
        const put = want.how === "put";
        expect(writes.length, label).toBe(put ? 1 : 0);
        expect(
          calls.map((c) => [c.id, c.on]),
          label,
        ).toEqual(put ? [["a", "b"]] : []);
        // told after the write: the doc already has it where it went down
        if (put) expect(calls[0].at.position[1], label).toBeCloseTo(0.4);
        // and only once: anything after the end changes nothing
        session.cancel();
        session.end(move(2, 2));
        await settle();
        expect(await session.ended, label).toEqual(want);
        expect(calls.length, label).toBe(put ? 1 : 0);
        expect(writes.length, label).toBe(put ? 1 : 0);
        // a lifted carry let go of its hold exactly once (landed only when put); one never lifted held nothing
        expect(m.stub.releases, label).toEqual(lifted || LIFTS.has(path) ? [["a", put ? { landed: true } : {}]] : []);
        s.unmount();
        s = null;
        cases++;
      }
    }
    expect(cases).toBe(18);
  }, 30000);

  it("on {nothing, the block} × turned over with F first or not: always told, with what it rests on (F never stops a put being heard)", async () => {
    for (const on of [null, "b"]) {
      for (const flip of [false, true]) {
        const label = `on ${on}, ${flip ? "flipped" : "not flipped"}`;
        const calls = [];
        const m = await mount({ doc: { objects: { b: piece({ name: "Block" }) } }, extensions: [ear(calls)] });
        m.stub.surfaces.push({ id: "b", top: 0.4, min: [1.5, 1.5], max: [2.5, 2.5] });
        const at = on ? 2 : 0.5;
        const session = m.x().input.press(press("a"));
        session.move(move(at, at));
        if (flip) session.key({ key: "f" });
        session.end(move(at, at));
        expect(await now(session.ended), label).toEqual({ how: "put", on });
        expect(
          calls.map((c) => [c.id, c.on]),
          label,
        ).toEqual([["a", on]]);
        expect(composeMatrix(transformOf("a"))[5], label).toBeCloseTo(flip ? -1 : 1);
        s.unmount();
        s = null;
      }
    }
  });

  it("the stage's update ends it without the pointer: {a peer's hold, the object removed} × {lifted or not} (4 cases)", async () => {
    // not lifted, it holds nothing a peer could take: it waits for its first move (which yields, the end table)
    const ROWS = [
      { what: "a peer's hold", lifted: false, run: ({ stub }) => (stub.heldBy = () => "peer"), want: "pending", releases: [] },
      { what: "a peer's hold", lifted: true, run: ({ stub }) => (stub.heldBy = () => "peer"), want: { how: "yielded", on: null }, releases: [["a", {}]] },
      { what: "removed", lifted: false, run: () => s.change((d) => delete d.objects.a), want: { how: "back", on: null }, releases: [] },
      { what: "removed", lifted: true, run: () => s.change((d) => delete d.objects.a), want: { how: "back", on: null }, releases: [["a", {}]] },
    ];
    for (const row of ROWS) {
      const label = `${row.what}, ${row.lifted ? "lifted" : "not lifted"}`;
      const m = await mount();
      const session = m.x().input.press(press("a"));
      if (row.lifted) session.move(move(1, 1));
      row.run(m);
      m.x().update();
      expect(await now(session.ended), label).toEqual(row.want);
      expect(m.stub.releases, label).toEqual(row.releases);
      s.unmount();
      s = null;
    }
  });

  it("put means written: a stage gone read-only meanwhile, or a write that throws, ends it back, and nothing is told", async () => {
    for (const how of ["read-only", "throws"]) {
      const calls = [];
      const { api, x, stub } = await mount({ extensions: [ear(calls)] });
      const session = x().input.press(press("a"));
      session.move(move(1, 1));
      const before = JSON.stringify(transformOf("a"));
      if (how === "read-only") api.writable = () => false;
      else
        api.change = () => {
          throw new Error("no");
        };
      if (how === "throws") expect(() => session.end(move(1, 1)), how).toThrow("no");
      else session.end(move(1, 1));
      expect(await now(session.ended), how).toEqual({ how: "back", on: null });
      expect(JSON.stringify(transformOf("a")), how).toBe(before);
      expect(calls, how).toEqual([]);
      expect(stub.releases, how).toEqual([["a", {}]]);
      s.unmount();
      s = null;
    }
  });

  it("a newer carry, or the part stopping, puts an open one back", async () => {
    const { x } = await mount({ doc: { objects: { b: piece() } } });
    const first = x().input.press(press("a"));
    first.move(move(1, 1));
    const second = x().input.press(press("b", { hit: { id: "b", point: [0, 0.1, 0], distance: 1 } }));
    expect(await now(first.ended)).toEqual({ how: "back", on: null });
    second.move(move(2, 2));
    await s.uninstall("scene.carry");
    expect(await now(second.ended)).toEqual({ how: "back", on: null });
  });

  it("a landed rule that throws doesn't stop the others hearing, or the put", async () => {
    const calls = [];
    const bad = { meta: { id: "t.bad" }, module: { create: () => ({ landed: () => { throw new Error("no"); } }) } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { x } = await mount({ extensions: [bad, ear(calls)] });
    const session = x().input.press(press("a"));
    session.move(move(1, 1));
    session.end(move(1, 1));
    expect(await now(session.ended)).toEqual({ how: "put", on: null });
    expect(calls.length).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
