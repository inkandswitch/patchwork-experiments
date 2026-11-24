// The doc's vocabulary for sailing (DESIGN.md, "Traits"): the trait keys,
// the claim kinds, what a station's value means when it's drawn, and
// walking the scene's tree as the stage resolves it. Pure: every play part
// and the edit view read the doc through this, and none of them through
// another part.

import { eulerFromQuat, mulQ, quatFromEuler } from "./frames.js";

/** A sea: waves on the water body it's put on (an object trait, `{ seed, scale }`). */
export const SEA = "sailing.sea";
export const SHIP = "sailing.ship";
export const HELM = "sailing.helm";
export const SAIL = "sailing.sail";
export const ANCHOR = "sailing.anchor";
/** The anchor itself (the hook), drawn lying on the bottom while its windlass says it's down. */
export const HOOK = "sailing.hook";
export const LADDER = "sailing.ladder";
/** Where the sail is worked from the cockpit: a traveller and its block, under the boom's end. */
export const MAINSHEET = "sailing.mainsheet";
export const FLOAT = "sailing.float";
/**
 * The jib: its lasting settings (`sheet` 0 hard in .. 1 eased, `held` null
 * or the side its clew is made fast on, "port" | "starboard", `furl` 0..1 of
 * it rolled away). The piece swings about its own Y (the luff) as the boom
 * does about the mast.
 */
export const JIB = "sailing.jib";
/** A winch the jib's sheet is led to: `{ sail: "jib", side: "port" | "starboard" }`. Where you stand to work it is its walk.stand. */
export const WINCH = "sailing.winch";

// Other packages' traits that sailing's parts carry, written in the shapes
// those packages document (sailing imports none of them):
/** the water package's: this object is water, its origin the surface at rest; `{ size? }`, none being open water. A sea goes on it. */
export const WATER_TRAIT = "water";
/** Is this object open water (the water package's trait with no size)? */
export const isOpenWater = (o) => !!o?.traits?.[WATER_TRAIT] && o.traits[WATER_TRAIT].size == null;
/**
 * The walk package's traits (walk/DESIGN.md, "The traits"): how people
 * stand on her. Her hull is a support (walked in her own frame); the boom
 * blocks where it's drawn, the jib and the anchor are passed through, the
 * wheel is the solid its turn about its axle sweeps; each station is a
 * stand spot `{ at, facing?, claim }` (its own frame), whose `claim` is the
 * one whoever works it from there holds (STATION; the sail's HALYARD), so
 * walk.people draws them standing at it; her ladder `{ top }`; the wheel is
 * her spawn too (people come aboard at its stand spot).
 */
export const WALK = Object.freeze({ support: "walk.support", moves: "walk.moves", stand: "walk.stand", ladder: "walk.ladder", spawn: "walk.spawn" });
/**
 * the weather package's: the world's weather, a scene trait, flat
 * (`{ wind, from, seed, ... }`: wind m/s at 10 m, from degrees true, seed
 * the gusts'; every field it leaves out is the weather's default:
 * weather/WEATHER.md). Sailing's parts and templates write the air of it
 * where a scene has none; the weather package offers it as the ambient below.
 */
export const WEATHER = "weather";
/** The ambient name of the world's wind (weather/README.md, "Conventions"): `{ speed (m/s), from (degrees), seed, gustiness (0..1) }`. Sailing reads it and offers none. */
export const WIND_AMBIENT = "wind";
/** joints' slide: a part that moves along a line between two stops (the companionway's hatch). */
export const SLIDE = "joints.slide";
/** traversal's exit: an object that leads to another document; the companionway is one, leading nowhere until a scene says where. */
export const EXIT = "traversal.exit";

/** The stations' traits, and what each is called on a ship (ctx.sim.stationsOf). */
export const STATIONS = Object.freeze({ helm: HELM, sail: SAIL, anchor: ANCHOR, mainsheet: MAINSHEET, jib: JIB });

/** A station's claim: who is working it. */
export const STATION = "station";
/**
 * Who stands at the mast working the halyard: a claim on the sail station,
 * apart from its "station" claim (which whoever is hauling on the sail's
 * values holds, only while a key is down), so someone at the mast doesn't
 * stop the helmsman trimming the sheet.
 */
export const HALYARD = "halyard";

/** A station's trait fields when the doc leaves them out (index.js describes them). */
export const DEFAULTS = Object.freeze({
  [HELM]: Object.freeze({ angle: 0 }),
  [SAIL]: Object.freeze({ raised: 1, sheet: 0.5 }),
  [ANCHOR]: Object.freeze({ down: true, rode: 0 }),
  [MAINSHEET]: Object.freeze({}),
  [JIB]: Object.freeze({ sheet: 0.5, held: null, furl: 0 }),
  [WINCH]: Object.freeze({}),
});

/** A jib's `held` side as the physics' jibHeld: −1 port, +1 starboard; 0 when it tends itself. */
export const heldSign = (held) => (held === "port" ? -1 : held === "starboard" ? 1 : 0);
/** −1 / +1 as a side's name. */
export const sideName = (s) => (s < 0 ? "port" : "starboard");

