// The invariant, over every interleaving. Two peers each hold their own
// replicas of the scene doc and of two bag docs (real Automerge documents);
// each runs a short program of puts, draws and pours; and between any two
// steps any one doc may or may not have reached the other peer. Every
// reachable state is visited (a search over steps and deliveries, each
// random draw branching over every item it could take), and at every end
// state, once everything has been delivered:
//
//   - each item is in exactly one place by the readers' rule (contents.js,
//     STRAYS): an object in the scene, or inside one bag;
//   - no item is gone from the docs as written (it is an object, or listed);
//   - both peers' docs are the same;
//   - no item is held by both peers, and what a peer holds is in the scene.
//
// Two things the stage does that aren't in the docs are modelled as it does
// them: a view doesn't put away a piece another view is holding (the
// extension refuses: api.heldBy), and of two views still holding one object
// once everything is delivered, the stage lets one hand keep it, the other
// giving it up and drawing again (`arbitrate`; extension.js step). Two draws
// from one bag never need the second: the bag's own verdict names one drawer.
//
// Nothing here is random and nothing is sampled: the programs are listed and
// the search is exhaustive.

import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { inside, putIn, shadowsFor } from "./contents.js";
import { drawOne, objectOf, pour, putObjects, settleDraw } from "./moves.js";

const SCENE = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
const BAGS = { B1: "automerge:3AAAAAAAAAAAAAAAAAAAAAAAAAAA", B2: "automerge:3BBBBBBBBBBBBBBBBBBBBBBBBBBB" };
const DOCS = ["S", "B1", "B2"];
const PEERS = ["p", "q"];
const ACTOR = { p: "aa", q: "bb" };
const token = (name) => ({ name, sourceUrl: `automerge:glb${name}`, providerId: "file-glb", renderUrl: null, visible: true, color: null, opacity: 1, wireframe: false, transform: { position: [1, 0, 2], rotation: [0, 0.5, 0], scale: 1 }, parent: null, group: null });
const T0 = { time: 0 };

// Every Automerge doc a search makes lives in the wasm heap until it is
// freed; a search makes tens of thousands. Each is noted here and freed when
// its search ends (explore).
let made = [];
const note = (doc) => (made.push(doc), doc);

/** The start: tokens a and b inside bag 1, token c on the table, bag 2 empty. */
function start() {
  const S = Automerge.from({ objects: { c: token("c") }, order: ["c"] }, { actor: "00" });
  let B1 = Automerge.from({ items: {} }, { actor: "01" });
  let t = 0;
  B1 = Automerge.change(B1, T0, (d) => putIn(d, [{ id: "a", object: token("a") }, { id: "b", object: token("b") }].map((x) => ({ ...x, object: (({ transform, parent, group, ...r }) => r)(x.object) })), { from: SCENE, tag: () => `s${++t}` }));
  const B2 = Automerge.from({ items: {} }, { actor: "02" });
  const docs = {};
  for (const w of PEERS) docs[w] = { S: note(Automerge.clone(S, { actor: ACTOR[w] })), B1: note(Automerge.clone(B1, { actor: ACTOR[w] })), B2: note(Automerge.clone(B2, { actor: ACTOR[w] })) };
  return docs;
}

const ITEMS = ["a", "b", "c"];

/** One peer's side of a state, as the handles the moves want. Writes replace the peer's doc in `st`. */
function side(st, w) {
  const handle = (name) => ({
    doc: () => st.docs[w][name],
    // (a doc is shared between the states that haven't changed it: copy it to write)
    change: (fn) => (st.docs[w][name] = note(Automerge.change(Automerge.clone(st.docs[w][name], { actor: ACTOR[w] }), T0, fn))),
  });
  const S = handle("S");
  const bags = { B1: handle("B1"), B2: handle("B2") };
  const has = (id) => !!S.doc().objects[id];
  const shadows = () => shadowsFor(Object.entries(bags).map(([k, h]) => ({ url: BAGS[k], doc: h.doc() })), { sceneUrl: SCENE, has });
  return { S, bags, has, shadows };
}

/** What a view does after any change: settle its draws. */
function settle(st, w) {
  const { S, bags, has } = side(st, w);
  const me = st.peers[w];
  for (const drawn of [...me.held]) {
    if (settleDraw(bags[drawn.bag].doc(), drawn, w, has) !== "lost") continue;
    me.held = me.held.filter((x) => x !== drawn);
    if (drawn.fresh && has(drawn.id)) S.change((d) => delete d.objects[drawn.id]);
    me.prog = [`draw:${drawn.bag}`, ...me.prog]; // the loser draws again
  }
}

