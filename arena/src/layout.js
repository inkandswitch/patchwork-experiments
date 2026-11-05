// Putting blocks into a scene doc, for editing a level (edit.js) and for the
// "Arena level" template (template.js). Each kind of block is one GLB file
// doc, drawn once and named in the level trait so later blocks of that kind
// reuse it. Objects are written straight into the scene doc, as any importer
// does; the scene shows them like anything else.
//
// Everything here takes what it needs ({ repo, doc, change, newId }), which
// both an extension's api and a template's context have.

import { encodeGLB } from "./glb.js";
import { KINDS, sampleArena } from "./level.js";

export const LEVEL = "arena.level";
// The kinds' art changes now and then. Their GLBs are remembered in the level
// trait under "<kind>@<ART>", so a level drawn with older art gets this art's
// GLBs for what's added to it, not the old ones.
export const ART = 2;
export const kindKey = (kind) => `${kind}@${ART}`;

/** A kind's GLB bytes. */
export function kindGLB(kind) {
  const meshes = KINDS[kind].meshes();
  return encodeGLB({ generator: "patchwork arena", meshes: meshes.map((m) => ({ ...m, roughness: 0.75 })) });
}

/** An object for the scene doc: a passthrough GLB, filed in `group`. */
export function levelObject({ name, transform, traits }, url, group) {
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
    ...(traits ? { traits: JSON.parse(JSON.stringify(traits)) } : {}),
  };
}

/**
 * Each kind's GLB doc url, made the first time it's needed. `made` is what
 * was drawn just now, for writeLevelTrait to remember.
 */
export async function kindUrls({ repo, doc }, kinds) {
  const known = { ...(doc()?.traits?.[LEVEL]?.kinds ?? {}) };
  const urls = {};
  const made = {};
  for (const kind of kinds) {
    if (known[kindKey(kind)]) {
      urls[kind] = known[kindKey(kind)];
      continue;
    }
    const file = await repo.create2({
      "@patchwork": { type: "file" },
      name: `${KINDS[kind].name}.glb`,
      extension: "glb",
      mimeType: "model/gltf-binary",
      content: kindGLB(kind),
    });
    urls[kind] = made[kindKey(kind)] = file.url;
  }
  return { urls, made };
}

/** Remember the kinds just drawn in the level trait (inside a change), making the trait if it's new. */
export function writeLevelTrait(d, made) {
  if (!d.traits) d.traits = {};
  if (!d.traits[LEVEL]) d.traits[LEVEL] = { kinds: {} };
  if (!d.traits[LEVEL].kinds) d.traits[LEVEL].kinds = {};
  // someone else may have drawn one first: theirs wins, ours is an orphan
  for (const [k, url] of Object.entries(made)) if (!d.traits[LEVEL].kinds[k]) d.traits[LEVEL].kinds[k] = url;
}

/** The url for a kind once the trait is written: the level's own, else the one just made. */
const urlOf = (d, urls, kind) => d.traits[LEVEL].kinds[kindKey(kind)] ?? urls[kind];

/**
 * Lay out the sample arena in one change: a group of blocks, the level trait
 * with the arena's look, and the doc's starting activity set to play, so
 * whoever opens it (its maker too) is in the game, not the editor.
 */
export async function layOutArena(ctx) {
  const blocks = sampleArena();
  const { urls, made } = await kindUrls(ctx, [...new Set(blocks.map((b) => b.kind))]);
  const gid = ctx.newId("g");
  ctx.change((d) => {
    writeLevelTrait(d, made);
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
      d.objects[id] = levelObject(b, urlOf(d, urls, b.kind), gid);
      d.order.push(id);
    }
  });
  return gid;
}

/** Put one block of `kind` at `transform` (no group), returning its id. */
export async function addBlock(ctx, kind, { name, transform, traits }) {
  const { urls, made } = await kindUrls(ctx, [kind]);
  const id = ctx.newId("o");
  ctx.change((d) => {
    writeLevelTrait(d, made);
    if (!d.objects) d.objects = {};
    if (!d.order) d.order = [];
    d.objects[id] = levelObject({ name, transform, traits }, urlOf(d, urls, kind), null);
    d.order.push(id);
  });
  return id;
}
