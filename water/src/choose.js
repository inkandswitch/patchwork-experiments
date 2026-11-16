// Which water a thing is in (WATER.md, "Which water a thing is in"): a pure
// function of the world's open water, the stage's own doc's bounded bodies
// (their boxes from their drawn poses) and a point in the stage's frame.
//
//   1. Leave out what you carry: bodies attached under the asker (`carried`,
//      worked out by the caller from the doc's tree) never answer for it, so
//      a tank or a flooded hold never buoys its own hull.
//   2. Find the regions holding p, by the rest band (up to the level plus
//      the waves' amplitude bound), never the displaced surface, so the
//      choice doesn't flicker on a crest. A bounded body's region is inside
//      its footprint and above its floor; the open water's is everything up
//      to its band.
//   3. Things before weather: own bounded bodies first, the smallest volume
//      first (an aquarium in a flooded hold), then the lowest id; the
//      world's open water last.
//   4. No region holds p: the highest rest surface below p among the bodies
//      whose footprint holds p's column (a thing above a pond). p[1] null is
//      "from above": only this step answers.
//   5. None at all: null. Never the wrong water.

import { aboveFloor, inFootprint } from "./bodies.js";

/**
 * @param {number[]} p  [x, y | null, z] in the stage's frame
 * @param {{ level: number, A: number } | null} open  the world's open water here (its level in this frame and its band), or none
 * @param {{ id: string, box: ReturnType<import("./bodies.js").boxOf>, A: number, carried?: boolean }[]} bounded  this doc's bounded bodies
 * @returns {{ kind: "open" } | { kind: "bounded", id: string } | null}
 */
export function choose(p, open, bounded) {
  const y = p[1];
  const above = y === null || y === undefined || y === Infinity;
  const mine = (bounded ?? []).filter((b) => !b.carried);
  const columns = mine.filter((b) => inFootprint(b.box, p));
  if (!above) {
    const holding = columns.filter((b) => aboveFloor(b.box, p) && y <= b.box.level + b.A);
    if (holding.length) {
      holding.sort((a, b) => a.box.volume - b.box.volume || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { kind: "bounded", id: holding[0].id };
    }
    if (open && y <= open.level + open.A) return { kind: "open" };
  }
  // nothing holds p: the highest rest surface below it in its column
  let best = null;
  let bestLevel = -Infinity;
  for (const b of columns) {
    if ((above || b.box.level <= y) && (b.box.level > bestLevel || (b.box.level === bestLevel && best?.kind === "bounded" && b.id < best.id))) {
      best = { kind: "bounded", id: b.id };
      bestLevel = b.box.level;
    }
  }
  if (open && (above || open.level <= y) && open.level > bestLevel) best = { kind: "open" };
  return best;
}
