// Standing knocked-over targets back up: the arena extension's "Stand
// targets up", wherever a target is down. It is a world command: a button on
// the stage's bar of tools in every body (scene/STAGE.md, "The interface"), and in the
// menu. Putting a target, crate or spawn point is the parts bin's
// (parts.js); a whole level comes from the "Arena level" template, and a
// level trait on its own from the inspector's "Add behaviour…" (index.js
// describes them).

import { anyDown, standTargetsUp } from "./level.js";

/** The command, on an extension's api (its change). */
export function resetCommand(api) {
  return {
    id: "reset",
    name: "Stand targets up",
    show: ["world", "menu"],
    state: (target, { scene }) => (anyDown(scene?.objects) ? { title: "Stand every knocked-over target back up" } : null),
    run: () => api.change((d) => standTargetsUp(d)),
  };
}
