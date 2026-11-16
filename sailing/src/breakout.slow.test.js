// Leaving the anchor in waves (DESIGN.md, "Leaving the anchor": "Open"),
// replayed in node: sailing-run.mjs's own sequence on the stock sloop, the
// seven seas of the Open table, each on the timeline the probe recorded in
// Chrome (its measured.anchoring, 2026-11-16, lane/n6): laid at anchor at
// world time 7.62 s where the doc had her, the main eased at 20.42 s,
// hoisted at the mast from 21.70 s for 0.35 s, raised at the helm from
// 24.45 s, the windlass held from 29.30 s, the HUD read 1.25 s after the
// anchor is up. test/breakout.js plays it with the stations' own held verbs
// and asks hud.js's own model for the advice, on B's read as the probe's
// gate does.
//
// Everything here is OPEN, a ratchet as KNOWN_GAPS are: each table is what
// the physics does today, row by row, and fails when a row changes (a fix,
// or any change to her physics or the copied water evaluator). Then the
// rows are re-measured and this file and DESIGN.md are rewritten together.
// Only verdicts are pinned (the HUD's advice, slack or taut, which way she
// drifts), never a magnitude. What a fix should make true is said with each
// table. (That the replay follows Chrome, to 2.3° and 0.05 m/s of the
// simulator's read at each mark, was measured once against the probe's
// marks and is in DESIGN.md; replay()'s moments carry that read, `sim`,
// to measure it again.)
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { replay, slackOf, stockSpec } from "./test/breakout.js";
import { createShip } from "./physics.js";
import { controlsOf } from "./sim.js";
import { createOcean } from "./test/ocean.js";

// Each case runs its world synchronously for seconds; a macrotask between cases lets the worker answer vitest's
// calls, which otherwise queue behind a whole block of them and time out.
beforeEach(() => new Promise((resolve) => setTimeout(resolve, 0)));

