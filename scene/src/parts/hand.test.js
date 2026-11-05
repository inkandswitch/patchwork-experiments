import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import hand, { effectiveTool } from "./hand.js";
import { composeMatrix } from "../transform.js";

const BOX = { min: [-0.1, 0, -0.1], max: [0.1, 0.1, 0.1] };
const down = (x, z) => ({ origin: [x, 10, z], dir: [0, -1, 0] });
const HAND = { meta: { id: "scene.hand" }, module: hand };

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
async function mount({ doc = {}, extensions = [], kit = ["scene.hand"], content = {} } = {}) {
  s = await mountStage({
    extensions: [HAND, ...extensions],
    kits: [{ id: "model", extensions: kit }],
    doc: { ...doc, objects: { a: object({ name: "A" }), ...(doc.objects ?? {}) } },
  });
  const api = s.api("scene.hand");
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
    hold: (id, t) => holds.push([id, t]),
    release: (id, opts) => releases.push([id, opts ?? {}]),
  };
  return { api, x: () => s.instance("scene.hand"), stub };
}

const press = (id, extra = {}) => ({ type: "press", button: 0, x: 10, y: 10, hit: id ? { id, point: [0, 0.1, 0], distance: 1 } : null, ...extra });
const move = (x, z, extra = {}) => ({ type: "move", ray: down(x, z), alt: false, ...extra });
const command = (id) => s.instance("scene.hand").commands.find((c) => c.id === id);
const stateOf = (id, target = null) => command(id).state(target, { scene: s.api("scene.hand").scene(), local: s.local.get() });
const transformOf = (id) => JSON.parse(JSON.stringify(s.doc().objects[id].transform));

describe("the effective tool", () => {
  it("is local, else the doc's suggestion (view.tool only), else move", () => {
    expect(effectiveTool({}, {})).toBe("move");
    expect(effectiveTool({}, { view: { tool: "hand" } })).toBe("hand");
    expect(effectiveTool({ tool: "select" }, { view: { tool: "hand" } })).toBe("select");
    // retired names suggest nothing
    expect(effectiveTool({}, { view: { defaultMode: "hand", defaultGizmo: "hand" } })).toBe("move");
  });
});

describe("scene.hand commands", () => {
  it("Hand: checked with the hand as the tool; running it makes the hand the tool", async () => {
    await mount();
    expect(stateOf("hand")).toMatchObject({ checked: false });
    expect(stateOf("hand", "a")).toBe(null);
    expect(command("hand").key).toBe("h");
    expect(s.api("scene.hand").run({ ext: "scene.hand", command: "hand", target: null })).toBe(true);
    expect(s.local.get().tool).toBe("hand");
    expect(stateOf("hand")).toMatchObject({ checked: true });
  });

  it("Hand is checked when the doc opens in the hand", async () => {
    await mount({ doc: { view: { tool: "hand" } } });
    expect(stateOf("hand")).toMatchObject({ checked: true });
  });

  it("Snap: only with the hand, a toolbar toggle of the snap pref", async () => {
    await mount();
    expect(stateOf("snap")).toBe(null);
    expect(command("snap").show).toEqual(["toolbar"]);
    s.local.swap((m) => ({ ...m, tool: "hand" }));
    expect(stateOf("snap")).toMatchObject({ checked: true });
    const docSnap = s.doc().view.snap;
    s.api("scene.hand").run({ ext: "scene.hand", command: "snap", target: null });
    expect(s.local.get().prefs.snap).toBe(false);
    expect(stateOf("snap")).toMatchObject({ checked: false });
    s.api("scene.hand").run({ ext: "scene.hand", command: "snap", target: null, value: true });
    expect(s.local.get().prefs.snap).toBe(true);
    expect(s.doc().view.snap).toBe(docSnap); // never the doc
  });

  it("Snap follows the doc's suggestion until this viewer chooses", async () => {
    await mount({ doc: { view: { tool: "hand", snap: false } } });
    expect(stateOf("snap")).toMatchObject({ checked: false });
  });
});

describe("scene.hand input", () => {
  it("claims a press on a carryable object only with the hand, nothing armed, unlocked, not a group, not a peer's", async () => {
    const { api, x } = await mount({ doc: { objects: { l: object({ locked: true }), g: object({ kind: "group" }) } } });
    expect(x().input.press(press("a"))).toBe(null); // tool: move
    s.local.swap((m) => ({ ...m, tool: "hand" }));
    expect(x().input.press(press("a"))).toBeTruthy();
    expect(x().input.press(press("l"))).toBe(null);
    expect(x().input.press(press("g"))).toBe(null);
    expect(x().input.press(press(null))).toBe(null);
    expect(x().input.press(press("a", { button: 2 }))).toBe(null);
    api.heldBy = (id) => (id === "a" ? "peer-session" : null);
    expect(x().input.press(press("a"))).toBe(null);
    api.heldBy = () => null;
    s.local.swap((m) => ({ ...m, armed: "scene.measure" }));
    expect(x().input.press(press("a"))).toBe(null);
  });

  it("shows a grab cursor over what it could pick up", async () => {
    const { x } = await mount({ doc: { objects: { l: object({ locked: true }) } } });
    expect(x().input.cursor({ hit: { id: "a" } })).toBe(null);
    s.local.swap((m) => ({ ...m, tool: "hand" }));
    expect(x().input.cursor({ hit: { id: "a" } })).toBe("grab");
    expect(x().input.cursor({ hit: { id: "l" } })).toBe(null);
    expect(x().input.cursor({ hit: null })).toBe(null);
    const session = x().input.press(press("a"));
    expect(session.cursor).toBe("grabbing");
  });

  it("a press that doesn't move is a tap it doesn't take (the click goes on), and holds nothing", async () => {
    const { x, stub } = await mount({ doc: { view: { tool: "hand" } } });
    const session = x().input.press(press("a"));
    expect(session.tap(press("a"))).toBe(false);
    session.cancel();
    expect(stub.holds).toEqual([]);
    expect(stub.releases).toEqual([]);
  });
});

