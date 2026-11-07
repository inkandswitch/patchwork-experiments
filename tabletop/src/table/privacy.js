// What a hidden card looks like to one viewer, of three things:
//
//   - face down: its back (the object's own look; no lens);
//   - face up, and this viewer may see it and knows what it is: its face
//     (its deck's look);
//   - face up, but not for this viewer: in another seat's hand, or its face
//     not known here yet once the deck is dealt (a secure deck's key not
//     delivered), or a deck nothing installed can read: the PRIVACY FACE, one
//     generic picture for every card, a frosted panel with a padlock, framed
//     like a card face. It says "this is face up, and kept from you on
//     purpose", where the back would say "face down", and it tells nothing
//     about which card it is: it's the same for every card of that size,
//     and nothing about it comes from the deck (card-table's secrets never
//     reach it). Before its deck is dealt (resolver.dealt() false: a secure
//     deck waiting for its players), no card is anyone's: every card shows
//     its back, as does every card of a deck still loading.
//
// Face up is the zone rule's (visibility.js faceUpIn): the card's +Y against
// the up of the frame it lies in, from the doc, so a card on a table aboard
// a heeling, pitching ship reads the same on every peer whatever she does.
//
// The privacy face is a GLB the scene keeps once, as a `file` doc at
// doc.assets[privacyKey(size)] (the scene's files, scene/STAGE.md "Parts"),
// made on demand by the first view that needs one (extension.js), so tables
// published before this existed get it too. It's sized to the card (its
// hint's bounds, which every card of a deck shares: its back's), so a scene
// with two sizes of card has two.

import { glbFile, round } from "./files.js";

/** Bump when the drawing changes: new art gets a new key, and scenes keep the old one's file. */
export const PRIVACY_VERSION = 2;

/** A card's size when it has no hint to say (Lost Cities': lost-cities.js CARD), centred, lying on y = 0. */
export const DEFAULT_CARD = Object.freeze({ min: Object.freeze([-0.028, 0, -0.0435]), max: Object.freeze([0.028, 0.0012, 0.0435]) });

/** The bounds a hidden object's privacy face is drawn to: its hint's, if they make a box, else DEFAULT_CARD. */
export function cardBounds(o) {
  const b = o?.hint?.bounds;
  const ok = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => Number.isFinite(Number(x)));
  if (!ok(b?.min) || !ok(b?.max)) return DEFAULT_CARD;
  const min = b.min.slice(0, 3).map(Number);
  const max = b.max.slice(0, 3).map(Number);
  if (!(max[0] > min[0] && max[1] > min[1] && max[2] > min[2])) return DEFAULT_CARD;
  return round({ min, max });
}

/**
 * The scene's assets key for the privacy face of a card with these bounds:
 * namespaced, versioned, and sized in tenths of a millimetre (with where it
 * sits, so two decks whose cards are the same size but drawn off-centre each
 * get one that lines up).
 */
export function privacyKey(bounds) {
  const b = bounds ?? DEFAULT_CARD;
  const t = (v) => Math.round(Number(v) * 10000);
  return `tabletop/private-card@${PRIVACY_VERSION}:${[...b.min, ...b.max].map(t).join(",")}`;
}

// Colours no card uses: a mid grey frost (darker than a white suit's card,
// paler and hueless beside the brown back, greyer than the blue suit) round
// a big pale padlock, so it reads as "locked", not as a card, from a seat.
const FRAME = "#2b3036";
const FROST = "#7d8892";
const REED = "#8f9aa4";
const LOCK = "#f1f3f5";
const KEYHOLE = "#2b3036";

/**
 * The privacy face as a piece (pieces.js parts), filling `bounds` exactly:
 * a slate card, a frosted field inset on each side with reeded stripes like
 * privacy glass, and a padlock in the middle, its shackle towards +Z. Both
 * sides alike (the underside the top mirrored through the card's middle), so
 * a private card being turned over, or tipped past upright in someone's
 * hand, never shows a bare side before its look changes. Pure.
 */
