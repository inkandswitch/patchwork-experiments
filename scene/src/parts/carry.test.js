import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import carry from "./carry.js";
import { applyMatrix, composeMatrix, multiplyMatrices } from "../transform.js";

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
  s = await mountStage({
    extensions: [...before, CARRY_EXT, ...extensions],
    doc: { ...doc, objects: { a: piece({ name: "A" }), ...(doc.objects ?? {}) } },
  });
  const api = s.api("scene.carry");
  const holds = [];
  const releases = [];
  const stub = {
    holds,
    releases,
    surfaces: [], // [{ id, top, min: [x, z], max: [x, z] }]: what a downward ray meets
  };
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
  api.ray = () => null;
  api.sceneBox = () => ({ min: [-1, 0, -1], max: [1, 1, 1] });
  api.content = (id) => ({ loaded: true, box: BOX, extras: content[id] ?? { connectors: [], snapRadius: null }, stats: null, root: null });
  api.box = (id) => ({ min: [-1, 0, -1], max: [1, 1, 1] });
  api.heldBy = () => null;
  api.pose = {
    // `stub.refuse`: something here holds it ahead of the carry (holds.js), so the hold doesn't stand
    hold: (id, t) => (holds.push([id, t]), !stub.refuse),
    release: (id, opts) => releases.push([id, opts ?? {}]),
  };
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
const stateOf = (id, target = null) => command(id).state(target, { scene: s.api("scene.carry").scene(), local: s.local.get() });
const transformOf = (id) => JSON.parse(JSON.stringify(s.doc().objects[id].transform));

describe("scene.carry commands", () => {
  it("has no tool to pick: no Hand command, no key of its own but Flip's", async () => {
    await mount();
    expect(s.instance("scene.carry").commands.map((c) => c.id)).toEqual(["flip", "snap"]);
  });

  it("Snap: a toolbar toggle of the snap pref, whenever carrying runs", async () => {
    await mount();
    expect(command("snap").show).toEqual(["toolbar"]);
    expect(stateOf("snap", "a")).toBe(null);
    expect(stateOf("snap")).toMatchObject({ checked: true });
    const docSnap = s.doc().view.snap;
    s.api("scene.carry").run({ ext: "scene.carry", command: "snap", target: null });
    expect(s.local.get().prefs.snap).toBe(false);
    expect(stateOf("snap")).toMatchObject({ checked: false });
    s.api("scene.carry").run({ ext: "scene.carry", command: "snap", target: null, value: true });
    expect(s.local.get().prefs.snap).toBe(true);
    expect(s.doc().view.snap).toBe(docSnap); // never the doc
  });

  it("Snap follows the doc's suggestion until this viewer chooses", async () => {
    await mount({ doc: { view: { snap: false } } });
    expect(stateOf("snap")).toMatchObject({ checked: false });
  });
});

