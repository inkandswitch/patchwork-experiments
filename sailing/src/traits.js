// The doc's vocabulary for sailing (DESIGN.md, "Traits"): the trait keys,
// the claim kinds, what a station's value means when it's drawn, and
// walking the scene's tree as the stage resolves it. Pure: every play part
// and the edit view read the doc through this, and none of them through
// another part.

export const SEA = "sailing.sea";
export const SHIP = "sailing.ship";
export const HELM = "sailing.helm";
export const SAIL = "sailing.sail";
export const ANCHOR = "sailing.anchor";
/** The anchor itself (the hook), drawn lying on the bottom while its windlass says it's down. */
export const HOOK = "sailing.hook";
export const LADDER = "sailing.ladder";
export const FLOAT = "sailing.float";

/** The stations' traits, and what each is called on a ship (ctx.sim.stationsOf). */
export const STATIONS = Object.freeze({ helm: HELM, sail: SAIL, anchor: ANCHOR });

/** The scene-wide claim of the view that simulates the sea and its ships. */
export const SIM = "sim";
/** A station's claim: who is working it. */
export const STATION = "station";

/** The extension that publishes the sea's clock in presence (edit.js runs as another id and reads it there). */
export const PLAY_ID = "sailing";

/** A station's trait fields when the doc leaves them out (index.js describes them). */
export const DEFAULTS = Object.freeze({
  [HELM]: Object.freeze({ angle: 0 }),
  [SAIL]: Object.freeze({ raised: 1, sheet: 0.5 }),
  [ANCHOR]: Object.freeze({ down: true, rode: 0 }),
});

/** Metres of chain let out when the anchor goes down. */
export const RODE = 25;

/** The wheel's turns from the middle to either lock. */
export const WHEEL_TURNS = 1.25;

/** The wheel's transform for a helm angle (-1..1): its doc transform turned about its own Z, + to starboard turning it clockwise as you face forward. */
export function wheelTransform(t, angle) {
  const r = t?.rotation ?? [0, 0, 0];
  return { position: [...(t?.position ?? [0, 0, 0])], rotation: [r[0], r[1], -angle * WHEEL_TURNS * 2 * Math.PI], scale: t?.scale ?? 1 };
}

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

/** The ships that sail: objects with the ship trait at the scene's root (one attached under something goes where that goes). */
export const shipsOf = (scene) => (scene?.ids ?? []).filter((id) => scene.objects[id]?.traits?.[SHIP] && !parentOf(scene, id));

/** The trait key that makes an object a station, or null. */
export function stationKind(o) {
  const t = o?.traits;
  if (!t) return null;
  return [HELM, SAIL, ANCHOR].find((k) => t[k]) ?? null;
}

/** A station's live value: its defaults, its trait's fields, and its holder's input over them. */
export function stationValue(kind, fields, input) {
  return { ...DEFAULTS[kind], ...(fields ?? {}), ...(input ?? {}) };
}

/**
 * A ship's parts, from a snapshot: its stations (the first of each kind
 * attached under it at any depth), its ladder and its anchor's hook, each
 * found by its trait. null where it has none.
 * @returns {{ helm, sail, anchor, ladder, hook }}
 */
export function partsOf(scene, ship) {
  const out = { helm: null, sail: null, anchor: null, ladder: null, hook: null };
  for (const id of scene?.ids ?? []) {
    const o = scene.objects[id];
    if (!o?.traits || id === ship || !isUnder(scene, id, ship)) continue;
    for (const [k, trait] of Object.entries(STATIONS)) if (!out[k] && o.traits[trait]) out[k] = id;
    if (!out.ladder && o.traits[LADDER]) out.ladder = id;
    if (!out.hook && o.traits[HOOK]) out.hook = id;
  }
  return out;
}
