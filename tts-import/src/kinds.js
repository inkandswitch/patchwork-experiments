// A TTS object → a "kind": everything its look depends on, and nothing else
// (not its name, not where it is). Objects with equal kinds share one GLB.
// Pure.
//
// Sizes at scale 1, in TTS units. None of these is documented; each is read
// off real mods (see README, "Sizes"):
//   card        2.2 × 3.1 (portrait along z), 0.02 thick
//   tile/token  2 deep (z); as wide as the image's aspect makes it (Stretch
//               on), else 2 wide; Thickness as given
//   board       18 deep (z), 18 × WidthScale wide, 0.2 thick; its snap
//               points' x are in a frame before WidthScale
//   figurine    2 × ImageScalar tall, as wide as the image's aspect makes it
//   die         a d6 is 1 across; others 0.75 circumradius
// Scale (non-uniform in TTS) is baked into the GLB, so it is part of the kind.

import { cardFaces } from "./cards.js";
import { colorHex } from "./convert.js";
import { deckEntry } from "./tts.js";

export const CARD = { w: 2.2, l: 3.1, t: 0.02 };
export const BOARD_HALF = 9;
export const DIE6 = 1;

const r4 = (v) => +Number(v).toFixed(4);
const scaleOf = (node) => {
  const t = node.transform ?? {};
  const s = [t.scaleX, t.scaleY, t.scaleZ].map((v) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? r4(v) : 1));
  return s;
};
const url = (v) => String(v ?? "").trim();
// a snap point: where, which way (TTS degrees, or null), and what it takes (its tags)
const snaps = (node) => node.snapPoints.map((s) => ({ position: s.position.map(r4), rotation: s.rotation ? s.rotation.map(r4) : null, tags: s.tags ?? [] }));

/** Built-in pieces (no assets): a shape and a default colour, by Name. */
export function pieceLook(name) {
  const s = String(name ?? "");
  const colorWord = /white|light/i.test(s) ? "#eeeae0" : /black|dark/i.test(s) ? "#26262a" : /red/i.test(s) ? "#b8352c" : /brown/i.test(s) ? "#7a5232" : null;
  if (/^Block(Square)/i.test(s)) return { shape: "box", size: [0.6, 0.6, 0.6], color: colorWord };
  if (/^BlockRectangle/i.test(s)) return { shape: "box", size: [1.2, 0.6, 0.6], color: colorWord };
  if (/^BlockTriangle/i.test(s)) return { shape: "box", size: [0.6, 0.6, 0.6], color: colorWord };
  if (/^PlayerPawn/i.test(s)) return { shape: "pawn", height: 1.4, color: colorWord };
  if (/^Chess_/i.test(s)) return { shape: "pawn", height: /King|Queen/i.test(s) ? 2 : 1.5, color: colorWord };
  if (/^Chinese_Checkers_Piece/i.test(s)) return { shape: "pawn", height: 0.7, color: colorWord };
  if (/^(Checker_|go_game_piece|backgammon_piece|reversi_chip|Quarter)/i.test(s)) return { shape: "disc", radius: /go_game/i.test(s) ? 0.45 : 0.6, height: 0.2, color: colorWord };
  if (/^Bowl/i.test(s)) return { shape: "bowl", color: colorWord };
  return { shape: "box", size: [0.6, 0.6, 0.6], color: colorWord };
}

/**
 * The kind of a node, or null if it isn't drawn (zones, scripting-only
 * objects). `ctx.deck` is the deck a card is in (for its CustomDeck),
 * `ctx.publicCard` asks for a hidden card's public look (its back, both sides).
 */
