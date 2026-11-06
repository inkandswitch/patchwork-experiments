// Sailing's parts (scene:part, STAGE.md "Parts"): the sloop whole, and each
// thing aboard her on its own, for the editor's parts bin, so any hull can
// be rigged by dragging them onto it, and buoys and an islet to sail past.
// The "Ship at sea" template lays her out with the same code (layout.js):
// there is one way to put a sloop in a scene.
//
// Each part is one or more pieces of ship.js's, each its own object showing
// the scene's one GLB doc for that kind (ctx.file: ten buoys share one
// file). The first piece is the part (it's what's selected); the rest hang
// under it, in its frame: the boom-and-sail under the mast, so moving the
// mast moves the sail, and the anchor under the windlass.
//
// Put on a ship (a hull with `sailing.ship`, or anything aboard her), a
// part squares itself to her body frame (body.js): its bow is her bow
// however her hull was modelled, it stands where it was put, and its origin
// is its own height above that (the wheel's axle). A ladder on her port
// side turns to hang outboard. Put anywhere else, it stands as the bin put
// it. A part isn't locked: it's placed by hand, so the gizmo may move it.
// A part that fits a stand carries its tag (ship.js TAGS), as the bin's
// metadata does, so the hand snaps it to the same stand the bin does.

import { FIT, LIFT, STAND, TAGS, partGLB } from "./ship.js";
import { ANCHOR, FLOAT, HELM, HOOK, LADDER, SAIL, SEA, SHIP } from "./traits.js";
import { frameMatrix, frameOf, placeIn } from "./body.js";
import { apply, eulerFromQuat, invert, matrixOf, multiply, mulQ, poseOfMatrix, quatFromEuler, rotateQ, headingOf } from "./frames.js";

/** The wind a new sea starts with: a working breeze from the north-east (speed m/s, from degrees). */
export const WIND = Object.freeze({ speed: 7, from: 45 });

/** A new sea: the trait a ship brings when the scene has none. */
export const newSea = ({ wind = WIND, seed = Math.floor(Math.random() * 1e9) } = {}) => ({ wind: { speed: wind.speed, from: wind.from }, seed, scale: 1 });

const sub = (a, b) => a.map((v, i) => v - b[i]);
const tidy = (v) => v.map((x) => Math.round(x * 1e9) / 1e9 + 0);

/**
 * What each part is made of: its pieces, the first the part itself, the
 * rest under it at `at` (in its frame). Their traits are the ones the
 * template sails with: the sail up, the wheel amidships, the anchor up.
 */
export const PIECES = Object.freeze({
  mast: [
    { kind: "mast", name: "Mast" },
    { kind: "rig", name: "Boom and sail", traits: { [SAIL]: { raised: 1, sheet: 0.5 } }, at: sub(FIT.rig.position, FIT.mast.position) },
  ],
  wheel: [{ kind: "wheel", name: "Wheel", traits: { [HELM]: { angle: 0 } } }],
  windlass: [
    { kind: "windlass", name: "Windlass", traits: { [ANCHOR]: { down: false, rode: 0 } } },
    { kind: "anchor", name: "Anchor", traits: { [HOOK]: {} }, at: sub(FIT.anchor.position, FIT.windlass.position) },
  ],
  ladder: [{ kind: "ladder", name: "Ladder", traits: { [LADDER]: {} } }],
  redBuoy: [{ kind: "redBuoy", name: "Red buoy", traits: { [FLOAT]: {} } }],
  greenBuoy: [{ kind: "greenBuoy", name: "Green buoy", traits: { [FLOAT]: {} } }],
  islet: [{ kind: "islet", name: "Islet" }],
});

/** What goes aboard the sloop, each at the stand her hull has for it (ship.js STAND: her connectors). */
export const ABOARD = Object.freeze(["mast", "wheel", "windlass", "ladder"]);

// ─── files ──────────────────────────────────────────────────────────────────

/** The key of a kind's GLB in the scene's files (doc.assets). Bump its version when its drawing changes. */
export const fileKey = (kind) => `sailing/${kind}@1`;

/** A kind's GLB, as ctx.file makes it: its bytes, and the hint an importer would write. */
export function makeFile(kind) {
  const { name, bytes, bounds, triangles } = partGLB(kind);
  return {
    name: `${name}.glb`,
    bytes,
    extension: "glb",
    mimeType: "model/gltf-binary",
    hint: { bounds: { min: [...bounds.min], max: [...bounds.max] }, triangles, bytes: bytes.byteLength },
  };
}

