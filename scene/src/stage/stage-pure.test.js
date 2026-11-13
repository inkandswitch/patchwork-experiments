import { describe, it, expect, vi } from "vitest";
import { assoc, createAtom } from "./atom.js";
import { activeSet, availableActivities, currentActivity, docReason } from "./activation.js";
import { chainOrder, holdersFor, offer } from "./chain.js";

describe("the local atom", () => {
  it("swaps whole values and tells watchers both", () => {
    const a = createAtom({ x: 1 });
    const seen = [];
    a.watch((next, prev) => seen.push([prev.x, next.x]));
    a.swap(assoc("x", 2));
    a.swap(assoc("x", 2)); // same: no swap
    expect(a.get()).toEqual({ x: 2 });
    expect(Object.isFrozen(a.get())).toBe(true);
    expect(seen).toEqual([[1, 2]]);
  });
});

describe("activation", () => {
  const metas = [
    { id: "tabletop", traits: ["tabletop.seats", "tabletop.hidden"], requires: ["hand", "keys"], activities: ["play"] },
    { id: "arena", traits: ["arena.target"], activities: ["play"] },
    { id: "arena.edit", traits: ["arena.target"], activities: ["edit"] },
    { id: "hand", activities: ["edit"] },
    { id: "keys" },
    { id: "select", activities: ["edit"] },
    { id: "outline", requires: ["sidebar"], activities: ["edit"] },
    { id: "sidebar", activities: ["edit"] },
    { id: "boat", traits: ["boat.hull"], activities: ["sail"] },
    { id: "switch", always: true },
  ];
  const ids = (set) => set.map((r) => [r.id, r.scope]);
  const doc = { traits: { "tabletop.seats": {} }, objects: { c: { traits: { "arena.target": {} } } } };

  it("in play: the scene's, then some objects', then the general ones; requirements follow whatever their activities, lending no scope", () => {
    expect(ids(activeSet({ metas, doc, activity: "play" }))).toEqual([
      ["tabletop", "scene"],
      ["hand", "general"],
      ["keys", "general"],
      ["arena", "objects"],
      ["switch", "general"],
    ]);
  });

  it("in edit: the editing parts, in registry order; traits the doc lacks (the boat's) run nothing", () => {
    expect(ids(activeSet({ metas, doc, activity: "edit" }))).toEqual([
      ["arena.edit", "objects"],
      ["hand", "general"],
      ["keys", "general"],
      ["select", "general"],
      ["outline", "general"],
      ["sidebar", "general"],
      ["switch", "general"],
    ]);
  });

  it("a required extension keeps its own scope, and declaring traits it lacks isn't a reason", () => {
    const m = [
      { id: "game", traits: ["game.board"], requires: ["rules", "board"] },
      { id: "rules", traits: ["rules.x"] },
      { id: "board", traits: ["game.board"], activities: ["edit"] },
    ];
    const d = { traits: { "game.board": {} } };
    expect(ids(activeSet({ metas: m, doc: d, activity: "play" }))).toEqual([
      ["game", "scene"],
      ["rules", "general"],
      ["board", "scene"],
    ]);
    expect(ids(activeSet({ metas: m, doc: {}, activity: "edit" }))).toEqual([]);
  });

  it("general: false — no reason of its own: it runs only when required, and offers nothing", () => {
    const m = [
      { id: "game", traits: ["game.board"], activities: ["play"], requires: ["prompt"] },
      { id: "prompt", general: false, activities: ["play"] },
    ];
    expect(ids(activeSet({ metas: m, doc: { traits: { "game.board": {} } }, activity: "play" }))).toEqual([
      ["game", "scene"],
      ["prompt", "general"],
    ]);
    expect(ids(activeSet({ metas: m, doc: {}, activity: "play" }))).toEqual([]);
    expect(availableActivities(m, {})).toEqual(["edit"]);
  });

  it("an object trait is the objects' reason; a scene trait the scene's", () => {
    expect(docReason(metas[0], { objects: { a: { traits: { "tabletop.hidden": {} } } } })).toBe("objects");
    expect(docReason(metas[0], { traits: { "tabletop.seats": {} }, objects: {} })).toBe("scene");
    expect(docReason(metas[5], { objects: {} })).toBeNull();
  });

  it("available: edit always, then what every extension with a reason takes part in (registry order)", () => {
    expect(availableActivities(metas, { objects: {} })).toEqual(["edit"]);
    expect(availableActivities(metas, doc)).toEqual(["edit", "play"]);
    expect(availableActivities(metas, { traits: { "boat.hull": {} } })).toEqual(["edit", "sail"]);
    expect(availableActivities([{ id: "review", activities: ["review"] }], {})).toEqual(["edit", "review"]);
  });

  it("current: this viewer's, else the doc's, else edit; but only one on offer, else edit", () => {
    const both = ["edit", "play"];
    expect(currentActivity(null, {}, both)).toBe("edit");
    expect(currentActivity(null, { view: { activity: "play" } }, both)).toBe("play");
    expect(currentActivity("edit", { view: { activity: "play" } }, both)).toBe("edit");
    expect(currentActivity("play", {}, ["edit"])).toBe("edit");
    expect(currentActivity(null, { view: { activity: "sail" } }, both)).toBe("edit");
  });
});

