// Cups, over every case: where a cup is (down, lifted, knocked over,
// carried off its dice), how it was shaken (in the open or blind, by
// someone or nobody), and who is looking (its holder, another seated
// player, a spectator). What each may see is the stage's merge of this one
// policy (audience = show ∩ only), worked out here as the stage does.

import { COVER, CUP_HEIGHT, DIE_HALF, LIFT_BACK, MAX_UNDER, cupOf, cupsOf, fits, includes, knocked, lifted, lowered, ours, policy, ringOf, sealersFor, shakePlan, shaken, spotOf, stoodUp, upright, yawOf } from "./cup.js";
import { builtDie } from "./die-glb.js";
import { dieOf, presetDoc } from "./die.js";
import { faceUp, reach, seedFor, seedFromLots, settled } from "./roll.js";
import { eulerMatrix } from "./m3.js";

const SEATED = ["ana", "ben"];
const VIEWERS = ["ana", "ben", "spec"];

/** The stage's merge, for one policy's answer. */
function merged(a) {
  if (!a) return { shown: [], audience: [] };
  const shown = a.show ?? [];
  if (!a.only) return { shown, audience: shown };
  const audience = shown === "all" ? [...a.only] : shown.filter((v) => a.only.includes(v));
  return { shown, audience };
}

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const die = (position, more = {}) => ({ name: "die", transform: T(position), traits: { "dice.die": {} }, ...more });
function sceneWith({ where, blind, holder, pending }) {
  const base = T([0, 0.75, 0], [0, 0.3, 0]);
  const cupT = where === "lifted" ? lifted(base) : where === "knocked" ? knocked(base) : base;
  const objects = {
    cup: { name: "cup", transform: cupT, traits: { "dice.cup": { up: where === "lifted", blind, holder, roll: pending ? { draw: "d1", dice: ["d0", "d1"], done: false } : null } } },
    d0: die(where === "carried" ? [0.3, 0.75, 0.3] : [0, 0.75, 0]),
    d1: die(where === "carried" ? [0.32, 0.75, 0.3] : [0.01, 0.75, 0.01]),
    loose: die([0.4, 0.75, 0]),
  };
  return { objects };
}

describe("who may see under a cup: every case", () => {
  const WHERE = ["down", "lifted", "knocked", "carried"];
  for (const where of WHERE)
    for (const blind of [false, true])
      for (const holder of [null, "ana"])
        for (const pending of [false, true]) {
          it(`${where}, ${blind ? "blind" : "in the open"}, ${holder ? "Ana's" : "nobody's"}, ${pending ? "shaken" : "not shaken"}`, () => {
            const s = sceneWith({ where, blind, holder, pending });
            const p = policy(s, SEATED);
            const { cups } = cupsOf(s);
            const covering = cups.get("cup").covering;
            // a down cup covers; lifted, knocked over or carried off them, it doesn't (carried: it still covers, but not those dice)
            expect(covering).toBe(where === "down" || where === "carried");
            const diceCovered = where === "down";
            for (const d of ["d0", "d1"]) {
              const a = p(d);
              // a die nobody shook and nothing covers is the doc's to say
              if (!diceCovered && !pending) {
                expect(a).toBe(null);
                continue;
              }
              const { shown, audience } = merged(a);
              const kept = diceCovered;
              for (const v of VIEWERS) {
                const sees = includes(audience, v);
                const want = kept ? !blind && holder === v : blind && holder ? SEATED.includes(v) && v !== holder : true;
                expect(sees, `${v} sees ${d}`).toBe(want);
                // a spectator sees nothing under a cup, ever; whoever shook it blind never sees it until it's shown them
                if (kept) expect(includes(audience, "spec")).toBe(false);
                if (blind && holder) expect(includes(audience, holder)).toBe(false);
                // audience ⊆ shown
                if (sees) expect(includes(shown, v)).toBe(true);
              }
              // blind and face up: turned toward everyone, so whoever may not know it is shown the veil, not the cup
              if (!kept && blind && holder) expect(shown).toBe("all");
            }
            // the loose die is never anyone's business here
            expect(p("loose")).toBe(null);
            // the cup answers for itself as for what it covers
            const c = merged(p("cup"));
            // (carried off the dice it was shaken over, it keeps nothing: those dice are out, so their roll is too)
            const keeps = covering && !(where === "carried" && pending);
            for (const v of VIEWERS) expect(includes(c.audience, v)).toBe(keeps ? !blind && holder === v : blind && holder ? v === "ben" : true);
          });
        }
});

