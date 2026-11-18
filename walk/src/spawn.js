// walk's traits' part (DESIGN.md, "The traits"): `walk.spawn`, `walk.support`,
// `walk.moves`, `walk.stand` and `walk.ladder`, written by whatever lays a
// scene out (arena's pads, a Doom map's layout, a boat's parts) and read by
// the walk body (body.js, supports.js). Being their part is what makes a doc
// that carries one call for this package (scene/STAGE.md, "Activation" and
// "Packages") and list it, as its view.start may need. Its verbs: on a spawn
// point, Walk from here (menu); on a ladder, or on the support it hangs on,
// Climb (F), while you swim within reach of its foot.

import { REACH, SPAWN, walkerOf } from "./body.js";
import { LADDER, SUPPORT, ownerOf } from "./supports.js";
import { apply } from "./frames.js";

/** Walk from here: on a spawn point, unless already walking. Pure. */
export function walkFromState(target, { scene, view } = {}) {
  if (target == null || !scene?.objects?.[target]?.traits?.[SPAWN]) return null;
  if (view?.body?.id === "walk") return null;
  return { title: "Start walking here, facing the way it faces" };
}

/**
 * The ladder a look at `target` climbs: the ladder itself, or (a look at the
 * support it hangs on, past a thin ladder) the nearest of that support's
 * ladders; either only while this session's walker swims within REACH (in
 * plan) of its foot, as its owner's mesh links it. Pure over the walker
 * (body.js's live session: { state(), env }). null when none.
 */
export function ladderFor(target, scene, w) {
  const st = w?.state?.();
  if (target == null || st?.mode !== "swimming" || !scene?.objects?.[target]) return null;
  const isLadder = (id) => !!scene.objects[id]?.traits?.[LADDER];
  const ladders = isLadder(target) ? [target] : scene.objects[target].traits?.[SUPPORT] ? Object.keys(scene.objects).filter((id) => isLadder(id) && ownerOf(scene, id) === target).sort() : [];
  let best = null;
  for (const id of ladders) {
    const on = ownerOf(scene, id);
    const M = on == null ? null : w.env.frame(on);
    const link = w.env.mesh(on)?.links?.find((l) => l.kind === "ladder" && l.id === id);
    if (!link?.foot || (on != null && !M)) continue;
    const f = M ? apply(M, [link.foot[0], 0, link.foot[1]]) : [link.foot[0], 0, link.foot[1]];
    const d = Math.hypot(f[0] - st.p[0], f[2] - st.p[1]);
    if (d <= REACH && (!best || d < best.d)) best = { id, d };
  }
  return best?.id ?? null;
}

/** Climb: on a ladder, or on the support it hangs on, while you swim within reach of its foot (ladderFor). */
export const climbState = (target, scene, w) => (ladderFor(target, scene, w) ? { title: "Climb out of the water" } : null);

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
          state: (target, ctx) => climbState(target, ctx?.scene ?? api.scene(), walkerOf(api.channel.session ?? null, api.url ?? null)),
          run: (target) => {
            const w = walkerOf(api.channel.session ?? null, api.url ?? null);
            const ladder = ladderFor(target, api.scene(), w);
            if (!ladder || !w.climb(ladder)) api.notify("Couldn't climb there.");
          },
        },
      ],
    };
  },
};
