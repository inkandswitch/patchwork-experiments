import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { choose, count, forget, inside, itemKey, kinds, outside, putIn, shadowsFor, strays, takeOut, verdict } from "./contents.js";
import { BagDatatype, lookOf, newBag } from "./datatype.js";
import { kindOf } from "./object.js";

const S1 = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
const S2 = "automerge:3yt6LbnDAzvNj9WDNDA4ew21R85G";
const thing = (id, name = id) => ({ id, object: { name, sourceUrl: `automerge:glb-${name}`, providerId: "file-glb" }, scale: 1 });
const filled = (...ids) => {
  const d = newBag();
  putIn(d, ids.map((id) => thing(id)), { from: S1 });
  return d;
};

describe("a bag's contents", () => {
  it("a new bag is empty, with the map its contents live in", () => {
    const d = {};
    BagDatatype.init(d);
    expect(d).toEqual({ title: "Token bag", look: { color: "#7a5a3a", size: 0.2 }, rule: "random", items: {} });
    expect(newBag()["@patchwork"]).toEqual({ type: "bag" });
    expect(count(d)).toBe(0);
    expect(inside(null)).toEqual([]);
  });

  it("a copy of a bag starts empty: an item is in one place", () => {
    const d = filled("a", "b");
    BagDatatype.markCopy(d);
    expect([d.title, count(d)]).toEqual(["Copy of Token bag", 0]);
  });

  it("a look is filled in and held within reason", () => {
    expect(lookOf({})).toEqual({ color: "#7a5a3a", size: 0.2 });
    expect(lookOf({ look: { color: "#AABBCC", size: 0.35 } })).toEqual({ color: "#aabbcc", size: 0.35 });
    expect(lookOf({ look: { color: "red", size: 900 } })).toEqual({ color: "#7a5a3a", size: 2 });
    expect(lookOf({ look: { size: -1 } }).size).toBe(0.2);
  });

  it("one key per object per scene, the same whoever asks", () => {
    expect(itemKey(S1, "o1")).toBe("o1@2zt6LbnDAzvNj9WDNDA4ew21R85F");
    expect(itemKey(`${S1}#heads`, "o1")).toBe(itemKey(S1, "o1"));
    expect(itemKey(S2, "o1")).not.toBe(itemKey(S1, "o1"));
    expect(itemKey(null, "o1")).toBe("o1");
  });

  it("things go in in order, a take marks the puts it saw, and a tombstone keeps the record", () => {
    const d = filled("a", "b", "c");
    expect(inside(d).map((x) => x.entry.id)).toEqual(["a", "b", "c"]);
    expect(inside(d).map((x) => x.entry.n)).toEqual([1, 2, 3]);
    expect(Object.keys(d.items).every((tag) => /^[abc]@2zt6LbnDAzvNj9WDNDA4ew21R85F#\w+$/.test(tag))).toBe(true);
    const take = takeOut(d, itemKey(S1, "b"), "me");
    expect([take.key, take.tags.length, take.seen, take.stamp]).toEqual([itemKey(S1, "b"), 1, [], 4]);
    expect(inside(d).map((x) => x.entry.id)).toEqual(["a", "c"]);
    expect(outside(d).map((x) => [x.entry.id, x.entry.out, x.entry.object.name])).toEqual([["b", { by: "me", n: 4 }, "b"]]);
    expect(verdict(d, take, "me")).toBe("mine");
    expect(takeOut(d, itemKey(S1, "b"), "me")).toBeNull(); // not listed: nothing to take
    // put back: a new put, after everything there; the old one stays a tombstone
    putIn(d, [thing("b")], { from: S1 });
    expect(inside(d).map((x) => x.entry.id)).toEqual(["a", "c", "b"]);
    expect(outside(d)).toEqual([]);
    expect(Object.keys(d.items).length).toBe(4);
    // a take that didn't see that put stands; the next take records the old one as seen
    expect(verdict(d, take, "me")).toBe("mine");
    const again = takeOut(d, itemKey(S1, "b"), "you");
    expect([again.tags.length, again.seen, again.stamp]).toEqual([1, take.tags, 6]);
    expect(verdict(d, again, "you")).toBe("mine");
    forget(d);
    expect(inside(d).map((x) => x.entry.id)).toEqual(["a", "c"]);
    expect(Object.keys(d.items).length).toBe(2);
    // forgotten marks say nothing either way
    expect([verdict(d, take, "me"), verdict(d, again, "you")]).toEqual(["mine", "mine"]);
  });

  it("an item with two live puts is one item; taking it takes both", () => {
    const d = filled("a");
    putIn(d, [thing("a", "a again")], { from: S1 });
    expect(inside(d).map((x) => [x.entry.object.name, x.tags.length])).toEqual([["a again", 2]]);
    expect(count(d)).toBe(1);
    const take = takeOut(d, itemKey(S1, "a"), "me");
    expect(take.tags.length).toBe(2);
    expect(count(d)).toBe(0);
    expect(outside(d).length).toBe(1);
  });

  it("the same id from two scenes is two items", () => {
    const d = newBag();
    putIn(d, [thing("o1", "cube")], { from: S1 });
    putIn(d, [thing("o1", "disc")], { from: S2 });
    expect(inside(d).map((x) => x.entry.object.name)).toEqual(["cube", "disc"]);
  });

  it("choose takes the item the rule's index names, over put order", () => {
    const d = filled("a", "b", "c");
    expect(choose(d, "top").entry.id).toBe("c");
    expect(["a", "b", "c"].map((_, k) => choose(d, "random", { random: () => (k + 0.5) / 3 }).entry.id)).toEqual(["a", "b", "c"]);
    expect(choose(d, "random", { random: () => 0, shadow: (key) => key === itemKey(S1, "a") }).entry.id).toBe("b");
    expect(choose(newBag(), "random")).toBeNull();
  });

  it("contents by kind: alike in name and look, counted", () => {
    const d = newBag();
    putIn(d, [thing("a", "Cube"), thing("b", "Disc"), thing("c", "Cube"), thing("d", "Cube")], { from: S1 });
    expect(kinds(inside(d), kindOf).map((k) => [k.name, k.n])).toEqual([["Cube", 3], ["Disc", 1]]);
  });

  it("the scene wins: an entry whose object is in its scene isn't inside, for this scene only", () => {
    const d = filled("a", "b");
    const has = (id) => id === "a";
    expect(strays(d, { sceneUrl: S1, has })).toEqual([itemKey(S1, "a")]);
    expect(strays(d, { sceneUrl: S2, has })).toEqual([]); // another scene's "a" is another object
    const sh = shadowsFor([{ url: "automerge:bag1", doc: d }], { sceneUrl: S1, has });
    expect(inside(d, sh.get("automerge:bag1")).map((x) => x.entry.id)).toEqual(["b"]);
    expect(count(d, sh.get("automerge:bag1"))).toBe(1);
  });

  it("an item listed in two bags of a scene is inside the first by URL, whatever order they're given in", () => {
    const one = filled("a", "b");
    const two = filled("b", "c");
    for (const bags of [[{ url: "automerge:b1", doc: one }, { url: "automerge:b2", doc: two }], [{ url: "automerge:b2", doc: two }, { url: "automerge:b1", doc: one }]]) {
      const sh = shadowsFor(bags, { sceneUrl: S1, has: () => false });
      expect(inside(one, sh.get("automerge:b1")).map((x) => x.entry.id)).toEqual(["a", "b"]);
      expect(inside(two, sh.get("automerge:b2")).map((x) => x.entry.id)).toEqual(["c"]);
    }
  });
});

describe("what Automerge makes of two peers' writes", () => {
  const fork = (doc) => [Automerge.clone(doc), Automerge.clone(doc)];
  const both = (a, b) => [Automerge.merge(Automerge.clone(a), Automerge.clone(b)), Automerge.merge(Automerge.clone(b), Automerge.clone(a))];
  const base = () => Automerge.change(Automerge.from(newBag()), (d) => void putIn(d, [thing("a"), thing("b")], { from: S1 }));
  const A = itemKey(S1, "a");
  const take = (doc, key, by) => {
    let t;
    const next = Automerge.change(doc, (d) => void (t = takeOut(d, key, by)));
    return [next, t];
  };

  it("two draws of one item: both peers read the same winner, so exactly one of them has it (either way round)", () => {
    for (const [first, second] of [["p", "q"], ["q", "p"]]) {
      const [x, y] = fork(base());
      const [p, tp] = take(x, A, first);
      const [q, tq] = take(y, A, second);
      for (const m of both(p, q)) {
        expect([verdict(m, tp, first), verdict(m, tq, second)].sort()).toEqual(["lost", "mine"]);
        expect(inside(m).map((x) => x.entry.id)).toEqual(["b"]);
      }
      // and before they've heard of each other, each reads its own as its own
      expect([verdict(p, tp, first), verdict(q, tq, second)]).toEqual(["mine", "mine"]);
    }
  });

  it("two draws that marked different puts of one item: still exactly one winner, the lower stamp", () => {
    // the item has two live puts; p saw only the first when it drew, q saw both
    let doc = base();
    const [one] = fork(doc);
    doc = Automerge.change(doc, (d) => void putIn(d, [thing("a")], { from: S1 }));
    const [p, tp] = take(one, A, "p");
    const [q, tq] = take(Automerge.clone(doc), A, "q");
    expect([tp.tags.length, tq.tags.length, tp.stamp, tq.stamp]).toEqual([1, 2, 3, 4]);
    for (const m of both(p, q)) {
      const v = [verdict(m, tp, "p"), verdict(m, tq, "q")];
      expect(v.sort()).toEqual(["lost", "mine"]);
      // q always has a surviving mark (the put p never saw), and p's stamp is lower: p has it iff its mark survived
      expect(verdict(m, tp, "p")).toBe(m.items[tp.tags[0]].out.by === "p" ? "mine" : "lost");
      expect(count(m)).toBe(1);
    }
  });

  it("two puts of one object: two puts, one item", () => {
    let [p, q] = fork(base());
    p = Automerge.change(p, (d) => void putIn(d, [{ id: "c", object: { name: "from p" }, scale: 2 }], { from: S1 }));
    q = Automerge.change(q, (d) => void putIn(d, [{ id: "c", object: { name: "from q" }, scale: 3 }], { from: S1 }));
    for (const m of both(p, q)) {
      expect(inside(m).map((x) => [x.entry.id, x.tags.length])).toEqual([["a", 1], ["b", 1], ["c", 2]]);
      expect(count(m)).toBe(3);
    }
  });

  it("a put is never undone by a take that hadn't seen it: the item is inside (add wins)", () => {
    // p took a and put it back; q, who has heard of neither, takes a too
    const [x, y] = fork(base());
    let [p] = take(x, A, "p");
    p = Automerge.change(p, (d) => void putIn(d, [thing("a")], { from: S1 }));
    const [q] = take(y, A, "q");
    for (const m of both(p, q)) expect(inside(m).map((x) => x.entry.id).sort()).toEqual(["a", "b"]);
  });
});