/** Metres of chain let out when the anchor goes down. */
export const RODE = 25;

/** The wheel's turns from the middle to either lock. */
export const WHEEL_TURNS = 1.25;

/**
 * A doc transform turned about one of its own axes (0 X, 1 Y, 2 Z) by
 * `angle`, on top of how it was placed: placed · turn. Each angle is kept
 * on the turn of 2π nearest the placed one plus the turn, so a wheel put
 * down square reads as it turns (2.5 turns lock to lock, not wrapped).
 */
export function turnedAbout(t, axis, angle) {
  const placed = [0, 1, 2].map((i) => Number(t?.rotation?.[i]) || 0);
  const half = [0, 0, 0, Math.cos(angle / 2)];
  half[axis] = Math.sin(angle / 2);
  const rotation = eulerFromQuat(mulQ(quatFromEuler(placed), half)).map((v, i) => {
    const near = placed[i] + (i === axis ? angle : 0);
    return v + 2 * Math.PI * Math.round((near - v) / (2 * Math.PI)) + 0;
  });
  return { position: [...(t?.position ?? [0, 0, 0])], rotation, scale: t?.scale ?? 1 };
}

/** The wheel's transform for a helm angle (-1..1): turned about its own Z from where it was put, + to starboard turning it clockwise as you face forward. */
export const wheelTransform = (t, angle) => turnedAbout(t, 2, -angle * WHEEL_TURNS * 2 * Math.PI);

/** The boom-and-sail's transform for a boom angle (radians, + to starboard): swung about its own Y (the mast) from where it was put. */
export const rigTransform = (t, boom) => turnedAbout(t, 1, boom);

/** The jib's transform for its chord's angle (radians, + to starboard): swung about its own Y (the luff, tack to head) from where it was put. */
export const jibTransform = (t, jib) => turnedAbout(t, 1, jib);

/** Off a ship's starboard quarter, looking at her deck, in her frame: the template's home view (view.start.home), and where an untouched orbit opens. */
export const QUARTER = Object.freeze({ position: Object.freeze([12, 6.5, 16]), target: Object.freeze([0, 2.5, 0]) });

// ─── the tree, as the stage resolves it ────────────────────────────────────

/**
 * What an object is attached to: the snapshot's resolved parents (a Map:
 * a missing parent, a group, or a broken cycle is null), never the raw field.
 */
export const parentOf = (scene, id) => scene?.parents?.get?.(id) ?? null;

/** Is `id` the object `root` or attached somewhere under it? */
export function isUnder(scene, id, root) {
  for (let at = id, n = 0; at != null && n < 64; at = parentOf(scene, at), n++) if (at === root) return true;
  return false;
}

/** The ship an object is aboard (itself, or the nearest ancestor with the ship trait), or null. */
export function shipOf(scene, id) {
  for (let at = id, n = 0; at != null && n < 64; at = parentOf(scene, at), n++) {
    if (scene?.objects?.[at]?.traits?.[SHIP]) return at;
  }
  return null;
}

/** The ships that sail: objects with the ship trait at the scene's root (one attached under something goes where that goes). */
export const shipsOf = (scene) => (scene?.ids ?? []).filter((id) => scene.objects[id]?.traits?.[SHIP] && !parentOf(scene, id));

/** The trait key that makes an object a station, or null. */
/** The station traits, in the order stationKind tests them. */
const STATION_KINDS = Object.freeze([HELM, SAIL, ANCHOR, MAINSHEET, JIB, WINCH]);

export function stationKind(o) {
  const t = o?.traits;
  if (!t) return null;
  for (let i = 0; i < STATION_KINDS.length; i++) if (t[STATION_KINDS[i]]) return STATION_KINDS[i];
  return null;
}

/** A station's live value: its defaults, its trait's fields, and its holder's input over them. */
export function stationValue(kind, fields, input) {
  return { ...DEFAULTS[kind], ...(fields ?? {}), ...(input ?? {}) };
}

/**
 * A ship's parts, from a snapshot: its stations (the first of each kind
 * attached under it at any depth), its ladder and its anchor's hook, each
 * found by its trait, null where it has none; and her jib's winches, every
 * one, in the scene's order.
 * @returns {{ helm, sail, anchor, mainsheet, jib, ladder, hook, winches: string[] }}
 */
export function partsOf(scene, ship) {
  const out = { helm: null, sail: null, anchor: null, mainsheet: null, jib: null, ladder: null, hook: null, winches: [] };
  for (const id of scene?.ids ?? []) {
    const o = scene.objects[id];
    if (!o?.traits || id === ship || !isUnder(scene, id, ship)) continue;
    for (const [k, trait] of Object.entries(STATIONS)) if (!out[k] && o.traits[trait]) out[k] = id;
    if (!out.ladder && o.traits[LADDER]) out.ladder = id;
    if (!out.hook && o.traits[HOOK]) out.hook = id;
    if (o.traits[WINCH]) out.winches.push(id);
  }
  return out;
}
