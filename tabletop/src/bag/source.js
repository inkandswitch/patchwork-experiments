// The "bag-sack" scene:source: a bag doc drawn as a sack (sack.js) at real
// size. It reads only the bag's look, so putting things in and drawing them
// never rebuilds it.

import { lookOf } from "./datatype.js";
import { roundBounds, sackGLB } from "./sack.js";

export default {
  async build({ doc }) {
    const { glb, bounds } = sackGLB(lookOf(doc));
    return { kind: "glb", glb, meta: { bounds: roundBounds(bounds) } };
  },
  // what build() reads, and nothing else
  fingerprint(doc) {
    const l = lookOf(doc);
    return `sack@1:${l.color}:${l.size}`;
  },
};
