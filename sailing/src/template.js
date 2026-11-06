// The "Ship at sea" template: an empty scene's start screen offers it, and
// it lays out a sloop riding at anchor on open water (layout.js), with the
// doc set to start in play, so its maker lands aboard. Editing it is one
// switch away.

import { layOutShip } from "./layout.js";

export default {
  async create(ctx) {
    await layOutShip(ctx);
    ctx.notify?.("A sloop at anchor, wind from the north-east. Press Play (or Enter) to go aboard.", "info");
  },
};