const TIMELINE = { lay: 7.616667, eased: 20.416667, hoist: 21.7, hoistFor: 0.35, raise: 24.45, weigh: 29.3, leaveAfter: 1.25 };
const BACK_THE_JIB = /back the jib \(B at the helm/;

// sea → where the doc had her when she was laid at anchor (sailing-run on lane/n6 at 62756a05); then, today:
// - up, leave: B's HUD says to back the jib at the frame the anchor comes up / when the probe reads it
// - pulled: while weighing, her rode is taut at some frame (the windlass pulls her, not only takes in slack)
const SEAS = {
  1: { at: [-14.074, -0.34, -14.321], up: true, leave: true, pulled: false },
  2: { at: [-12.335, -0.554, -13.02], up: true, leave: false, pulled: true },
  3: { at: [-12.692, 0.31, -15.206], up: true, leave: true, pulled: false },
  4: { at: [-11.798, -0.334, -13.554], up: true, leave: true, pulled: false },
  5: { at: [-14.129, -0.674, -16.68], up: false, leave: false, pulled: true },
  383967344: { at: [-14.198, -0.291, -15.701], up: true, leave: true, pulled: true },
  696349617: { at: [-13.18, -0.225, -13.502], up: true, leave: true, pulled: true },
};

/** The least chain her rode has to spare from `from` until the windlass is held, and whether it is taut at any frame while weighing. */
const rodeWatch = (from) => {
  const seen = { spare: Infinity, pulled: false };
  seen.onFrame = ({ w, A, ids, t, phase }) => {
    const s = slackOf(w, A, ids);
    if (s == null) return;
    if (phase === "anchored" && t > from) seen.spare = Math.min(seen.spare, s);
    if (phase === "weighing" && s < 0) seen.pulled = true;
  };
  return seen;
};

describe("OPEN: leaving the anchor in waves on sailing-run's timeline, main up (DESIGN.md, \"Leaving the anchor\": Open)", () => {
  // The plan's table: at breakout the HUD advises backing the jib on every sea. Today it does on six of seven at
  // the frame the anchor comes up, and on five when the probe reads it 1.25 s later.
  // Before the windlass turns, laid at anchor she is never on her rode (the target: lying to it, taut).
  for (const [seaKey, want] of Object.entries(SEAS)) {
    const sea = Number(seaKey);
    it(`sea ${sea}: B's HUD says to back the jib ${want.up ? "as the anchor comes up" : "NOT as the anchor comes up"}, ${want.leave ? "and" : "NOT"} when the probe reads it; chain to spare at every frame until the windlass turns; the windlass ${want.pulled ? "pulls her" : "only takes in slack"}`, async () => {
      const rode = rodeWatch(TIMELINE.lay);
      const r = await replay({ sea, ...TIMELINE, at: want.at, onFrame: rode.onFrame });
      expect({ up: BACK_THE_JIB.test(r.up.advice), leave: BACK_THE_JIB.test(r.leave.advice), slack: rode.spare > 0, pulled: rode.pulled }).toEqual({ up: want.up, leave: want.leave, slack: true, pulled: want.pulled });
    });
  }
});

describe("OPEN: before the windlass turns, she is never on her rode: laid by an editor's move or as Ship at anchor, main up or sails down", () => {
  // The anchor goes down under her bow (sim.js dropPoint; layout.js for Ship at anchor) with 25 m of chain in 10 m
  // of water. The target: she lies to it, the rode taut once she has fallen back on it.
  const cases = [];
  for (const sea of Object.keys(SEAS).map(Number)) {
    for (const anchored of [false, true]) {
      for (const main of [true, false]) if (anchored || !main) cases.push({ sea, anchored, main }); // laid, main up: above
    }
  }
  for (const { sea, anchored, main } of cases) {
    it(`sea ${sea}, ${anchored ? "Ship at anchor" : "laid at anchor"}, ${main ? "main up" : "sails down"}: chain to spare at every frame`, async () => {
      const rode = rodeWatch(TIMELINE.lay);
      await replay({ sea, ...TIMELINE, anchored, main, at: anchored ? null : SEAS[sea].at, end: TIMELINE.weigh, onFrame: rode.onFrame });
      expect(rode.spare).toBeGreaterThan(0);
      expect(rode.spare).toBeLessThan(Infinity); // it was down and watched
    });
  }
});

describe("OPEN: adrift with no wind and her sails down, she makes way toward the waves on most seas, bow or stern to them", () => {
  // Metres made toward the waves in 60 s, the waves from 045° (the template's wind): "toward" over a metre,
  // "away" over a metre the other way, else "neither" (under 2 cm/s). A hull in waves is pushed down-wave, slowly;
  // the target is no "toward" row. Most of it is her contract's heave damping applied along her body's vertical
  // (DESIGN.md, Open), though not all: damped along the world's vertical, sea 2 still makes way toward them.
  const FROM = 45;
  const DEG = Math.PI / 180;
  const BAND = 1;
  // sea → [bow to the waves, stern to them] (measured 2026-11-16)
  const DRIFT = {
    1: ["toward", "toward"],
    2: ["toward", "toward"],
    3: ["toward", "toward"],
    4: ["away", "away"],
    5: ["away", "neither"],
    383967344: ["toward", "toward"],
    696349617: ["toward", "toward"],
  };
  let ship;
  beforeAll(async () => {
    ship = createShip(await stockSpec());
  });
  for (const [seaKey, ways] of Object.entries(DRIFT)) {
    ["bow", "stern"].forEach((end, i) => {
      it(`sea ${seaKey}, ${end} to the waves: ${ways[i]}`, () => {
        const env = { water: createOcean({ wind: { speed: 7, from: FROM }, seed: Number(seaKey) }) };
        const controls = controlsOf({ helm: { angle: 0 }, sail: { raised: 0, sheet: 0.5 }, jib: { furl: 1, sheet: 0.5 }, anchor: { down: false } }, null, ship.spec);
        let s = ship.rest({ yaw: (-FROM - 180 * i) * DEG });
        const p0 = [...s.position];
        for (let k = 0; k < 60 * 30; k++) s = ship.step(s, controls, env, 1 / 30);
        const made = (s.position[0] - p0[0]) * Math.sin(FROM * DEG) - (s.position[2] - p0[2]) * Math.cos(FROM * DEG);
        expect(made > BAND ? "toward" : made < -BAND ? "away" : "neither").toBe(ways[i]);
      });
    });
  }
});
