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

import { FIT, HATCH_SPEED, HATCH_TRAVEL, LIFT, STAND, TAGS, jibFit, partGLB, winchTrait } from "./ship.js";
import { ANCHOR, EXIT, FLOAT, HELM, HOOK, JIB, LADDER, MAINSHEET, SAIL, SEA, SHIP, SLIDE, WINCH } from "./traits.js";
import { frameMatrix, frameOf, placeIn } from "./body.js";
import { apply, eulerFromQuat, invert, matrixOf, mulQ, poseOfMatrix, quatFromEuler, rotateQ, headingOf } from "./frames.js";

/** The wind a new sea starts with: a working breeze from the north-east (speed m/s, from degrees). */
export const WIND = Object.freeze({ speed: 7, from: 45 });

/** A new sea: the trait a ship brings when the scene has none. */
export const newSea = ({ wind = WIND, seed = Math.floor(Math.random() * 1e9) } = {}) => ({ wind: { speed: wind.speed, from: wind.from }, seed, scale: 1 });

const sub = (a, b) => a.map((v, i) => v - b[i]);
const tidy = (v) => v.map((x) => Math.round(x * 1e9) / 1e9 + 0);

/**
 * What each part is made of: its pieces, the first the part itself, the
 * rest under it at `at` (in its frame), turned by `rotation` (Euler XYZ)
 * where given. Their traits are the ones the template sails with: the sail
 * up, the jib out and tending itself, the wheel amidships, the anchor up. A
 * piece with a `side` is one of a pair across her (the jib's winches): the
 * first on the side the part is put, the other its mirror across her
 * centreline (`across`, objectsFor). A piece's `tags` are the stand it
 * fits on the piece above it (the hatch's on the companionway).
 */
export const PIECES = Object.freeze({
  mast: [
    { kind: "mast", name: "Mast" },
    { kind: "rig", name: "Boom and sail", traits: { [SAIL]: { raised: 1, sheet: 0.5 } }, at: sub(FIT.rig.position, FIT.mast.position) },
    // the jib on her forestay, its origin the tack, its Y the luff (ship.js jibDrawing)
    { kind: "jib", name: "Jib", traits: { [JIB]: { sheet: 0.5, held: null, furl: 0 } }, at: sub(jibFit().position, FIT.mast.position), rotation: jibFit().rotation },
  ],
  wheel: [{ kind: "wheel", name: "Wheel", traits: { [HELM]: { angle: 0 } } }],
  windlass: [
    { kind: "windlass", name: "Windlass", traits: { [ANCHOR]: { down: false, rode: 0 } } },
    { kind: "anchor", name: "Anchor", traits: { [HOOK]: {} }, at: sub(FIT.anchor.position, FIT.windlass.position) },
  ],
  ladder: [{ kind: "ladder", name: "Ladder", traits: { [LADDER]: {} } }],
  // the sheet led to the cockpit: a station to stand at and trim (and hoist) the ship's sail from
  mainsheet: [{ kind: "mainsheet", name: "Mainsheet", traits: { [MAINSHEET]: {} } }],
  // the jib's sheets' winches, port and starboard, on her side decks by the cockpit
  winches: [
    { kind: "winch", name: "Port jib winch", side: -1 },
    { kind: "winch", name: "Starboard jib winch", side: 1, mirror: true },
  ],
  // the way below: the companionway, an exit (traversal's) that leads nowhere until a scene says
  // where, its verb "Go below"; and its hatch, sliding forward along the cabin top to open (joints')
  companionway: [
    { kind: "companionway", name: "Companionway", traits: { [EXIT]: { verb: "Go below" } } },
    { kind: "hatch", name: "Hatch", tags: [TAGS.hatch], traits: { [SLIDE]: { axis: [0, 0, -1], stops: { closed: 0, open: HATCH_TRAVEL }, speed: HATCH_SPEED, at: "closed" } }, at: sub(FIT.hatch.position, FIT.companionway.position) },
  ],
  redBuoy: [{ kind: "redBuoy", name: "Red buoy", traits: { [FLOAT]: {} } }],
  greenBuoy: [{ kind: "greenBuoy", name: "Green buoy", traits: { [FLOAT]: {} } }],
  islet: [{ kind: "islet", name: "Islet" }],
});

/** What goes aboard the sloop, each at the stand her hull has for it (ship.js STAND: her connectors). */
export const ABOARD = Object.freeze(["mast", "wheel", "windlass", "ladder", "mainsheet", "winches", "companionway"]);

// ─── files ──────────────────────────────────────────────────────────────────

