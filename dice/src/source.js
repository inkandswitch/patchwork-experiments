// scene:source "die": a die doc → its GLB, at real size (die-glb.js). The
// scene builds it whenever the die changes and shows the result; the GLB's
// `extras.dice` is what the dice extension rolls and reads (roll.js).

import { dieKey } from "./die.js";
import { dieGLB } from "./die-glb.js";

export default {
  async build({ doc }) {
    const { glb, bounds } = dieGLB(doc);
    return { kind: "glb", glb, meta: { bounds } };
  },
  // only what the die is made from: a roll in its panel, or a new title, builds nothing
  fingerprint: (doc) => dieKey(doc),
};
