// The doom package's scene extension. It is here for its drop (STAGE.md,
// "Drops"): a .wad file doc dropped into a scene is laid out as its first map
// (layout.js), whose static part carries the marker trait `doom.map`; where a
// map is, it runs, and does nothing more. Anything else dropped is left to
// whoever takes it.

import { isWad, layOutMap } from "./layout.js";

export default {
  create() {
    return {};
  },
  async drop(ctx, info) {
    if (!isWad(info?.doc)) return false;
    try {
      await layOutMap(ctx, info);
    } catch (err) {
      ctx.notify?.(`Couldn't lay out that WAD: ${err?.message ?? err}`, "error");
    }
    return true;
  },
};