export function kindOf(node, ctx = {}) {
  const scale = scaleOf(node);
  const color = colorHex(node.color);
  switch (node.kind) {
    case "card": {
      const faces = cardFaces(node.cardId, deckEntry(node, ctx.deck));
      if (!faces) return { type: "placeholder", scale, size: [CARD.w, CARD.t, CARD.l], color: "#d8d4c8", why: "card without a CustomDeck entry" };
      if (ctx.publicCard) return { type: "card", scale, face: faces.back, back: faces.back };
      return { type: "card", scale, face: faces.face, back: faces.back };
    }
    case "tile":
    case "token": {
      const im = node.image ?? {};
      const spec = node.kind === "tile" ? im.CustomTile ?? {} : im.CustomToken ?? {};
      return {
        type: node.kind,
        scale,
        top: url(im.ImageURL),
        bottom: url(im.ImageSecondaryURL) || null,
        thickness: r4(Number(spec.Thickness) > 0 ? spec.Thickness : 0.2),
        tileType: node.kind === "tile" ? Number(spec.Type) || 0 : null,
        stretch: node.kind === "tile" ? spec.Stretch !== false : true,
        color: color ?? "#ffffff",
        snaps: snaps(node),
      };
    }
    case "board": {
      const im = node.image ?? {};
      return { type: "board", scale, top: url(im.ImageURL), widthScale: r4(Number(im.WidthScale) > 0 ? im.WidthScale : 1), color: color ?? "#ffffff", snaps: snaps(node) };
    }
    case "figurine": {
      const im = node.image ?? {};
      return { type: "figurine", scale, front: url(im.ImageURL), back: url(im.ImageSecondaryURL) || null, imageScalar: r4(Number(im.ImageScalar) > 0 ? im.ImageScalar : 1) };
    }
    case "model":
    case "bag": {
      const m = node.mesh;
      if (m?.MeshURL) {
        return {
          type: "model",
          scale,
          mesh: url(m.MeshURL),
          diffuse: url(m.DiffuseURL) || null,
          color: color ?? "#ffffff",
          material: Number(m.MaterialIndex) || 0,
          snaps: snaps(node),
        };
      }
      if (node.kind === "bag") return { type: "bag", scale, color: color ?? "#6b4a2e" };
      return { type: "placeholder", scale, size: [1, 1, 1], color: color ?? "#999999", why: "model without a mesh URL" };
    }
    case "die": {
      const custom = node.name === "Custom_Dice";
      const typeSides = [4, 6, 8, 10, 12, 20];
      const sides = custom ? typeSides[Number(node.image?.CustomDice?.Type) || 0] ?? 6 : Number(/^Die_(\d+)/.exec(node.name)?.[1]) || 6;
      return {
        type: "die",
        scale,
        sides,
        image: custom ? url(node.image?.ImageURL) || null : null,
        color: color ?? "#f4f1ea",
        faces: (node.rotationValues ?? []).map((r) => ({ value: String(r.Value), rotation: [r.Rotation?.x, r.Rotation?.y, r.Rotation?.z].map((v) => r4(Number(v) || 0)) })),
      };
    }
    case "piece":
      return { type: "piece", scale, look: pieceLook(node.name), color: color };
    case "pdf":
      return { type: "pdf", scale };
    case "deck":
      return null; // a deck is its cards
    case "zone":
    case "text":
      return null;
    case "fixture":
    case "assetbundle":
    case "unknown":
    default:
      return { type: "placeholder", scale, size: node.kind === "assetbundle" ? [1, 1, 1] : [0.6, 0.6, 0.6], color: color ?? "#a0a0a8", why: node.kind };
  }
}

/** A stable string for a kind (sorted keys), for deduping. */
export function kindKey(kind) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(kind));
}

/** A short hash of a string (FNV-1a, 2×32 bits), for doc-friendly keys. */
export function shortHash(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 15);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** The asset URLs a kind needs, with what for: [{ url, role: "image" | "model" }]. */
export function kindAssets(kind) {
  const out = [];
  const add = (u, role) => u && out.push({ url: u, role });
  if (kind.type === "card") {
    add(kind.face.url, "image");
    add(kind.back.url, "image");
  }
  if (kind.type === "tile" || kind.type === "token") {
    add(kind.top, "image");
    add(kind.bottom, "image");
  }
  if (kind.type === "board") add(kind.top, "image");
  if (kind.type === "figurine") {
    add(kind.front, "image");
    add(kind.back, "image");
  }
  if (kind.type === "model") {
    add(kind.mesh, "model");
    add(kind.diffuse, "image");
  }
  if (kind.type === "die") add(kind.image, "image");
  if (kind.type === "table") add(kind.image, "image");
  return out;
}
