// Which water a thing is in (choose.js): W15. The finite space WATER.md
// names, every case: the world's open water {none, level 0 flat, level 0
// with waves} × every subset of four own bodies {A, a box holding p; N, a
// smaller box inside A holding p; C, a box elsewhere; D, a box attached
// under the asker holding p} × five points × `not` {the asker, none}; then
// a levels axis, A and N each at {-1, 0, 1} against open water at 0 and none,
// in three columns at twelve heights. The expectation is the rule written out
// apart from the code.
import { describe, expect, it } from "vitest";
import { choose } from "./choose.js";
import { boxOf } from "./bodies.js";
import { compose } from "./test/fake-view.js";

const box = (size, position, yaw = 0) => boxOf(size, compose({ position, rotation: [0, yaw, 0] }));
// volumes: N 8 < D 108 < A 400; every surface at level 0; C far off
const BODIES = {
  A: { box: box([10, 4, 10], [0, 0, 0]), A: 0.5 },
  N: { box: box([2, 2, 2], [0, 0, 0]), A: 0.5 },
  C: { box: box([4, 2, 4], [50, 0, 0]), A: 0.5 },
  D: { box: box([6, 3, 6], [0, 0, 0]), A: 0.5, under: true },
};
const OPEN = { none: null, flat: { level: 0, A: 0.5 }, waved: { level: 0, A: 1.5 } };
const POINTS = {
  "inside, below the level": [0, -0.5, 0],
  "inside, within the band": [0, 0.3, 0],
  "above the band, in the footprint": [0, 5, 0],
  "outside every footprint": [20, -0.5, 20],
  "below every floor": [0, -6, 0],
};
const subsets = () => {
  const names = Object.keys(BODIES);
  return Array.from({ length: 16 }, (_, m) => names.filter((_, i) => m & (1 << i)));
};

/** The rule, written out per kind of point (the expected answer, as a body name, "open" or null). */
function expected(kind, open, present, notAsker) {
  const mine = present.filter((n) => !(notAsker && BODIES[n].under));
  // those whose footprint holds x = z = 0, smallest volume first, and lowest id first
  const bySize = ["N", "D", "A"].filter((n) => mine.includes(n));
  const byId = ["A", "D", "N"].filter((n) => mine.includes(n));
  switch (kind) {
    case "inside, below the level":
    case "inside, within the band":
      return bySize[0] ?? (open ? "open" : null);
    case "above the band, in the footprint":
      // the highest rest surface below: all at 0, things before weather, the lowest id
      return byId[0] ?? (open ? "open" : null);
    case "outside every footprint":
    case "below every floor":
      return open ? "open" : null;
  }
}

