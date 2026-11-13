// The sea while editing (DESIGN.md, edit.js): the same water and sky as in
// play (sea-view.js draws both), at the doc's world time (api.clock.t), so
// the hull someone sails meanwhile rides the waves you see. Editing brings
// no process: alone in edit, nobody computes the clock, and the sea stands
// still until someone plays (scene TOOLS.md §7; editing stops freezing the
// world when activities go). Ships stay where the doc (or the sailor's
// pose) puts them.

import { drawSea } from "./sea-view.js";

export default {
  create(api) {
    const sea = drawSea(api);
    const off = api.loop(() => sea.draw(api.clock.t()));
    return {
      update: (scene) => sea.update(scene),
      atmosphere: sea.atmosphere,
      dispose() {
        off?.();
        sea.dispose();
      },
    };
  },
};
