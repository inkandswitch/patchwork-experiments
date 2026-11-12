// The look rule (rule.js), over every case: who it is turned toward (shown)
// and who may see it (audience) for a viewer `me`, another seated viewer and
// "all", with the item known here or not, and the keeper ready or not; and
// the slot rule over every small arrangement. No sampling.
import { describe, it, expect } from "vitest";
import { bindings, docUrl, itemLook, lookFor } from "./rule.js";

const ME = "me";
const SETS = { unknown: null, nobody: [], "others only": ["you"], me: [ME], "me and others": [ME, "you"], all: "all" };
const has = (set, v) => set === "all" || (Array.isArray(set) && set.includes(v));
const within = (a, s) => a === null || s === null ? a === s : s === "all" || (a !== "all" && a.every((v) => s.includes(v)));
const FACE = { sourceUrl: "automerge:face", name: "Seven of rust" };
const VEIL = { veil: true };

// every pair the stage can hand out: both unknown together, and audience ⊆ shown
const CASES = [];
for (const [an, audience] of Object.entries(SETS)) for (const [sn, shown] of Object.entries(SETS)) {
  if ((audience === null) !== (shown === null) || !within(audience, shown)) continue;
  for (const known of [true, false]) for (const ready of [true, false]) CASES.push({ an, sn, audience, shown, known, ready });
}

describe("the look rule, every case", () => {
  it("covers every consistent (audience, shown) pair, item known or not, ready or not", () => {
    // unknown/unknown, and the 14 pairs of known sets with audience ⊆ shown, each four ways
    expect(CASES.length).toBe(15 * 4);
  });

  for (const c of CASES) {
    const got = lookFor({ ready: c.ready, audience: c.audience, shown: c.shown, viewer: ME, look: c.known ? FACE : null });
    const want = !c.ready || c.audience === null ? null : has(c.audience, ME) && c.known ? FACE : has(c.shown, ME) ? VEIL : null;
    it(`${c.ready ? "ready" : "not ready"}, audience ${c.an}, shown to ${c.sn}, item ${c.known ? "known" : "not known"} → ${want === null ? "its own look" : want === FACE ? "the item" : "the veil"}`, () => {
      expect(got).toEqual(want);
    });
  }

  it("never the item to someone outside the audience, whatever else", () => {
    for (const c of CASES) {
      const got = lookFor({ ready: c.ready, audience: c.audience, shown: c.shown, viewer: ME, look: FACE });
      if (!has(c.audience, ME) || !c.ready) expect(got === FACE).toBe(false);
    }
  });

  it("the cases by name", () => {
    const look = (audience, shown, known = true) => lookFor({ ready: true, audience, shown, viewer: ME, look: known ? FACE : null });
    // in another seat's hand, whichever way up: its back (which back it is, is real information)
    expect(look(["you"], ["you"])).toBeNull();
    // face down on the table: its back
    expect(look([], [])).toBeNull();
    // face up on the table: the item; its keys not here yet: the veil
    expect(look("all", "all")).toBe(FACE);
    expect(look("all", "all", false)).toEqual(VEIL);
    // in my own hand: the item; not known here yet: the veil
    expect(look([ME], [ME])).toBe(FACE);
    expect(look([ME], [ME], false)).toEqual(VEIL);
    // face up behind someone else's screen: the veil (turned toward me, kept from me)
    expect(look(["you"], "all")).toEqual(VEIL);
    expect(look([], "all")).toEqual(VEIL);
    // a listed package is missing (unknown): nothing is said at all
    expect(look(null, null)).toBeNull();
    // someone who is nobody in particular (no viewer id) sees only what all see
    expect(lookFor({ ready: true, audience: "all", shown: "all", viewer: null, look: FACE })).toBe(FACE);
    expect(lookFor({ ready: true, audience: [ME], shown: [ME], viewer: null, look: FACE })).toBeNull();
  });

  it("an item's look is its sourceUrl and name, and nothing else of it", () => {
    expect(itemLook({ sourceUrl: "automerge:x", name: "X", secret: 1 })).toEqual({ sourceUrl: "automerge:x", name: "X" });
    expect(itemLook("a word")).toEqual({});
    expect(itemLook({})).toEqual({});
    expect(itemLook(undefined)).toBeNull();
    expect(itemLook(null)).toBeNull();
  });
});

describe("which object is which slot", () => {
  const T = "keep.plain";
  const A = "automerge:2AaaaAaaaAaaaAaaaAaaaAaaa1";
  const B = "automerge:2BbbbBbbbBbbbBbbbBbbbBbbb1";
  const obj = (by, slot) => ({ traits: { [T]: { by, slot } } });

  it("every arrangement of three objects over two containers and two slots: each slot has one holder, the lowest id", () => {
    const choices = [null, [A, 0], [A, 1], [B, 0], [B, 1]];
    let n = 0;
    for (const x of choices) for (const y of choices) for (const z of choices) {
      n++;
      const objects = {};
      const put = (id, c) => c && (objects[id] = obj(c[0], c[1]));
      // (inserted out of order: the rule goes by id, not by the map's order)
      put("o3", z);
      put("o1", x);
      put("o2", y);
      const b = bindings(objects, T);
      const named = Object.keys(objects);
      // every bound-looking object is either a holder or a clash, never both
      expect([...b.of.keys(), ...b.clashes].sort()).toEqual(named.sort());
      // a slot's holder is the lowest id naming it
      for (const [key, bySlot] of b.slots) for (const [slot, id] of bySlot) {
        const claimants = named.filter((o) => objects[o].traits[T].by === key && objects[o].traits[T].slot === slot).sort();
        expect(id).toBe(claimants[0]);
        expect(b.of.get(id)).toEqual({ key, slot });
        for (const other of claimants.slice(1)) expect(b.clashes).toContain(other);
      }
    }
    expect(n).toBe(125);
  });

  it("ignores what isn't a binding: no container, heads on the url kept bare, a slot that isn't a whole number ≥ 0", () => {
    const b = bindings({ a: obj(`${A}#heads`, 2), b: obj("nonsense", 0), c: obj(A, -1), d: obj(A, 1.5), e: obj(A, "0"), f: { traits: {} }, g: {} }, T);
    expect([...b.of]).toEqual([["a", { key: A, slot: 2 }]]);
    expect(b.clashes).toEqual([]);
    expect(docUrl(`${A}#x`)).toBe(A);
    expect(docUrl(7)).toBeNull();
  });
});
