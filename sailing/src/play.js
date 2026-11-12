// The sailing extension in play: a ship you crew together (DESIGN.md, "Play").
// This file only joins the parts; each is its own module with its own tests:
//
//   sea-view.js  the sea: its clock, the drawn ocean, the sky        (createSeaView)
//   sim.js       the ships: who simulates, physics, poses, controls  (createSim)
//   crew.js      people: walking the deck, swimming, avatars, camera (createCrew)
//   looks.js     what each view dresses for itself: floats, the sail (createLooks)
//   stations.js  the helm, the sail, the anchor, the ladder: verbs   (stationCommands)
//   hud.js       crosshair, wind, speed, heading, hints              (createHud)
//
// They meet through one context object, `ctx`, which each fills in as it's
// made (ctx.sea, ctx.sim, ctx.crew), and they import nothing of each other
// (but for hud.js, which takes crew.js's seatedView): what they share of the
// doc is in traits.js, of the maths in frames.js.
//
// One loop runs them, in the order a frame needs: the sea's clock first (the
// time the ships are stepped to and the waves drawn at), then the ships,
// then the people standing on them as they now are, then what's dressed and
// read off them. This is also the one place the presence rate is set: the
// simulator streams poses at RATE, someone aboard at 20 Hz, a watcher not
// at all.

import { createSeaView } from "./sea-view.js";
import { createSim } from "./sim.js";
import { createCrew } from "./crew.js";
import { createLooks } from "./looks.js";
import { stationCommands } from "./stations.js";
import { createHud } from "./hud.js";
import { carryableAboard } from "./traits.js";

/** The simulator's presence rate (Hz): its clock and its poses go out this often. */
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
    const off = api.loop((dt, now) => {
      ctx.sea.tick(dt, now, ctx.sim.simulating(), ctx.sim.simulator());
      ctx.sim.tick(dt);
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
      atmosphere: () => ctx.sea.atmosphere(),
      // the hand (a game played aboard) never picks up the ship or her fittings (traits.js)
      carryable: (id) => carryableAboard(api.scene(), id),
      commands: stationCommands(api, ctx),
      input: ctx.crew.input,
      // what walks, for whoever owns seats (api.collect("firstPerson"): stand up at a seat, sit back down)
      firstPerson: ctx.crew.firstPerson,
      receive(type, data, from) {
        for (const p of parts) p.receive?.(type, data, from);
      },
      dispose() {
        off?.();
        for (const p of [...parts].reverse()) p.dispose?.();
      },
      // for probes (probes/sailing-run.mjs): the parts, to read and nudge
      debug: ctx,
    };
  },
};
