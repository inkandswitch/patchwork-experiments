// scene:source "machine": a machine doc → its cabinet (cabinet.js), the
// screen's place said in the GLB's extras. Only the kind of machine shapes
// it: the game it runs, its title and its sessions build nothing.

import { cabinetGLB } from "./cabinet.js";

export default {
  async build({ doc }) {
    const { glb, bounds } = cabinetGLB(doc?.kind ?? null);
    return { kind: "glb", glb, meta: { bounds } };
  },
  fingerprint: (doc) => String(doc?.kind ?? ""),
};
