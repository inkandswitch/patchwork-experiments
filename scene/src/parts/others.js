// scene.others: everyone else's selection boxes, each in their colour
// (STAGE.md, "The input chain"). A part of every doc (traits ["*"]: stage/activation.js), so
// it runs in every stage, as that doc's own part, whatever the focus: what
// someone selects on the boat shows from inside the game on her table, in
// the boat's frame (STAGE.md, "Views, stages and links", "Presence where it is"). It reads
// what scene.select tells each doc's channel (presence "selected"), draws in
// the doc's world layer (./boxes.js), and says nothing itself. A pin has no
// channel, so it draws none.
//
// This view's own selection is scene.select's box, drawn over any of these
// on the same object.

import { peerColor, peerSelections } from "./peers.js";
import { boxes } from "./boxes.js";

const REMOTE = [0.6, 0.4, 0.9];
/** whose presence says what is selected */
const SELECT = "scene.select";

function create(api) {
  const drawn = boxes(api, (objects, theme) =>
    peerSelections(api.channel.peers(), SELECT, objects)
      // (never this view's own: that one is scene.select's)
      .filter((p) => p.selected && p.session !== api.channel.session)
      .map((p) => ({ key: `peer:${p.session}`, id: p.selected, rgb: peerColor(theme.remote ?? REMOTE, p.viewer ?? p.session) })),
  );
  // others' selections come and go without a doc change
  api.channel.watch(() => api.schedule(drawn.refresh));
  drawn.refresh();
  return {
    update(scene, local, prev, view) {
      // (only the viewer's hover or pointer changed: nothing here; the same scene, local and view is content loaded)
      if (prev?.scene === scene && prev?.local === local && prev?.view !== view && prev?.view?.theme === view.theme) return;
      drawn.refresh();
    },
    dispose: drawn.dispose,
  };
}

export default { create };