describe("scene.hand carrying", () => {
  it("lifts on the first move, follows the pointer floating, and writes only the final transform", async () => {
    const { x, stub } = await mount({ doc: { view: { tool: "hand" }, objects: { a: object({ name: "A", color: "#ff0000" }) } } });
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
    const { x, stub } = await mount({ doc: { view: { tool: "hand" }, objects: { b: object({ name: "Block" }) } } });
    stub.surfaces.push({ id: "b", top: 0.4, min: [1.5, 1.5], max: [2.5, 2.5] });
    const session = x().input.press(press("a"));
    session.move(move(2, 2));
    session.end(move(2, 2));
    await settle();
    expect(transformOf("a").position[1]).toBeCloseTo(0.4);
  });

  it("never lands on itself or what's attached to it", async () => {
    const { x, stub } = await mount({ doc: { view: { tool: "hand" }, objects: { kid: object({ parent: "a" }) } } });
    stub.surfaces.push({ id: "a", top: 0.5, min: [-9, -9], max: [9, 9] }, { id: "kid", top: 0.7, min: [-9, -9], max: [9, 9] });
    const session = x().input.press(press("a"));
    session.move(move(1, 1));
    session.end(move(1, 1));
    await settle();
    expect(transformOf("a").position[1]).toBeCloseTo(0);
  });

  it("Escape (the router's cancel) puts it back: a plain release, nothing written", async () => {
    const { x, stub } = await mount({ doc: { view: { tool: "hand" } } });
    const session = x().input.press(press("a"));
    session.move(move(1, 1));
    expect(session.key({ key: "Escape" })).toBe(false); // left to the router, which cancels
    session.cancel();
    await settle();
    expect(transformOf("a").position).toEqual([0, 0, 0]);
    expect(stub.releases).toEqual([["a", {}]]);
  });

  it("snaps to another object's connector, turning to its yaw; Alt and the pref place freely", async () => {
    const content = { board: { connectors: [{ position: [1, 0, 0], yaw: Math.PI / 2, tags: [] }], snapRadius: 0.5 } };
    const { x } = await mount({ doc: { view: { tool: "hand" }, objects: { board: object({ name: "Board" }) } }, content });
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
    s.api("scene.hand").setPref("snap", false);
    session = x().input.press(press("a"));
    session.move(move(1.2, 0.1));
    session.end(move(1.2, 0.1));
    await settle();
    expect(transformOf("a").position[0]).toBeCloseTo(1.2);
  });

  it("a tagged connector takes only objects with one of its tags", async () => {
    const content = { board: { connectors: [{ position: [1, 0, 0], yaw: null, tags: ["card"] }], snapRadius: 0.5 } };
    const { x } = await mount({ doc: { view: { tool: "hand" }, objects: { board: object(), c: object({ tags: ["card"] }) } }, content });
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
    const { x } = await mount({ doc: { view: { tool: "hand" } } });
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

  it("other keys go on down the chain", async () => {
    const { x } = await mount({ doc: { view: { tool: "hand" } } });
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
      doc: { view: { tool: "hand" }, objects: { a: object({ transform: { position: [0, 0.1, 0], rotation: [0, 0, Math.PI], scale: 1 } }) } },
      extensions: [rules],
      kit: ["scene.hand", "t.rules"],
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
      doc: { view: { tool: "hand" }, objects: { p: object({ transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: 1 } }), a: object({ parent: "p" }) } },
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
    const { api, x } = await mount({ doc: { view: { tool: "hand" }, objects: { board: object() } }, content });
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
            press: (ev) => api.collect("carry").find((c) => c.id === "scene.hand")?.value("a", ev) ?? null,
          },
        }),
      },
    };
    const { api, stub } = await mount({ extensions: [grabber], kit: ["t.grab", "scene.hand"] });
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
    const { api, stub } = await mount({ extensions: [grabber], kit: ["t.grab", "scene.hand"] });
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

describe("scene.hand grab offset", () => {
  it("keeps where it was grabbed, in plan, so it doesn't jump on pickup", async () => {
    const { x } = await mount({ doc: { view: { tool: "hand" } } });
    const session = x().input.press(press("a", { hit: { id: "a", point: [0.05, 0.1, -0.05], distance: 1 } }));
    session.move(move(1, 1));
    session.end(move(1, 1));
    await settle();
    expect(transformOf("a").position.map((v) => +v.toFixed(9))).toEqual([0.95, 0, 1.05]);
  });
});
