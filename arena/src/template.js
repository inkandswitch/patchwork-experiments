// The "Arena level" template: an empty scene's start screen offers it, and
// it lays out the sample arena (layout.js) with the doc set to start in play,
// so its maker lands in the game. Editing it is one switch away.

import { layOutArena } from "./layout.js";

export default {
  async create(ctx) {
    await layOutArena(ctx);
    ctx.notify?.("Arena laid out. Press Play (or Enter) to walk it.", "info");
  },
};
