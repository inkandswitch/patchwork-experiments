// Undo (HISTORY.md, TOOLS Decisions 2): the editor's own edits only, as inverse
// changes, never anyone's later write. The pure parts, then the recorder the
// editor runs (createEdits) on real Automerge, over every sequence of edits,
// package verbs, process saves, clock acts, undos and redos up to a depth.
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { DEPTH, EMPTY, createEdits, fold, inverse, moved, plain, pushed, same, topOf, valueAt } from "./undo-log.js";

/** A doc over a real Automerge doc, as the recorder writes one: change(fn) → its patches. */
function amHandle(init, url = "automerge:scene") {
  let doc = Automerge.isAutomerge(init) ? init : Automerge.from(init);
  return {
    url,
    doc: () => doc,
    /** as a stage's api.change: what it wrote, as patches */
    change(fn) {
      let patches = [];
      doc = Automerge.change(doc, { patchCallback: (p) => void (patches = p) }, fn);
      return patches;
    },
    /** take in another replica's changes, as a sync does (never through change: no patches for an edit to record) */
    merge(other) {
      doc = Automerge.merge(doc, Automerge.clone(other.doc()));
    },
    /** stand at a doc (a fork of one this handle held) */
    at(d) {
      doc = d;
    },
    free: () => Automerge.free(doc),
  };
}

/** A copy of a doc to go on writing from, as the same actor (its other copies never meet it). */
const fork = (doc) => Automerge.clone(doc, { actor: Automerge.getActorId(doc) });

/**
 * Every sequence of `names` up to `depth` long, each visited once as a node
 * of their tree: a node's state is copied (`copy`) for each of its children
 * and `step(state, seq)` runs the child's last event on it. A sequence's
 * checks at its i-th event depend only on its first i events, so this checks
 * what running each sequence from the start would, once per prefix.
 * @returns how many sequences were visited
 */
function everySequence(depth, names, root, copy, step, drop) {
  let all = 0;
  const visit = (state, seq) => {
    for (const name of names) {
      const s = copy(state);
      const next = [...seq, name];
      step(s, next);
      all++;
      if (next.length < depth) visit(s, next);
      drop(s);
    }
  };
  visit(root, []);
  return all;
}

/** A recorder's stacks in a box a walk can stand at (createEdits' `store`). */
const box = () => {
  let v = EMPTY;
  return { get: () => v, swap: (fn) => void (v = fn(v)), at: (x) => void (v = x) };
};