describe("what a cup covers", () => {
  const cupAt = (pos, more = {}) => ({ name: "cup", transform: T(pos), traits: { "dice.cup": { up: false, ...more } } });
  it("a die whose origin is within its wall, at its height, on the same parent", () => {
    for (const r of [0, COVER * 0.5, COVER - 1e-4, COVER + 1e-4])
      for (const dy of [0, CUP_HEIGHT - 1e-3, CUP_HEIGHT + 1e-3])
        for (const parent of [null, "other"]) {
          const s = { objects: { cup: cupAt([0, 0, 0]), d: { ...die([r, dy, 0]), parent }, other: { name: "t", transform: T([0, 0, 0]) } } };
          const { covered } = cupsOf(s);
          expect(covered.has("d"), `r ${r} dy ${dy} parent ${parent}`).toBe(r < COVER && dy < CUP_HEIGHT && parent == null);
        }
  });
  it("in a parent's frame, scaled: metres are metres", () => {
    for (const k of [0.5, 1, 2]) {
      const s = { objects: { table: { transform: { ...T([0, 0, 0]), scale: k } }, cup: { ...cupAt([0, 0, 0]), parent: "table" }, d: { ...die([(COVER * 0.9) / k, 0, 0]), parent: "table" }, e: { ...die([(COVER * 1.1) / k, 0, 0]), parent: "table" } } };
      const { covered } = cupsOf(s, (p) => (p === "table" ? k : 1));
      expect([...covered]).toEqual(["d"]);
    }
  });
});

describe("moving a cup", () => {
  const YAWS = Array.from({ length: 16 }, (_, i) => -Math.PI + (i * Math.PI) / 8);
  it("lifted is set aside along its own +X (its holder's right); lowered undoes it; its spot stays where its dice are", () => {
    for (const yaw of YAWS)
      for (const k of [0.5, 1, 2]) {
        const t = T([0.1, 0.75, -0.2], [0, yaw, 0]);
        const up = lifted(t, k);
        expect(Math.hypot(up.position[0] - 0.1, up.position[2] + 0.2)).toBeCloseTo(LIFT_BACK / k, 5);
        expect(up.position[0] - 0.1).toBeCloseTo((Math.cos(yaw) * LIFT_BACK) / k, 5);
        expect(up.position[2] + 0.2).toBeCloseTo((-Math.sin(yaw) * LIFT_BACK) / k, 5);
        lowered(up, k).position.forEach((v, i) => expect(v).toBeCloseTo(t.position[i], 5));
        spotOf(up, true, k).forEach((v, i) => expect(v).toBeCloseTo(t.position[i], 5));
      }
  });
  it("knocked over isn't upright, keeps its heading, lies on its side on the table; stood up is exactly where it was", () => {
    for (const yaw of YAWS)
      for (const k of [0.5, 1]) {
        const t = T([0.1, 0.75, -0.2], [0, yaw, 0]);
        expect(upright(t)).toBe(true);
        const down = knocked(t, k);
        expect(upright(down)).toBe(false);
        expect(Math.cos(yawOf(down.rotation) - yaw)).toBeCloseTo(1, 5);
        // its axis lies level, a mouth's radius above the table
        expect(eulerMatrix(down.rotation)[1][1]).toBeCloseTo(0, 5);
        expect(down.position[1] - 0.75).toBeCloseTo(0.043 / k, 5);
        const back = stoodUp(down, k);
        expect(upright(back)).toBe(true);
        back.position.forEach((v, i) => expect(v).toBeCloseTo(t.position[i], 5));
        expect(Math.cos(back.rotation[1] - yaw)).toBeCloseTo(1, 5);
      }
  });
});

