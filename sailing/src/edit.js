// The sea while editing (DESIGN.md, edit.js): the same water and sky as in
// play (sea-view.js draws both). When someone is sailing her while you
// edit, its clock is the one the play extension publishes, followed as in
// play, so the hull you see them sail rides the waves you see; else a clock
// of this view's own. Ships stay where the doc (or the sailor's pose) puts
// them.

import { drawSea, seaClock } from "./sea-view.js";
import { SIM } from "./traits.js";

export default {
  create(api) {
    const sea = drawSea(api);
    const clock = seaClock(api);
    const off = api.loop((dt, now) => {
      const c = api.claimedBy(null, SIM);
      sea.draw(clock.tick(dt, now, c && !c.mine ? c.session : null));
    });
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
