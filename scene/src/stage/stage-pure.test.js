import { describe, it, expect, vi } from "vitest";
import { assoc, createAtom } from "./atom.js";
import { activeSet, docReason, ownReason } from "./activation.js";
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

describe("activation: traits only (STAGE.md, “Activation”)", () => {
  const metas = [
    { id: "tabletop", traits: ["tabletop.seats", "tabletop.hidden"] },
    { id: "arena", traits: ["arena.target"] },
    { id: "keys" },
    { id: "select" },
    { id: "boat", traits: ["boat.hull"] },
    { id: "clock" },
  ];
  const ids = (set) => set.map((r) => [r.id, r.scope]);
  const doc = { traits: { "tabletop.seats": {} }, objects: { c: { traits: { "arena.target": {} } } } };

  it("the scene's, then some objects', then the general ones, each in registry order; traits the doc lacks (the boat's) run nothing", () => {
    expect(ids(activeSet({ metas, doc }))).toEqual([
      ["tabletop", "scene"],
      ["arena", "objects"],
      ["keys", "general"],
      ["select", "general"],
      ["clock", "general"],
    ]);
    expect(ids(activeSet({ metas, doc: {} }))).toEqual([
      ["keys", "general"],
      ["select", "general"],
      ["clock", "general"],
    ]);
  });

  it("an object trait is the objects' reason; a scene trait the scene's; none declared is general; declared but absent is nothing", () => {
    expect(docReason(metas[0], { objects: { a: { traits: { "tabletop.hidden": {} } } } })).toBe("objects");
    expect(docReason(metas[0], { traits: { "tabletop.seats": {} }, objects: {} })).toBe("scene");
    expect(ownReason(metas[2], { objects: {} })).toBe("general");
    expect(ownReason(metas[4], doc)).toBeNull();
  });

  it("fields that used to route around activities change nothing: activities, requires, always, general: false", () => {
    const plain = [{ id: "game", traits: ["game.board"] }, { id: "prompt" }];
    const decorated = [
      { id: "game", traits: ["game.board"], activities: ["play"], requires: ["prompt", "other"] },
      { id: "prompt", general: false, always: true, activities: ["edit"] },
    ];
    for (const d of [{}, { traits: { "game.board": {} } }]) expect(ids(activeSet({ metas: decorated, doc: d }))).toEqual(ids(activeSet({ metas: plain, doc: d })));
  });

  // Exhaustive over a finite world: every subset of six extensions (one of each
  // kind: scene trait, object trait, both, none, a trait nobody writes, every
  // doc's) × every
  // doc made of {no trait, scene trait, object trait, both}. What runs, and in
  // what order, is the rule and nothing else.
  it("over every subset of six extensions (one of each kind, and one of every doc: traits [\"*\"]) × four docs: scope = the rule, order = scene, objects, general, each once", () => {
    const pool = [
      { id: "s", traits: ["t.s"] },
      { id: "o", traits: ["t.o"] },
      { id: "so", traits: ["t.s", "t.o"] },
      { id: "g" },
      { id: "x", traits: ["t.x"] },
      { id: "any", traits: ["*"] },
    ];
    const docs = [{}, { traits: { "t.s": {} } }, { objects: { a: { traits: { "t.o": {} } } } }, { traits: { "t.s": {} }, objects: { a: { traits: { "t.o": {} } } } }];
    // the rule, spelt out: every doc calls for "any" (and only it, of these, with nothing in the doc)
    const reason = { s: [null, "scene", null, "scene"], o: [null, null, "objects", "objects"], so: [null, "scene", "objects", "scene"], g: Array(4).fill("general"), x: Array(4).fill(null), any: Array(4).fill("scene") };
    for (const m of pool) for (const [i, d] of docs.entries()) expect([m.id, i, ownReason(m, d)]).toEqual([m.id, i, reason[m.id][i]]);
    const rank = { scene: 0, objects: 1, general: 2 };
    let cases = 0;
    for (let mask = 0; mask < 1 << pool.length; mask++) {
      const ms = pool.filter((_, i) => mask & (1 << i));
      for (const d of docs) {
        const set = activeSet({ metas: ms, doc: d });
        const want = ms.filter((m) => ownReason(m, d)).map((m) => [m.id, ownReason(m, d)]);
        expect(new Set(set.map((r) => r.id)).size).toBe(set.length);
        expect(set.map((r) => [r.id, r.scope]).sort()).toEqual([...want].sort());
        for (let i = 1; i < set.length; i++) {
          expect(rank[set[i - 1].scope] <= rank[set[i].scope]).toBe(true);
          if (set[i - 1].scope === set[i].scope) expect(ms.indexOf(set[i - 1].meta) < ms.indexOf(set[i].meta)).toBe(true);
        }
        cases++;
      }
    }
    expect(cases).toBe(256);
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

  it("the widget's owner, then the holders nearest first, then the general ones — each once", () => {
    expect(chainOrder({ running, widgetOwner: "halo", holders: holders(["card"]) })).toEqual(["halo", "tabletop", "select"]);
    expect(chainOrder({ running, widgetOwner: "gone", holders: holders([]) })).toEqual(["tabletop", "select", "halo"]);
  });

  it("holders: the nearest link up the hit chain with one of the extension's traits, the scene last (id null)", () => {
    expect([...holders(["table", "card", "crate"])]).toEqual([["tabletop", { id: "card", depth: 1 }], ["arena", { id: "crate", depth: 2 }]]);
    expect([...holders([])]).toEqual([["tabletop", { id: null, depth: 0 }]]);
    expect([...holders(["crate"])]).toEqual([["tabletop", { id: null, depth: 1 }], ["arena", { id: "crate", depth: 0 }]]);
  });

  it("a part of every doc (traits [\"*\"]) is held by the scene, whatever the hit and whatever traits the doc has", () => {
    const any = [{ id: "any", meta: { traits: ["*"] }, scope: "scene" }];
    for (const scene of [[], ["tabletop.seats"]])
      for (const chain of [[], ["card"], ["table", "card", "crate"]]) {
        const h = holdersFor(any, chain, (id) => (id === null ? scene : (traits[id] ?? [])));
        expect([scene, chain, [...h]]).toEqual([scene, chain, [["any", { id: null, depth: chain.length }]]]);
      }
  });

  // STAGE.md's sailing case: a card on the saloon table of a boat in an arena level.
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