describe("the pure parts", () => {
  it("plain and same: frozen doc values copied; deep equality, undefined only equal to itself", () => {
    const v = Object.freeze({ a: Object.freeze([1, 2]), b: undefined, c: new Uint8Array([1]) });
    const c = plain(v);
    expect(c).toEqual({ a: [1, 2], c: new Uint8Array([1]) });
    expect(Object.isFrozen(c.a)).toBe(false);
    expect(same(v, c)).toBe(true);
    expect(same({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(same(undefined, null)).toBe(false);
    expect(same([1], { 0: 1 })).toBe(false);
    expect(valueAt({ a: { b: [1] } }, ["a", "b"])).toEqual([1]);
    expect(valueAt({ a: 1 }, ["a", "b"])).toBeUndefined();
  });

  it("fold: a later write keeps the first before; a leaf over earlier ones takes them in; a no-op is dropped", () => {
    const d0 = { objects: { a: { name: "A", transform: { position: [0, 0, 0] } } } };
    const d1 = { objects: { a: { name: "B", transform: { position: [0, 0, 0] } } } };
    const d2 = { objects: { a: { name: "C", transform: { position: [1, 0, 0] } } } };
    let leaves = fold([], [{ path: ["objects", "a", "name"] }], d0, d1);
    expect(leaves).toEqual([{ path: ["objects", "a", "name"], before: "A", after: "B" }]);
    leaves = fold(leaves, [{ path: ["objects", "a", "name"] }, { path: ["objects", "a", "transform", "position", 0] }], d1, d2);
    expect(leaves).toEqual([
      { path: ["objects", "a", "name"], before: "A", after: "C" },
      { path: ["objects", "a", "transform", "position"], before: [0, 0, 0], after: [1, 0, 0] },
    ]);
    // then the object goes: one leaf over both, whose before is the object as it was before the step
    const d3 = { objects: {} };
    leaves = fold(leaves, [{ path: ["objects", "a"] }], d2, d3);
    expect(leaves).toEqual([{ path: ["objects", "a"], before: d0.objects.a, after: undefined }]);
    // back as it was: nothing to undo
    expect(fold(leaves, [{ path: ["objects", "a"] }], d3, d0)).toEqual([]);
  });

  it("inverse: all of it, only while every leaf still holds the step's after and its parent is there", () => {
    const leaves = [
      { path: ["objects", "a", "name"], before: "A", after: "B" },
      { path: ["objects", "b", "name"], before: "X", after: "Y" },
      { path: ["objects", "c"], before: undefined, after: { name: "C" } },
    ];
    expect(inverse(leaves, { objects: { a: { name: "B" }, b: { name: "Y" }, c: { name: "C" } } })).toEqual({
      writes: [
        { path: ["objects", "a", "name"], value: "A" },
        { path: ["objects", "b", "name"], value: "X" },
        { path: ["objects", "c"], value: undefined },
      ],
      changed: [],
    });
    // b written since: nothing at all
    expect(inverse(leaves, { objects: { a: { name: "B" }, b: { name: "Z" }, c: { name: "C" } } })).toEqual({ writes: [], changed: [["objects", "b", "name"]] });
    // a's gone since: its field has nowhere to go
    expect(inverse(leaves.slice(0, 1), { objects: {} })).toEqual({ writes: [], changed: [["objects", "a", "name"]] });
  });

  it("the stacks: per doc; a new step clears redo; at most DEPTH kept", () => {
    let s = EMPTY;
    for (let i = 0; i < DEPTH + 5; i++) s = pushed(s, "u", { label: `e${i}`, parts: [] });
    expect(s.u.undo).toHaveLength(DEPTH);
    expect(topOf(s, "u", "undo").label).toBe(`e${DEPTH + 4}`);
    expect(topOf(s, "v", "undo")).toBeNull();
    s = moved(s, "u", "undo", { label: "back", parts: [] });
    expect(topOf(s, "u", "redo").label).toBe("back");
    s = moved(s, "u", "undo", null);
    expect(topOf(s, "u", "redo").label).toBe("back");
    s = pushed(s, "u", { label: "new", parts: [] });
    expect(s.u.redo).toEqual([]);
  });
});

describe("createEdits on real Automerge", () => {
  const T = (position) => ({ position, rotation: [0, 0, 0], scale: 1 });
  const init = () => ({
    objects: {
      die: { name: "Die", transform: T([0, 0, 0]), traits: { "t.die": { face: 1 } } },
      deck: { name: "Deck", transform: T([2, 0, 0]), traits: { "t.deck": { order: ["c1", "c2", "c3"] } } },
      c1: { name: "C1", transform: T([2, 0.01, 0]) },
      c2: { name: "C2", transform: T([2, 0.02, 0]) },
      c3: { name: "C3", transform: T([2, 0.03, 0]) },
      hull: { name: "Hull", transform: T([0, 0, 5]), saved: 0 },
    },
    order: ["die", "deck", "c1", "c2", "c3", "hull"],
    clock: { running: true, t: 0 },
    view: {},
  });

  it("text written back is spliced, never replaced: a cursor taken before undo and redo still resolves, and an edit elsewhere in the text stays", () => {
    const h = amHandle({ content: "radius: 1.5; width: 60", objects: {}, order: [], clock: { running: true, t: 0 }, view: {} }, "automerge:model");
    const e = createEdits({ handle: h });
    const g = e.begin("Edit model");
    g.change((d) => Automerge.splice(d, ["content"], 8, 3, "4"));
    g.end();
    expect(h.doc().content).toBe("radius: 4; width: 60");
    const at = Automerge.getCursor(h.doc(), ["content"], 17); // the "6" of "60"
    expect(e.take("undo")).toBe(true);
    expect(h.doc().content).toBe("radius: 1.5; width: 60");
    expect(Automerge.getCursorPosition(h.doc(), ["content"], at)).toBe(19);
    expect(e.take("redo")).toBe(true);
    expect(h.doc().content).toBe("radius: 4; width: 60");
    expect(Automerge.getCursorPosition(h.doc(), ["content"], at)).toBe(17);
    // someone's edit elsewhere in the text: the step's after is no longer what the text holds, so undo leaves it be
    h.change((d) => Automerge.splice(d, ["content"], 0, 0, "// "));
    expect(e.take("undo")).toBe(false);
    expect(h.doc().content).toBe("// radius: 4; width: 60");
    h.free();
  });

  it("judge sees the doc before a step's first change and after its last, readable when the step ends; what it says rides on the step", () => {
    const h = amHandle(init());
    const seen = [];
    const judge = ({ before, after }) => {
      seen.push([plain(before.objects.die.transform.position), plain(after.objects.die.transform.position)]);
      return { kept: ["Die"] };
    };
    const e = createEdits({ handle: h, judge });
    const g = e.begin("Move");
    g.change((d) => (d.objects.die.transform.position = [1, 0, 0]));
    h.change((d) => (d.clock.t = 5)); // something else in between: a newer doc
    g.change((d) => (d.objects.die.transform.position = [2, 0, 0]));
    g.end();
    expect(seen).toEqual([[[0, 0, 0], [2, 0, 0]]]);
    expect(e.stacks()[h.url].undo[0]).toMatchObject({ kept: ["Die"] });
    h.free();
  });

  it("a step on another doc (an object's render doc) is undone there, from the scene's stack", () => {
    const h = amHandle(init());
    const r = amHandle({ params: { height: 0.2 } }, "automerge:render");
    const e = createEdits({ handle: h });
    const g = e.begin("Height");
    g.change((d) => (d.params.height = 0.5), r);
    g.end();
    expect(e.labels()).toEqual({ undo: "Height", redo: null });
    e.take("undo");
    expect(r.doc().params.height).toBe(0.2);
    h.free();
    r.free();
  });

  it("nothing left as it was: dropped, and said; not writable: nothing", () => {
    const h = amHandle(init());
    const told = [];
    let canWrite = true;
    const e = createEdits({ handle: h, notify: (t) => told.push(t), writable: () => canWrite });
    const g = e.begin("Move");
    g.change((d) => (d.objects.die.transform.position = [1, 0, 0]));
    g.end();
    canWrite = false;
    expect(e.take("undo")).toBe(false);
    canWrite = true;
    h.change((d) => (d.objects.die.transform.position = [9, 9, 9])); // rolled meanwhile
    expect(e.take("undo")).toBe(false);
    expect(told).toEqual(["Nothing to undo: “Move” has been changed since."]);
    expect(e.labels()).toEqual({ undo: null, redo: null });
    expect(plain(h.doc().objects.die.transform.position)).toEqual([9, 9, 9]);
    h.free();
  });

  // The decision's guarantee, over a finite world. The stage's own edits
  // (move the die, move a card, move the hull, add an object, remove the die),
  // a package's verbs (roll the die: where it lands, how it lies, its face;
  // shuffle the deck: its order and every card's place), a process's save (the
  // hull's place and stamp) and a clock act (pause), and undo and redo: every
  // sequence of up to UNDO_DEPTH (default 4) of those 11. Each leaf of the doc
  // is attributed to whatever wrote it last; after every undo and redo, every
  // leaf it changed was last written by an edit (or an undo or redo of one):
  // undo never un-rolls a die, un-shuffles a deck, rewinds a process or
  // unpauses; and never half an edit (the order always lists exactly the
  // objects). No step on either stack ever holds a leaf only a verb, a save
  // or a pause writes. And an undo straight after an edit restores the doc as
  // it was before it; a redo straight after that undo, as it was after.
  it("over every sequence of edits, verbs, saves, pauses, undos and redos: undo reverts only edits, whole (as undo.js's same judges, pinned by \"plain and same\")", () => {
    const depth = Number(globalThis.process?.env?.UNDO_DEPTH ?? 4);
    const LEAVES = [
      ["objects", "die"],
      ["objects", "die", "transform", "position"],
      ["objects", "die", "transform", "rotation"],
      ["objects", "die", "traits", "t.die", "face"],
      ["objects", "deck", "traits", "t.deck", "order"],
      ["objects", "c1", "transform", "position"],
      ["objects", "c2", "transform", "position"],
      ["objects", "c3", "transform", "position"],
      ["objects", "hull", "transform", "position"],
      ["objects", "hull", "saved"],
      ["clock", "running"],
      ["clock", "t"],
      ["order"],
    ];
    const VERB_ONLY = new Set(
      [
        ["objects", "die", "transform", "rotation"],
        ["objects", "die", "traits", "t.die", "face"],
        ["objects", "deck", "traits", "t.deck", "order"],
        ["objects", "hull", "saved"],
        ["clock", "running"],
        ["clock", "t"],
      ].map((p) => JSON.stringify(p)),
    );
    const key = (p) => JSON.stringify(p);
    const EVENTS = {
      // the stage's own edits
      moveDie: (w, k) => w.edit("Move", (d) => d.objects.die && (d.objects.die.transform.position = [k, 0, 0])),
      moveCard: (w, k) => w.edit("Move", (d) => (d.objects.c1.transform.position = [3, 0, k])),
      moveHull: (w, k) => w.edit("Move", (d) => (d.objects.hull.transform.position = [k, 0, 5])),
      add: (w, k) =>
        w.edit("Add", (d) => {
          d.objects[`n${k}`] = { name: `N${k}`, transform: T([0, k, 0]) };
          d.order.push(`n${k}`);
        }),
      removeDie: (w) =>
        w.edit("Delete", (d) => {
          if (!d.objects.die) return;
          delete d.objects.die;
          d.order.splice(d.order.indexOf("die"), 1);
        }),
      // a package's verbs, a process's save, a clock act: plain writes
      roll: (w, k) =>
        w.write((d) => {
          const die = d.objects.die;
          if (!die) return;
          die.transform.position = [k, 0.5, 1];
          die.transform.rotation = [k, k, 0];
          die.traits["t.die"].face = (k % 6) + 1;
        }),
      shuffle: (w) =>
        w.write((d) => {
          const order = d.objects.deck.traits["t.deck"].order;
          const next = [order[1], order[2], order[0]];
          d.objects.deck.traits["t.deck"].order = next;
          next.forEach((c, i) => (d.objects[c].transform.position = [2, 0.01 * (i + 1), 0]));
        }),
      save: (w, k) =>
        w.write((d) => {
          d.objects.hull.transform.position = [0, 0, 5 + k];
          d.objects.hull.saved = k;
        }),
      pause: (w, k) =>
        w.write((d) => {
          d.clock.running = !d.clock.running;
          d.clock.t = k;
        }),
      undo: (w) => w.take("undo"),
      redo: (w) => w.take("redo"),
    };
    const names = Object.keys(EVENTS);
    const kindOf = (n) => (["moveDie", "moveCard", "moveHull", "add", "removeDie"].includes(n) ? "edit" : n === "undo" || n === "redo" ? "edit" : "verb");
    // one handle and recorder, stood at each node's doc and stacks in turn (a step's parts name the handle)
    const h = amHandle(init());
    const store = box();
    const e = createEdits({ handle: h, store });
    const w = {
      edit: (label, fn) => {
        const g = e.begin(label);
        g.change(fn);
        g.end();
      },
      write: (fn) => h.change(fn),
      take: (which) => e.take(which),
    };
    const root = { doc: h.doc(), stacks: EMPTY, now: plain(h.doc()), last: new Map(LEAVES.map((p) => [key(p), "init"])), prevName: null, prevDoc: null, beforeEdit: null };
    const all = everySequence(
      depth,
      names,
      root,
      (s) => ({ ...s, doc: fork(s.doc), last: new Map(s.last) }),
      (s, seq) => {
        const name = seq.at(-1);
        const k = seq.length;
        h.at(s.doc);
        store.at(s.stacks);
        const before = s.now;
        EVENTS[name](w, k);
        const after = plain(h.doc());
        const where = `${seq.join(",")} @${name}`;
        const changed = LEAVES.filter((p) => !same(valueAt(before, p), valueAt(after, p)));
        if (name === "undo" || name === "redo") {
          for (const p of changed) expect(s.last.get(key(p)), `${where}: ${key(p)}`).not.toBe("verb");
          if (name === "undo" && kindOf(s.prevName) === "edit" && s.prevName !== "undo" && s.prevName !== "redo" && s.beforeEdit && !same(s.beforeEdit.before, s.beforeEdit.after)) expect(same(after, s.beforeEdit.before), where).toBe(true);
          if (name === "redo" && s.prevName === "undo" && !same(s.prevDoc, before)) expect(same(after, s.prevDoc), where).toBe(true);
        }
        // never half an edit: the order lists exactly the objects there are, whatever undo and redo did
        expect([...after.order].sort(), where).toEqual(Object.keys(after.objects).sort());
        for (const p of changed) s.last.set(key(p), kindOf(name));
        if (kindOf(name) === "edit" && name !== "undo" && name !== "redo") s.beforeEdit = { before, after };
        // no stack holds a leaf only verbs, saves and pauses write
        for (const st of Object.values(e.stacks())) for (const step of [...st.undo, ...st.redo]) for (const part of step.parts) for (const l of part.leaves) expect(VERB_ONLY.has(key(l.path)), `${where}: ${key(l.path)} on a stack`).toBe(false);
        Object.assign(s, { doc: h.doc(), stacks: store.get(), now: after, prevDoc: before, prevName: name });
      },
      (s) => Automerge.free(s.doc),
    );
    expect(all).toBe([...Array(depth)].reduce((a, _, i) => a + names.length ** (i + 1), 0));
  }, 300_000);

  // The same guarantee with two people, each on their own replica with their
  // own stack: A's edits (move the die, move the hull, delete the die), a
  // package's verb (roll the die) and a process's save (the hull) on A's
  // replica, B's edits (move the die: the same field as A's and the roll's;
  // move a card: a different one) on B's, each one's undo and redo, and a
  // sync (both ways), so B's edits reach A merged at once, after several
  // steps, or concurrently with A's own writes to the same field. Every
  // value written is the writer's own (no two writes write the same value),
  // and each leaf's every value remembers who wrote it (`by`; a value a
  // merge made, such as a list both changed, is the merge's). Over every
  // sequence of up to UNDO_PAIR_DEPTH (default 4) of those 12 (20,736 at
  // 4, with the shorter ones 22,620): an undo or
  // redo of A's changes only leaves that hold a value A wrote (by an edit,
  // an undo or a redo), and B's likewise; neither stack holds a leaf only a
  // verb or a save writes; and on both replicas the order lists exactly the
  // objects.
  it("two people on two replicas, merged at once, later or concurrently: undo reverts only my own edits, whole (as undo.js's same judges, pinned by \"plain and same\")", () => {
    const depth = Number(globalThis.process?.env?.UNDO_PAIR_DEPTH ?? 4);
    const LEAVES = [
      ["objects", "die"],
      ["objects", "die", "transform", "position"],
      ["objects", "die", "transform", "rotation"],
      ["objects", "c1", "transform", "position"],
      ["objects", "hull", "transform", "position"],
      ["objects", "hull", "saved"],
      ["order"],
    ];
    const VERB_ONLY = new Set([JSON.stringify(["objects", "die", "transform", "rotation"]), JSON.stringify(["objects", "hull", "saved"])]);
    const key = (p) => JSON.stringify(p);
    // the die itself is there or not (its fields are their own leaves: a merge mixes them)
    const look = (doc, p) => (p.length === 2 ? valueAt(doc, p) !== undefined : valueAt(doc, p));
    const vkey = (v) => JSON.stringify(v === undefined ? "∅" : v);
    const EVENTS = {
      moveDie: { who: "A", run: (w, k) => w.edit("A", "Move", (d) => d.objects.die && (d.objects.die.transform.position = [k, 0, 0])) },
      moveHull: { who: "A", run: (w, k) => w.edit("A", "Move", (d) => (d.objects.hull.transform.position = [k, 0, 5])) },
      removeDie: {
        who: "A",
        run: (w) =>
          w.edit("A", "Delete", (d) => {
            if (!d.objects.die) return;
            delete d.objects.die;
            d.order.splice(d.order.indexOf("die"), 1);
          }),
      },
      undo: { who: "A", run: (w) => w.take("A", "undo") },
      redo: { who: "A", run: (w) => w.take("A", "redo") },
      roll: {
        who: "verb",
        run: (w, k) =>
          w.write("A", (d) => {
            if (!d.objects.die) return;
            d.objects.die.transform.position = [k, 0.5, 1];
            d.objects.die.transform.rotation = [k, k, 0];
          }),
      },
      save: {
        who: "verb",
        run: (w, k) =>
          w.write("A", (d) => {
            d.objects.hull.transform.position = [0, 0.5, 5 + k];
            d.objects.hull.saved = k;
          }),
      },
      bMoveDie: { who: "B", run: (w, k) => w.edit("B", "Move", (d) => d.objects.die && (d.objects.die.transform.position = [k, 1, 0])) },
      bMoveCard: { who: "B", run: (w, k) => w.edit("B", "Move", (d) => (d.objects.c1.transform.position = [3, 1, k])) },
      bUndo: { who: "B", run: (w) => w.take("B", "undo") },
      bRedo: { who: "B", run: (w) => w.take("B", "redo") },
      sync: { who: "merge", run: (w) => w.sync() },
    };
    const names = Object.keys(EVENTS);
    const takes = new Set(["undo", "redo", "bUndo", "bRedo"]);
    // one handle and recorder per replica, stood at each node's docs and stacks in turn
    const a = amHandle(init());
    const b = amHandle(Automerge.load(Automerge.save(a.doc())));
    const h = { A: a, B: b };
    const store = { A: box(), B: box() };
    const e = { A: createEdits({ handle: a, store: store.A }), B: createEdits({ handle: b, store: store.B }) };
    const w = {
      edit: (who, label, fn) => {
        const g = e[who].begin(label);
        g.change(fn);
        g.end();
      },
      write: (who, fn) => h[who].change(fn),
      take: (who, which) => e[who].take(which),
      sync: () => {
        a.merge(b);
        b.merge(a);
      },
    };
    // leaf → value → who wrote it
    const by0 = new Map(LEAVES.map((p) => [key(p), new Map([[vkey(look(plain(a.doc()), p)), new Set(["init"])]])]));
    const copyBy = (by) => new Map([...by].map(([p, m]) => [p, new Map([...m].map(([v, s]) => [v, new Set(s)]))]));
    const root = { doc: { A: a.doc(), B: b.doc() }, stacks: { A: EMPTY, B: EMPTY }, now: { A: plain(a.doc()), B: plain(b.doc()) }, by: by0 };
    const all = everySequence(
      depth,
      names,
      root,
      (s) => ({ ...s, doc: { A: fork(s.doc.A), B: fork(s.doc.B) }, by: copyBy(s.by) }),
      (s, seq) => {
        const name = seq.at(-1);
        const k = seq.length;
        const by = s.by;
        const wrote = (p, v, who) => {
          const m = by.get(key(p));
          if (!m.has(vkey(v))) m.set(vkey(v), new Set());
          m.get(vkey(v)).add(who);
        };
        for (const r of ["A", "B"]) {
          h[r].at(s.doc[r]);
          store[r].at(s.stacks[r]);
        }
        const { who, run } = EVENTS[name];
        const before = s.now;
        run(w, k);
        const after = { A: plain(a.doc()), B: plain(b.doc()) };
        const where = `${seq.join(",")} @${name}#${k}`;
        for (const r of ["A", "B"]) {
          const changed = LEAVES.filter((p) => !same(look(before[r], p), look(after[r], p)));
          if (takes.has(name) && r === who) {
            // an undo or redo of mine only ever changes a leaf that holds a value I wrote
            for (const p of changed) expect(by.get(key(p)).get(vkey(look(before[r], p))) ?? new Set(), `${where}: ${key(p)}`).toContain(who);
          }
          for (const p of changed) {
            const v = look(after[r], p);
            // a sync brings values someone wrote; one nobody wrote (a list both changed) is the merge's
            if (name === "sync") {
              if (!by.get(key(p)).has(vkey(v))) wrote(p, v, "merge");
            } else wrote(p, v, who);
          }
          // never half an edit: the order lists exactly the objects there are
          expect([...after[r].order].sort(), `${where} on ${r}`).toEqual(Object.keys(after[r].objects).sort());
        }
        for (const r of ["A", "B"])
          for (const st of Object.values(e[r].stacks()))
            for (const step of [...st.undo, ...st.redo]) for (const part of step.parts) for (const l of part.leaves) expect(VERB_ONLY.has(key(l.path)), `${where}: ${key(l.path)} on ${r}'s stack`).toBe(false);
        s.doc = { A: a.doc(), B: b.doc() };
        s.stacks = { A: store.A.get(), B: store.B.get() };
        s.now = after;
      },
      (s) => {
        Automerge.free(s.doc.A);
        Automerge.free(s.doc.B);
      },
    );
    expect(all).toBe([...Array(depth)].reduce((a, _, i) => a + names.length ** (i + 1), 0));
  }, 300_000);
});
