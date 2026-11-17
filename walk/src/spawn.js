// walk's traits' part (DESIGN.md, "The traits"): `walk.spawn`, `walk.support`,
// `walk.moves`, `walk.stand` and `walk.ladder`, written by whatever lays a
// scene out (arena's pads, a Doom map's layout, a boat's parts) and read by
// the walk body (body.js, supports.js). Being their part is what makes a doc
// that carries one call for this package (scene/STAGE.md, "Activation" and
// "Packages") and list it, as its view.start may need. Its verbs: on a spawn
// point, Walk from here (menu); on a ladder, Climb (F), while you swim within
// reach of its foot.

import { REACH, SPAWN, walkerOf } from "./body.js";
import { LADDER, ownerOf } from "./supports.js";
import { apply } from "./frames.js";

/** Walk from here: on a spawn point, unless already walking. Pure. */
export function walkFromState(target, { scene, view } = {}) {
  if (target == null || !scene?.objects?.[target]?.traits?.[SPAWN]) return null;
  if (view?.body?.id === "walk") return null;
  return { title: "Start walking here, facing the way it faces" };
}

/**
 * Climb: on a ladder, while this session's walker swims within REACH (in
 * plan) of the ladder's foot, as its owner's mesh links it. Pure over the
 * walker (body.js's live session: { state(), env }).
 */
export function climbState(target, scene, w) {
  if (target == null || !scene?.objects?.[target]?.traits?.[LADDER]) return null;
  const st = w?.state?.();
  if (st?.mode !== "swimming") return null;
  const on = ownerOf(scene, target);
  const M = on == null ? null : w.env.frame(on);
  const link = w.env.mesh(on)?.links?.find((l) => l.kind === "ladder" && l.id === target);
  if (!link?.foot || (on != null && !M)) return null;
  const f = M ? apply(M, [link.foot[0], 0, link.foot[1]]) : [link.foot[0], 0, link.foot[1]];
  return Math.hypot(f[0] - st.p[0], f[2] - st.p[1]) <= REACH ? { title: "Climb out of the water" } : null;
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
        {
          id: "climb",
          name: "Climb",
          key: "f",
          show: ["use", "menu"],
          state: (target, ctx) => climbState(target, ctx?.scene ?? api.scene(), walkerOf(api.session ?? null, api.url ?? null)),
          run: (target) => {
            if (!walkerOf(api.session ?? null, api.url ?? null)?.climb(target)) api.notify("Couldn't climb there.");
          },
        },
      ],
    };
  },
};