describe("the choice (W15)", () => {
  for (const [openName, open] of Object.entries(OPEN))
    for (const present of subsets())
      it(`open water ${openName}, own bodies {${present.join(", ")}}: every point, the asker left out or not`, () => {
        for (const [kind, p] of Object.entries(POINTS))
          for (const notAsker of [true, false]) {
            const list = present.map((id) => ({ id, box: BODIES[id].box, A: BODIES[id].A, carried: notAsker && !!BODIES[id].under }));
            const got = choose(p, open, list);
            const name = got === null ? null : got.kind === "open" ? "open" : got.id;
            expect([kind, notAsker, name]).toEqual([kind, notAsker, expected(kind, open, present, notAsker)]);
          }
      });

  // the levels axis: A (10 × 4 × 10) and N (2 × 2 × 2, inside A's column) each at a level in {-1, 0, 1}, against
  // open water at 0 (flat) or none; asked in three columns (both footprints, A's only, neither) at heights that
  // fall on no level, floor or band edge, and from above. The fallback's ranking (the highest rest surface below,
  // things before weather at an equal level, then the lowest id) is enumerated here, not sampled.
  const LEVELS = [-1, 0, 1];
  const COLUMNS = { "both footprints": [0, 0], "A's footprint only": [3, 0], "no footprint": [20, 20] };
  const HEIGHTS = [null, -5.5, -3.5, -2.5, -1.5, -0.75, 0, 0.25, 0.75, 1.25, 1.75, 6];
  /** The rule, written out over plain numbers (no boxes): the expected answer. */
  function ranked(x, z, y, la, ln, open) {
    const bodies = [
      { id: "A", level: la, floor: la - 4, half: 5, volume: 400 },
      { id: "N", level: ln, floor: ln - 2, half: 1, volume: 8 },
    ].filter((b) => Math.abs(x) <= b.half && Math.abs(z) <= b.half);
    if (y !== null) {
      const holding = bodies.filter((b) => y >= b.floor && y <= b.level + 0.5).sort((a, b) => a.volume - b.volume);
      if (holding.length) return holding[0].id;
      if (open && y <= open.level + open.A) return "open";
    }
    const below = bodies.filter((b) => y === null || b.level <= y);
    const all = [...below.map((b) => ({ name: b.id, level: b.level, rank: 0 })), ...(open && (y === null || open.level <= y) ? [{ name: "open", level: open.level, rank: 1 }] : [])];
    // highest first; at an equal level a thing (rank 0) before the weather, then the lowest id
    all.sort((a, b) => b.level - a.level || a.rank - b.rank || (a.name < b.name ? -1 : 1));
    return all[0]?.name ?? null;
  }
  for (const la of LEVELS)
    for (const ln of LEVELS)
      it(`levels: A at ${la}, N at ${ln}, against open water at 0 and none, every column and height`, () => {
        const list = [
          { id: "A", box: box([10, 4, 10], [0, la, 0]), A: 0.5 },
          { id: "N", box: box([2, 2, 2], [0, ln, 0]), A: 0.5 },
        ];
        for (const open of [OPEN.flat, null])
          for (const [col, [x, z]] of Object.entries(COLUMNS))
            for (const y of HEIGHTS) {
              const got = choose([x, y, z], open, list);
              const name = got === null ? null : got.kind === "open" ? "open" : got.id;
              expect([!!open, col, y, name]).toEqual([!!open, col, y, ranked(x, z, y, la, ln, open)]);
            }
      });

  it("by the rest band, not the displaced surface: every height in the waved band is the open water's (the choice has no time to flicker on)", () => {
    for (let y = -1.5; y <= 1.5; y += 0.25) expect(choose([20, y, 20], OPEN.waved, [])).toEqual({ kind: "open" });
    expect(choose([20, 1.51, 20], OPEN.waved, [])).toEqual({ kind: "open" }); // above it, the highest surface below: still the open water
    expect(choose([20, 1.51, 20], null, [])).toBeNull();
    // a flat body's band is 0.5: at 0.6 the box no longer holds p, and the highest surface below is still the box's
    expect(choose([0, 0.6, 0], null, [{ id: "A", ...BODIES.A }])).toEqual({ kind: "bounded", id: "A" });
    expect(choose([0, 0.6, 0], OPEN.waved, [{ id: "A", ...BODIES.A }])).toEqual({ kind: "open" });
  });

  it("from above (p[1] null): the highest rest surface in the column, things before weather", () => {
    const pond = { id: "P", box: box([4, 1, 4], [0, 2, 0]), A: 0.5 };
    expect(choose([0, null, 0], OPEN.flat, [pond])).toEqual({ kind: "bounded", id: "P" });
    expect(choose([9, null, 0], OPEN.flat, [pond])).toEqual({ kind: "open" });
    expect(choose([0, null, 0], null, [])).toBeNull();
    // a pond below the open water's level loses to it
    const low = { ...pond, box: box([4, 1, 4], [0, -2, 0]) };
    expect(choose([0, null, 0], OPEN.flat, [low])).toEqual({ kind: "open" });
  });

  it("a turned footprint is tested in the body's own frame", () => {
    const long = { id: "L", box: box([2, 1, 20], [0, 0, 0], Math.PI / 2), A: 0.5 };
    expect(choose([9, -0.2, 0], null, [long])).toEqual({ kind: "bounded", id: "L" });
    expect(choose([0, -0.2, 9], null, [long])).toBeNull();
  });

  it("equal volumes: the lowest id", () => {
    const twin = (id) => ({ id, box: box([2, 2, 2], [0, 0, 0]), A: 0.5 });
    expect(choose([0, -0.5, 0], null, [twin("b"), twin("a")])).toEqual({ kind: "bounded", id: "a" });
  });
});