/** The states one step of peer `w` leads to (a random draw: one per item it could take). */
function step(st, w) {
  const [op, ...rest] = st.peers[w].prog;
  const [verb, arg] = op.split(":");
  const outs = [];
  const run = (fn) => {
    const next = fork(st);
    next.peers[w].prog = rest;
    next.trace = [...(st.trace ?? []), `${w}:${op}`];
    fn(next, side(next, w));
    settle(next, w);
    outs.push(next);
  };
  if (verb === "put") {
    const [id, bag] = arg.split(">");
    run((next, s) => {
      const which = id === "held" ? next.peers[w].held.at(-1)?.id : id;
      if (!which || !s.has(which)) return; // nothing there to put: the step is spent
      if (next.peers[other(w)].held.some((x) => x.id === which)) return; // in the other's hand: not this view's to put away
      next.peers[w].held = next.peers[w].held.filter((x) => x.id !== which);
      putObjects({
        objects: s.S.doc().objects,
        ids: [which],
        sceneUrl: SCENE,
        remove: (ids) => s.S.change((d) => { for (const x of ids) { delete d.objects[x]; const i = [...d.order].indexOf(x); if (i >= 0) d.order.splice(i, 1); } }),
        bag: s.bags[bag],
        tag: () => `${w}${++next.peers[w].ids}`,
      });
    });
  } else if (verb === "draw") {
    const n = inside(st.docs[w][arg], side(st, w).shadows().get(BAGS[arg])).length;
    // every item the draw could take (n = 0: one state, nothing drawn)
    for (let k = 0; k < Math.max(1, n); k++) {
      run((next, s) => {
        const drawn = drawOne({
          bag: s.bags[arg],
          rule: "random",
          by: w,
          random: () => (k + 0.5) / Math.max(1, n),
          shadow: s.shadows().get(BAGS[arg]),
          scene: {
            url: SCENE,
            has: s.has,
            newId: () => `${w}${++next.peers[w].ids}`,
            insert: (id, entry) => s.S.change((d) => { d.objects[id] = objectOf(entry, { position: [0.3, 0, 0] }); if (![...d.order].includes(id)) d.order.push(id); }),
          },
        });
        if (drawn) next.peers[w].held.push({ ...drawn, entry: undefined, bag: arg });
      });
    }
  } else if (verb === "pour") {
    run((next, s) => pour({ from: s.bags.B1, to: s.bags.B2, by: w, shadow: s.shadows().get(BAGS.B1), tag: () => `${w}${++next.peers[w].ids}` }));
  } else throw new Error(`unknown op ${op}`);
  return outs;
}

/** Deliver one doc from one peer to the other; the receiver then settles. Null when there is nothing to deliver. */
function deliver(st, name, from, to) {
  const have = new Set(Automerge.getHeads(st.docs[to][name]));
  if (Automerge.getHeads(st.docs[from][name]).every((h) => have.has(h)) || Automerge.hasHeads(st.docs[to][name], Automerge.getHeads(st.docs[from][name]))) return null;
  const next = fork(st);
  next.docs[to][name] = note(Automerge.merge(Automerge.clone(st.docs[to][name], { actor: ACTOR[to] }), st.docs[from][name]));
  next.trace = [...(st.trace ?? []), `${name}:${from}>${to}`];
  settle(next, to);
  return next;
}

/** A copy of a state that can be changed on its own: the docs are shared until one is written (side, deliver). */
function fork(st) {
  const docs = {};
  for (const w of PEERS) docs[w] = { ...st.docs[w] };
  return { docs, peers: JSON.parse(JSON.stringify(st.peers)), trace: st.trace };
}

/** JSON with every map's keys sorted (a merged map hands its keys back in no promised order). */
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

const other = (w) => (w === "p" ? "q" : "p");

/**
 * Two views hold one object, and the docs, fully delivered, can't tell them
 * apart (each drew it through a different bag, or one put it away under the
 * other's hand and drew it again): the stage's hold order lets one hand keep
 * it, and the other gives it up once the first puts it down, and draws
 * again. Here the later draw gives way (by stamp, then by name), as the
 * stage's order is by who took hold first. Null while anything is still to
 * be delivered (the bag's verdict comes first), or no object is held twice.
 */
