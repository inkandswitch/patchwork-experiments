// The exit's rules, exhaustively over finite sets of cases: every trait value
// × every look × every target × both surfaces, against a plain statement of
// the rule (the oracle), so the cases say what the code must do and nothing
// is sampled.
import { describe, expect, it } from "vitest";
import { DEFAULT_VERB, KEY, REACH, destinationOf, docOf, exitVerb, inReach, verbOf } from "./exit.js";

const HERE = "automerge:4NMNnkMhL8jXrdJ9jamS2ix4pTMh";
const THERE = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";

// every kind of `to`: [value, where it leads (null: nowhere)]
const TOS = [
  [undefined, null],
  [null, null],
  [42, null],
  ["", null],
  ["   ", null],
  ["https://patchwork.inkandswitch.com/#doc=" + THERE, null],
  ["automerge:", null],
  ["automerge:0OIl", null], // not base58
  [THERE, THERE],
  [`  ${THERE}  `, THERE],
  [`${THERE}#below`, `${THERE}#below`],
  [HERE, null], // where it already is
  [`${HERE}#somewhere`, null],
];
// every kind of `verb`: [value, what it's called]
const VERBS = [
  [undefined, DEFAULT_VERB],
  [null, DEFAULT_VERB],
  [7, DEFAULT_VERB],
  ["", DEFAULT_VERB],
  ["   ", DEFAULT_VERB],
  ["Go below", "Go below"],
  ["  Exit  ", "Exit"],
  ["x".repeat(41), "x".repeat(40)],
];
const EYE = [0, 1.6, 0];
// every kind of look the use prompt can pass: [ctx, within reach]
const LOOKS = [
  [{}, false], // the key map: no eye
  [{ from: EYE }, false],
  [{ hit: { id: "x", distance: 1 } }, false],
  [{ from: EYE, hit: { id: "x", distance: 0.3 } }, true],
  [{ from: EYE, hit: { id: "x", distance: REACH } }, true],
  [{ from: EYE, hit: { id: "x", distance: REACH + 0.001 } }, false],
  [{ from: EYE, hit: { id: "x", point: [0, 1.6, -1.5] } }, true],
  [{ from: EYE, hit: { id: "x", point: [0, 1.6, -2.5] } }, false],
  [{ from: EYE, hit: { id: "x", distance: NaN, point: [1, 1.6, -1] } }, true],
  [{ from: EYE, hit: { id: "x" } }, false],
];
// every kind of target, in a scene with an exit "e" whose trait each case sets
const TARGETS = ["e", "plain", "group", "missing", "dimension:d1", null];
const sceneWith = (trait) => ({
  objects: {
    e: { name: "Exit", traits: { [KEY]: trait } },
    plain: { name: "A crate", traits: { "joints.slide": {} } },
    group: { kind: "group", name: "G", traits: { [KEY]: { to: THERE } } },
  },
});

describe("where an exit leads", () => {
  it.each(TOS)("to %j leads to %j", (to, want) => {
    expect(destinationOf(to === undefined ? {} : { to }, HERE)).toBe(want);
  });
  it("leads nowhere without a trait, and anywhere but here when here is unknown", () => {
    expect(destinationOf(null, HERE)).toBe(null);
    expect(destinationOf(undefined)).toBe(null);
    expect(destinationOf({ to: HERE }, null)).toBe(HERE);
  });
  it("a link's document is the link up to its id", () => {
    expect(docOf(`${THERE}#a|b`)).toBe(THERE);
    expect(docOf("automerge:")).toBe(null);
    expect(docOf(null)).toBe(null);
  });
});

describe("what using it is called", () => {
  it.each(VERBS)("verb %j is called %j", (verb, want) => {
    expect(verbOf(verb === undefined ? {} : { verb })).toBe(want);
  });
});

describe("arm's reach", () => {
  it.each(LOOKS)("%j: within reach %s", (ctx, want) => {
    expect(inReach(ctx.from, ctx.hit)).toBe(want);
  });
});

describe("the verb, for every trait, look, target and surface", () => {
  // the rule, stated plainly
  const oracle = ({ toWant, verbWant, target, surface, reach }) => (target === "e" && toWant != null && (surface === "menu" || reach) ? { label: verbWant, to: toWant } : null);
  const cases = [];
  for (const [to, toWant] of TOS)
    for (const [verb, verbWant] of VERBS)
      for (const target of TARGETS)
        for (const surface of ["use", "menu"])
          for (const [ctx, reach] of surface === "use" ? LOOKS : [[{}, false]]) cases.push({ to, toWant, verb, verbWant, target, surface, ctx, reach });

  it(`agrees with the rule in all ${13 * 8 * 6 * (10 + 1)} cases`, () => {
    expect(cases.length).toBe(13 * 8 * 6 * 11);
    const wrong = [];
    for (const c of cases) {
      const trait = {};
      if (c.to !== undefined) trait.to = c.to;
      if (c.verb !== undefined) trait.verb = c.verb;
      const got = exitVerb(sceneWith(trait), c.target, { surface: c.surface, here: HERE, ...c.ctx });
      const want = oracle(c);
      if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push({ c, got, want });
    }
    expect(wrong).toEqual([]);
  });

  it("offers nothing on an object whose trait is gone, or in an empty scene", () => {
    expect(exitVerb({ objects: { e: { traits: {} } } }, "e", { surface: "menu" })).toBe(null);
    expect(exitVerb(null, "e", { surface: "menu" })).toBe(null);
    expect(exitVerb({}, "e", { surface: "menu" })).toBe(null);
  });
});
