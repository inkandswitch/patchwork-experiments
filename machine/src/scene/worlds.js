// A machine's world (the trait WORLD): doom/'s whole map of a level, in
// which that machine's Doom is drawn. What decides, apart from what draws
// (present/spectator.js) and from the extension that wires the two
// (extension.js): whether a world draws or rests, what the command that lays
// one out says, where it goes and which WAD file doc it is drawn from.

import { doomWorld } from "../present/doom-world.js";
import { QUERY, level as decodeLevel } from "../doom.js";
import { doomWads } from "../patchwork/load.js";

/**
 * The trait of a map that shows a machine's game: `{ machine, source }`, the
 * object id of the cabinet whose Doom is drawn in it and the machine doc it
 * was laid out for (the cabinet's `sourceUrl` then). The map is doom/'s
 * whole map (its scene:source, by id, with `whole: true`), of that game's
 * IWAD.
 */
export const WORLD = "machine.world";
/** doom/'s scene:source, which builds a Doom map's parts from a WAD file doc (met by id, never imported). */
export const MAP_SOURCE = "doom-map";
/** How big a world is laid out (m, its longer side across): a model of the level beside the cabinet, to walk around. */
export const WORLD_SIZE = 3;
/** How far right of the cabinet's middle a world's near edge is laid out (m, for a cabinet at scale 1). */
export const GAP = 0.6;

/**
 * Is plugin `id` registered under `type` now? A function read when asked,
 * on the live registry (`api.registry(type)`, found once): a package
 * installed or removed later is seen, as the stage sees it (scene/STAGE.md:
 * registry changes don't restart the extensions already running).
 */
export function registered(registry, type, id) {
  let reg = null;
  Promise.resolve(registry?.(type)).then(
    (r) => void (reg = r),
    () => {},
  );
  return () => !!reg?.filter?.((p) => p?.id === id)?.length;
}

/**
 * The state of "Lay out its world" for machine entry `e` (or none):
 * null (not offered: no machine, or not a Doom), disabled with why, or
 * enabled. `mapSource`: is doom/'s map source here now.
 */
export function worldCommand(e, mapSource) {
  if (!e || e.kind !== "doom") return null;
  if (!e.m) return { disabled: true, title: e.note ?? "Starting…" };
  if (!mapSource) return { disabled: true, title: "Needs the doom package, which builds Doom's maps" };
  if (doomWads(e.content).length !== 1) return { disabled: true, title: "Its game loads more than its IWAD, and doom/ builds a map from one WAD" };
  return { title: "A model of the level beside it, its monsters, players and doors moving as the game has them" };
}

/** doom/'s map from the machine's own WADs, in the frame the map part states (its extras.doom). */
const fromWads = (e, frame) => doomWorld(doomWads(e.content), frame.map, { anchor: frame.anchor, unitsPerMetre: frame.unitsPerMetre });

/**
 * The engine's world at its tick, read for world `w` (its trait `trait`, its
 * built content `c`), or null: the world rests (drawn as built). It draws
 * only when its machine (entry `e`) runs a Doom here, of the source the world
 * was laid out for, the map is built and says where its frame is, those WADs
 * have the map, and the game is on it. `w` keeps the map's doomWorld, made
 * again for another machine entry (another session, or another view of the
 * game) or another frame.
 */
export function stateOf(w, trait, e, c, make = fromWads) {
  if (!e?.m || e.kind !== "doom" || trait?.source !== e.url) return null;
  const frame = c?.loaded ? c.extras?.doom : null;
  if (!frame) return null;
  const key = `${frame.map}:${frame.anchor}:${frame.unitsPerMetre}`;
  if (w.e !== e || w.key !== key) {
    w.e = e;
    w.key = key;
    try {
      w.world = make(e, frame);
    } catch {
      w.world = null; // a map these WADs don't have: nothing of this game is on it
    }
  }
  if (!w.world) return null;
  const host = e.m.host;
  const lvl = host.query(QUERY.level);
  if (!lvl || !w.world.playing(decodeLevel(lvl))) return null;
  const things = host.query(QUERY.things);
  const sectors = host.query(QUERY.sectors);
  return things && sectors ? w.world.read({ things, sectors }) : null;
}

/**
 * Where a world of extent `extent` (doomWorld's: metres, in the map part's
 * frame) is laid out beside a cabinet whose displayed world matrix is `at`:
 * turned as the cabinet is, WORLD_SIZE across its longer side (never
 * enlarged), its near edge GAP to the cabinet's right (GAP grows with the
 * cabinet's scale, the map's own size doesn't), its middle level with the
 * cabinet's front and back, and its lowest floor at the cabinet's feet.
 * @returns {{ position: number[], rotation: number[], scale: number }}
 */
export function besideCabinet(THREE, at, { min, max }) {
  const position = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3();
  new THREE.Matrix4().fromArray(at).decompose(position, turn, size);
  const scale = Math.min(1, WORLD_SIZE / Math.max(max[0] - min[0], max[2] - min[2]));
  const offset = new THREE.Vector3(GAP * size.x - min[0] * scale, -min[1] * scale, (-(min[2] + max[2]) / 2) * scale);
  const e = new THREE.Euler().setFromQuaternion(turn);
  return { position: position.add(offset.applyQuaternion(turn)).toArray(), rotation: [e.x, e.y, e.z], scale };
}

/**
 * The URL of the WAD file doc a world of machine entry `e` is drawn from: one
 * a world laid out for the same game already uses (its trait's `source` is
 * the cabinet's source now), else a new file doc of the IWAD, made once for
 * the entry however often the command runs. `api` is the extension's (repo,
 * scene).
 */
export async function wadFile(api, e, name = "Doom") {
  for (const o of Object.values(api.scene().objects ?? {})) {
    const t = o?.traits?.[WORLD];
    if (t?.source === e.url && o.sourceUrl) return o.sourceUrl;
  }
  e.wad ??= (async () => {
    const value = { "@patchwork": { type: "file" }, name: `${name}.wad`, extension: "wad", mimeType: "application/octet-stream", content: doomWads(e.content)[0] };
    const file = api.repo.create2 ? await api.repo.create2(value) : api.repo.create(value);
    return file.url;
  })();
  try {
    return await e.wad;
  } catch (err) {
    e.wad = null; // try again next time
    throw err;
  }
}
