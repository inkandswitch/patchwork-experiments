// Each kind of piece is drawn once, as a GLB `file` doc the game keeps
// (`glbUrl`); every copy of that piece on every table shows the same doc, as a
// passthrough object in the scene. Editing a piece rewrites its GLB in place,
// so the tables already set up change with it.

import { encodeGLB } from "./glb.js";
import { meshesBounds, pieceMeshes } from "./shapes.js";

// bump when the way parts become geometry changes, so existing GLBs are redrawn
// 2: snap points written as the scene's connectors
const GEOMETRY_VERSION = 2;

/** Everything a piece's GLB is made from, as one string. */
export function glbKey(piece) {
  return JSON.stringify({
    v: GEOMETRY_VERSION,
    parts: piece?.parts ?? [],
    snapPoints: piece?.snapPoints ?? null,
    snapRadius: piece?.snapRadius ?? null,
  });
}

/**
 * A piece's snap points ([x, y, z] or { position, yaw?, rotation?, tags? }) as the
 * scene's connectors: { position, rotation?, tags? }. A connector with tags
 * takes only objects with one of them (the hand's rule): a card slot is
 * tagged "card", and so is every card.
 */
export function connectorsOf(points) {
  return (points ?? []).map((p) => {
    const position = [...(Array.isArray(p) ? p : p?.position ?? [0, 0, 0])].map(Number);
    const rotation = fullRotation(p);
    const yaw = Array.isArray(p) ? null : p?.yaw;
    const tags = Array.isArray(p) ? [] : (Array.isArray(p?.tags) ? p.tags : []).filter((t) => typeof t === "string" && t);
    return { position, ...(rotation ? { rotation } : yaw == null ? {} : { rotation: [0, Number(yaw), 0] }), ...(tags.length ? { tags: [...tags] } : {}) };
  });
}

/** A snap point's whole frame, if it gives one (`rotation`, Euler XYZ radians): a place a tile stands on edge in. */
const fullRotation = (p) => (!Array.isArray(p) && Array.isArray(p?.rotation) && p.rotation.length === 3 && p.rotation.every((v) => Number.isFinite(Number(v))) ? p.rotation.map(Number) : null);

/**
 * The GLB extras key this package writes a piece's places under in full,
 * frame and all, when any has a whole `rotation`. The scene keeps only a
 * connector's yaw when it reads them (content(id).extras.connectors), which
 * is all its hand needs to snap; Draw, which puts a tile into a place
 * standing on edge, needs the rest (table/slots.js reads it back).
 */
export const SLOTS_EXTRAS = "tabletop.slots";

/** A piece → { glb, bounds }. Snap points go in as the scene's `extras.connectors` (see scene/README). */
export function pieceGLB(piece) {
  const meshes = pieceMeshes(piece?.parts);
  const extras = {};
  if (Array.isArray(piece?.snapPoints) && piece.snapPoints.length) {
    extras.connectors = connectorsOf(piece.snapPoints);
    if (piece.snapPoints.some(fullRotation)) extras[SLOTS_EXTRAS] = connectorsOf(piece.snapPoints);
  }
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
