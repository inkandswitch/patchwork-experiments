// Leaving the anchor in waves (DESIGN.md, "Leaving the anchor": "Open"),
// replayed in node: sailing-run.mjs's own sequence on the stock sloop, the
// seven seas of the Open table, each on the timeline the probe recorded in
// Chrome (its measured.anchoring, 2026-11-16, lane/n6): laid at anchor at
// world time 7.62 s where the doc had her, the main eased at 20.42 s,
// hoisted at the mast from 21.70 s for 0.35 s, raised at the helm from
// 24.45 s, the windlass held from 29.30 s, the HUD read 1.25 s after the
// anchor is up. test/breakout.js plays it with the stations' own held verbs
// and asks hud.js's own model for the advice.
//
// What it pins:
// - the replay reaches Chrome's verdict on every sea (the leave step
//   exercised or not: the HUD's advice to back the jib), and her apparent
//   wind and speed as Chrome measured them, at the frame the anchor comes up
//   and when the probe reads the HUD;
// - the diagnosis (OPEN, a ratchet: it fails once the defect is fixed, and
//   then this test and DESIGN.md are rewritten): from the moment she is laid
//   at anchor until the windlass is turned, her rode has chain to spare at
//   every frame. The anchor goes down under her bow (sim.js dropPoint) with
//   25 m of chain in 10 m of water, and in the probe's 22 s she never falls
//   back onto it: she isn't lying to her anchor at all, but adrift beside it,
//   main up or sails down. Whether she is head to wind as it comes up is
//   where the waves and gusts have turned a free boat.
// - a second finding (OPEN, a ratchet too): adrift in those waves with no
//   wind and her sails down, bow to the waves, she makes a few tenths of a
//   metre a second INTO them. Waves push a hull down-wave; this is her
//   contract's heave damping applied along her body's vertical (physics.js,
//   "moving ahead pitched, that's her bottom's lift"): pitching in a head
//   sea, its fore-and-aft part is a thrust. With the same damping along the
//   world's vertical (a scratch switch, measured 2026-11-16) she goes 6.4 and
//   8.1 m down-wave instead. It is a question for the lead (DESIGN.md).
import { describe, it, expect } from "vitest";
import { replay, slackOf, spec } from "./test/breakout.js";
import { createShip } from "./physics.js";
import { controlsOf } from "./sim.js";
import { createOcean } from "./test/ocean.js";

const TIMELINE = { lay: 7.616667, eased: 20.416667, hoist: 21.7, hoistFor: 0.35, raise: 24.45, weigh: 29.3, leaveAfter: 1.25 };

// sea → where the doc had her when she was laid at anchor, and Chrome's read at the frame the anchor came up
// and when the probe read the HUD (apparent wind ° off the bow, + from starboard; speed m/s through the water,
// − astern); `exercised`: the HUD said to back the jib then (sailing-run on lane/n6 at 62756a05, 2026-11-16)
const CHROME = {
  1: { at: [-14.074, -0.34, -14.321], up: [0.78, -0.566], leave: [-12.05, -0.35], exercised: true },
  2: { at: [-12.335, -0.554, -13.02], up: [29.43, -0.431], leave: [38.81, -0.434], exercised: false },
  3: { at: [-12.692, 0.31, -15.206], up: [-3.59, -0.445], leave: [-5.49, -0.59], exercised: true },
  4: { at: [-11.798, -0.334, -13.554], up: [17.66, -0.43], leave: [22.51, -0.467], exercised: true },
  5: { at: [-14.129, -0.674, -16.68], up: [-140.09, 0.399], leave: [-158.94, 0.896], exercised: false },
  383967344: { at: [-14.198, -0.291, -15.701], up: [-29.93, 0.481], leave: [-13.89, -0.004], exercised: true },
  696349617: { at: [-13.18, -0.225, -13.502], up: [-32.06, 0.379], leave: [-21.38, 0.628], exercised: false },
};
const AWA = 5; // ° either way
const SPEED = 0.1; // m/s either way
const BACK_THE_JIB = /back the jib \(B at the helm/;

describe("leaving the anchor in waves, replayed in node on sailing-run's timeline (DESIGN.md, \"Leaving the anchor\": Open)", () => {
  for (const [seaKey, chrome] of Object.entries(CHROME)) {
    const sea = Number(seaKey);
    it(`sea ${sea}: the replay reaches Chrome's verdict (${chrome.exercised ? "exercised" : "not exercised"}); OPEN: laid at anchor, her rode had chain to spare at every frame until the windlass turned`, async () => {
      let spare = Infinity;
      const r = await replay({
        sea,
        ...TIMELINE,
        at: chrome.at,
        onFrame: (A, ids, t, w) => {
          if (t <= TIMELINE.lay || t >= TIMELINE.weigh) return;
          const s = slackOf(w, A, ids);
          if (s != null) spare = Math.min(spare, s);
        },
      });
      console.log(`sea ${sea}: up ${JSON.stringify(r.up)} leave ${JSON.stringify(r.leave)} least slack ${spare.toFixed(2)} m`);
      expect(BACK_THE_JIB.test(r.leave.advice)).toBe(chrome.exercised);
      expect(Math.abs(r.up.awa - chrome.up[0])).toBeLessThan(AWA);
      expect(Math.abs(r.up.speed - chrome.up[1])).toBeLessThan(SPEED);
      expect(Math.abs(r.leave.awa - chrome.leave[0])).toBeLessThan(AWA);
      expect(Math.abs(r.leave.speed - chrome.leave[1])).toBeLessThan(SPEED);
      // OPEN: never on her rode before weighing
      expect(spare).toBeGreaterThan(0);
    });
  }
});

describe("OPEN: adrift in a head sea, no wind, sails down, she makes way into the waves", () => {
  const ship = createShip(spec());
  const DEG = Math.PI / 180;
  const from = 45; // the template's wind, the waves' direction
  // seed → metres she makes toward the waves in 60 s (measured 2026-11-16)
  for (const [seed, ahead] of [[1, 10.59], [696349617, 11.36]]) {
    it(`sea ${seed}: ${ahead} m toward the waves in 60 s (±0.5 m)`, () => {
      const env = { water: createOcean({ wind: { speed: 7, from }, seed }) };
      const controls = controlsOf({ helm: { angle: 0 }, sail: { raised: 0, sheet: 0.5 }, jib: { furl: 1, sheet: 0.5 }, anchor: { down: false } }, null, ship.spec);
      let s = ship.rest({ yaw: -from * DEG });
      const p0 = [...s.position];
      for (let i = 0; i < 60 * 30; i++) s = ship.step(s, controls, env, 1 / 30);
      const made = (s.position[0] - p0[0]) * Math.sin(from * DEG) - (s.position[2] - p0[2]) * Math.cos(from * DEG);
      expect(Math.abs(made - ahead)).toBeLessThan(0.5);
    });
  }
});