/**
 * The scene's file doc for a kind: { url, hint }. A stage older than parts
 * has no ctx.file: then a doc of its own each time, as the template made
 * them before.
 */
export async function fileFor(ctx, kind) {
  if (typeof ctx.file === "function") return ctx.file(fileKey(kind), () => makeFile(kind));
  const f = makeFile(kind);
  const doc = await ctx.repo.create2({ "@patchwork": { type: "file" }, name: f.name, extension: f.extension, mimeType: f.mimeType, content: f.bytes });
  return { url: doc.url, hint: f.hint };
}

/** Every kind a list of parts is made of, filed once each. */
async function filesFor(ctx, parts) {
  const kinds = new Set(parts.flatMap((p) => PIECES[p].map((piece) => piece.kind)));
  const files = {};
  for (const kind of kinds) files[kind] = await fileFor(ctx, kind);
  return files;
}

// ─── objects ────────────────────────────────────────────────────────────────

/** An object for the scene doc: a passthrough GLB. */
export function partObject({ name, url, transform, parent = null, group = null, traits, tags, locked = false, hint }) {
  return {
    name,
    sourceUrl: url,
    providerId: "file-glb",
    renderUrl: null,
    parent,
    group,
    visible: true,
    color: null,
    opacity: 1,
    wireframe: false,
    locked,
    transform: { position: [...transform.position], rotation: [...transform.rotation], scale: transform.scale ?? 1 },
    ...(hint ? { hint: JSON.parse(JSON.stringify(hint)) } : {}),
    ...(traits ? { traits: JSON.parse(JSON.stringify(traits)) } : {}),
    ...(tags ? { tags: [...tags] } : {}),
  };
}

/**
 * A part's objects, the part first: [id, object] pairs to write.
 * @param {string} part  a PIECES key
 * @param {{ parent: string | null, transform }} place  where the part goes
 * @param {{ [kind]: { url, hint } }} files
 * @param {(prefix: string) => string} newId
 * @param {{ group?: string | null, locked?: boolean }} [o]
 */
export function objectsFor(part, place, files, newId, { group = null, locked = false } = {}) {
  const [first, ...rest] = PIECES[part];
  const root = newId("o");
  const tags = TAGS[first.kind] ? [TAGS[first.kind]] : undefined;
  const out = [[root, partObject({ name: first.name, ...files[first.kind], transform: place.transform, parent: place.parent, group, locked, traits: first.traits, tags })]];
  for (const p of rest) {
    out.push([newId("o"), partObject({ name: p.name, ...files[p.kind], transform: { position: p.at, rotation: [0, 0, 0] }, parent: root, traits: p.traits })]);
  }
  return out;
}

/** Write objects into the doc, in order. */
export function writeObjects(d, objects) {
  if (!d.objects) d.objects = {};
  if (!d.order) d.order = [];
  for (const [id, o] of objects) {
    d.objects[id] = o;
    d.order.push(id);
  }
}

// ─── where a part goes ──────────────────────────────────────────────────────

/** A part standing with its foot at `foot`, turned by `q`, in some frame: its origin is its own height above (LIFT). */
export function standing(kind, foot, q, scale = 1) {
  const up = rotateQ(q, [0, (LIFT[kind] ?? 0) * scale, 0]);
  return { position: tidy(foot.map((v, i) => v + up[i])), rotation: tidy(eulerFromQuat(q)), scale };
}

/** The ship `id` is aboard (itself, or the nearest above it with the ship trait) in a snapshot or doc, or null. */
function shipAbove(scene, id) {
  const up = (at) => (scene?.parents?.get ? (scene.parents.get(at) ?? null) : (scene?.objects?.[at]?.parent ?? null));
  for (let at = id, n = 0; at != null && n < 64; at = up(at), n++) if (scene?.objects?.[at]?.traits?.[SHIP]) return at;
  return null;
}

/**
 * Where a part goes, from where the bin put it. On a ship (the parent, or
 * something aboard her), squared to her body frame at the spot it was put,
 * lifted to its height; a ladder on her port side turned to hang outboard.
 * Anywhere else, as put.
 * @param {{ objects, parents? }} scene
 * @param {{ parent: string | null, transform }} at
 * @param {string} part  a PIECES key
 * @param {{ extras, box } | null} [content]  the ship's, when the stage can say (her frame, if her trait doesn't)
 */
