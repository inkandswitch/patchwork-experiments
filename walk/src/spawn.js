// Spawn points (the trait `walk.spawn`, on whatever marks where people start
// walking: arena's pads, a Doom map's player start). The walk body reads
// them (body.js); this part is their trait's own, so a doc that has spawn
// points calls for this package by the ordinary rule (scene/STAGE.md,
// "Activation" and "Packages") and lists it, as its view.start may need. Its
// one verb, on a spawn point: Walk from here.

import { SPAWN } from "./body.js";

/** Walk from here: on a spawn point, unless already walking. Pure. */
export function walkFromState(target, { scene, local } = {}) {
  if (target == null || !scene?.objects?.[target]?.traits?.[SPAWN]) return null;
  if (local?.body?.id === "walk") return null;
  return { title: "Start walking here, facing the way it faces" };
}

export default {
  create(api) {
    return {
      commands: [
        {
          id: "walk-from",
          name: "Walk from here",
          show: ["menu"],
          state: (target, ctx) => walkFromState(target, ctx),
          run: (target) => {
            if (!api.body.enter("walk", target)) api.notify("Couldn't walk from there.");
          },
        },
      ],
    };
  },
};
