// The "Ship at sea" and "Ship at anchor" templates: an empty scene's start
// screen offers them, and each lays out a sloop (layout.js), the doc starting
// people off her quarter, where a click on her comes aboard. At sea she's under way
// on a reach; at anchor she lies head to wind off the islet in a moderate
// breeze, her sail down and her anchor down, somewhere to set things up
// aboard (a card table in her cockpit) and still get under way from. She
// sails on while anyone edits her; pausing the clock is what stops her.

import { ANCHORAGE_AIR, layOutShip } from "./layout.js";

export default {
  async create(ctx) {
    await layOutShip(ctx);
    ctx.notify?.("A sloop on a reach, the wind from the north-east. Click her (or press Enter) to come aboard.", "info");
  },
};

export const atAnchor = {
  async create(ctx) {
    await layOutShip(ctx, { anchored: true, wind: ANCHORAGE_AIR });
    ctx.notify?.("A sloop at anchor off the islet, in a moderate breeze. Click her (or press Enter) to come aboard; raise the sail (take the helm or the mainsheet in the cockpit with F, then hold R; or hold R at the mast) and weigh the anchor at the windlass (hold F) to get under way.", "info");
  },
};