function arbitrate(st) {
  for (const name of DOCS) if (stable(Automerge.getHeads(st.docs.p[name]).slice().sort()) !== stable(Automerge.getHeads(st.docs.q[name]).slice().sort())) return null;
  for (const x of st.peers.p.held) {
    const y = st.peers.q.held.find((h) => h.id === x.id);
    if (!y) continue;
    const loser = (x.take?.stamp ?? 0) > (y.take?.stamp ?? 0) ? "p" : "q";
    const next = fork(st);
    next.peers[loser].held = next.peers[loser].held.filter((h) => h.id !== x.id);
    next.peers[loser].prog = [`draw:${(loser === "p" ? x : y).bag}`, ...next.peers[loser].prog];
    next.trace = [...(st.trace ?? []), `hands:${loser}`];
    return next;
  }
  return null;
}

const keyOf = (st) => JSON.stringify([PEERS.map((w) => DOCS.map((name) => [...Automerge.getHeads(st.docs[w][name])].sort())), st.peers]);

/** Where each item is, as peer `w` reads it: the places it is in. */
function whereabouts(st, w, { written = false } = {}) {
  const s = side(st, w);
  const shadows = s.shadows();
  const out = {};
  for (const id of ITEMS) out[id] = [];
  for (const id of Object.keys(s.S.doc().objects)) (out[id] ??= []).push("scene");
  for (const [k, h] of Object.entries(s.bags)) for (const { entry } of inside(h.doc(), written ? null : shadows.get(BAGS[k]))) (out[entry.id] ??= []).push(k);
  return out;
}

/** Search every interleaving of two programs. @returns { states, ends, failures, hands } */
function explore(progP, progQ) {
  const first = { docs: start(), peers: { p: { prog: progP, held: [], ids: 0 }, q: { prog: progQ, held: [], ids: 0 } } };
  const seen = new Set([keyOf(first)]);
  const todo = [first];
  const failures = [];
  let ends = 0;
  let hands = 0; // how often the hands had to settle what the docs couldn't
  while (todo.length) {
    const st = todo.pop();
    if (seen.size > 400000) throw new Error(`the search is larger than expected: ${JSON.stringify([progP, progQ])} ${JSON.stringify(st.peers)} ${(st.trace ?? []).join(" ")}`);
    const nexts = [];
    for (const w of PEERS) if (st.peers[w].prog.length) nexts.push(...step(st, w));
    for (const name of DOCS) for (const [from, to] of [["p", "q"], ["q", "p"]]) nexts.push(deliver(st, name, from, to));
    const settled = arbitrate(st);
    if (settled) hands++;
    nexts.push(settled);
    const live = nexts.filter(Boolean);
    if (!live.length) {
      ends++;
      const problems = check(st);
      if (problems.length && failures.length < 1) failures.push({ problems, trace: (st.trace ?? []).join(" "), peers: st.peers, p: whereabouts(st, "p"), q: whereabouts(st, "q") });
      continue;
    }
    for (const n of live) {
      const k = keyOf(n);
      if (seen.has(k)) continue;
      seen.add(k);
      todo.push(n);
    }
  }
  for (const doc of made.splice(0)) {
    try {
      Automerge.free(doc);
    } catch {
      // freed already (two notes of one doc)
    }
  }
  return { states: seen.size, ends, failures, hands };
}

/** What is wrong with an end state (everything delivered, every program run): nothing, when the invariant holds. */
function check(st) {
  const problems = [];
  for (const name of DOCS) {
    if (stable(st.docs.p[name]) !== stable(st.docs.q[name])) problems.push(`${name} differs between the peers`);
  }
  for (const w of PEERS) {
    for (const [id, places] of Object.entries(whereabouts(st, w))) if (places.length !== 1) problems.push(`${w} reads ${id} in ${JSON.stringify(places)}`);
    for (const [id, places] of Object.entries(whereabouts(st, w, { written: true }))) if (!places.length) problems.push(`${w}'s docs have lost ${id}`);
  }
  const held = PEERS.map((w) => st.peers[w].held.map((x) => x.id));
  for (const id of held[0]) if (held[1].includes(id)) problems.push(`both peers hold ${id}`);
  for (const w of PEERS) for (const x of st.peers[w].held) if (!st.docs[w].S.objects[x.id]) problems.push(`${w} holds ${x.id}, which isn't in the scene`);
  return problems;
}

