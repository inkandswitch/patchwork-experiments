// The doom package's scene extension: no traits, so it never runs. It is
// here for its drop (STAGE.md, "Drops"): a .wad file doc dropped into a scene
// is laid out as its first map (layout.js). Anything else dropped is left to
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
