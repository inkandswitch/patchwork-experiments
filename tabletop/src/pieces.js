// Each kind of piece is drawn once, as a GLB `file` doc the game keeps
// (`glbUrl`); every copy of that piece on every table shows the same doc, as a
// passthrough object in the scene. Editing a piece rewrites its GLB in place,
// so the tables already set up change with it.

import { encodeGLB } from "./glb.js";
import { meshesBounds, pieceMeshes } from "./shapes.js";

// bump when the way parts become geometry changes, so existing GLBs are redrawn
const GEOMETRY_VERSION = 1;

/** Everything a piece's GLB is made from, as one string. */
export function glbKey(piece) {
  return JSON.stringify({
    v: GEOMETRY_VERSION,
    parts: piece?.parts ?? [],
    snapPoints: piece?.snapPoints ?? null,
    snapRadius: piece?.snapRadius ?? null,
  });
}

/** A piece → { glb, bounds }. Snap points go in the scene's `extras.snapPoints` (see scene/README). */
export function pieceGLB(piece) {
  const meshes = pieceMeshes(piece?.parts);
  const extras = {};
  if (Array.isArray(piece?.snapPoints) && piece.snapPoints.length) extras.snapPoints = JSON.parse(JSON.stringify(piece.snapPoints));
  if (Number(piece?.snapRadius) > 0) extras.snapRadius = Number(piece.snapRadius);
  const glb = encodeGLB({
    generator: "patchwork tabletop",
    meshes: meshes.map((m) => ({ name: m.name, positions: m.positions, normals: m.normals, indices: m.indices, color: m.color, roughness: 0.6 })),
    ...(Object.keys(extras).length ? { extras } : {}),
  });
  return { glb, bounds: meshesBounds(meshes) };
}

const fileName = (piece) => `${String(piece?.name || "piece").replace(/[\\/:]/g, "-")}.glb`;

/**
 * Make sure every piece has a GLB drawn from its current parts: create the
 * file doc the first time, rewrite its content when the piece has changed.
 * Writes `glbUrl`, `glbKey` and `bounds` on the game. Returns how many it drew.
 */
export async function ensurePieceGLBs(repo, handle) {
  const pieces = handle.doc()?.pieces ?? {};
  let drawn = 0;
  for (const [kind, piece] of Object.entries(pieces)) {
    const key = glbKey(piece);
    if (piece.glbUrl && piece.glbKey === key) continue;
    const { glb, bounds } = pieceGLB(piece);
    let url = piece.glbUrl;
    if (url) {
      const file = await repo.find(url);
      file.change((f) => {
        f.content = glb;
        f.name = fileName(piece);
      });
    } else {
      const file = await repo.create2({
        "@patchwork": { type: "file" },
        name: fileName(piece),
        extension: "glb",
        mimeType: "model/gltf-binary",
        content: glb,
      });
      url = file.url;
    }
    handle.change((d) => {
      const p = d.pieces?.[kind];
      if (!p) return;
      // someone else drew it first: theirs wins, ours is an orphan
      if (!p.glbUrl) p.glbUrl = url;
      p.glbKey = key;
      p.bounds = bounds ? { min: bounds.min.map((v) => +v.toFixed(5)), max: bounds.max.map((v) => +v.toFixed(5)) } : null;
    });
    drawn++;
  }
  return drawn;
}
