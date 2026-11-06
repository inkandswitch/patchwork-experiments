// The scene's own GLB files, for the parts (parts.js) and the templates
// (template.js): a piece drawn to a GLB as ctx.file's make() wants it, and
// the file for a key. One module, so the two can't drift apart.

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

/**
 * The scene's file for `key`: { url, hint }. Through ctx.file (the scene's
 * one doc per key, doc.assets); on a stage without it, a file doc of its
 * own. (Only templates can meet such a stage: they predate ctx.file, while
 * parts came with it, scene 259ae893.)
 */
export async function fileFor(ctx, key, make) {
  if (typeof ctx.file === "function") return ctx.file(key, make);
  const f = make();
  const doc = await ctx.repo.create2({ "@patchwork": { type: "file" }, name: f.name, extension: f.extension, mimeType: f.mimeType, content: f.bytes });
  return { url: doc.url, hint: f.hint ?? null };
}