describe("dice under a cup", () => {
  it("up to seven lie inside its wall, none touching at any heading; eight don't fit", () => {
    for (let n = 0; n <= MAX_UNDER; n++)
      for (const yaw of [0, 0.4, 2]) {
        const ring = ringOf(n, yaw);
        expect(ring.length).toBe(n);
        for (const { at } of ring) expect(Math.hypot(at[0], at[2]) + DIE_HALF).toBeLessThanOrEqual(0.040);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(Math.hypot(ring[i].at[0] - ring[j].at[0], ring[i].at[2] - ring[j].at[2])).toBeGreaterThanOrEqual(2 * DIE_HALF - 1e-6);
      }
    expect(ringOf(MAX_UNDER + 1)).toBe(null);
  });

  it("a shake puts the cup down over every die it takes, from lifted, down or knocked over, and their pose says nothing of a roll", () => {
    for (const where of ["lifted", "down", "knocked"])
      for (const n of [1, 3, 5, 7])
        for (const yaw of [0, 1.1, -2.5]) {
          const base = T([0.2, 0.75, 0.1], [0, yaw, 0]);
          const cupT = where === "lifted" ? lifted(base) : where === "knocked" ? knocked(base) : base;
          const objects = { cup: { transform: cupT, traits: { "dice.cup": { up: where === "lifted" } } } };
          const ring = ringOf(n, 0.3);
          ring.forEach(({ at }, i) => (objects[`d${i}`] = die([0.2 + at[0], 0.75, 0.1 + at[2]], { transform: T([0.2 + at[0], 0.75, 0.1 + at[2]], [0.4, 1, 2]) })));
          // and one too far to be taken
          objects.far = die([0.6, 0.75, 0.6]);
          const c = cupsOf({ objects }).cups.get("cup");
          const taken = shaken(c, Object.keys(objects));
          expect(taken).toEqual(ring.map((_, i) => `d${i}`));
          const plan = shakePlan(c, taken);
          const after = structuredClone(objects);
          after.cup.transform = plan.cup;
          after.cup.traits["dice.cup"].up = false;
          for (const [d, t] of plan.dice) {
            after[d].transform = t;
            expect(t.rotation[0]).toBe(0);
            expect(t.rotation[2]).toBe(0);
            expect(t.position[1]).toBe(0.75);
          }
          const { cups, covered } = cupsOf({ objects: after });
          expect(cups.get("cup").covering).toBe(true);
          expect([...covered].sort()).toEqual([...taken].sort());
          expect(covered.has("far")).toBe(false);
        }
  });
});

describe("a cup's dice, from their seed", () => {
  const built = builtDie(dieOf(presetDoc("d6")));
  it("seed n lands face n mod 6, lying flat on what it stood on, wherever it was under the cup", () => {
    const from = { position: [0.01, 0.75, -0.02], rotation: [0, 0.7, 0], scale: 1 };
    for (let seed = 0; seed < 12; seed++) {
      const { face, to } = settled(built, seed, from);
      expect(face).toBe(seed % 6);
      expect(faceUp(to.rotation, built)).toBe(face);
      // its lowest corner on the table, its middle over where it was
      const m = eulerMatrix(to.rotation);
      const low = to.position[1] + built.centre[1] * 0 + (m[1][0] * built.centre[0] + m[1][1] * built.centre[1] + m[1][2] * built.centre[2]) - reach(built, m);
      expect(low).toBeCloseTo(0.75, 6);
    }
  });
  it("each die under a cup gets its own seed from the lots seed, by its place, as dice thrown together do", () => {
    const hex = "0000002a" + "0".repeat(56);
    expect(seedFromLots(hex)).toBe(42);
    const faces = [0, 1, 2, 3, 4].map((k) => settled(built, seedFor(42, k), { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }).face);
    expect(faces).toEqual([0, 1, 2, 3, 4].map((k) => seedFor(42, k) % 6));
    expect(seedFromLots("xyz")).toBe(null);
  });
});