export function privacyPiece(bounds = DEFAULT_CARD) {
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  const w = x1 - x0;
  const l = z1 - z0;
  const t = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const s = Math.min(w, l);
  const m = s * 0.07; // the frame round the field
  const fw = w - 2 * m;
  const fl = l - 2 * m;
  // layers up the card, as fractions of its thickness: the core in the
  // middle, then each side's frost, reeds, padlock and keyhole, the top's
  // keyhole reaching y1 and the bottom's y0
  const at = (k) => y0 + t * k;
  /** a part on the top (+Y) between fractions k0 and k1, and its mirror image on the bottom */
  const both = (k0, k1, part) => [
    { ...part, ...(part.shape === "box" ? { size: [part.size[0], t * (k1 - k0), part.size[2]], at: [part.at[0], at(k0), part.at[2]] } : {}) },
    { ...part, ...(part.shape === "box" ? { size: [part.size[0], t * (k1 - k0), part.size[2]], at: [part.at[0], at(1 - k1), part.at[2]] } : {}) },
  ];
  const keyhole = (k0, k1, x, z) => ({ shape: "lathe", profile: [[0, at(k0)], [s * 0.06, at(k0)], [s * 0.06, at(k1)], [0, at(k1)]], segments: 20, at: [x, 0, z], color: KEYHOLE, name: "keyhole" });
  const parts = [
    { shape: "box", size: [w, t * 0.3, l], at: [cx, at(0.35), cz], color: FRAME, name: "card" },
    ...both(0.65, 0.72, { shape: "box", size: [fw, 0, fl], at: [cx, 0, cz], color: FROST, name: "frost" }),
  ];
  // reeds across the field: privacy glass, nothing to read through it
  const n = 9;
  const pitch = fw / n;
  for (let i = 0; i < n; i += 2) parts.push(...both(0.72, 0.78, { shape: "box", size: [pitch * 0.9, 0, fl], at: [cx - fw / 2 + pitch * (i + 0.5), 0, cz], color: REED, name: "reed" }));
  // the padlock: a body, its shackle, a keyhole. Its top is towards +Z, so
  // it reads the right way up from across the table: a hand's cards face its
  // seat, and the privacy face is what everyone but that seat sees
  const down = -1; // the way the lock's bottom is, along Z
  const bw = s * 0.56;
  const bl = s * 0.42;
  const bz = cz + down * s * 0.12; // the body's middle
  const bar = s * 0.1;
  const sh = s * 0.28; // the shackle's reach above the body
  const top = bz - down * (bl / 2); // the body's top edge
  const lock = (size, x, z, name) => both(0.78, 0.9, { shape: "box", size: [size[0], 0, size[1]], at: [x, 0, z], color: LOCK, name });
  parts.push(
    ...lock([bw, bl], cx, bz, "lock"),
    ...lock([bar, sh], cx - bw * 0.3, top - down * (sh / 2), "shackle"),
    ...lock([bar, sh], cx + bw * 0.3, top - down * (sh / 2), "shackle"),
    ...lock([bw * 0.6 + bar, bar], cx, top - down * (sh - bar / 2), "shackle"),
    keyhole(0.9, 1, cx, bz - down * s * 0.03),
    keyhole(0, 0.1, cx, bz - down * s * 0.03),
    ...both(0.9, 0.97, { shape: "box", size: [s * 0.045, 0, s * 0.11], at: [cx, 0, bz + down * s * 0.06], color: KEYHOLE, name: "keyhole" }),
  );
  return { name: "Private card", parts };
}

/** The privacy face's file, as ctx.file's make() wants it (files.js glbFile), its hint the card's bounds. */
export function privacyFile(bounds = DEFAULT_CARD) {
  const f = glbFile(privacyPiece(bounds));
  return { ...f, hint: { bounds: round(bounds) } };
}

/**
 * In a change of the scene doc: remember the privacy face's file at
 * doc.assets[key], if that key is still empty (as the stage's ctx.file
 * does). The one write the privacy face ever makes: nothing per card. Two
 * peers at once: the merge keeps one, and the other's file doc is a spare.
 */
export function rememberAsset(d, key, url, bounds) {
  // made with the doc (the scene's datatype); a scene from before `assets` gets it here
  if (!d.assets) d.assets = {};
  if (!d.assets[key]?.url) d.assets[key] = { url, hint: { bounds: { min: [...bounds.min], max: [...bounds.max] } } };
}

/**
 * Which of the three a hidden card is to a viewer: "face" when its deck
 * gave this viewer its face; else, face down, "back"; else, face up:
 *
 *   - its deck not dealt yet (a secure deck waiting for its players: no
 *     card is anyone's, and none can be shown to anybody), "back", as every
 *     card was before there was a privacy face: the HUD says what it's
 *     waiting for;
 *   - kept from this viewer by the zone rule (in another seat's hand),
 *     "private";
 *   - this viewer's to see, its face not here yet (a secure deck's keys on
 *     their way), "private" when the deck says it's dealt, else (a deck that
 *     doesn't say) "back".
 *
 * A card in your own hand face down is "face": the zone rule shows you it
 * whichever way up (the GLB's face is then underneath). Pure.
 * @param {{ face: boolean, faceUp: boolean, withheld?: boolean, dealt?: boolean | null }} o
 *   withheld: the zone rule keeps it from this viewer (default true);
 *   dealt: the deck says its cards can be shown (true), can't be yet
 *   (false), or doesn't say (null; the default)
 */
export function cardState({ face, faceUp, withheld = true, dealt = null }) {
  if (face) return "face";
  if (!faceUp || dealt === false) return "back";
  if (withheld) return "private";
  return dealt === true ? "private" : "back";
}
