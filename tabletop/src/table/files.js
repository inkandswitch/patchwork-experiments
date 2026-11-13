// The scene's own GLB files, for the parts (parts.js) and the templates
// (template.js): a piece drawn to a GLB as ctx.file's make() wants it. One
// module, so the two can't drift apart. The file for a key is the stage's
// ctx.file (the scene's one doc per key, doc.assets; scene/STAGE.md "Parts").

import { drawer, glbName, lookKey, shortHash } from "../look/look.js";

/** The scene's assets key for a piece's GLB: one per look, whatever game or part it's from ("tabletop/look@…"). */
export const lookFileKey = (piece) => `tabletop/look@${shortHash(lookKey(piece))}`;

/**
 * A piece's GLB, as ctx.file's make() wants it: its bytes, and the hint an
 * importer would write. `io` is look.js's drawer's (how files are read,
 * images decoded, documents drawn); plain parts need none of it.
 */
export async function glbFile(piece, io = {}) {
  const d = drawer(io);
  try {
    const { glb, bounds } = await d.draw(piece);
    return { name: glbName(piece), bytes: glb, extension: "glb", mimeType: "model/gltf-binary", ...(bounds ? { hint: { bounds } } : {}) };
  } finally {
    d.close();
  }
}
