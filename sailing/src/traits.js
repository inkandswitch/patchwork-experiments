// The doc's vocabulary for sailing (DESIGN.md, "Traits"): the trait keys,
// the claim kinds, what a station's value means when it's drawn, and
// walking the scene's tree as the stage resolves it. Pure: every play part
// and the edit view read the doc through this, and none of them through
// another part.

import { eulerFromQuat, mulQ, quatFromEuler } from "./frames.js";

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

/** The stations' traits, and what each is called on a ship (ctx.sim.stationsOf). */
export const STATIONS = Object.freeze({ helm: HELM, sail: SAIL, anchor: ANCHOR, mainsheet: MAINSHEET });

/** The scene-wide claim of the view that simulates the sea and its ships. */
export const SIM = "sim";
/** A station's claim: who is working it. */
export const STATION = "station";
/**
 * Who stands at the mast working the halyard: a claim on the sail station,
 * apart from its "station" claim (which whoever is hauling on the sail's
 * values holds, only while a key is down), so someone at the mast doesn't
 * stop the helmsman trimming the sheet.
 */
export const HALYARD = "halyard";

/** The extension that publishes the sea's clock in presence (edit.js runs as another id and reads it there). */
export const PLAY_ID = "sailing";

/** A station's trait fields when the doc leaves them out (index.js describes them). */
export const DEFAULTS = Object.freeze({
  [HELM]: Object.freeze({ angle: 0 }),
  [SAIL]: Object.freeze({ raised: 1, sheet: 0.5 }),
  [ANCHOR]: Object.freeze({ down: true, rode: 0 }),
  [MAINSHEET]: Object.freeze({}),
});

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

/** Off a ship's starboard quarter, looking at her deck, in her frame: the template's home view, and where the orbit opens in play. */
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

/** Does an object carry a sailing trait, or a sailing tag (a mast's stand: "sailing.mast")? Then it's the ship's own. */
export function sailingThing(o) {
  if (!o) return false;
  if (o.traits && Object.keys(o.traits).some((k) => k.startsWith("sailing."))) return true;
  return Array.isArray(o.tags) && o.tags.some((t) => typeof t === "string" && t.startsWith("sailing."));
}

/**
 * Whether the hand may carry `id` in play (scene.hand's `carryable`): never
 * a ship, nor anything of hers (a sailing trait or tag: the mast, the sail,
 * the wheel, the windlass and anchor, the ladder; she'd be dismasted by a
 * game of cards); anything else aboard (a table and its cards) is no
 * business of sailing's (undefined).
 */
export function carryableAboard(scene, id) {
  const o = scene?.objects?.[id];
  if (!o) return undefined;
  if (o.traits?.[SHIP] || sailingThing(o)) return false;
  return undefined;
}

/** The ships that sail: objects with the ship trait at the scene's root (one attached under something goes where that goes). */
export const shipsOf = (scene) => (scene?.ids ?? []).filter((id) => scene.objects[id]?.traits?.[SHIP] && !parentOf(scene, id));

/** The trait key that makes an object a station, or null. */
export function stationKind(o) {
  const t = o?.traits;
  if (!t) return null;
  return [HELM, SAIL, ANCHOR, MAINSHEET].find((k) => t[k]) ?? null;
}

/** A station's live value: its defaults, its trait's fields, and its holder's input over them. */
export function stationValue(kind, fields, input) {
  return { ...DEFAULTS[kind], ...(fields ?? {}), ...(input ?? {}) };
}

/**
 * A ship's parts, from a snapshot: its stations (the first of each kind
 * attached under it at any depth), its ladder and its anchor's hook, each
 * found by its trait. null where it has none.
 * @returns {{ helm, sail, anchor, mainsheet, ladder, hook }}
 */
export function partsOf(scene, ship) {
  const out = { helm: null, sail: null, anchor: null, mainsheet: null, ladder: null, hook: null };
  for (const id of scene?.ids ?? []) {
    const o = scene.objects[id];
    if (!o?.traits || id === ship || !isUnder(scene, id, ship)) continue;
    for (const [k, trait] of Object.entries(STATIONS)) if (!out[k] && o.traits[trait]) out[k] = id;
    if (!out.ladder && o.traits[LADDER]) out.ladder = id;
    if (!out.hook && o.traits[HOOK]) out.hook = id;
  }
  return out;
}
