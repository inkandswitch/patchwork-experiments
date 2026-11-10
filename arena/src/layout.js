// Putting blocks into a scene doc, for the "Arena level" template
// (template.js) and the arena's parts (parts.js). Each kind of block is one
// GLB file doc, drawn once per scene: the stage's drop context keeps it
// (ctx.file, under the scene's assets), so later blocks of that kind, from the
// template or the bin, reuse it. Objects are written straight into the scene
// doc, as any importer does; the scene shows them like anything else.
//
// Everything here takes a drop context ({ doc, change, newId, file }), which
// a template and a part both get.

import { encodeGLB } from "./glb.js";
import { KINDS, sampleArena } from "./level.js";

export const LEVEL = "arena.level";
// The kinds' art changes now and then. A kind's GLB is kept under
// "arena/<kind>@<ART>", so a level drawn with older art gets this art's GLBs
// for what's added to it, not the old ones.
export const ART = 2;
export const kindKey = (kind) => `arena/${kind}@${ART}`;

/** A kind's GLB bytes. */
export function kindGLB(kind) {
  const meshes = KINDS[kind].meshes();
  return encodeGLB({ generator: "patchwork arena", meshes: meshes.map((m) => ({ ...m, roughness: 0.75 })) });
}

/** A kind's box in its own frame, for the scene's hint (a placeholder, and load order, until the GLB is in). */
export function kindBounds(kind) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of KINDS[kind].meshes()) {
    for (let i = 0; i < positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], positions[i]);
      max[i % 3] = Math.max(max[i % 3], positions[i]);
    }
  }
  return { min, max };
}

/** A kind's GLB doc ({ url, hint }): the scene's own, drawn the first time it's needed. */
export function kindFile(ctx, kind) {
  return ctx.file(kindKey(kind), () => ({
    name: `${KINDS[kind].name}.glb`,
    bytes: kindGLB(kind),
    extension: "glb",
    mimeType: "model/gltf-binary",
    hint: { bounds: kindBounds(kind) },
  }));
}

/**
 * Make the scene a level (inside a change), if it isn't one. The trait holds
 * only the level's settings (its look); a bare one is a level with the
 * scene's own look.
 */
export function makeLevel(d) {
  if (!d.traits) d.traits = {};
  if (!d.traits[LEVEL]) d.traits[LEVEL] = {};
}

/** An object for the scene doc: a passthrough GLB, filed in `group`. Laid-out blocks are locked. */
export function levelObject({ name, transform, traits }, { url, hint }, group) {
  return {
    name,
    sourceUrl: url,
    providerId: "file-glb",
    renderUrl: null,
    parent: null,
    group,
    visible: true,
    color: null,
    opacity: 1,
    wireframe: false,
    locked: true,
    transform: { position: [...transform.position], rotation: [...transform.rotation], scale: transform.scale ?? 1 },
    ...(hint ? { hint: JSON.parse(JSON.stringify(hint)) } : {}),
    ...(traits ? { traits: JSON.parse(JSON.stringify(traits)) } : {}),
  };
}

/**
 * Lay out the sample arena in one change: a group of blocks, the level trait
 * with the arena's look, and the doc's starting activity set to play, so
 * whoever opens it (its maker too) is in the game, not the editor.
 */
export async function layOutArena(ctx) {
  const blocks = sampleArena();
  const files = {};
  for (const kind of new Set(blocks.map((b) => b.kind))) files[kind] = await kindFile(ctx, kind);
  const gid = ctx.newId("g");
  ctx.change((d) => {
    makeLevel(d);
    if (!d.objects) d.objects = {};
    if (!d.order) d.order = [];
    if (!d.view) d.view = {};
    d.objects[gid] = { kind: "group", name: "Arena", group: null, visible: true, opacity: 1 };
    d.order.push(gid);
    // a laid-out level has the arena's look (sky, haze, sun: play.js); a
    // scene that only had a target added keeps its own
    d.traits[LEVEL].look = "arena";
    d.view.activity = "play";
    for (const b of blocks) {
      const id = ctx.newId("o");
      d.objects[id] = levelObject(b, files[b.kind], gid);
      d.order.push(id);
    }
  });
  return gid;
}
