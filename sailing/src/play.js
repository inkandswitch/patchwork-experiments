// The sailing extension: a ship you crew together (DESIGN.md, "Play"). It
// runs wherever the doc has a sailing trait, whatever anyone is doing.
// This file only joins the parts; each is its own module with its own tests:
//
//   sea-view.js  the sea: the world's water and wind (no clock)      (createSeaView)
//   sim.js       the ships: who simulates, physics, poses, controls  (createSim)
//   crew.js      coming aboard (walk's), the station body, the camera (createCrew)
//   looks.js     what each view dresses for itself: floats, the sail (createLooks)
//   stations.js  the helm, the sail, the anchor: verbs              (stationCommands)
//   hud.js       crosshair, wind, speed, heading, hints              (createHud)
//
// The sea itself (its waves, wind and sky) is another extension, sea.js,
// which gives them away as data; the water package draws and evaluates the
// world's water, and this extension reads it through ctx.sea.
//
// They meet through one context object, `ctx`, which each fills in as it's
// made (ctx.sea, ctx.sim, ctx.crew), and they import nothing of each other:
// what they share of the doc is in traits.js, of the maths in frames.js.
//
// The ships step as a process of the doc's clock (sim.js), before any of
// this. Then one loop runs the rest, in the order a frame needs: the sea's
// time offset latched, the ships' following (what the computer
// publishes), then the people standing on them as they now are, then what's
// dressed and read off them. This is also the one place the presence rate
// is set: the computer streams poses at RATE, someone aboard at 20 Hz, a
// watcher not at all.

import { createSeaView } from "./sea-view.js";
import { createSim } from "./sim.js";
import { createCrew } from "./crew.js";
import { createLooks } from "./looks.js";
import { stationCommands } from "./stations.js";
import { createHud } from "./hud.js";

/** The computer's presence rate (Hz): its poses and its ships' readings go out this often. */
export const RATE = 30;
/** Someone aboard: where they stand goes out this often. */
export const CREW_RATE = 20;

/** The presence rate this view wants. */
export const rateFor = ({ simulating, playing }) => (simulating ? RATE : playing ? CREW_RATE : 0);

export default {
  create(api) {
    const ctx = {};
    ctx.sea = createSeaView(api);
    ctx.sim = createSim(api, ctx);
    ctx.crew = createCrew(api, ctx);
    const looks = createLooks(api, ctx);
    const hud = createHud(api, ctx);
    const parts = [ctx.sea, ctx.sim, ctx.crew, looks, hud];

    let rate = null;
    const off = api.loop((dt) => {
      ctx.sea.tick();
      ctx.sim.tick();
      ctx.crew.tick(dt);
      looks.tick(dt);
      hud.tick(dt);
      const hz = rateFor({ simulating: ctx.sim.simulating(), playing: ctx.crew.me().playing });
      if (hz !== rate) api.presence.rate((rate = hz));
    });

    return {
      update(scene, local, prev) {
        for (const p of parts) p.update?.(scene, local, prev);
      },
      commands: stationCommands(api, ctx),
      input: ctx.crew.input,
      // the crew's body (scene/STAGE.md, "Bodies"): standing at a station, over walk (walking her deck is walk's)
      bodies: ctx.crew.bodies,
      dispose() {
        off?.();
        for (const p of [...parts].reverse()) p.dispose?.();
      },
      // for probes (probes/sailing-run.mjs): the parts, to read and nudge
      debug: ctx,
    };
  },
};
