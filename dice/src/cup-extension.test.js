// The cup extension against a fake stage (test/fakes.js): two players and a
// spectator on one doc, each view with its own api, its audience the stage's
// merge of this extension's own policy, and a scripted lots (what
// api.collect("dice.lots") gives: the real one, lots-ext.js, is tested on its
// own in lots-ext.test.js and lots.test.js). What a die is comes from what
// the stage says it built.
import { describe, it, expect } from "vitest";
import Cups, { ASTRAY_MS, SHAKE_SECONDS, dressFor } from "./cup-extension.js";
import { CUP, lifted, ringOf, sealersFor } from "./cup.js";
import { KEPT } from "./lots.js";
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
  const told = new Map();
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
      // this client's own record of its part of a draw (lots-run told): what a test puts in `told`, else none
      told: (draw) => told.get(draw) ?? null,
    },
    told,
  };
}

/** A lots state as the convention gives it. */
const lotsState = (o) => ({ id: "r1xx", of: ["d0", "d1", "d2"], phase: "known", seed: SEED, public: false, contributors: ["alice", "bob"], waiting: [], protests: [], ...o });

/**
 * A table: Alice's cup (lifted, nobody's) with three dice in front of it; A is
 * Alice, B is Bob, S a spectator, all playing.
 */
function table({ present = ["A", "B", "S"] } = {}) {
  const base = T([0, 0.75, 0]);
  const objects = { cup: { name: "Alice's cup", transform: lifted(base), traits: { [CUP]: { holder: null, up: true, blind: false, roll: null, round: null } } } };
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
    w.view(session).collected = { "dice.lots": lots.value, roster: { viewers: () => SEATED, who: name } };
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
    expect(t.lots.draws).toEqual([{ id: "cup", sealers: ["alice"], of: t.dice, draw: "dfake0xx" }]);
    expect(t.cup()).toMatchObject({ holder: "alice", up: false, blind: false, roll: { draw: "dfake0xx", dice: t.dice, blind: false, done: false } });
    for (const d of t.dice) {
      const r = t.doc.objects[d].transform.rotation;
      expect(r[0]).toBe(0);
      expect(r[2]).toBe(0);
      expect(faceUp(r, BUILT)).toBe(0);
    }
    expect(t.notices("A")).toEqual(["You shook your cup."]);
    expect(t.w.sent.filter((m) => m.type === "shook")).toEqual([]);
    expect(Object.keys(t.views.A.x.messages)).toEqual(["peeked", "lifted"]);
    t.w.done();
  });

  it("the rattle in the air is shown only while its hold stands: refused (a carry or the halo here has the cup), it stops and holds nothing; the shake is written as ever", () => {
    for (const when of ["start", "mid-shake"]) {
      const t = table();
      if (when === "start") t.w.view("A").heldHere = new Set(["cup"]);
      t.run("A", "shake");
      expect(t.cup(), when).toMatchObject({ holder: "alice", up: false, roll: { done: false } });
      t.w.tick(1 / 60, 3);
      if (when === "mid-shake") t.w.view("A").heldHere = new Set(["cup"]);
      t.w.tick(1 / 60, 3);
      const loops = t.w.view("A").loops.length;
      t.w.tick(1 / 60, Math.ceil(SHAKE_SECONDS * 60) + 2);
      // no hold of the cup's left standing, nor released as landed: it was never this throw's to land
      expect(t.w.holds.get("cup")?.landed ?? false, when).toBe(false);
      expect(t.w.released.filter((r) => r.id === "cup" && r.landed), when).toEqual([]);
      expect(t.w.view("A").loops.length, when).toBeLessThanOrEqual(loops);
      t.w.done();
    }
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
    // told by each as the doc bears it out; the speaker named by the stage (these viewers have no contact: "Someone")
    expect(t.notices("B")).toContain("You lifted Alice's cup.");
    expect(t.notices("A")).toContain("Someone lifted your cup.");
    expect(t.notices("S")).toContain("Someone lifted Alice's cup.");
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
    expect(t.lots.draws.slice(1)).toEqual([{ id: "cup", sealers: ["alice"], of: t.dice, draw }]);
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
    // Alice's own round, but of her dice in another order (so each would show another's face): no better
    t.lots.states.set("cup", lotsState({ id: "rswap", draw, by: "alice", of: [...t.dice].reverse(), asked: ["alice"], sealers: ["alice"], phase: "open", public: true }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.cup().roll.done).toBe(false);
    for (const d of t.dice) expect(t.views.B.x.looks().get(d)).toEqual({ veil: true });
    expect(t.lots.draws.length).toBe(4);
    t.w.done();
  });

  it("a forgery in Alice's own draw (Bob says the part in his name isn't his, before he could know the roll): no client uses its seed; Alice's client shakes again in place, once, as a new draw of the same dice (never a new attempt of the old one, which every client that saw it would refuse as her reroll), the roll saying who said so; every view tells it", () => {
    const t = table();
    t.shake();
    const draw = t.cup().roll.draw;
    const poses = Object.fromEntries(["cup", ...t.dice].map((id) => [id, structuredClone(t.doc.objects[id].transform)]));
    expect(t.lots.draws.length).toBe(1);
    t.lots.states.set("cup", lotsState({ id: "rforged", draw, by: "alice", asked: ["alice"], sealers: ["alice"], forged: ["bob"], knew: ["alice"] }));
    t.w.change(() => {});
    t.w.flush();
    // a new draw (no `draw` given: not the old one asked again), of the same dice, sealed as the shake was
    expect(t.lots.draws.slice(1)).toEqual([{ id: "cup", sealers: ["alice"], of: t.dice, draw: "dfake1xx" }]);
    expect(t.lots.draws[1]).toMatchObject({ draw: expect.not.stringMatching(draw) });
    expect(t.cup().roll).toEqual({ draw: "dfake1xx", dice: t.dice, blind: false, done: false, forged: ["bob"] });
    expect(t.cup().holder).toBe("alice");
    // nothing moved: the cup stays down over the same dice
    for (const [id, pose] of Object.entries(poses)) expect(t.doc.objects[id].transform).toEqual(pose);
    // nothing turned up by the forged one, and nobody draws a die from it
    expect(t.cup().roll.done).toBe(false);
    for (const s of ["A", "B", "S"]) expect(t.views[s].x.debug().dressed.filter(([, k]) => k === "pose")).toEqual([]);
    t.w.flush();
    expect(t.notices("A").at(-1)).toBe("Your cup was drawn again: Bob says its lots were written in their name by someone else.");
    expect(t.notices("B").at(-1)).toBe("Alice's cup was drawn again: your client says its lots were written in your name by someone else.");
    expect(t.notices("S").at(-1)).toBe("Alice's cup was drawn again: Bob says its lots were written in their name by someone else.");
    // once: the forged round still there until the new one lands is just a round astray, already asked over
    for (let i = 0; i < 3; i++) {
      t.w.change(() => {});
      t.w.flush();
    }
    expect(t.lots.draws.length).toBe(2);
    // the new draw's round lands, and it's an ordinary shake from there
    t.lots.states.set("cup", lotsState({ id: "rnew", draw: "dfake1xx", by: "alice", asked: ["alice"], sealers: ["alice"] }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.lots.draws.length).toBe(2);
    expect(t.hud("B")).toEqual([]);
    t.w.done();
  });

  it("a forgery said by someone who could already know the roll (here: it's public) only stops it: nothing turns up and nothing is drawn again for them, since saying so would let them choose among rolls", () => {
    const t = table();
    t.shake();
    const draw = t.cup().roll.draw;
    const poses = Object.fromEntries(["cup", ...t.dice].map((id) => [id, structuredClone(t.doc.objects[id].transform)]));
    for (const knew of ["all", ["alice", "bob"]]) {
      t.lots.states.set("cup", lotsState({ id: "rforged", draw, by: "alice", asked: ["alice"], sealers: ["alice"], forged: ["bob"], knew, ...(knew === "all" ? { phase: "open", public: true } : {}) }));
      for (let i = 0; i < 3; i++) {
        t.w.change(() => {});
        t.w.flush();
      }
      expect(t.lots.draws.length).toBe(1);
      expect(t.cup().roll).toMatchObject({ draw, done: false });
      expect(t.cup().roll.forged ?? []).toEqual([]);
      for (const [id, pose] of Object.entries(poses)) expect(t.doc.objects[id].transform).toEqual(pose);
      for (const s of ["A", "B", "S"]) expect(t.views[s].x.debug().dressed.filter(([, k]) => k === "pose")).toEqual([]);
    }
    t.w.done();
  });

  it("a forgery Alice's own client finds (asked in her name, not by her): the same, saying so in her own words", () => {
    const t = table();
    t.shake();
    const draw = t.cup().roll.draw;
    // her client refuses it: its fault is hers before her protest is in the doc
    t.lots.states.set("cup", lotsState({ id: "rforged", draw, by: "alice", asked: ["alice"], sealers: ["alice"], forged: [], fault: { of: "rforged", why: "forged" }, knew: ["alice"] }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.cup().roll.forged).toEqual(["alice"]);
    t.w.flush();
    expect(t.notices("A").at(-1)).toBe("Your cup was drawn again: your client says its lots were written in your name by someone else.");
    expect(t.notices("B").at(-1)).toBe("Alice's cup was drawn again: Alice says its lots were written in their name by someone else.");
    t.w.done();
  });

  it("a forgery Alice's own client finds once someone else could know the roll (Bob, a blind cup up, wrote over her commit): only stopped, never drawn again, else Bob could draw her dice again until a roll suited him", () => {
    const t = table();
    t.shake(true);
    const draw = t.cup().roll.draw;
    t.run("A", "lift");
    t.w.flush();
    const poses = Object.fromEntries(["cup", ...t.dice].map((id) => [id, structuredClone(t.doc.objects[id].transform)]));
    for (const knew of [["bob"], ["alice", "bob"], "all"]) {
      t.lots.states.set("cup", lotsState({ id: "rforged", draw, by: "alice", asked: ["alice", "bob"], sealers: ["alice", "bob"], forged: [], fault: { of: "rforged", why: "forged" }, knew }));
      for (let i = 0; i < 3; i++) {
        t.w.change(() => {});
        t.w.flush();
      }
      expect(t.lots.draws.length).toBe(1);
      expect(t.cup().roll).toMatchObject({ draw, done: false });
      expect(t.cup().roll.forged ?? []).toEqual([]);
      for (const [id, pose] of Object.entries(poses)) expect(t.doc.objects[id].transform).toEqual(pose);
      for (const s of ["A", "B", "S"]) expect(t.views[s].x.debug().dressed.filter(([, k]) => k === "pose")).toEqual([]);
    }
    t.w.done();
  });

  it("asking again for her own shake (written over, or given up) only while nobody else could know it, by Alice's own record: else stopped, written on the roll, every HUD says so, she's told once; with no record (a reload), only a shake that isn't blind", () => {
    const TOLD = { none: null, kept: KEPT, self: { to: ["alice"], opened: false }, bob: { to: ["alice", "bob"], opened: false }, opened: { to: [], opened: true } };
    let cases = 0;
    for (const blind of [false, true])
      for (const [k, told] of Object.entries(TOLD))
        for (const how of ["written over", "given up"]) {
          const t = table();
          t.shake(blind);
          const draw = t.cup().roll.draw;
          const asked = blind ? ["alice", "bob"] : ["alice"];
          if (told) t.lots.told.set(draw, told);
          t.lots.states.set(
            "cup",
            how === "written over"
              ? lotsState({ id: "rover", draw, by: "bob", asked: ["bob"], sealers: ["bob"], phase: "open", public: true })
              : lotsState({ id: "rgone", draw, by: "alice", asked, sealers: asked, phase: "ended", seed: null, gone: ["bob"] }),
          );
          for (let i = 0; i < 3; i++) {
            t.w.change(() => {});
            t.w.flush();
          }
          const label = JSON.stringify({ blind, told: k, how });
          // the model: nothing released, or to nobody but her and never opened; with no record, sealed to her alone
          const ask = k === "kept" || k === "self" || (k === "none" && !blind);
          expect(t.lots.draws.slice(1), label).toEqual(ask ? [{ id: "cup", sealers: blind ? ["alice", "bob"] : ["alice"], of: t.dice, draw }] : []);
          expect(!!t.cup().roll.stopped, label).toBe(!ask);
          const stopped = t.notices("A").filter((n) => /isn't drawn again/.test(n));
          expect(stopped.length, label).toBe(ask ? 0 : 1);
          if (!ask) for (const v of ["A", "B", "S"]) expect(t.hud(v).some((l) => /shake was stopped/.test(l)), `${label} ${v}`).toBe(true);
          t.w.done();
          cases++;
        }
    expect(cases).toBe(20);
  });

  it("only the holder's client draws again for a forgery: Bob's, holding no cup, asks nothing", () => {
    const t = table({ present: ["B", "S"] });
    t.w.change((d) => (d.objects.cup.traits[CUP] = { holder: "alice", up: false, blind: false, roll: { draw: "dALICExx", dice: t.dice, blind: false, done: false }, round: null }));
    t.lots.states.set("cup", lotsState({ id: "rforged", draw: "dALICExx", by: "alice", asked: ["alice"], sealers: ["alice"], forged: ["bob"] }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.lots.draws).toEqual([]);
    expect(t.cup().roll.draw).toBe("dALICExx");
    t.w.done();
  });

  it("Alice's shake given up while she was away (lots.js GONE): nobody uses it; lifted, the others' HUD says she draws it again when back; her client, here, asks again for the same draw, once for that round, which nobody refuses", () => {
    const t = table();
    t.shake();
    const draw = t.cup().roll.draw;
    t.lots.states.set("cup", lotsState({ id: "rgone", draw, by: "alice", asked: ["alice"], sealers: ["alice"], phase: "ended", seed: null, gone: ["bob"] }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.lots.draws.slice(1)).toEqual([{ id: "cup", sealers: ["alice"], of: t.dice, draw }]);
    t.w.change(() => {});
    t.w.flush();
    expect(t.lots.draws.length).toBe(2);
    expect(t.hud("B")).toEqual([]); // down: nothing to see yet
    t.run("B", "lift");
    t.w.flush();
    expect(t.cup().roll.done).toBe(false);
    expect(t.hud("B")).toEqual(["Alice's dice can't be turned up: Alice left before their roll was drawn, and draws it again when they're back."]);
    expect(t.hud("A")).toEqual([]);
    t.w.done();
  });

  it("two shakes at once, the merge keeping Alice's roll and Bob's round (another draw): the same, and Alice's client asks again for hers", () => {
    const t = table();
    t.shake();
    const draw = t.cup().roll.draw;
    t.lots.states.set("cup", lotsState({ id: "rben", draw: "dBEN0", by: "bob", asked: ["bob"], sealers: ["bob"] }));
    t.w.change(() => {});
    t.w.flush();
    expect(t.lots.draws.at(-1)).toEqual({ id: "cup", sealers: ["alice"], of: t.dice, draw });
    t.w.done();
  });

  it("Shake blind asks for every seated player's part sealed, the holder's too; it isn't offered with nobody else here, and a blind round drawn by the holder alone is no blind roll", () => {
    const alone = table({ present: ["A", "S"] });
    expect(alone.state("A", "shake-blind")).toMatchObject({ disabled: true, title: "Nobody else at the table is here to keep it from you" });
    alone.w.done();

    const t = table();
    expect(t.state("A", "shake-blind").disabled).toBeUndefined();
    t.shake(true);
    expect(t.lots.draws).toEqual([{ id: "cup", sealers: sealersFor("alice", true, SEATED), of: t.dice, draw: "dfake0xx" }]);
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

  it("the others see who is peeking as soon as the peek reaches them by presence, though the doc doesn't change; and stop seeing it when she stops", () => {
    const t = table();
    t.shake();
    const tags = (s) => t.w.view(s).labels.map((l) => l.text);
    expect(tags("B")).not.toContain("Alice is peeking");
    t.run("A", "peek"); // (no flush: nothing in the doc changes, only A's presence)
    expect(tags("B")).toContain("Alice is peeking");
    expect(tags("S")).toContain("Alice is peeking");
    expect(tags("A")).not.toContain("Alice is peeking");
    t.run("A", "peek"); // Stop peeking
    expect(tags("B")).not.toContain("Alice is peeking");
  });

  it("a peek is told to the others when the doc bears it out (the holder's cup, down) within a while, never otherwise, and a message saying more than which cup is dropped", () => {
    const t = table();
    const alice = { viewer: "alice", session: "A" };
    t.w.hear("B", "peeked", { cup: "cup" }, alice);
    t.w.flush();
    expect(t.notices("B")).toEqual([]); // her cup is lifted, nobody's: it doesn't bear it out
    t.w.tick(3.5, 1); // longer than the stage waits for the doc to bear a word out: forgotten
    t.shake();
    expect(t.notices("B").filter((n) => /peeked/.test(n))).toEqual([]);
    t.w.hear("B", "peeked", { cup: "cup" }, alice);
    expect(t.notices("B")).toContain("Someone peeked under their cup.");
    // the shape is exact: which cup, and nothing about what's under it
    t.w.hear("B", "peeked", { cup: "cup", faces: [1, 2] }, alice);
    t.w.hear("B", "peeked", { nope: 1 }, alice);
    // and it's the holder's word or nobody's
    t.w.hear("B", "peeked", { cup: "cup" }, { viewer: "spec", session: "S" });
    t.w.flush();
    expect(t.notices("B").filter((n) => /peeked/.test(n)).length).toBe(1);
    const { messages } = t.views.B.x;
    expect(messages.peeked.valid({ cup: "cup", faces: [1] })).toBe(false);
    expect(messages.lifted.valid({ cups: ["cup"], seed: "x" })).toBe(false);
    for (const d of [null, 7, { cups: [] }, { cups: ["x".repeat(128)] }]) expect(messages.lifted.valid(d)).toBe(false);
    t.w.done();
  });

  it("her own peek is said to her as hers, and told to the others", () => {
    const t = table();
    t.shake();
    t.run("A", "peek");
    t.w.flush();
    expect(t.notices("A")).toContain("You peeked under your cup.");
    expect(t.notices("B")).toContain("Someone peeked under their cup.");
    expect(t.notices("S")).toContain("Someone peeked under their cup.");
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