// What a player does with a bag, a few steps at a time: draw, draw twice, put
// something in, draw and put it back (an exchange), put and then draw. And
// with a second bag at the table: pour one into the other, then draw from
// it; put into the other; draw from the first and put that into the second.
const P = {
  draw: ["draw:B1"],
  draw2: ["draw:B1", "draw:B1"],
  put: ["put:c>B1"],
  exchange: ["draw:B1", "put:held>B1"],
  putDraw: ["put:c>B1", "draw:B1"],
  pour: ["pour"],
  pourDraw: ["pour", "draw:B2"],
  putOther: ["put:c>B2"],
  drawPutOther: ["draw:B1", "put:held>B2"],
};
const pairs = (names) => names.flatMap((a, i) => names.slice(i).map((b) => [a, b]));
// Every pair of these is searched. The largest searches (tens of thousands
// of states each, minutes) run only with BAG_FULL=1; the rest always.
const ONE_BAG = pairs(["draw", "draw2", "put", "exchange", "putDraw"]);
const TWO_BAGS = pairs(["pour", "pourDraw", "putOther", "draw", "put", "drawPutOther"]);
const SLOW = new Set(["draw2+draw2", "draw2+exchange", "draw2+putDraw", "exchange+exchange", "exchange+putDraw", "putDraw+putDraw", "pourDraw+pourDraw", "pourDraw+drawPutOther", "drawPutOther+drawPutOther", "draw+drawPutOther", "put+drawPutOther"]);
const FULL = !!process.env.BAG_FULL;
// BAG_ONLY="a+b,c+d" searches just those pairs (a large one on its own).
const ONLY = process.env.BAG_ONLY ? new Set(process.env.BAG_ONLY.split(",")) : null;

describe("every interleaving of two peers' moves, with real merges", () => {
  const total = { pairs: 0, states: 0, ends: 0, skipped: 0, hands: 0 };

  for (const [name, list] of [["one bag", ONE_BAG], ["two bags", TWO_BAGS]]) {
    it(`${name}: each item ends in exactly one place, on both peers, and no two peers hold the same one`, async () => {
      for (const [a, b] of list) {
        if (ONLY ? !ONLY.has(`${a}+${b}`) : !FULL && SLOW.has(`${a}+${b}`)) {
          total.skipped++;
          continue;
        }
        const t0 = Date.now();
        const r = explore(P[a], P[b]);
        if (process.env.BAG_TRACE) (await import("node:fs")).appendFileSync(process.env.BAG_TRACE, `${a} + ${b}: ${r.states} states, ${r.ends} ends, ${r.hands} by the hands, ${Date.now() - t0} ms\n`);
        total.hands += r.hands;
        // draws alone, from one bag: the bag's own verdict names one drawer, every time
        if ([a, b].every((x) => x === "draw" || x === "draw2")) expect({ a, b, hands: r.hands }).toEqual({ a, b, hands: 0 });
        total.pairs++;
        total.states += r.states;
        total.ends += r.ends;
        expect({ a, b, failures: r.failures }).toEqual({ a, b, failures: [] });
        expect(r.ends).toBeGreaterThan(0);
      }
    }, 3_600_000);
  }

  it("visited a real search (the numbers the README quotes)", () => {
    console.log(`[bag] interleavings: ${total.pairs} program pairs, ${total.states} states, ${total.ends} end states, ${total.hands} settled by the hands${total.skipped ? ` (${total.skipped} larger pairs run with BAG_FULL=1)` : ""}`);
    if (!ONLY) expect(total.states).toBeGreaterThan(1000);
  });

  it("two draws of the same item at once: one object, one holder, and the other draws again", () => {
    // P and Q both take item b (the last in) before either hears of the other
    const st = { docs: start(), peers: { p: { prog: ["draw:B1"], held: [], ids: 0 }, q: { prog: ["draw:B1"], held: [], ids: 0 } } };
    const pick = (s, w) => step(s, w).find((n) => n.peers[w].held[0]?.id === "b");
    let s = pick(pick(st, "p"), "q");
    expect([s.peers.p.held[0].id, s.peers.q.held[0].id]).toEqual(["b", "b"]);
    for (let i = 0; i < 12; i++) for (const name of DOCS) for (const [from, to] of [["p", "q"], ["q", "p"]]) s = deliver(s, name, from, to) ?? s;
    // the loser's program now says to draw again; it does
    for (const w of PEERS) while (s.peers[w].prog.length) s = step(s, w)[0];
    for (let i = 0; i < 12; i++) for (const name of DOCS) for (const [from, to] of [["p", "q"], ["q", "p"]]) s = deliver(s, name, from, to) ?? s;
    expect(check(s)).toEqual([]);
    expect([s.peers.p.held[0].id, s.peers.q.held[0].id].sort()).toEqual(["a", "b"]);
    expect(Object.keys(s.docs.p.S.objects).sort()).toEqual(["a", "b", "c"]);
    expect(inside(s.docs.p.B1)).toEqual([]);
  });
});
