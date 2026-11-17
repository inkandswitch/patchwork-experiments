// The exit's rules, exhaustively over finite sets of cases: every trait value
// × every target, against a plain statement of the rule (the oracle), so the
// cases say what the code must do and nothing is sampled. Reach is the
// stage's (the command says reach: true): scene's keymap tests cover it.
import { describe, expect, it } from "vitest";
import { DEFAULT_VERB, KEY, destinationOf, docOf, exitVerb } from "./exit.js";

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

describe("the verb, for every trait and target", () => {
  // the rule, stated plainly
  const oracle = ({ toWant, verbWant, target }) => (target === "e" && toWant != null ? { label: verbWant, to: toWant } : null);
  const cases = [];
  for (const [to, toWant] of TOS) for (const [verb, verbWant] of VERBS) for (const target of TARGETS) cases.push({ to, toWant, verb, verbWant, target });

  it(`agrees with the rule in all ${13 * 8 * 6} cases`, () => {
    const wrong = [];
    for (const c of cases) {
      const trait = {};
      if (c.to !== undefined) trait.to = c.to;
      if (c.verb !== undefined) trait.verb = c.verb;
      const got = exitVerb(sceneWith(trait), c.target, { here: HERE });
      const want = oracle(c);
      if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push({ c, got, want });
    }
    expect(wrong).toEqual([]);
  });

  it("offers nothing on an object whose trait is gone, or in an empty scene", () => {
    expect(exitVerb({ objects: { e: { traits: {} } } }, "e")).toBe(null);
    expect(exitVerb(null, "e")).toBe(null);
    expect(exitVerb({}, "e")).toBe(null);
  });
});
