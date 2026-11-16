// The "Arena level" template: an empty scene's start screen offers it, and
// it lays out the sample arena (layout.js), the doc starting people walking
// at a spawn point, so its maker lands in the game. Editing it is selecting
// something (the menu, or the outline); nothing to switch.

import { layOutArena } from "./layout.js";

export default {
  async create(ctx) {
    await layOutArena(ctx);
    ctx.notify?.("Arena laid out. Pick up the gun on the bar (or press Enter) to play.", "info");
  },
};