/**
 * Each kind's drawing's version, where it isn't 1: the hull's 2 has a stand
 * for the mainsheet, its 3 one for the jib's winches; the rig's 2 carries
 * her rig contract (extras.rig: stock-rig.js); the mast's 2 has no jib
 * rolled on its forestay (the jib is its own piece). Then every face wound to look out and
 * no face lying on another's (shadows and depth fought there): the hull's 4,
 * the mast's 3, and 2 for the winch, windlass, mainsheet, wheel, anchor and
 * islet. The rig's 3 and the jib's 2 mark their cloth as taking no shadows
 * (a one-sided sheet: mesh extras receiveShadow false). The hull's 5 has no
 * companionway (it is a part of its own) and a stand for it.
 */
const VERSIONS = Object.freeze({ hull: 5, rig: 3, mast: 3, jib: 2, winch: 2, windlass: 2, mainsheet: 2, wheel: 2, anchor: 2, islet: 2 });

/** The key of a kind's GLB in the scene's files (doc.assets). Bump its version (VERSIONS) when its drawing changes. */
export const fileKey = (kind) => `sailing/${kind}@${VERSIONS[kind] ?? 1}`;

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

/** The scene's file doc for a kind (ctx.file, under its fileKey): { url, hint }. */
export function fileFor(ctx, kind) {
  return ctx.file(fileKey(kind), () => makeFile(kind));
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
 * @param {{ group?: string | null, locked?: boolean, settings?: { [traitKey]: object }, across?: number }} [o]
 *   settings: trait fields to set over the pieces' own (the sail lowered, the anchor down);
 *   across: where across her (her body's x) the part is put, for a pair's
 *   mirror piece (2·across the other way) and which side each is on
 */
export function objectsFor(part, place, files, newId, { group = null, locked = false, settings = null, across = FIT.winch.position[0] } = {}) {
  const [first, ...rest] = PIECES[part];
  const root = newId("o");
  const tags = TAGS[first.kind] ? [TAGS[first.kind]] : undefined;
  const traitsOf = (traits) => {
    if (!traits || !settings) return traits;
    const out = {};
    for (const [k, v] of Object.entries(traits)) out[k] = settings[k] ? { ...v, ...settings[k] } : v;
    return out;
  };
  // a pair across her: put to starboard, the first is the starboard one
  const flip = across > 0 ? -1 : 1;
  const sided = (p) => (p.side ? { name: p.side * flip < 0 ? "Port jib winch" : "Starboard jib winch", traits: { [WINCH]: winchTrait(p.side * flip) } } : { name: p.name, traits: p.traits });
  const top = sided(first);
  const out = [[root, partObject({ name: top.name, ...files[first.kind], transform: place.transform, parent: place.parent, group, locked, traits: traitsOf(top.traits), tags })]];
  for (const p of rest) {
    const at = p.mirror ? [tidy([-2 * across])[0], 0, 0] : p.at;
    const { name, traits } = sided(p);
    out.push([newId("o"), partObject({ name, ...files[p.kind], transform: { position: at, rotation: p.rotation ?? [0, 0, 0] }, parent: root, traits: traitsOf(traits), tags: p.tags })]);
  }
  return out;
}

/** Write objects into the doc, in order. */
export function writeObjects(d, objects) {
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
  const inBody = apply(invert(frameMatrix(frame)), apply(under, t.position));
  if (kind === "ladder" && inBody[0] < 0) q = mulQ(q, [0, 1, 0, 0]);
  return { parent, transform: standing(kind, t.position, q, t.scale ?? 1), body: inBody };
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
      const scene = ctx.scene();
      const ship = at?.parent ? shipAbove(scene, at.parent) : null;
      const place = placement(scene, at, name, ship ? (ctx.content?.(ship) ?? null) : null);
      // a pair across her (the winches) mirrors the first across her centreline
      const across = Array.isArray(place.body) && Math.abs(place.body[0]) > 0.05 ? place.body[0] : undefined;
      const objects = objectsFor(name, place, files, ctx.newId, { across });
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
 * @param {{ settings?: { [traitKey]: object } }} [o]  her stations' settings over the parts' own (at anchor: sail down, anchor down)
 */
export function sloopObjects({ position, yaw }, files, newId, ship = {}, { settings = null } = {}) {
  const hull = newId("o");
  const out = [[hull, partObject({ name: "Sloop", ...files.hull, transform: { position: [position[0], 0, position[2]], rotation: [0, yaw, 0] }, traits: { [SHIP]: ship } })]];
  const square = [0, 0, 0, 1];
  for (const p of ABOARD) out.push(...objectsFor(p, { parent: hull, transform: standing(PIECES[p][0].kind, STAND[p], square) }, files, newId, { settings, across: STAND[p][0] }));
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
    // where she was put, in the world (the stage's at.world: STAGE.md, api.part)
    const world = matrixOf(at.world);
    const objects = sloopObjects({ position: [world[12], 0, world[14]], yaw: headingOf(world) }, files, ctx.newId);
    ctx.change((d) => {
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
export const mainsheet = part("mainsheet");
export const winches = part("winches");
export const companionway = part("companionway");
export const redBuoy = part("redBuoy");
export const greenBuoy = part("greenBuoy");
export const islet = part("islet");
