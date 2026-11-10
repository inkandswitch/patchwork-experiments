// The scene's own GLB files, for the parts (parts.js) and the templates
// (template.js): a piece drawn to a GLB as ctx.file's make() wants it. One
// module, so the two can't drift apart. The file for a key is the stage's
// ctx.file (the scene's one doc per key, doc.assets; scene/STAGE.md "Parts").

import { pieceGLB } from "../pieces.js";

/** Bounds rounded to 10 µm, as an importer's hint writes them. */
export const round = (b) => (b ? { min: b.min.map((v) => +v.toFixed(5)), max: b.max.map((v) => +v.toFixed(5)) } : null);

/** A piece's GLB, as ctx.file's make() wants it: its bytes, and the hint an importer would write. */
export function glbFile(piece) {
  const { glb, bounds } = pieceGLB(piece);
  const b = round(bounds);
  return {
    name: `${String(piece?.name || "piece").replace(/[\\/:]/g, "-")}.glb`,
    bytes: glb,
    extension: "glb",
    mimeType: "model/gltf-binary",
    ...(b ? { hint: { bounds: b } } : {}),
  };
}