describe("scene.carry input", () => {
  it("claims a press on its holder only: with the trait, nothing armed, unlocked, not a group, not a peer's", async () => {
    const { api, x } = await mount({ doc: { objects: { l: piece({ locked: true }), g: piece({ kind: "group" }), plain: object() } } });
    expect(x().input.press(press("a"))).toBeTruthy();
    expect(x().input.press(press("l"))).toBe(null);
    expect(x().input.press(press("g"))).toBe(null);
    expect(x().input.press(press("plain"))).toBe(null);
    expect(x().input.press(press(null))).toBe(null);
    expect(x().input.press(press("a", { button: 2 }))).toBe(null);
    api.heldBy = (id) => (id === "a" ? "peer-session" : null);
    expect(x().input.press(press("a"))).toBe(null);
    api.heldBy = () => null;
    s.local.swap((m) => ({ ...m, armed: "scene.measure" }));
    expect(x().input.press(press("a"))).toBe(null);
  });

  it("carries the holder, not the hit: a press on what's attached to a piece carries the piece", async () => {
    const { x, stub } = await mount({ doc: { objects: { kid: object({ parent: "a" }) } } });
    const session = x().input.press(press("kid", { holder: "a" }));
    session.move(move(1, 1));
    expect(stub.holds.map(([id]) => id)).toEqual(["a"]);
    session.cancel();
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

  it("rests on the highest surface under its footprint", async () => {
    const { x, stub } = await mount({ doc: { objects: { b: piece({ name: "Block" }) } } });
    stub.surfaces.push({ id: "b", top: 0.4, min: [1.5, 1.5], max: [2.5, 2.5] });
    const session = x().input.press(press("a"));
    session.move(move(2, 2));
    session.end(move(2, 2));
    await settle();
    expect(transformOf("a").position[1]).toBeCloseTo(0.4);
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

  it("Escape (the router's cancel) puts it back: a plain release, nothing written", async () => {
    const { x, stub } = await mount({ doc: {} });
    const session = x().input.press(press("a"));
    session.move(move(1, 1));
    expect(session.key({ key: "Escape" })).toBe(false); // left to the router, which cancels
    session.cancel();
    await settle();
    expect(transformOf("a").position).toEqual([0, 0, 0]);
    expect(stub.releases).toEqual([["a", {}]]);
  });

  it("refused by something here that holds it ahead (a roll, a glide): it goes back at whichever move, and nothing is written", async () => {
    for (const at of [0, 1, 2]) {
      const { x, stub } = await mount({ doc: {} });
      const session = x().input.press(press("a"));
      for (let i = 0; i < 3; i++) {
        stub.refuse = i >= at;
        session.move(move(1 + i, 1));
      }
      session.end(move(3, 1));
      await settle();
      expect(transformOf("a").position).toEqual([0, 0, 0]);
      expect(stub.releases).toEqual([["a", {}]]);
      s.unmount();
      s = null;
    }
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
    s.api("scene.carry").setPref("snap", false);
    session = x().input.press(press("a"));
    session.move(move(1.2, 0.1));
    session.end(move(1.2, 0.1));
    await settle();
    expect(transformOf("a").position[0]).toBeCloseTo(1.2);
  });

  it("a tagged connector takes only objects with one of its tags", async () => {
    const content = { board: { connectors: [{ position: [1, 0, 0], yaw: null, tags: ["card"] }], snapRadius: 0.5 } };
    const { x } = await mount({ doc: { objects: { board: object(), c: piece({ tags: ["card"] }) } }, content });
    let session = x().input.press(press("a"));
    session.move(move(1.2, 0));
    session.end(move(1.2, 0));
    session = x().input.press(press("c"));
    session.move(move(1.2, 0));
    session.end(move(1.2, 0));
    await settle();
    expect(transformOf("a").position[0]).toBeCloseTo(1.2);
    expect(transformOf("c").position[0]).toBeCloseTo(1);
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
    api.ray = (x, y) => down(x / 10, y / 10); // port px → a spot on the table
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
    api.ray = (x, y) => down(x / 10, y / 10);
    s.pointer("pointerdown", 10, 10);
    s.pointer("pointermove", 30, 10);
    s.key("Escape", { code: "Escape" });
    s.pointer("pointerup", 30, 10);
    await settle();
    expect(transformOf("a").position).toEqual([0, 0, 0]);
    expect(stub.releases).toEqual([["a", {}]]);
  });
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

  it("is carry's verb: on anything carryable, from the menu or F, whatever else is going on", async () => {
    await mount({ doc: { objects: { plain: object() } } });
    expect(command("flip").key).toBe("f");
    expect(command("flip").show).toEqual(["menu", "use"]);
    expect(stateOf("flip", "a")).toMatchObject({ title: expect.stringContaining("(F)") });
    expect(stateOf("flip", null)).toBe(null);
    expect(stateOf("flip", "plain")).toBe(null);
  });

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
    for (const at of [0, 1, 2, 3]) {
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
    api.heldBy = () => "peer";
    stub.tick(0.1);
    await settle();
    expect(stub.loops.size).toBe(0);
    expect(stub.releases.at(-1)).toEqual(["a", {}]);
    expect(transformOf("a")).toEqual(lying);
  });

  it("F over a piece flips it at a table, where nothing else answers F", async () => {
    const { default: keys } = await import("./keys.js");
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
    api.heldBy = (id) => (id === held ? "peer" : null);
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
