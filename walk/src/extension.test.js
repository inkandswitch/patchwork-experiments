// walk's two parts (scene/COMPOSITION.md §3, "Presence where it is"): the
// body (extension.js, general: it runs at the focus) and the others walking
// (people.js, a part of every doc: it runs in every stage). The people part
// draws exactly the others whose presence (under the body's key, "walk")
// says where they stand, at their feet, in its doc's own frame (its world
// layer): checked over every set of four kinds of peer. The body part draws
// nobody.

import { describe, it, expect } from "vitest";
import walk from "./extension.js";
import people from "./people.js";
import { plugins } from "./index.js";

/** Just enough of three.js for the avatars: groups, meshes, colours. */
class Obj {
  constructor() {
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => Object.assign(this.position, { x, y, z }) };
    this.rotation = { x: 0, y: 0, z: 0, set: (x, y, z) => Object.assign(this.rotation, { x, y, z }) };
  }
  add(...os) {
    for (const o of os) (o.parent = this), this.children.push(o);
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
const THREE = {
  Group: Obj,
  Mesh: class extends Obj {},
  CylinderGeometry: class {},
  SphereGeometry: class {},
  BoxGeometry: class {},
  MeshStandardMaterial: class {},
  MeshBasicMaterial: class {},
  Color: class {
    setHSL() {
      return this;
    }
  },
};

/** A fake api on one doc: its presence, its world layer, its labels. */
function fakeApi(presence, id) {
  const world = new Obj();
  let labelled = [];
  const watchers = [];
  return {
    api: {
      id,
      session: "me",
      THREE,
      world: () => world,
      labels: () => ({ set: (items) => (labelled = items) }),
      presence: { get: () => presence, watch: (fn) => watchers.push(fn), set() {}, rate() {} },
      repo: null,
      invalidate() {},
      // (what the body reads; never entered here)
      body: { current: () => null },
      camera: {},
      clock: { now: () => 0 },
    },
    world,
    labels: () => labelled,
  };
}

// the kinds of peer: another walking, another not walking, this view itself walking, another with a malformed avatar
const KINDS = {
  walker: ["s1", { viewer: "viewer:ana", keys: { walk: { avatar: { feet: [1, 2, 3], yaw: 0.5 } } } }],
  still: ["s2", { viewer: "viewer:ben", keys: {} }],
  me: ["me", { viewer: "viewer:me", keys: { walk: { avatar: { feet: [9, 9, 9], yaw: 0 } } } }],
  broken: ["s3", { viewer: "viewer:cara", keys: { walk: { avatar: { feet: "here" } } } }],
};

describe("walk's parts", () => {
  it("the body is general; the people are a part of every doc", () => {
    const meta = Object.fromEntries(plugins.map((p) => [p.id, p.traits ?? []]));
    expect(meta.walk).toEqual([]);
    expect(meta["walk.people"]).toEqual(["*"]);
  });

  it("every set of peers × each part: the people part draws the others walking at their feet, nobody else; the body part draws nobody and offers the body", () => {
    const names = Object.keys(KINDS);
    let n = 0;
    for (let mask = 0; mask < 1 << names.length; mask++) {
      const presence = Object.fromEntries(names.filter((_, i) => mask & (1 << i)).map((k) => KINDS[k]));
      for (const [id, part] of [["walk", walk], ["walk.people", people]]) {
        const f = fakeApi(presence, id);
        const inst = part.create(f.api);
        inst.update?.();
        const drawn = f.world.children.map((g) => [g.position.x, g.position.y, g.position.z]);
        const draws = id === "walk.people" && mask & 1;
        expect([mask, id, drawn]).toEqual([mask, id, draws ? [[1, 2, 3]] : []]);
        expect([mask, id, f.labels().map((l) => l.key)]).toEqual([mask, id, draws ? ["s1"] : []]);
        expect([id, (inst.bodies ?? []).map((b) => b.id)]).toEqual([id, id === "walk" ? ["walk"] : []]);
        inst.dispose?.();
        expect(f.world.children).toEqual([]);
        n++;
      }
    }
    expect(n).toBe(32);
  });
});
