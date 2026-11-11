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
// made on demand by the first view that needs one (extension.js): setting a
// table up never writes it, and a table nobody has seen a card at never has
// one. It's sized to the card (its
// hint's bounds, which every card of a deck shares: its back's), so a scene
// with two sizes of card has two.

import { glbFile, round } from "./files.js";

/** Bump when the drawing changes: new art gets a new key, and scenes keep the old one's file. */
export const PRIVACY_VERSION = 3;

/** How far the privacy face's decals stand proud of its core: 0.2 mm, the least that never fights from a seat. */
export const DECAL = 0.0002;

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

/** Rectangles [x0, z0, x1, z1] that tile `rect` less every one of `holes` (cells of their edges, merged along X). Pure. */
export function cutRects(rect, holes) {
  const [x0, z0, x1, z1] = rect;
  const xs = new Set([x0, x1]);
  const zs = new Set([z0, z1]);
  for (const h of holes) {
    for (const x of [h[0], h[2]]) if (x > x0 && x < x1) xs.add(x);
    for (const z of [h[1], h[3]]) if (z > z0 && z < z1) zs.add(z);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Z = [...zs].sort((a, b) => a - b);
  const out = [];
  for (let j = 0; j + 1 < Z.length; j++) {
    const zm = (Z[j] + Z[j + 1]) / 2;
    let run = null;
    for (let i = 0; i + 1 < X.length; i++) {
      const xm = (X[i] + X[i + 1]) / 2;
      const hidden = holes.some((h) => xm > h[0] && xm < h[2] && zm > h[1] && zm < h[3]);
      if (hidden) run = null;
      else if (run) run[2] = X[i + 1];
      else out.push((run = [X[i], Z[j], X[i + 1], Z[j + 1]]));
    }
  }
  return out;
}

/**
 * The privacy face as a piece (pieces.js parts), filling `bounds` exactly:
 * a slate card, a frosted field inset on each side with reeded stripes like
 * privacy glass, and a padlock in the middle, its shackle towards +Z. Both
 * sides alike (the underside the top mirrored through the card's middle), so
 * a private card being turned over, or tipped past upright in someone's
 * hand, never shows a bare side before its look changes. Pure.
 *
 * Two levels a side, never more: the core, and one layer of decals DECAL
 * proud of it (0.2 mm) that tile the field without overlapping. The frost
 * and reeds are cut round the padlock, the padlock round its keyhole; no
 * decal lies on another, so no two faces are nearer each other than DECAL,
 * which the depth buffer resolves from across the table (stacked 0.07 mm
 * apart they fought).
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
  const d = Math.min(DECAL, t / 3); // a decal's height above the core
  const sink = d / 2; // and how far it reaches down into it, so its underside lies on nothing
  const parts = [{ shape: "box", size: [w, t - 2 * d, l], at: [cx, y0 + d, cz], color: FRAME, name: "card" }];
  /** a decal over rect [x0, z0, x1, z1], on the top and mirrored on the bottom */
  const decal = ([a, b, c, e], color, name) => {
    const size = [c - a, d + sink, e - b];
    const at = (y) => [(a + c) / 2, y, (b + e) / 2];
    parts.push({ shape: "box", size, at: at(y1 - d - sink), color, name }, { shape: "box", size, at: at(y0), color, name });
  };

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
  const rect = (x, z, sx, sz) => [x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2];
  // the keyhole: a round head (an octagon of two crossed bars) and its slot below
  const kz = bz - down * s * 0.03;
  const keyhole = [rect(cx, kz, s * 0.12, s * 0.08), rect(cx, kz, s * 0.08, s * 0.12), rect(cx, bz + down * s * 0.06, s * 0.045, s * 0.11)];
  const body = rect(cx, bz, bw, bl);
  // the shackle: two legs up from the body, and the bar across their tops (the legs stop under it)
  const legs = [-1, 1].map((k) => rect(cx + k * bw * 0.3, top - down * ((sh - bar) / 2), bar, sh - bar));
  const crown = rect(cx, top - down * (sh - bar / 2), bw * 0.6 + bar, bar);
  // the padlock's own box in the field: the frost and reeds stop at it
  const lockBox = [cx - bw / 2, Math.min(body[1], crown[1]), cx + bw / 2, Math.max(body[3], crown[3])];

  // reeds across the field: privacy glass, nothing to read through it; frost between them
  const n = 9;
  const pitch = fw / n;
  const fx0 = cx - fw / 2;
  const fz = [cz - fl / 2, cz + fl / 2];
  const stripes = [];
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const a = fx0 + pitch * (i + 0.05);
    const b = fx0 + pitch * (i + 0.95);
    stripes.push([a, b, REED, "reed"]);
  }
  // frost: from the field's edge to the first reed, between reeds, and on to the far edge
  const edges = [fx0, ...stripes.flatMap(([a, b]) => [a, b]), fx0 + fw];
  for (let k = 0; k + 1 < edges.length; k += 2) if (edges[k + 1] > edges[k]) stripes.push([edges[k], edges[k + 1], FROST, "frost"]);
  for (const [a, b, color, name] of stripes) for (const r of cutRects([a, fz[0], b, fz[1]], [lockBox])) decal(r, color, name);
  // inside the padlock's box: frost round the shackle, the lock's pieces, the keyhole
  for (const r of cutRects(lockBox, [body, ...legs, crown])) decal(r, FROST, "frost");
  for (const r of cutRects(body, keyhole)) decal(r, LOCK, "lock");
  for (const r of [...legs, crown]) decal(r, LOCK, "shackle");
  // the keyhole's crossed bars overlap: cut each by those before it
  keyhole.forEach((k, i) => {
    for (const r of cutRects(k, keyhole.slice(0, i))) decal(r, KEYHOLE, "keyhole");
  });
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
  // (`assets` is made with the doc: the scene's datatype)
  if (!d.assets[key]?.url) d.assets[key] = { url, hint: { bounds: { min: [...bounds.min], max: [...bounds.max] } } };
}

/**
 * Which of the three a hidden card is to a viewer: "face" when its deck
 * gave this viewer its face; else, face down, "back"; else, face up:
 *
 *   - its deck not dealt yet (a secure deck waiting for its players: no
 *     card is anyone's, and none can be shown to anybody), "back": the HUD
 *     says what it's waiting for;
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
