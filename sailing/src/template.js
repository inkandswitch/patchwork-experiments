// The "Ship at sea" template: an empty scene's start screen offers it, and
// it lays out a sloop under way on open water (layout.js), with the doc set
// to start in play, so its maker lands aboard. Editing it is one
// switch away.

import { layOutShip } from "./layout.js";

export default {
  async create(ctx) {
    await layOutShip(ctx);
    ctx.notify?.("A sloop on a reach, the wind from the north-east. Click the view (or press Enter) to come aboard.", "info");
  },
};
