import { describe, expect, it } from "vitest";
import { createDisplay } from "./display.js";
import { modelOf } from "./model.js";

const T = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };

/** A scope and content that only record what they are told. */
function fakes() {
  const told = { display: new Map(), outline: new Map(), placed: new Map(), poses: new Map() };
  const scope = {
    setGroups() {},
    applyDisplay: (id, o) => told.display.set(id, o),
    setOutline: (id, c) => told.outline.set(id, c),
    setPose: (id, t) => (t ? told.poses.set(id, t) : told.poses.delete(id)),
    removeObject: (id) => told.display.delete(id),
    ids: () => [...told.display.keys()],
    worldOf: () => null,
    poseOf: (id) => told.poses.get(id) ?? null,
    get posed() {
      return told.poses.size > 0;
    },
  };
  const content = { place: (id, o, how) => (told.placed.set(id, how), false), forget: (id) => told.placed.delete(id), ids: () => [...told.placed.keys()] };
  return { scope, content, told };
}

describe("display (display.js)", () => {
  // Three extensions, each displaying the object with one of four field sets, in every running order: each
  // field is the last in running order to give it; releasing them in any order leaves the doc's object.
  it("over every running order of three extensions × each giving one of four field sets: per field the later wins; released, nothing is left", () => {
    const SETS = [{ name: "A" }, { tint: "red" }, { name: "B", hidden: true }, { opacity: 0.5, tint: "blue" }];
    const exts = ["x", "y", "z"];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((o) => o.map((i) => exts[i]));
    const m = modelOf({ objects: { a: { name: "own", transform: T } } });
    let cases = 0;
    for (const order of orders)
      for (let k = 0; k < 4 ** 3; k++) {
        const { scope, content, told } = fakes();
        let changes = 0;
        const d = createDisplay({ scope, content, rank: () => order, opened: () => false, changed: () => changes++ });
        const given = Object.fromEntries(exts.map((x, i) => [x, SETS[Math.floor(k / 4 ** i) % 4]]));
        const releases = exts.map((x) => d.set(x, "a", given[x]));
        d.draw(m);
        const want = {};
        for (const x of order) Object.assign(want, given[x]);
        expect([order, k, d.merged().get("a")]).toEqual([order, k, want]);
        expect(d.nameOf(m, "a")).toBe(want.name ?? "own");
        expect(told.display.get("a").visible).toBe(want.hidden ? false : undefined);
        expect(told.placed.get("a").shown).toBe(!want.hidden);
        expect(Object.keys(d.authors().a).length).toBe(3);
        for (const r of releases) r();
        d.draw(m);
        expect([d.merged().has("a"), d.nameOf(m, "a"), told.placed.get("a").shown]).toEqual([false, "own", true]);
        cases++;
      }
    expect(cases).toBe(6 * 64);
  });

  it("drop(ext) takes only that extension's overrides; an override outlives its object and applies again when it comes back", () => {
    const { scope, content, told } = fakes();
    const d = createDisplay({ scope, content, rank: () => ["x", "y"], opened: () => false, changed: () => {} });
    const with_ = modelOf({ objects: { a: { name: "a", transform: T } } });
    const without = modelOf({ objects: {} });
    d.set("x", "a", { name: "X" });
    d.set("y", "a", { tint: "red" });
    d.drop("y");
    d.draw(with_);
    expect(d.merged().get("a")).toEqual({ name: "X" });
    d.draw(without);
    expect([d.merged().has("a"), told.placed.has("a")]).toEqual([false, false]);
    d.draw(with_);
    expect(d.merged().get("a")).toEqual({ name: "X" });
  });
});
