// Put, then draw: what comes back is what went in, minus where it was.
import { describe, it, expect } from "vitest";
import { inside, outside } from "./contents.js";
import { newBag } from "./datatype.js";
import { RULES } from "./draw.js";
import { drawOne, objectOf, pour, putObjects, settleDraw } from "./moves.js";
import { LEFT_BEHIND, kindOf, objectFrom, recordOf, scaleOf } from "./object.js";
import { FakeHandle } from "./test/fake-repo.js";

const SCENE = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
const OTHER = "automerge:3yt6LbnDAzvNj9WDNDA4ew21R85G";

/** Every kind of thing an object can be: a passthrough GLB, a built one, one with traits and tags, a scaled one, a bare one. */
const OBJECTS = {
  cube: { name: "Cube", sourceUrl: "automerge:cubeglb", providerId: "file-glb", renderUrl: null, parent: null, group: null, visible: true, color: null, opacity: 1, wireframe: false, transform: { position: [0.1, 0, 0.2], rotation: [0, 1, 0], scale: 1 }, hint: { bounds: { min: [-0.01, 0, -0.01], max: [0.01, 0.02, 0.01] } } },
  hull: { name: "Hull", sourceUrl: "automerge:hulldoc", providerId: "camber-hull-surface", renderUrl: "automerge:hullrender", parent: "table", group: "g1", visible: true, color: "#ff0000", opacity: 0.5, wireframe: true, transform: { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: 2.5 }, at: { heads: ["abc"] } },
  card: { name: "Card", sourceUrl: "automerge:back", providerId: "file-glb", renderUrl: null, parent: null, group: null, visible: false, color: null, opacity: 1, wireframe: false, locked: false, tags: ["card"], traits: { "tabletop.hidden": { by: "automerge:deck" }, "arena.target": { down: false } }, transform: { position: [0, 0.4, 0], rotation: [0, 0, Math.PI], scale: 1 }, claims: { held: { viewer: "v", session: "s" } } },
  bare: { name: "Marker", sourceUrl: null, providerId: null, renderUrl: null, parent: null, group: null, transform: { position: [5, 5, 5], rotation: [0, 0, 0], scale: 0.5 } },
};
const minusPose = (o) => {
  const { transform, parent, group, claims, ...rest } = structuredClone(o);
  return { ...rest, scale: transform.scale };
};

function world() {
  const scene = new FakeHandle(SCENE, { objects: structuredClone(OBJECTS), order: Object.keys(OBJECTS) });
  const bag = new FakeHandle("automerge:bag", newBag());
  const remove = (ids) => scene.change((d) => { for (const id of ids) { delete d.objects[id]; d.order = d.order.filter((x) => x !== id); } });
  const side = (url = SCENE, h = scene) => ({
    url,
    has: (id) => !!h.doc().objects[id],
    newId: () => `new${Object.keys(h.doc().objects).length}`,
    insert: (id, entry) => h.change((d) => { d.objects[id] = objectOf(entry, { position: [9, 9, 9], rotation: [0, 0, 0], parent: null, group: null }); if (!d.order.includes(id)) d.order.push(id); }),
  });
  return { scene, bag, remove, side };
}

