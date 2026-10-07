// scene:source "file-glb" — a GLB file doc is already what the scene wants.
// It is a passthrough provider (index.js): objects added since SCENE-CONTRACT v3
// show the file directly and never build. This build() only serves objects
// added before that, which still have a render doc.
import { fileBytes } from "../file-content.js";
import { parseGLB } from "../glb.js";

export default {
  async build({ doc }) {
    const glb = fileBytes(doc);
    parseGLB(glb); // fail early, with a clear message, on something that isn't a GLB
    return { kind: "glb", glb };
  },
};