describe("a shake's lots: is the round on a cup the one its shake asked for, and who can know it before it's lifted", () => {
  // every round a client might find on a cup, against every cup: whose it is, how it was shaken, which draw, who
  // asked, whose parts it asked to keep sealed, and (once the contributors are fixed) who took part
  const P = ["ana", "ben", "cy"];
  const subsetsOf = (list) => list.reduce((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
  const ASKED = subsetsOf(P).filter((s) => s.length).map((s) => s.sort());
  const cases = [];
  for (const holder of [null, "ana"])
    for (const blind of [false, true])
      for (const draw of ["d1", "d2"])
        for (const by of ["ana", "ben"])
          for (const asked of ASKED)
            for (const contributors of [null, ...subsetsOf(P).filter((s) => s.includes(by)).map((s) => s.sort())]) cases.push({ holder, blind, draw, by, asked, contributors });
  it("has every case", () => expect(cases.length).toBe(2 * 2 * 2 * 2 * 7 * 5));

  it("ours: its draw, asked by the holder, sealed by the holder alone (or, blind, the holder among others); fits: and, blind, someone besides the holder kept a part sealed", () => {
    for (const c of cases) {
      const cup = cupOf({ traits: { "dice.cup": { holder: c.holder, up: false, blind: false, roll: { draw: "d1", dice: ["x"], blind: c.blind, done: false } } } });
      const sealers = c.contributors ? c.asked.filter((v) => c.contributors.includes(v)) : null;
      const st = { draw: c.draw, by: c.by, asked: c.asked, sealers };
      const isOurs = c.holder !== null && c.draw === "d1" && c.by === c.holder && (c.blind ? c.asked.includes(c.holder) && c.asked.length > 1 : c.asked.length === 1 && c.asked[0] === c.holder);
      expect(ours(st, cup), JSON.stringify(c)).toBe(isOurs);
      const isFit = isOurs && (!c.blind || sealers === null || sealers.some((v) => v !== c.holder));
      expect(fits(st, cup), JSON.stringify(c)).toBe(isFit);
      // what that means: a seed a client uses for this cup was one only its holder could know (in the open), or nobody (blind),
      // until the stage's audience released it. (One sealer knows a draw at once; several, none of them until they release.)
      if (isFit && sealers) {
        const knowsEarly = sealers.length === 1 ? sealers[0] : null;
        expect(knowsEarly, JSON.stringify(c)).toBe(c.blind ? null : c.holder);
      }
    }
    // no round at all, or no roll, is never a cup's
    expect(ours(null, cupOf({ traits: { "dice.cup": { holder: "ana", roll: { draw: "d1", dice: [] } } } }))).toBe(false);
    expect(ours({ draw: "d1", by: "ana", asked: ["ana"] }, cupOf({ traits: { "dice.cup": { holder: "ana", roll: null } } }))).toBe(false);
  });

  it("a shake asks for the holder's part sealed; shaken blind, every seated player's and the holder's: and the rounds asked so are ours", () => {
    expect(sealersFor("ana", false, ["ana", "ben", "cy"])).toEqual(["ana"]);
    expect(sealersFor("ana", true, ["ben", "cy", "ana"])).toEqual(["ana", "ben", "cy"]);
    expect(sealersFor("spec", true, ["ana", "ben"])).toEqual(["ana", "ben", "spec"]);
    expect(sealersFor("ana", true, null)).toEqual(["ana"]);
    for (const blind of [false, true]) {
      const cup = cupOf({ traits: { "dice.cup": { holder: "ana", roll: { draw: "d1", dice: [], blind } } } });
      expect(ours({ draw: "d1", by: "ana", asked: sealersFor("ana", blind, ["ana", "ben"]) }, cup)).toBe(true);
    }
    // shaken blind with nobody else seated: no round is ours (and Shake blind isn't offered then)
    const cup = cupOf({ traits: { "dice.cup": { holder: "ana", roll: { draw: "d1", dice: [], blind: true } } } });
    expect(ours({ draw: "d1", by: "ana", asked: sealersFor("ana", true, ["ana"]) }, cup)).toBe(false);
  });
});

describe("two shakes of one cup at once, merged by Automerge", () => {
  // The cup's roll (dice.cup) and its lots round (keep.lots) are separate keys, the round written after an await. Every
  // order of actors, and whether Ben's round is written before or after Ana's shake reached him: whichever roll and
  // round the merge keeps, a client can tell from the doc alone whether the round is the roll's (`ours`), and when it
  // isn't, it is the merged holder's own draw that has no round (so the holder's client is the one to ask again).
  it("ours tells, in every case, and the holder is the one whose round is missing", async () => {
    const A = await import("@automerge/automerge");
    const base = A.from({ objects: { cup: { traits: { "dice.cup": { holder: null, up: true, blind: false, roll: null }, "keep.lots": {} } } } });
    const shake = (who, draw) => (d) => {
      const t = d.objects.cup.traits["dice.cup"];
      t.holder = who;
      t.up = false;
      t.roll = { draw, dice: ["d0"], blind: false, done: false };
    };
    const round = (who, draw) => (d) => {
      d.objects.cup.traits["keep.lots"].round = { draw, id: `r${draw}`, by: who, sealers: [who] };
    };
    const seen = new Set();
    for (const [x, y] of [["aa", "bb"], ["bb", "aa"]]) {
      for (const benHeard of [false, true]) {
        let a = A.change(A.clone(base, { actor: x.repeat(16) }), shake("ana", "dANA"));
        let b = A.change(A.clone(base, { actor: y.repeat(16) }), shake("ben", "dBEN"));
        a = A.change(a, round("ana", "dANA"));
        if (benHeard) b = A.merge(b, A.clone(a));
        b = A.change(b, round("ben", "dBEN"));
        const m = A.merge(A.clone(a), b);
        const t = m.objects.cup.traits;
        const cup = cupOf({ traits: { "dice.cup": JSON.parse(JSON.stringify(t["dice.cup"])) } });
        const r = t["keep.lots"].round;
        const st = { draw: r.draw, by: r.by, asked: [...r.sealers] };
        const ok = ours(st, cup);
        seen.add(`${cup.holder}/${r.by}`);
        expect(ok).toBe(cup.roll.draw === r.draw && cup.holder === r.by);
        if (!ok) expect(cup.roll.draw).toBe(cup.holder === "ana" ? "dANA" : "dBEN");
      }
    }
    // the merge does keep one shake's roll with the other's round, in some of these
    expect([...seen].some((s) => s.split("/")[0] !== s.split("/")[1])).toBe(true);
  });
});
