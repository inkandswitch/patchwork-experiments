// The cup extension against a fake stage (test/fakes.js): two players and a
// spectator on one doc, each view with its own api, its audience the stage's
// merge of this extension's own policy, and a scripted `lots` convention (the
// real one is keep's, which this package doesn't import: its rounds are
// tested there). What a die is comes from what the stage says it built.
import { describe, it, expect } from "vitest";
import Cups, { ASTRAY_MS, MESSAGES, SHAKE_SECONDS, dressFor } from "./cup-extension.js";
import { CUP, lifted, ringOf, sealersFor } from "./cup.js";
import { PRESETS, dieOf } from "./die.js";
import { builtDie } from "./die-glb.js";
import { faceOfSeed, faceUp, seedFor, seedFromLots } from "./roll.js";
import * as fakes from "./test/fakes.js";
import { emptyScene } from "./test/empty-scene.js";

const T = (position, rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const BUILT = builtDie(dieOf(PRESETS.d6.make()));
const SEED = "a1b2c3d4" + "0".repeat(56);
const SEATED = ["alice", "bob"];
const name = (v) => v[0].toUpperCase() + v.slice(1);

/** The stage's merge of one policy's answer, for one viewer (STAGE.md, "Audience"): null → the doc's to say, everyone. */
function audienceOf(a) {
  if (!a) return { audience: "all", shown: "all" };
  const shown = a.show ?? [];
  if (!a.only) return { audience: shown, shown };
  return { audience: shown === "all" ? [...a.only].sort() : shown.filter((v) => a.only.includes(v)), shown };
}

/** A scripted lots convention: draws are recorded; state is what the test says. */
function scriptedLots() {
  const states = new Map();
  const draws = [];
  let n = 0;
  return {
    states,
    draws,
    value: {
      draw(id, o = {}) {
        const draw = o.draw ?? `dfake${n++}xx`;
        draws.push({ id, ...o, draw });
        return draw;
      },
      state: (id) => states.get(id) ?? null,
    },
  };
}

/** A lots state as the convention gives it. */
const lotsState = (o) => ({ id: "r1xx", phase: "known", seed: SEED, public: false, contributors: ["alice", "bob"], waiting: [], protests: [], ...o });

/**
 * A table: Alice's cup (lifted, nobody's) with three dice in front of it; A is
 * Alice, B is Bob, S a spectator, all playing.
 */
function table({ present = ["A", "B", "S"] } = {}) {
  const base = T([0, 0.75, 0]);
  const objects = { cup: { name: "Alice's cup", transform: lifted(base), traits: { [CUP]: { holder: null, up: true, blind: false, roll: null }, "keep.lots": {} } } };
  const dice = ringOf(3, 0).map((r, i) => {
    objects[`d${i}`] = { name: `d${i}`, transform: T([r.at[0], 0.75, r.at[2] + 0.004], [0.4, 0.2, 0]), traits: { "dice.die": {} } };
    return `d${i}`;
  });
  const doc = emptyScene({ objects, order: Object.keys(objects) });
  const content = Object.fromEntries(dice.map((d) => [d, { loaded: true, extras: { dice: BUILT } }]));
  const w = fakes.fakeWorld(doc, { content });
  const lots = scriptedLots();
  const views = {};
  for (const [session, viewer] of [["A", "alice"], ["B", "bob"], ["S", "spec"]]) {
    if (!present.includes(session)) continue;
    const api = w.join(session, { viewer });
    w.view(session).collected = { lots: lots.value, roster: { viewers: () => SEATED, who: name } };
    let x = null;
    api.audience = (id) => audienceOf(x.audience(api.scene())(id)).audience;
    api.shown = (id) => audienceOf(x.audience(api.scene())(id)).shown;
    x = w.attach(session, Cups.create(api));
    views[session] = { api, x };
  }
  w.flush();
  const cmd = (s, id) => views[s].x.commands.find((c) => c.id === id);
  const state = (s, id, target = "cup") => cmd(s, id).state(target, { scene: views[s].api.scene(), local: views[s].api.local.get() });
  const run = (s, id, target = "cup") => cmd(s, id).run(target);
  const notices = (s) => w.view(s).notices.map((n) => n.text);
  const hud = (s) => views[s].x.hud().map((l) => l.text);
  const cup = () => doc.objects.cup.traits[CUP];
  /** Shake A's cup and let it land. */
  const shake = (blind = false) => {
    run("A", blind ? "shake-blind" : "shake");
    w.tick(1 / 60, Math.ceil(SHAKE_SECONDS * 60) + 2);
    w.flush();
  };
  return { w, doc, dice, lots, views, cmd, state, run, notices, hud, cup, shake };
}

describe("dressFor: how a view draws a die a cup answers for, every case", () => {
  const AUD = ["all", ["alice"], ["bob"], []];
  it("shows it as it truly lies only to a viewer who may see it and knows it; hides it only under a cup the viewer may not see under; never both", () => {
    let n = 0;
    for (const veiled of [false, true])
      for (const pending of [false, true])
        for (const known of [false, true])
          for (const covered of [false, true])
            for (const audience of AUD)
              for (const viewer of ["alice", "bob", "spec"]) {
                n++;
                const how = dressFor({ veiled, pending, known, covered, audience, viewer });
                const may = audience === "all" || audience.includes(viewer);
                expect(how === "truth").toBe(!veiled && pending && known && may);
                expect(how === "hide").toBe(!veiled && covered && !may);
                // a die this viewer may not see under a cup is never drawn as itself, nor its truth shown
                if (covered && !may) expect(how).not.toBe("truth");
              }
    expect(n).toBe(2 * 2 * 2 * 2 * 4 * 3);
  });
});

describe("the cup's verbs and what the doc says", () => {
  it("a shake: one write puts the cup down over its dice in a pose that says nothing, asks lots for the holder's part sealed, and tells only the shaker by itself (no message)", () => {
    const t = table();
    expect(t.state("A", "shake")).toEqual({ label: "Shake", title: expect.stringMatching(/only you may look under it/) });
    let writes = 0;
    const change = t.views.A.api.change;
    t.views.A.api.change = (fn) => (writes++, change(fn));
    t.run("A", "shake");
    expect(writes).toBe(1);
    expect(t.lots.draws).toEqual([{ id: "cup", sealers: ["alice"], draw: "dfake0xx" }]);
    expect(t.cup()).toMatchObject({ holder: "alice", up: false, blind: false, roll: { draw: "dfake0xx", dice: t.dice, blind: false, done: false } });
    for (const d of t.dice) {
      const r = t.doc.objects[d].transform.rotation;
      expect(r[0]).toBe(0);
      expect(r[2]).toBe(0);
      expect(faceUp(r, BUILT)).toBe(0);
    }
    expect(t.notices("A")).toEqual(["You shook your cup."]);
    expect(t.w.sent.filter((m) => m.type === "shook")).toEqual([]);
    expect(Object.keys(MESSAGES)).toEqual(["peeked", "lifted"]);
    t.w.done();
  });

  it("everyone else is told of a shake from the doc: a new draw on the cup, whoever wrote it and whatever they said", () => {
    const t = table();
    t.shake();
    expect(t.notices("B")).toEqual(["Alice shook their cup."]);
    expect(t.notices("S")).toEqual(["Alice shook their cup."]);
    // a modified client writes a new draw on Alice's cup without the verb, the cup unmoved: it's still told
    t.w.change((d) => (d.objects.cup.traits[CUP].roll.draw = "dsneakyxx"));
    t.w.flush();
    expect(t.notices("B").at(-1)).toBe("Alice shook their cup.");
    expect(t.notices("A").at(-1)).toBe("Your cup was shaken.");
    t.w.done();
  });

  it("while it's down: the holder's client knows the roll (lots known), draws the dice as they lie; the others' and the spectator's don't draw them at all", () => {
    const t = table();
    t.shake();
    const draw = t.cup().roll.draw;
    t.lots.states.set("cup", lotsState({ draw, by: "alice", asked: ["alice"], sealers: ["alice"] }));
    t.w.change(() => {});
    t.w.flush();
    // the audience: Alice alone
    for (const s of ["A", "B", "S"]) for (const d of t.dice) expect(t.views[s].api.audience(d)).toEqual(["alice"]);
    // no veil anywhere: Alice knows them, the others aren't shown them
    for (const s of ["A", "B", "S"]) expect(t.views[s].x.looks().size).toBe(0);
    t.w.done();
  });

  it("lifted, and the round public: the first client to know writes every die turned up, as the seed says, once; each view tells what was rolled and who drew it", () => {
    const t = table();
    t.shake();
    const draw = t.cup().roll.draw;
    t.lots.states.set("cup", lotsState({ draw, by: "alice", asked: ["alice"], sealers: ["alice"] }));
    t.run("B", "lift");
    t.w.flush();
    expect(t.cup().up).toBe(true);
    expect(t.cup().roll.done).toBe(false); // not public yet
    t.lots.states.set("cup", lotsState({ draw, by: "alice", asked: ["alice"], sealers: ["alice"], phase: "open", public: true }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.cup().roll.done).toBe(true);
    const seed = seedFromLots(SEED);
    t.dice.forEach((d, i) => expect(faceUp(t.doc.objects[d].transform.rotation, BUILT)).toBe(faceOfSeed(seedFor(seed, i), BUILT.faces.length)));
    t.w.flush();
    const labels = t.dice.map((d, i) => BUILT.faces[faceOfSeed(seedFor(seed, i), BUILT.faces.length)].label).join(", ");
    expect(t.notices("A")).toContain(`You rolled ${labels}: drawn by you and Bob.`);
    expect(t.notices("B")).toContain(`Alice rolled ${labels}: drawn by Alice and you.`);
    expect(t.notices("B").some((n) => /lifted/.test(n))).toBe(false); // (his own lift isn't told back to him)
    expect(t.notices("A")).toContain("Bob lifted your cup.");
    expect(t.notices("S")).toContain("Bob lifted Alice's cup.");
    t.w.done();
  });

  it("a round written over Alice's by Bob, sealed to himself, on her draw: no client uses its seed, nothing is turned up even when it's public, Alice's client asks again for her own once per round it finds, and everyone is told after a while", () => {
    const t = table();
    t.shake();
    const draw = t.cup().roll.draw;
    expect(t.lots.draws.length).toBe(1);
    // Alice's own round lands
    t.lots.states.set("cup", lotsState({ id: "rmine", draw, by: "alice", asked: ["alice"], sealers: ["alice"] }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.lots.draws.length).toBe(1);
    // Bob's client writes over it
    t.lots.states.set("cup", lotsState({ id: "rbob", draw, by: "bob", asked: ["bob"], sealers: ["bob"], phase: "open", public: true }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.lots.draws.slice(1)).toEqual([{ id: "cup", sealers: ["alice"], draw }]);
    t.w.change(() => {});
    t.w.flush();
    expect(t.lots.draws.length).toBe(2); // once for that round
    t.run("A", "lift");
    t.w.flush();
    expect(t.cup().roll.done).toBe(false);
    // Bob's view: the dice are face up to all, and nobody knows them: veiled, not his "seed"
    for (const d of t.dice) expect(t.views.B.x.looks().get(d)).toEqual({ veil: true });
    expect(t.hud("B")).toEqual([]);
    t.w.tick(ASTRAY_MS / 1000 + 0.1, 1);
    expect(t.hud("B")).toEqual(["Alice's dice can't be turned up: the lots on that cup aren't the ones its shake asked for (two shakes at once, or someone wrote over them). Alice's client asks again."]);
    // a blind-shaken claim on an open shake is no better
    t.lots.states.set("cup", lotsState({ id: "rbob2", draw, by: "alice", asked: ["alice", "bob"], sealers: ["alice", "bob"], phase: "open", public: true }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.cup().roll.done).toBe(false);
    expect(t.lots.draws.length).toBe(3);
    t.w.done();
  });

  it("two shakes at once, the merge keeping Alice's roll and Bob's round (another draw): the same, and Alice's client asks again for hers", () => {
    const t = table();
    t.shake();
    const draw = t.cup().roll.draw;
    t.lots.states.set("cup", lotsState({ id: "rben", draw: "dBEN0", by: "bob", asked: ["bob"], sealers: ["bob"] }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.lots.draws.at(-1)).toEqual({ id: "cup", sealers: ["alice"], draw });
    t.w.done();
  });

  it("Shake blind asks for every seated player's part sealed, the holder's too; it isn't offered with nobody else here, and a blind round drawn by the holder alone is no blind roll", () => {
    const alone = table({ present: ["A", "S"] });
    expect(alone.state("A", "shake-blind")).toMatchObject({ disabled: true, title: "Nobody else at the table is here to keep it from you" });
    alone.w.done();

    const t = table();
    expect(t.state("A", "shake-blind").disabled).toBeUndefined();
    t.shake(true);
    expect(t.lots.draws).toEqual([{ id: "cup", sealers: sealersFor("alice", true, SEATED), draw: "dfake0xx" }]);
    expect(t.cup()).toMatchObject({ blind: true, roll: { blind: true } });
    expect(t.notices("B")).toEqual(["Alice shook their cup blind."]);
    const draw = t.cup().roll.draw;
    // drawn by Alice alone (Bob gone before he committed): Alice's client could know it, so no client uses it
    t.lots.states.set("cup", lotsState({ draw, by: "alice", asked: ["alice", "bob"], sealers: ["alice"], contributors: ["alice"] }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.hud("B")).toEqual(["Nobody but Alice took part in the lots for Alice's blind shake, so it isn't blind: shake it again with someone else here."]);
    expect(t.lots.draws.length).toBe(1); // nothing to ask again: it is her round
    t.w.done();
  });

  it("blind, lifted: shown to Bob (who knows it, once the parts are released to him), veiled for Alice, the label says so; Show me makes it everyone's", () => {
    const t = table();
    t.shake(true);
    const draw = t.cup().roll.draw;
    t.lots.states.set("cup", lotsState({ draw, by: "alice", asked: ["alice", "bob"], sealers: ["alice", "bob"], phase: "sealed", seed: null, waiting: ["alice", "bob"] }));
    t.w.change(() => {});
    t.w.flush();
    for (const d of t.dice) for (const s of ["A", "B", "S"]) expect(t.views[s].api.audience(d)).toEqual([]);
    expect(t.state("A", "lift")).toMatchObject({ label: "Lift", title: "Lift it: everyone but you may see what's under it (L)" });
    t.run("A", "lift");
    t.w.flush();
    for (const d of t.dice) expect(t.views.A.api.audience(d)).toEqual(["bob"]);
    // Bob knows it now (Alice's part sealed to him)
    t.lots.states.set("cup", lotsState({ draw, by: "alice", asked: ["alice", "bob"], sealers: ["alice", "bob"] }));
    t.w.change(() => {});
    t.w.flush();
    // (lots' state is one object here, as every view's: Alice's view still mustn't show it, for she isn't in the audience)
    for (const d of t.dice) {
      expect(t.views.A.x.looks().get(d)).toEqual({ veil: true });
      expect(t.views.B.x.looks().get(d)).toBeUndefined();
      expect(t.views.S.x.looks().get(d)).toEqual({ veil: true }); // face up to the table, kept from the spectator too (cup.js policy)
    }
    expect(t.w.view("A").labels.map((l) => l.text)).toContain("Blind: hidden from you");
    expect(t.w.view("B").labels.map((l) => l.text)).toContain("Blind: hidden from Alice");
    expect(t.hud("A")).toEqual([]); // nothing's wrong: it's kept from her
    expect(t.state("A", "lift")).toMatchObject({ label: "Show me" });
    t.run("A", "lift");
    t.w.flush();
    expect(t.cup().blind).toBe(false);
    expect(t.cup().roll.blind).toBe(true); // how it was shaken stays: the round is still its own
    for (const d of t.dice) expect(t.views.A.api.audience(d)).toBe("all");
    t.lots.states.set("cup", lotsState({ draw, by: "alice", asked: ["alice", "bob"], sealers: ["alice", "bob"], phase: "open", public: true }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.cup().roll.done).toBe(true);
    t.w.done();
  });

  it("lifted with a sealed part missing: everyone's HUD names whose part it waits on", () => {
    const t = table();
    t.shake();
    const draw = t.cup().roll.draw;
    t.lots.states.set("cup", lotsState({ draw, by: "alice", asked: ["alice"], sealers: ["alice"], phase: "sealed", seed: null, waiting: ["alice"] }));
    t.run("B", "lift");
    t.w.flush();
    expect(t.hud("B")).toEqual(["Alice's dice can't be turned up until Alice is here to open their part of the roll."]);
    expect(t.hud("S")).toEqual(["Alice's dice can't be turned up until Alice is here to open their part of the roll."]);
    t.w.done();
  });

  it("a cup down over dice can't be carried, nor the dice under it; lifted, or down over nothing, it can", () => {
    const t = table();
    expect(t.views.B.x.carryable("cup")).toBe(true);
    t.shake();
    for (const s of ["A", "B"]) {
      expect(t.views[s].x.carryable("cup")).toBe(false);
      for (const d of t.dice) expect(t.views[s].x.carryable(d)).toBe(false);
    }
    t.run("B", "lift");
    t.w.flush();
    expect(t.views.B.x.carryable("cup")).toBe(true);
    // put down again, over nothing
    t.w.change((d) => {
      for (const id of t.dice) d.objects[id].transform.position[0] += 0.5;
    });
    t.run("B", "cover");
    t.w.flush();
    expect(t.cup().up).toBe(false);
    expect(t.views.B.x.carryable("cup")).toBe(true);
    t.w.done();
  });

  it("a peek is told to the others when the doc bears it out (the holder's cup, down) within a while, never otherwise, and a message saying more than which cup is dropped", () => {
    const t = table();
    t.views.B.x.receive("peeked", { cup: "cup" }, { viewer: "alice", session: "A" });
    t.w.flush();
    expect(t.notices("B")).toEqual([]); // her cup is lifted, nobody's: it doesn't bear it out
    t.w.tick(3.5, 1); // longer than a word and its doc change can be apart: forgotten
    t.shake();
    expect(t.notices("B").filter((n) => /peeked/.test(n))).toEqual([]);
    t.views.B.x.receive("peeked", { cup: "cup" }, { viewer: "alice", session: "A" });
    expect(t.notices("B")).toContain("Alice peeked under their cup.");
    // the shape is exact: which cup, and nothing about what's under it
    t.views.B.x.receive("peeked", { cup: "cup", faces: [1, 2] }, { viewer: "alice", session: "A" });
    t.views.B.x.receive("peeked", { nope: 1 }, { viewer: "alice", session: "A" });
    // and it's the holder's word or nobody's
    t.views.B.x.receive("peeked", { cup: "cup" }, { viewer: "spec", session: "S" });
    expect(t.notices("B").filter((n) => /peeked/.test(n)).length).toBe(1);
    expect(MESSAGES.peeked({ cup: "cup", faces: [1] })).toBe(false);
    expect(MESSAGES.lifted({ cups: ["cup"], seed: "x" })).toBe(false);
    t.w.done();
  });

  it("knocked over, its dice are everyone's; stood up, it's a cup again", () => {
    const t = table();
    t.shake();
    expect(t.state("B", "knock")).toMatchObject({ title: expect.any(String) });
    t.run("B", "knock");
    t.w.flush();
    for (const d of t.dice) expect(t.views.B.api.audience(d)).toBe("all");
    expect(t.state("B", "stand")).toMatchObject({ title: expect.any(String) });
    t.run("B", "stand");
    t.w.flush();
    expect(t.state("B", "knock")).not.toBe(null);
    t.w.done();
  });
});
