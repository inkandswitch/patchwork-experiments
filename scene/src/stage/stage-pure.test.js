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
    { id: "gizmo", meta: {}, scope: "general" },
  ];
  const traits = { card: ["tabletop.hidden"], crate: ["arena.target"], table: [] };
  const holders = (chain) => holdersFor(running, chain, (id) => traits[id] ?? []);

  it("an objects-scope extension hears only events on its objects", () => {
    expect(chainOrder({ running })).toEqual(["tabletop", "select", "gizmo"]);
    expect(chainOrder({ running, holders: holders(["crate"]) })).toEqual(["arena", "tabletop", "select", "gizmo"]);
  });

  it("armed, then the widget's owner, then the hit chain's holders, then the scene's, then the general ones — each once", () => {
    expect(chainOrder({ running, armed: "select", widgetOwner: "gizmo", holders: holders(["card"]) })).toEqual(["select", "gizmo", "tabletop"]);
    expect(chainOrder({ running, armed: "gone" })).toEqual(["tabletop", "select", "gizmo"]);
  });

  it("holders: the nearest object up the hit chain with one of the extension's traits", () => {
    expect([...holders(["table", "card", "crate"])]).toEqual([["tabletop", "card"], ["arena", "crate"]]);
    expect(holders([]).size).toBe(0);
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