export function placement(scene, at, part, content = null) {
  const parent = at?.parent ?? null;
  const t = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, ...at?.transform };
  const ship = parent ? shipAbove(scene, parent) : null;
  if (!ship) return { parent, transform: t };
  const frame = frameOf(scene.objects[ship].traits[SHIP], content);
  const under = placeIn(scene, parent, ship); // the parent in the hull's frame
  // her body's rotation, seen from the parent: the hull's frame undone, then hers
  let q = mulQ(poseOfMatrix(invert(under)).quaternion, quatFromEuler(frame.rotation));
  const kind = PIECES[part][0].kind;
  if (kind === "ladder") {
    const inBody = apply(invert(frameMatrix(frame)), apply(under, t.position));
    if (inBody[0] < 0) q = mulQ(q, [0, 1, 0, 0]);
  }
  return { parent, transform: standing(kind, t.position, q, t.scale ?? 1) };
}

/**
 * A part for the bin: create(ctx, at) puts it where `at` says (squared to a
 * ship it's put on) and returns its id. Its files are made first; if what it
 * was put on went meanwhile (a peer deleted it), it puts nothing.
 */
export function part(name) {
  return {
    async create(ctx, at) {
      const files = await filesFor(ctx, [name]);
      const scene = ctx.scene?.() ?? ctx.doc?.() ?? {};
      const ship = at?.parent ? shipAbove(scene, at.parent) : null;
      const place = placement(scene, at, name, ship ? (ctx.content?.(ship) ?? null) : null);
      const objects = objectsFor(name, place, files, ctx.newId);
      let put = false;
      ctx.change((d) => {
        if (place.parent && !d.objects?.[place.parent]) return;
        // filed in its parent's group, as addObject files what it attaches
        if (place.parent) objects[0][1].group = d.objects[place.parent].group ?? null;
        writeObjects(d, objects);
        put = true;
      });
      if (!put) ctx.notify?.("What that was put on has gone.");
      return put ? objects[0][0] : null;
    },
  };
}

// ─── the sloop ──────────────────────────────────────────────────────────────

/**
 * The sloop's objects: her hull, a ship by its trait (her spec read from her
 * GLB), and every part aboard at the stand her hull has for it (her own
 * frame is her body's).
 * @param {{ position: number[], yaw: number }} where  world: her waterline under `position`, her bow turned by `yaw`
 * @param {object} files  every kind she's made of, filed
 * @param {(prefix: string) => string} newId
 * @param {object} [ship]  her sailing.ship trait ({} at rest; the template gives her way)
 */
export function sloopObjects({ position, yaw }, files, newId, ship = {}) {
  const hull = newId("o");
  const out = [[hull, partObject({ name: "Sloop", ...files.hull, transform: { position: [position[0], 0, position[2]], rotation: [0, yaw, 0] }, traits: { [SHIP]: ship } })]];
  const square = [0, 0, 0, 1];
  for (const p of ABOARD) out.push(...objectsFor(p, { parent: hull, transform: standing(PIECES[p][0].kind, STAND[p], square) }, files, newId));
  return out;
}

/** Every kind the sloop is made of, filed: the hull and what goes aboard. */
export async function sloopFiles(ctx) {
  return { hull: await fileFor(ctx, "hull"), ...(await filesFor(ctx, ABOARD)) };
}

/**
 * The sloop as a part: on the water where she's put (at the scene's root,
 * where a ship sails), her bow the way the bin faced her, at rest with her
 * sail up. A ship brings her sea: a scene without one gets one.
 */
export const sloop = {
  async create(ctx, at) {
    const files = await sloopFiles(ctx);
    // where she was put, in the world (a stage older than `at.world`: through her parent as the doc has it)
    const scene = ctx.scene?.() ?? ctx.doc?.() ?? {};
    const world = at?.world ? matrixOf(at.world) : multiply(placeIn(scene, at?.parent ?? null, null) ?? matrixOf(null), matrixOf(at?.transform));
    const objects = sloopObjects({ position: [world[12], 0, world[14]], yaw: headingOf(world) }, files, ctx.newId);
    ctx.change((d) => {
      if (!d.traits) d.traits = {};
      if (!d.traits[SEA]) d.traits[SEA] = newSea();
      writeObjects(d, objects);
    });
    return objects[0][0];
  },
};

export const mast = part("mast");
export const wheel = part("wheel");
export const windlass = part("windlass");
export const ladder = part("ladder");
export const redBuoy = part("redBuoy");
export const greenBuoy = part("greenBuoy");
export const islet = part("islet");