describe("put, then draw", () => {
  it("a record is the object without where it was, and its size beside it", () => {
    for (const o of Object.values(OBJECTS)) {
      const r = recordOf(o);
      for (const k of LEFT_BEHIND) expect(k in r).toBe(false);
      expect({ ...r, scale: scaleOf(o) }).toEqual(minusPose(o));
      // a fresh copy: nothing of the original is shared
      expect(r.traits === o.traits && !!o.traits).toBe(false);
    }
    expect(scaleOf({})).toBe(1);
    expect(kindOf(recordOf(OBJECTS.cube))).toEqual({ key: "automerge:cubeglb\u0000Cube", name: "Cube" });
  });

  it("each object comes back equal to the original minus its pose, under its own id, for every rule that takes it out", () => {
    for (const rule of RULES.map((r) => r.value).filter((r) => r !== "random-replace")) {
      const { scene, bag, remove, side } = world();
      const keys = putObjects({ objects: scene.doc().objects, ids: Object.keys(OBJECTS), sceneUrl: SCENE, remove, bag });
      expect(keys.length).toBe(4);
      // in the bag, not in the scene: that is what "inside" means
      expect(scene.doc().objects).toEqual({});
      expect(inside(bag.doc()).map((x) => x.entry.id)).toEqual(Object.keys(OBJECTS));
      const back = [];
      for (let i = 0; i < 4; i++) back.push(drawOne({ bag, rule, by: "me", random: () => 0.6, scene: side() }));
      expect(drawOne({ bag, rule, by: "me", scene: side() })).toBeNull();
      expect(back.map((d) => d.id).sort()).toEqual(Object.keys(OBJECTS).sort());
      expect(back.every((d) => !d.fresh && !d.copy && settleDraw(bag.doc(), d, "me") === "mine")).toBe(true);
      for (const [id, o] of Object.entries(OBJECTS)) {
        const now = scene.doc().objects[id];
        expect(minusPose(now)).toEqual(minusPose(o));
        expect([now.parent, now.group, now.transform.position]).toEqual([null, null, [9, 9, 9]]);
        expect("claims" in now).toBe(false);
      }
      expect(inside(bag.doc())).toEqual([]);
      expect(outside(bag.doc()).length).toBe(4);
    }
  });

  it("with replacement the item stays in, and a copy is asked for", () => {
    const { scene, bag, remove, side } = world();
    putObjects({ objects: scene.doc().objects, ids: ["cube", "card"], sceneUrl: SCENE, remove, bag });
    const copies = [];
    const drawn = drawOne({ bag, rule: "random-replace", by: "me", random: () => 0.9, scene: { ...side(), copy: (entry) => copies.push(entry) } });
    expect([drawn.copy, drawn.id, drawn.entry.id]).toEqual([true, null, "card"]);
    expect(copies.map((e) => e.object.name)).toEqual(["Card"]);
    expect(inside(bag.doc()).length).toBe(2);
    expect(outside(bag.doc())).toEqual([]);
  });

  it("into another scene, or one where that id is taken, it comes out under a new id that the drawer alone made", () => {
    const { scene, bag, remove } = world();
    putObjects({ objects: scene.doc().objects, ids: ["cube"], sceneUrl: SCENE, remove, bag });
    const other = new FakeHandle(OTHER, { objects: { cube: { name: "another scene's cube" } }, order: ["cube"] });
    const drawn = drawOne({
      bag,
      rule: "top",
      by: "me",
      scene: { url: OTHER, has: (id) => !!other.doc().objects[id], newId: () => "fresh1", insert: (id, entry) => other.change((d) => (d.objects[id] = objectOf(entry, {}))) },
    });
    expect([drawn.id, drawn.fresh]).toEqual(["fresh1", true]);
    expect(other.doc().objects.cube.name).toBe("another scene's cube");
    expect(minusPose(other.doc().objects.fresh1)).toEqual(minusPose(OBJECTS.cube));
  });

  it("outside any scene a draw just takes it out, and says what it was", () => {
    const { scene, bag, remove } = world();
    putObjects({ objects: scene.doc().objects, ids: ["cube", "hull"], sceneUrl: SCENE, remove, bag });
    const drawn = drawOne({ bag, rule: "top", by: "tool" });
    expect([drawn.entry.object.name, drawn.id, drawn.fresh]).toEqual(["Hull", null, false]);
    expect(inside(bag.doc()).map((x) => x.entry.id)).toEqual(["cube"]);
  });

  it("groups and what isn't there don't go in; nothing is removed for them", () => {
    const { scene, bag, remove } = world();
    scene.change((d) => (d.objects.g1 = { kind: "group", name: "Group" }));
    expect(putObjects({ objects: scene.doc().objects, ids: ["g1", "nope"], sceneUrl: SCENE, remove, bag })).toEqual([]);
    expect(Object.keys(scene.doc().objects).length).toBe(5);
    expect(inside(bag.doc())).toEqual([]);
  });

  it("pouring moves every item, whole and in order, and leaves the first bag empty", () => {
    const { scene, bag, remove } = world();
    putObjects({ objects: scene.doc().objects, ids: Object.keys(OBJECTS), sceneUrl: SCENE, remove, bag });
    const before = inside(bag.doc()).map(({ key, entry }) => [key, entry.id, entry.from, entry.object, entry.scale]);
    const to = new FakeHandle("automerge:bag2", newBag());
    expect(pour({ from: bag, to, by: "me" })).toBe(4);
    expect(inside(to.doc()).map(({ key, entry }) => [key, entry.id, entry.from, entry.object, entry.scale])).toEqual(before);
    expect(inside(bag.doc())).toEqual([]);
    expect(pour({ from: bag, to, by: "me" })).toBe(0);
  });

  it("objectFrom is a fresh object at the pose given, at its own size", () => {
    const o = objectFrom({ name: "x", traits: { a: { b: 1 } } }, 2, { position: [1, 2, 3], rotation: [0, 1, 0], parent: "p", group: "g" });
    expect(o).toEqual({ name: "x", traits: { a: { b: 1 } }, parent: "p", group: "g", transform: { position: [1, 2, 3], rotation: [0, 1, 0], scale: 2 } });
    expect(objectFrom({}, 0).transform.scale).toBe(1);
  });
});
