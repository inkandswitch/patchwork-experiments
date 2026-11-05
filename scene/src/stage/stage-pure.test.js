import { describe, it, expect, vi } from "vitest";
import { assoc, createAtom } from "./atom.js";
import { activeSet, chosenKits, docReason, expandKits } from "./activation.js";
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
    { id: "tabletop", traits: ["tabletop.seats", "tabletop.hidden"], requires: ["hand", "keys"] },
    { id: "arena", traits: ["arena.target"] },
    { id: "hand" },
    { id: "keys" },
    { id: "select" },
    { id: "outline", requires: ["sidebar"] },
    { id: "sidebar" },
    { id: "kits", always: true },
  ];
  const kits = [
    { id: "model", extensions: ["select", "outline", "hand", "missing"] },
    { id: "layout", kits: ["model", "layout"], extensions: ["keys"] },
  ];

  it("expands kits in order, nested where named, once each, ignoring cycles", () => {
    expect(expandKits(kits, ["layout"])).toEqual(["select", "outline", "hand", "missing", "keys"]);
    expect(expandKits(kits, ["nope"])).toEqual([]);
  });

  it("the scene's, then some objects', then the viewer's kits', then always; requirements follow, lending no scope", () => {
    const doc = { traits: { "tabletop.seats": {} }, objects: { c: { traits: { "arena.target": {} } } } };
    const set = activeSet({ metas, kits, kitIds: ["model"], doc });
    expect(set.map((r) => [r.id, r.scope])).toEqual([
      ["tabletop", "scene"],
      ["hand", "viewer"],
      ["keys", "viewer"],
      ["arena", "objects"],
      ["select", "viewer"],
      ["outline", "viewer"],
      ["sidebar", "viewer"],
      ["kits", "viewer"],
    ]);
  });

  it("an object trait is the objects' reason; a scene trait the scene's", () => {
    expect(docReason(metas[0], { objects: { a: { traits: { "tabletop.hidden": {} } } } })).toBe("objects");
    expect(docReason(metas[0], { traits: { "tabletop.seats": {} }, objects: {} })).toBe("scene");
    expect(docReason(metas[4], { objects: {} })).toBeNull();
  });

  it("an empty kit list and no traits leave only what is always on", () => {
    expect(activeSet({ metas, kits, kitIds: [], doc: { objects: {} } }).map((r) => r.id)).toEqual(["kits"]);
  });

  it("kits: the doc's suggestion (else model), plus what this viewer turned on, minus what they turned off", () => {
    expect(chosenKits(null, {})).toEqual(["model"]);
    expect(chosenKits(null, { view: { kits: [] } })).toEqual([]);
    expect(chosenKits({ on: ["layout"], off: ["model"] }, { view: { kits: ["model", "x"] } })).toEqual(["x", "layout"]);
  });
});

describe("the input chain", () => {
  const running = [
    { id: "tabletop", meta: { traits: ["tabletop.seats", "tabletop.hidden"] }, scope: "scene" },
    { id: "arena", meta: { traits: ["arena.target"] }, scope: "objects" },
    { id: "select", meta: {}, scope: "viewer" },
    { id: "gizmo", meta: {}, scope: "viewer" },
  ];
  const traits = { card: ["tabletop.hidden"], crate: ["arena.target"], table: [] };
  const holders = (chain) => holdersFor(running, chain, (id) => traits[id] ?? []);

  it("an objects-scope extension hears only events on its objects", () => {
    expect(chainOrder({ running })).toEqual(["tabletop", "select", "gizmo"]);
    expect(chainOrder({ running, holders: holders(["crate"]) })).toEqual(["arena", "tabletop", "select", "gizmo"]);
  });

  it("armed, then the widget's owner, then the hit chain's holders, then the scene's, then the viewer's — each once", () => {
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