describe("the input chain", () => {
  const running = [
    { id: "tabletop", meta: { traits: ["tabletop.seats", "tabletop.hidden"] }, scope: "scene" },
    { id: "arena", meta: { traits: ["arena.target"] }, scope: "objects" },
    { id: "select", meta: {}, scope: "general" },
    { id: "halo", meta: {}, scope: "general" },
  ];
  const traits = { card: ["tabletop.hidden"], crate: ["arena.target"], table: [] };
  const sceneTraits = ["tabletop.seats"];
  const holders = (chain) => holdersFor(running, chain, (id) => (id === null ? sceneTraits : (traits[id] ?? [])));

  it("an extension placed only on objects hears only events on its objects", () => {
    expect(chainOrder({ running, holders: holders([]) })).toEqual(["tabletop", "select", "halo"]);
    expect(chainOrder({ running, holders: holders(["crate"]) })).toEqual(["arena", "tabletop", "select", "halo"]);
  });

  it("armed, then the widget's owner, then the holders nearest first, then the general ones — each once", () => {
    expect(chainOrder({ running, armed: "select", widgetOwner: "halo", holders: holders(["card"]) })).toEqual(["select", "halo", "tabletop"]);
    expect(chainOrder({ running, armed: "gone", holders: holders([]) })).toEqual(["tabletop", "select", "halo"]);
  });

  it("holders: the nearest link up the hit chain with one of the extension's traits, the scene last (id null)", () => {
    expect([...holders(["table", "card", "crate"])]).toEqual([["tabletop", { id: "card", depth: 1 }], ["arena", { id: "crate", depth: 2 }]]);
    expect([...holders([])]).toEqual([["tabletop", { id: null, depth: 0 }]]);
    expect([...holders(["crate"])]).toEqual([["tabletop", { id: null, depth: 1 }], ["arena", { id: "crate", depth: 0 }]]);
  });

  // SCOPE.md's sailing case: a card on the saloon table of a boat in an arena level.
  it("a card on a table aboard a boat in an arena: the table's, then the boat's, then the scene's", () => {
    const sim = [
      { id: "arena", meta: { traits: ["arena.level", "arena.target"] }, scope: "scene" },
      { id: "sailing", meta: { traits: ["sailing.boat", "sailing.tiller"] }, scope: "objects" },
      { id: "tabletop", meta: { traits: ["tabletop.seats", "tabletop.hidden"] }, scope: "objects" },
      { id: "select", meta: {}, scope: "general" },
    ];
    const on = { card: ["tabletop.hidden"], table: ["tabletop.seats"], sole: [], hull: ["sailing.boat"], tiller: ["sailing.tiller"], wall: [] };
    const of = (chain) => {
      const h = holdersFor(sim, chain, (id) => (id === null ? ["arena.level"] : on[id]));
      return { order: chainOrder({ running: sim, holders: h }), holder: Object.fromEntries([...h].map(([k, v]) => [k, v.id])) };
    };
    expect(of(["card", "table", "sole", "hull"])).toEqual({ order: ["tabletop", "sailing", "arena", "select"], holder: { tabletop: "card", sailing: "hull", arena: null } });
    expect(of(["tiller", "hull"])).toEqual({ order: ["sailing", "arena", "select"], holder: { sailing: "tiller", arena: null } });
    expect(of(["wall"])).toEqual({ order: ["arena", "select"], holder: { arena: null } });
  });

  it("two extensions on one object: running order breaks the tie, and only that tie", () => {
    const two = [
      { id: "b", meta: { traits: ["b.t"] }, scope: "objects" },
      { id: "a", meta: { traits: ["a.t"] }, scope: "objects" },
      { id: "c", meta: { traits: ["c.t"] }, scope: "objects" },
    ];
    const on = { x: ["a.t", "b.t"], y: ["c.t"] };
    const h = (chain) => holdersFor(two, chain, (id) => on[id] ?? []);
    expect(chainOrder({ running: two, holders: h(["x", "y"]) })).toEqual(["b", "a", "c"]);
    expect(chainOrder({ running: two, holders: h(["y", "x"]) })).toEqual(["c", "b", "a"]);
  });

  // Every placement of three extensions' traits over a hit chain of up to
  // three objects plus the scene, in every running order, against the spec
  // read literally: walk up the chain, and at each link offer whoever holds
  // it (running order) and hasn't been offered yet; then the general ones.
  it("is the walk up the chain, exhaustively", () => {
    const exts = ["p", "q", "r"];
    const perms = (xs) => (xs.length ? xs.flatMap((x) => perms(xs.filter((y) => y !== x)).map((p) => [x, ...p])) : [[]]);
    const general = { id: "g", meta: {}, scope: "general" };
    let cases = 0;
    for (let len = 0; len <= 3; len++) {
      const chain = ["o0", "o1", "o2"].slice(0, len);
      const links = [...chain, null];
      const subsets = 1 << links.length;
      for (let mask = 0; mask < subsets ** exts.length; mask++) {
        // which links carry each extension's trait
        const placed = Object.fromEntries(exts.map((e, i) => [e, links.filter((_, j) => (Math.floor(mask / subsets ** i) >> j) & 1)]));
        const traitsOf = (id) => exts.filter((e) => placed[e].includes(id)).map((e) => `${e}.t`);
        for (const order of perms(exts)) {
          const run = [...order.map((e) => ({ id: e, meta: { traits: [`${e}.t`] }, scope: "objects" })), general];
          const h = holdersFor(run, chain, traitsOf);
          const want = [];
          links.forEach((link, depth) => {
            for (const e of order) {
              if (placed[e].includes(link) && !want.includes(e)) {
                want.push(e);
                expect(h.get(e)).toEqual({ id: link, depth });
              }
            }
          });
          expect([...h.keys()].sort()).toEqual([...want].sort());
          expect(chainOrder({ running: run, holders: h })).toEqual([...want, "g"]);
          cases++;
        }
      }
    }
    expect(cases).toBe(6 * (2 ** 3 + 4 ** 3 + 8 ** 3 + 16 ** 3));
  });

  it("offers until something claims it; a failing handler is skipped", () => {
    const inputs = {
      a: { click: () => false },
      b: { click: () => { throw new Error("x"); } },
      c: { click: (ev) => ev.who === "c" },
      d: { click: () => true },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(offer(["a", "b", "c", "d"], (id) => inputs[id], "click", (id) => ({ who: id }))).toEqual({ id: "c", result: true });
    expect(offer(["a"], (id) => inputs[id], "click", {})).toBeNull();
    warn.mockRestore();
  });
});
