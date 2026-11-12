// The audience algebra (audience.js), over the whole small lattice: two
// seated viewers a and b, a spectator c who is in no list, every `show`
// (absent, [], [a], [b], [a, b], "all") with every `only` (absent, [], [a],
// [b], [a, b]), and every list of up to three such answers. No sampling.
import { describe, it, expect } from "vitest";
import { ALL, cleanAnswer, inAudience, mergeAudience, mergeShown } from "./audience.js";

const SHOWS = [undefined, [], ["a"], ["b"], ["a", "b"], ALL];
const ONLYS = [undefined, [], ["a"], ["b"], ["a", "b"]];
const ANSWERS = [null];
for (const show of SHOWS) for (const only of ONLYS) ANSWERS.push({ ...(show !== undefined ? { show } : {}), ...(only !== undefined ? { only } : {}) });
const VIEWERS = ["a", "b", "c"];

const LISTS = [[]];
for (const x of ANSWERS) {
  LISTS.push([x]);
  for (const y of ANSWERS) {
    LISTS.push([x, y]);
    for (const z of ANSWERS) LISTS.push([x, y, z]);
  }
}

// the definition, said viewer by viewer
const shows = (a, v) => !!a && (a.show === ALL || (Array.isArray(a.show) && a.show.includes(v)));
const allows = (a, v) => !a || a.only === undefined || a.only.includes(v);
const shownTo = (list, v) => list.some((a) => shows(a, v));
const mayKnow = (list, v) => shownTo(list, v) && list.every((a) => allows(a, v));

describe("the audience algebra, exhaustively", () => {
  it(`covers ${ANSWERS.length} answers and ${LISTS.length} lists`, () => {
    expect(ANSWERS.length).toBe(31);
    expect(LISTS.length).toBe(1 + 31 + 31 * 31 + 31 * 31 * 31);
  });

  it("a viewer is in the audience exactly when some policy shows it to them and none screens it from them", () => {
    for (const list of LISTS) {
      const A = mergeAudience(list);
      const S = mergeShown(list);
      for (const v of VIEWERS) {
        expect(inAudience(A, v)).toBe(mayKnow(list, v));
        expect(inAudience(S, v)).toBe(shownTo(list, v));
      }
    }
  });

  it('"all" exactly when something shows it to all and nothing limits it; otherwise a sorted list without repeats', () => {
    for (const list of LISTS) {
      const A = mergeAudience(list);
      const top = list.some((a) => a?.show === ALL) && list.every((a) => !a || a.only === undefined);
      expect(A === ALL).toBe(top);
      if (A !== ALL) expect(A).toEqual([...new Set(A)].sort());
    }
  });

  it("order never matters, and saying a thing twice says it once", () => {
    for (const [x, y, z] of LISTS.filter((l) => l.length === 3)) {
      const want = JSON.stringify(mergeAudience([x, y, z]));
      for (const p of [[x, z, y], [y, x, z], [y, z, x], [z, x, y], [z, y, x], [x, y, z, x], [x, x, y, z, z]]) expect(JSON.stringify(mergeAudience(p))).toBe(want);
      const shown = JSON.stringify(mergeShown([x, y, z]));
      for (const p of [[z, y, x], [y, z, x, y]]) expect(JSON.stringify(mergeShown(p))).toBe(shown);
    }
  });

  it("the audience is within who it's shown to; nobody without a show", () => {
    for (const list of LISTS) {
      const A = mergeAudience(list);
      const S = mergeShown(list);
      for (const v of VIEWERS) if (inAudience(A, v)) expect(inAudience(S, v)).toBe(true);
      if (!list.some((a) => a?.show !== undefined)) expect(A).toEqual([]);
    }
  });

  it("one more policy: an `only` never lets anyone new in, a bare `show` never puts anyone out", () => {
    for (const list of LISTS.filter((l) => l.length <= 2)) {
      for (const extra of ANSWERS) {
        const before = mergeAudience(list);
        const after = mergeAudience([...list, extra]);
        for (const v of VIEWERS) {
          if (!extra || extra.show === undefined) expect(inAudience(after, v) && !inAudience(before, v)).toBe(false);
          if (!extra || extra.only === undefined) expect(inAudience(before, v) && !inAudience(after, v)).toBe(false);
        }
      }
    }
  });

  it("a missing `only` enlarges the audience: why an unknown policy must fail closed", () => {
    expect(mergeAudience([{ show: ALL }, { only: ["a"] }])).toEqual(["a"]);
    expect(mergeAudience([{ show: ALL }])).toBe(ALL);
  });

  it("today's table: face down in your own tray is yours (expose and occlude are two things, not one intersection)", () => {
    // the tray shows it to its seat and screens it from the rest; lying face down shows it to nobody
    expect(mergeAudience([{ show: ["a"], only: ["a"] }, null])).toEqual(["a"]);
    // face up behind a's screen: shown to all, a's alone
    expect(mergeShown([{ show: ALL }, { only: ["a"] }])).toBe(ALL);
    expect(mergeAudience([{ show: ALL }, { only: ["a"] }])).toEqual(["a"]);
  });
});

describe("answers, made safe", () => {
  it("drops what isn't a viewer, and reads an `only` that isn't a list as nobody", () => {
    expect(cleanAnswer({ show: ["b", "a", "a", 3, ""], only: ["a", null] })).toEqual({ show: ["a", "b"], only: ["a"] });
    expect(cleanAnswer({ only: "all" })).toEqual({ only: [] });
    expect(cleanAnswer({ show: "everyone" })).toBeNull();
    for (const junk of [null, undefined, 3, "all", [], {}]) expect(cleanAnswer(junk) ?? null).toBeNull();
    expect(mergeAudience([{ show: ALL }, { only: "nonsense" }])).toEqual([]);
  });

  it("unknown (null) is nobody", () => {
    for (const v of VIEWERS) expect(inAudience(null, v)).toBe(false);
    expect(inAudience(ALL, null)).toBe(true);
    expect(inAudience(["a"], null)).toBe(false);
  });
});
