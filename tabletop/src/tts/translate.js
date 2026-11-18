// A Tabletop Simulator save → a tabletop-game (tabletop/GAME-FORMAT.md):
// what each object looks like and is, as a piece, and where everything
// starts, as the game's setup. Pure: it reads the save and two lookups the
// importer gives it, and writes nothing. It never makes a scene: laying a
// game out (decks shuffled and kept, hands, bags, dice, seats) is the
// tabletop package's, for any game, so an imported game works the way a
// built-in one does.
//
//   translate(save, { file, unit, flipObjX, includeContents, maxObjects })
//     → { game, counts, skipped, approximated, warnings }
//
// `file(url)` is what a piece names the mod's asset at `url` by: the URL
// itself (fetched when it's first drawn, and cached in the game's `assets`),
// a file doc the importer stored it in, or null when it can't be had (a
// piece is then drawn without it). No asset is read here: a tile or token
// as wide as its picture says so (`aspect: "image"`), and the drawer measures
// the picture when it draws it.
//
// The frame (convert.js): TTS is left-handed, Y up, in "about an inch"; the
// format is the scene's, right-handed, Y up, metres. Positions mirror z;
// rotations become M·R·M; every look is built in the format's frame, with
// the object's TTS scale (non-uniform, the format's poses have none) baked
// into its sizes. A TTS object's origin is kept as its piece's origin, so a
// TTS position is the thing's position. An image's top in TTS reads from
// TTS's −Z, which is the format's +Z mirrored: every slab image here is
// turned 180° (GAME-FORMAT.md §4).
//
// What becomes what:
//   Card            a card: a slab, its cell of the face sheet on top, its back
//                   below; kept, wherever it is (shown as its back piece)
//   Deck            a deck listing its cards, top first, lying as TTS has it
//   Tile/Token/Board a slab with its images (a token cut out of its image)
//   Custom_Model    a model part: the OBJ through a matrix (scale, mirror, units)
//   Bag, Infinite_  a bag holding what TTS had in it (an infinite bag hands out
//   Bag             copies: rule "random-replace")
//   Die_N, Custom_  a die drawn as a die document (dice/ draws it),
//   Dice            with the trait that makes it a die; a custom d6's faces
//                   are cells of its image, each named by its RotationValues
//                   (customDieFaces below)
//   Figurine        a standee: its image stood up on a base
//   HandTrigger     a seat, and its hand: a tray with card slots, the seat's zone
//   SnapPoints      the pieces' snap points, and the table's
//   States          the piece's states, in TTS's order (its first the piece's
//                   own look), each named by its Nickname or "<piece> (state n)";
//                   a thing in another state says which (`state`). A card's
//                   and a deck's, and a state that isn't the same sort of
//                   thing (a die's that isn't a die), are left out (counted)
//   triggers, text, scripting: left out (counted)
//
// And a setup recipe (GAME-FORMAT.md §6) where the mod has what one says:
//   - how many play: a seat for each hand, the last ones left out for fewer
//     (TTS's colour order), as few as the mod's PlayerCounts says;
//   - a memory bag (a bag whose script state holds the saved place of each
//     thing in it, `{ ml }`): an option to lay its things out where it saved
//     them (`place`, out of the bag). Bags whose layouts overlap are one
//     choice (they lay out the same spot: Earthborne's ranger cards), others
//     each a yes or no. Its things get ids, `tts-<guid>`;
//   - face-down decks on the table: an option to shuffle them when the game
//     starts (a start step each), off unless chosen, since a mod's deck may
//     be in an order that matters (choice 15).
// Any other scripted setup (plain Lua) is left for later.

import { cardFaces } from "./cards.js";
import { combinationCount, layoutCost } from "../../contract/v2/recipe.js";
import { MAX_COMBINATIONS, MAX_LAYOUT_COST } from "../../contract/v2/validate.js";
import { applyMat3, colorHex, convertPosition, convertRotation, readTransform, ttsUp, unityRotation } from "./convert.js";
import { solid } from "../dice/solids.js";
import { deckEntry } from "./tts.js";

/** Sizes at TTS scale 1, in TTS units, read off real mods. */
export const CARD = { w: 2.2, l: 3.1, t: 0.02 };
export const BOARD_HALF = 9;
const STAND_IN = "#a0a0a8b0"; // see-through grey: a stand-in reads as one
const PAPER = "#f2f0ea";

/** Model MaterialIndex → PBR: 0 plastic, 1 wood, 2 metal, 3 cardboard, 4 glass. */
const MATERIALS = [
  { roughness: 0.45, metalness: 0 },
  { roughness: 0.75, metalness: 0 },
  { roughness: 0.35, metalness: 0.8 },
  { roughness: 0.9, metalness: 0 },
  { roughness: 0.1, metalness: 0 },
];

const r6 = (v) => +(+v).toFixed(6) + 0;
const v3 = (a) => a.map(r6);
const url = (v) => String(v ?? "").trim();
const isWeb = (u) => /^https?:\/\//i.test(u);
const scaleOf = (node) => {
  const t = node.transform ?? {};
  return [t.scaleX, t.scaleY, t.scaleZ].map((v) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? Math.abs(Number(v)) : 1));
};

/** A stable string for a value (sorted keys), for deduping pieces. */
export function keyOf(v) {
  const sort = (x) => (Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x);
  return JSON.stringify(sort(v));
}

/** A short hash of a string (FNV-1a, two 32-bit lanes): a piece's id. */
export function shortHash(s) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 15);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** Built-in pieces (no assets): a shape and a colour, by Name, in TTS units at scale 1. */
export function pieceLook(name) {
  const s = String(name ?? "");
  const colorWord = /white|light/i.test(s) ? "#eeeae0" : /black|dark/i.test(s) ? "#26262a" : /red/i.test(s) ? "#b8352c" : /brown/i.test(s) ? "#7a5232" : null;
  if (/^BlockRectangle/i.test(s)) return { shape: "box", size: [1.2, 0.6, 0.6], color: colorWord };
  if (/^Block(Square|Triangle)/i.test(s)) return { shape: "box", size: [0.6, 0.6, 0.6], color: colorWord };
  if (/^PlayerPawn/i.test(s)) return { shape: "pawn", height: 1.4, color: colorWord };
  if (/^Chess_/i.test(s)) return { shape: "pawn", height: /King|Queen/i.test(s) ? 2 : 1.5, color: colorWord };
  if (/^Chinese_Checkers_Piece/i.test(s)) return { shape: "pawn", height: 0.7, color: colorWord };
  if (/^(Checker_|go_game_piece|backgammon_piece|reversi_chip|Quarter)/i.test(s)) return { shape: "disc", radius: /go_game/i.test(s) ? 0.45 : 0.6, height: 0.2, color: colorWord };
  if (/^Bowl/i.test(s)) return { shape: "bowl", color: colorWord };
  return { shape: "box", size: [0.6, 0.6, 0.6], color: colorWord };
}

/**
 * @param {ReturnType<import("./tts.js").readSave>} save
 * @param {{ file?: (url: string) => string | null, unit?: number, flipObjX?: boolean, includeContents?: boolean, maxObjects?: number }} [o]
 */
export function translate(save, { file = (u) => (isWeb(u) ? u : null), unit = 0.0254, flipObjX = true, includeContents = true, maxObjects = 5000 } = {}) {
  const u = unit;
  const pieces = {};
  const counts = { things: 0, cards: 0, decks: 0, bags: 0, dice: 0, seats: 0, states: 0 };
  const skipped = {};
  const approximated = {};
  const warnings = [];
  let placed = 0;
  let truncated = 0;
  const skip = (node, why) => {
    const k = `${node.name || "?"}${why ? ` (${why})` : ""}`;
    skipped[k] = (skipped[k] ?? 0) + 1;
  };
  const approx = (node) => (approximated[node.name || "?"] = (approximated[node.name || "?"] ?? 0) + 1);

  /** A piece, deduped by everything it is: its id. */
  const usePiece = (piece) => {
    const id = `p${shortHash(keyOf({ ...piece, name: null }))}`;
    if (!pieces[id]) pieces[id] = piece;
    return id;
  };
  /** An image the format can name: { file, rect?, turn: 180 }, or undefined when the mod's asset isn't had. */
  const image = (u0, rect = null) => {
    const f = u0 ? file(u0) : null;
    if (!f) return undefined;
    const full = !rect || (rect.x === 0 && rect.y === 0 && rect.w === 1 && rect.h === 1);
    return { file: f, ...(full ? {} : { rect: [rect.x, rect.y, rect.w, rect.h].map(r6) }), turn: 180 };
  };
  /** A TTS snap point in an object's frame → the format's: baked into its piece's frame. */
  const snap = (s, S, xFactor = 1) => ({
    position: v3([s.position[0] * xFactor * S[0] * u, s.position[1] * S[1] * u, -s.position[2] * S[2] * u]),
    ...(s.rotation ? { rotation: convertRotation(s.rotation) } : {}),
    ...(s.tags?.length ? { tags: [...s.tags] } : {}),
  });
  const slab = ({ outline = "rect", w, d, t, y = 0, color = PAPER, side, top, bottom, aspect = false }) => ({
    shape: "slab",
    outline,
    size: v3([w, d]),
    thickness: r6(t),
    ...(aspect && top ? { aspect: "image" } : {}),
    ...(y ? { at: [0, r6(y), 0] } : {}),
    color,
    ...(side ? { side } : {}),
    ...(top ? { top } : {}),
    ...(bottom ? { bottom } : {}),
  });
  const common = (node) => ({ ...(node.locked ? { locked: true } : {}), ...(node.tags?.length ? { tags: [...node.tags] } : {}) });

  /** The back a deck's cards show when they're kept: its back image on both sides. */
  const backPiece = (faces, S) => {
    const back = image(faces.back.url, faces.back.rect);
    const t = CARD.t * S[1] * u;
    return usePiece({ name: "Card", parts: [slab({ w: CARD.w * S[0] * u, d: CARD.l * S[2] * u, t, y: -t / 2, top: back, bottom: back, color: "#8a8478" })], tags: ["card"] });
  };

  /** A card's piece (with its back), or a stand-in's when it has no deck entry. */
  const cardPiece = (node, deck) => {
    const S = scaleOf(deck ?? node);
    const faces = cardFaces(node.cardId, deckEntry(node, deck));
    const t = CARD.t * S[1] * u;
    if (!faces) {
      approx(node);
      return { id: usePiece({ name: node.nickname || "Card", parts: [{ shape: "box", size: v3([CARD.w * S[0] * u, t, CARD.l * S[2] * u]), at: [0, r6(-t / 2), 0], color: STAND_IN }] }), card: false };
    }
    const back = backPiece(faces, S);
    const face = image(faces.face.url, faces.face.rect);
    const behind = image(faces.back.url, faces.back.rect);
    return { id: usePiece({ name: node.nickname || "Card", parts: [slab({ w: CARD.w * S[0] * u, d: CARD.l * S[2] * u, t, y: -t / 2, top: face, bottom: behind })], back }), card: true };
  };

  /**
   * Any other drawn object's piece: { id, die?, bag? } or null when it isn't
   * drawn. `keep` makes the piece's id (by default deduped into the game's
   * pieces); a state's look is read with `keep` giving the piece itself.
   */
  const pieceOf = (node, keep = usePiece) => {
    const S = scaleOf(node);
    const color = colorHex(node.color);
    const im = node.image ?? {};
    switch (node.kind) {
      case "tile":
      case "token": {
        const spec = (node.kind === "tile" ? im.CustomTile : im.CustomToken) ?? {};
        const t = (Number(spec.Thickness) > 0 ? Number(spec.Thickness) : 0.2) * S[1] * u;
        const stretch = node.kind === "token" || spec.Stretch !== false;
        const outline = node.kind === "token" ? "cutout" : ["rect", "hex", "circle", "rounded"][Number(spec.Type) || 0] ?? "rect";
        const top = image(url(im.ImageURL));
        const bottom = image(url(im.ImageSecondaryURL)) ?? top;
        // a tile's origin is its bottom face (a tile on the table has posY = the table top); a token's its middle
        // stretched to its picture: as wide as the image says, measured when it's drawn
        const part = slab({ outline: outline === "cutout" && !top ? "rect" : outline, w: 2 * S[0] * u, d: 2 * S[2] * u, t, y: node.kind === "token" ? -t / 2 : 0, color: "#ffffff", side: color ?? "#ffffff", top, bottom, aspect: stretch });
        const snaps = node.snapPoints.map((s) => snap(s, S));
        return { id: keep({ name: node.nickname || (node.kind === "tile" ? "Tile" : "Token"), parts: [part], ...common(node), ...(snaps.length ? { snapPoints: snaps } : {}) }) };
      }
      case "board": {
        const ws = Number(im.WidthScale) > 0 ? Number(im.WidthScale) : 1;
        const t = 0.2 * S[1] * u;
        const top = image(url(im.ImageURL));
        const part = slab({ w: 2 * BOARD_HALF * ws * S[0] * u, d: 2 * BOARD_HALF * S[2] * u, t, y: -t / 2, color: color ?? "#ffffff", top, bottom: top });
        const snaps = node.snapPoints.map((s) => snap(s, S, ws));
        return { id: keep({ name: node.nickname || "Board", parts: [part], ...common(node), ...(snaps.length ? { snapPoints: snaps } : {}) }) };
      }
      case "figurine": {
        const front = image(url(im.ImageURL));
        const back = image(url(im.ImageSecondaryURL)) ?? front;
        const h = 2 * (Number(im.ImageScalar) > 0 ? Number(im.ImageScalar) : 1);
        const hw = h / 2; // a square picture's: the stand is as wide as its image says
        const base = 0.12;
        const r = Math.max(0.4, hw * 0.8);
        // the image stood up facing +z (the near seats), its top up: a slab turned a quarter about x, on a round base
        const stand = { ...slab({ w: 2 * hw * S[0] * u, d: h * S[1] * u, t: 0.03 * S[2] * u, color: PAPER, top: front && { ...front, turn: 0 }, bottom: back && { ...back, turn: 0 }, aspect: true }), at: v3([0, (base + h / 2) * S[1] * u, (-0.03 / 2) * S[2] * u]), rotation: [Math.PI / 2, 0, 0] };
        const foot = slab({ outline: "circle", w: 2 * r * S[0] * u, d: 2 * r * S[2] * u, t: base * S[1] * u, color: "#2b2b2b" });
        return { id: keep({ name: node.nickname || "Figurine", parts: [stand, foot], ...common(node) }) };
      }
      case "model":
      case "bag": {
        const m = node.mesh;
        const bag = node.kind === "bag" ? { rule: /Infinite/i.test(node.name) ? "random-replace" : "random" } : null;
        const meshUrl = m?.MeshURL ? file(url(m.MeshURL)) : null;
        let parts;
        if (meshUrl) {
          const mat = MATERIALS[Number(m.MaterialIndex) || 0] ?? MATERIALS[0];
          const tex = m.DiffuseURL ? file(url(m.DiffuseURL)) : null;
          parts = [{ shape: "model", file: meshUrl, ...(tex ? { texture: tex } : {}), color: color ?? "#ffffff", matrix: v3([(flipObjX ? -1 : 1) * S[0] * u, 0, 0, 0, S[1] * u, 0, 0, 0, -S[2] * u]), ...mat }];
        } else if (bag) {
          const k = ((S[0] + S[2]) / 2) * u;
          const profile = [[0, 0], [0.9, 0], [1.1, 0.5], [1, 1.2], [0.55, 1.6], [0.65, 1.8], [0, 1.8]].map(([pr, py]) => [r6(pr * k), r6(py * S[1] * u)]);
          parts = [{ shape: "lathe", profile, segments: 24, at: [0, r6(-0.9 * S[1] * u), 0], color: color ?? "#6b4a2e", roughness: 0.95 }];
          if (m?.MeshURL) approx(node);
        } else {
          approx(node);
          parts = [{ shape: "box", size: v3([S[0] * u, S[1] * u, S[2] * u]), at: [0, r6(-0.5 * S[1] * u), 0], color: STAND_IN }];
        }
        const snaps = node.snapPoints.map((s) => snap(s, S));
        return { id: keep({ name: node.nickname || (bag ? "Bag" : "Model"), parts, ...common(node), ...(snaps.length ? { snapPoints: snaps } : {}), ...(bag ? { bag } : {}) }), bag: !!bag };
      }
      case "die": {
        const custom = node.name === "Custom_Dice";
        const sides = custom ? [4, 6, 8, 10, 12, 20][Number(node.image?.CustomDice?.Type) || 0] ?? 6 : Number(/^Die_(\d+)/.exec(node.name)?.[1]) || 6;
        const size = r6(((S[0] + S[1] + S[2]) / 3) * u);
        // a custom d6's faces are cells of its image; any other custom die is numbered the usual way (a stand-in)
        const faces = custom ? customDieFaces(node, (cell) => image(url(im.ImageURL), cell)) : null;
        if (custom && im.ImageURL && !faces) approx(node);
        // drawn as a die document by whatever draws dice (dice/source.js); a die by its trait
        return { id: keep({ name: node.nickname || `d${sides}`, doc: { "@patchwork": { type: "die" }, shape: `d${sides}`, size, ...(color ? { body: color } : {}), ...(faces ? { faces } : {}) }, traits: { "dice.die": {} }, ...common(node) }), die: true, size };
      }
      case "piece": {
        const look = pieceLook(node.name);
        const c = look.color ?? color ?? "#d0c8b8";
        approx(node);
        let parts;
        const k = ((S[0] + S[2]) / 2) * u;
        if (look.shape === "pawn") {
          const h = look.height;
          const prof = [[0, 0], [0.32, 0], [0.3, 0.08], [0.14, 0.2], [0.1, 0.62], [0.2, 0.75], [0.17, 0.92], [0, 1]];
          parts = [{ shape: "lathe", profile: prof.map(([pr, py]) => [r6(pr * h * k), r6(py * h * S[1] * u)]), segments: 24, at: [0, r6((-h / 2) * S[1] * u), 0], color: c }];
        } else if (look.shape === "disc") parts = [slab({ outline: "circle", w: 2 * look.radius * S[0] * u, d: 2 * look.radius * S[2] * u, t: look.height * S[1] * u, y: (-look.height / 2) * S[1] * u, color: c })];
        else if (look.shape === "bowl") parts = [{ shape: "lathe", profile: [[0, 0], [1, 0], [1.6, 0.6], [1.5, 0.62], [0.9, 0.08], [0, 0.08]].map(([pr, py]) => [r6(pr * k), r6(py * S[1] * u)]), segments: 32, at: [0, r6(-0.3 * S[1] * u), 0], color: c }];
        else parts = [{ shape: "box", size: v3([look.size[0] * S[0] * u, look.size[1] * S[1] * u, look.size[2] * S[2] * u]), at: [0, r6((-look.size[1] / 2) * S[1] * u), 0], color: c }];
        return { id: keep({ name: node.nickname || node.name, parts, ...common(node) }) };
      }
      case "pdf": {
        const t = 0.04 * S[1] * u;
        return { id: keep({ name: node.nickname || "PDF", parts: [slab({ w: 2 * 1.105 * S[0] * u, d: 2 * 1.43 * S[2] * u, t, y: -t / 2, color: "#fbfaf6", side: "#d8d4c8" })], ...common(node) }) };
      }
      case "deck":
      case "zone":
      case "text":
        return null;
      default: {
        approx(node);
        const size = node.kind === "assetbundle" ? [1, 1, 1] : [0.6, 0.6, 0.6];
        return { id: keep({ name: node.nickname || node.name || "Object", parts: [{ shape: "box", size: v3([size[0] * S[0] * u, size[1] * S[1] * u, size[2] * S[2] * u]), at: [0, r6((-size[1] / 2) * S[1] * u), 0], color: STAND_IN }], ...common(node) }) };
      }
    }
  };

  // ── where the table top is, and how big the table is ──
  const tableY = tableHeight(save.objects);
  const ext = extentOf(save.objects);
  const at = (node) => {
    const t = readTransform(node.transform);
    return { position: convertPosition(t.position, { unit: u, tableY }), rotation: convertRotation(t.rotation) };
  };
  const pose = (p) => ({ position: v3(p.position), ...(p.rotation.some((x) => x !== 0) ? { rotation: p.rotation } : {}) });
  const more = () => {
    if (placed >= maxObjects) {
      truncated++;
      return false;
    }
    placed++;
    return true;
  };

  /** A deck → a deck thing: its cards top first, lying as TTS has it (a face-down deck: level and turned over). */
  const deckThing = (node, located) => {
    const cards = node.contents.filter((c) => c.kind === "card");
    const list = cards.length ? cards : (node.deckIds ?? []).map((cardId) => ({ ...node, kind: "card", name: "Card", nickname: "", cardId, contents: [] }));
    for (const c of node.contents) if (c.kind !== "card") skip(c, "in a deck");
    if (!list.length) return void skip(node, "empty");
    const kinds = [];
    for (const c of list) {
      if (!more()) break;
      for (const st of c.states ?? []) skip(st, "another state of a card");
      const p = cardPiece(c, node);
      if (!p.card) {
        skip(c, "a card without a CustomDeck entry");
        continue;
      }
      kinds.push(p.id);
    }
    if (!kinds.length) return;
    counts.decks++;
    counts.cards += kinds.length;
    const deck = { name: node.nickname || "Deck", cards: kinds };
    if (!located) return { deck };
    const t = readTransform(node.transform);
    const down = ttsUp(t.rotation)[1] < 0;
    // the stack is centred where TTS has the deck, made bottom up from its foot
    const h = CARD.t * scaleOf(node)[1] * u;
    const p = at(node);
    const rotation = down ? convertRotation(flipped(t.rotation)) : p.rotation;
    const foot = [p.position[0], p.position[1] - (kinds.length * h) / 2, p.position[2]];
    // a face-down deck is named, for a start step that shuffles it (recipeOf)
    return { ...(down ? { id: idFor(node) } : {}), deck: { ...deck, ...(down ? { faceDown: true } : {}) }, at: pose({ position: foot, rotation }) };
  };

  /**
   * An object with States → its piece, with every state's look in TTS's
   * order (the one with the lowest id is the piece's own; the object itself
   * is the state whose id States leaves out), and which one it shows:
   * { id, die?, bag?, size?, state? }. A state that isn't drawn, or isn't
   * the same sort of thing (a die, a bag), is left out.
   */
  const statedPiece = (node) => {
    const ids = node.states.map((st) => Number(st.stateId)).filter((n) => Number.isInteger(n) && n > 0);
    let own = 1;
    while (ids.includes(own)) own++;
    const own0 = pieceOf(node, (piece) => piece);
    if (!own0) return null;
    const looks = [{ id: own, node, look: own0 }];
    for (const st of node.states) {
      const n = Number(st.stateId);
      const look = Number.isInteger(n) && n > 0 && st.kind !== "card" && st.kind !== "deck" ? pieceOf(st, (piece) => piece) : null;
      if (!look || !!look.die !== !!own0.die || !!look.bag !== !!own0.bag) skip(st, "another state, not drawn as one");
      else looks.push({ id: n, node: st, look });
    }
    looks.sort((a, b) => a.id - b.id);
    const [first, ...rest] = looks;
    const base = first.look.id;
    // each look named by its Nickname where that's its own, else "<the piece> (state n)"
    const nicks = looks.map((l) => l.node.nickname);
    const name = base.name;
    const named = looks.map((l, k) => (k === 0 ? name : l.node.nickname && l.node.nickname !== name && nicks.filter((x) => x === l.node.nickname).length === 1 ? l.node.nickname : `${name} (state ${l.id})`));
    const lookOf = (piece) => ({ ...(piece.parts ? { parts: piece.parts } : {}), ...(piece.doc ? { doc: piece.doc } : {}), ...(piece.snapPoints && keyOf(piece.snapPoints) !== keyOf(base.snapPoints ?? null) ? { snapPoints: piece.snapPoints } : {}) });
    const states = rest.map((l, k) => ({ name: named[k + 1], ...lookOf(l.look.id) }));
    if (!states.length) return { ...own0, id: usePiece(base) };
    counts.states += states.length;
    const shown = looks.findIndex((l) => l.node === node);
    return { ...own0, id: usePiece({ ...base, states }), ...(shown > 0 ? { state: named[shown] } : {}) };
  };

  /** A node → its things (a stack is one thing of several copies; a bag holds its contents). */
  const thingsOf = (node, located = true) => {
    // a card's look is its keeper's, a deck's its cards': neither has states here
    for (const st of node.kind === "card" || node.kind === "deck" ? node.states : []) skip(st, `another state of a ${node.kind}`);
    if (node.kind === "deck") {
      const d = deckThing(node, located);
      return d ? [d] : [];
    }
    if (node.kind === "card") {
      if (!more()) return [];
      const p = cardPiece(node, null);
      if (p.card) counts.cards++;
      return [{ piece: p.id, ...(located ? { at: pose(at(node)) } : {}) }];
    }
    // a HandTrigger is a seat, and its hand (below); every other zone is left out
    if (node.kind === "zone") {
      if (!(node.name === "HandTrigger" && node.handColor)) skip(node);
      return [];
    }
    if (node.kind === "text") {
      skip(node);
      return [];
    }
    const p = node.states.length ? statedPiece(node) : pieceOf(node);
    if (!p) {
      skip(node, "not drawn");
      return [];
    }
    const n = node.number > 1 && /_Stack$/.test(node.name) ? node.number : 1;
    const out = [];
    let count = 0;
    for (let i = 0; i < n && more(); i++) count++;
    if (!count) return out;
    const thing = { piece: p.id, ...(p.state ? { state: p.state } : {}) };
    if (located) {
      const q = at(node);
      // a die document stands on its foot; TTS has a die by its middle
      if (p.die) q.position = [q.position[0], q.position[1] - p.size / 2, q.position[2]];
      thing.at = pose(q);
    }
    if (count > 1) {
      const S = scaleOf(node);
      const spec = node.image?.CustomTile ?? node.image?.CustomToken;
      const step = (node.kind === "tile" || node.kind === "token" ? Number(spec?.Thickness) || 0.2 : 0.5) * S[1] * u;
      Object.assign(thing, { count, grid: { cols: 1, across: [0, 0, 0], down: [0, r6(step), 0] } });
    }
    if (p.die) counts.dice += count;
    if (p.bag) {
      counts.bags++;
      if (includeContents && node.contents.length) thing.contents = node.memory ? memoryContents(node) : node.contents.flatMap((c) => thingsOf(c, false));
    }
    counts.things++;
    out.push(thing);
    for (const c of node.children) out.push(...thingsOf(c, true));
    return out;
  };

  /**
   * A memory bag's contents: each thing it saved a place for gets an id, and
   * its place (worked out as for a thing lying there: a deck's foot, a die's)
   * is kept for the recipe; the rest are as any bag's.
   */
  const memories = []; // { guid, name, place: { [thingId]: Pose } }
  const ids = new Set();
  /** A thing's id, from its object's GUID (`tts-<guid>`), its own even where a mod repeats a GUID. */
  function idFor(node) {
    const base = `tts-${node.guid || node.path}`.replace(/[^A-Za-z0-9._-]/g, "-");
    let id = base;
    for (let k = 2; ids.has(id); k++) id = `${base}-${k}`;
    ids.add(id);
    return id;
  }
  function memoryContents(node) {
    const place = {};
    const out = [];
    const seen = new Set(); // a GUID the bag holds twice: the first is laid where it's saved, the rest stay in the bag
    for (const c of node.contents) {
      const saved = c.guid && !seen.has(c.guid) ? node.memory[c.guid] : null;
      if (saved) seen.add(c.guid);
      if (!saved) {
        out.push(...thingsOf(c, false));
        continue;
      }
      const [x, y, z] = saved.position;
      const [rx, ry, rz] = saved.rotation;
      const [first, ...rest] = thingsOf({ ...c, transform: { ...c.transform, posX: x, posY: y, posZ: z, rotX: rx, rotY: ry, rotZ: rz } }, true);
      if (!first) continue;
      const { at, id: named, ...inBag } = first;
      const id = named ?? idFor(c);
      out.push({ id, ...inBag });
      // resting on the table, never under it: a bag saves where things lay on the table it was used at, which may
      // be lower than the one this game's things say (tableHeight); a deck's place is its foot, anything else's its origin
      const bottom = at.position[1] - (c.kind === "deck" ? 0 : (footOf(c) ?? 0) * u);
      place[id] = bottom < 0 ? { ...at, position: [at.position[0], r6(at.position[1] - bottom), at.position[2]] } : at;
      out.push(...rest.map(({ at: _, ...t }) => t));
    }
    if (Object.keys(place).length) memories.push({ guid: node.guid, name: node.nickname || "Memory bag", place });
    return out;
  }

  const setup = [];
  // the table under it all: the mod's table image on top, its free snap points
  const table = usePiece({
    name: "Table",
    parts: [slab({ w: 2 * ext.hx * u, d: 2 * ext.hz * u, t: 0.5 * u, y: -0.5 * u, color: "#4d6b56", side: "#5a4535", top: image(url(save.tableURL)) })],
    locked: true,
    ...(save.snapPoints?.length ? { snapPoints: save.snapPoints.map((s) => snap({ ...s, position: [s.position[0] - ext.cx, 0, s.position[2] - ext.cz] }, [1, 1, 1])) } : {}),
  });
  setup.push({ piece: table, at: pose({ position: convertPosition([ext.cx, tableY, ext.cz], { unit: u, tableY }), rotation: [0, 0, 0] }) });
  for (const node of save.objects) setup.push(...thingsOf(node, true));

  // seats from the hands: each a hand tray where the hand is, its box the hand's, +Z toward its player
  const seats = {};
  for (const node of handsOf(save.objects)) {
    const sid = String(node.handColor).toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    if (!sid || seats[sid]) continue;
    const t = readTransform(node.transform);
    const p = convertPosition(t.position, { unit: u, tableY });
    const c = convertPosition([ext.cx, tableY, ext.cz], { unit: u, tableY });
    const out = [p[0] - c[0], p[2] - c[2]];
    const len = Math.hypot(...out) || 1;
    const yaw = Math.atan2(out[0] / len, out[1] / len);
    const w = Math.max(t.scale[0], t.scale[2]) * u;
    const d = Math.min(t.scale[0], t.scale[2]) * u;
    const hgt = Math.max(0.05, t.scale[1] * u);
    const slots = Math.max(1, Math.min(20, Math.floor(w / (CARD.w * u * 1.05))));
    const pitch = w / slots;
    const color = colorHex(hexOf(node.handColor)) ?? "#3a4a3a";
    const hand = usePiece({
      name: `${node.handColor} hand`,
      parts: [{ shape: "box", size: v3([w, 0.002, d]), color: shade(color) }],
      locked: true,
      zone: { min: v3([-w / 2, 0, -d / 2]), max: v3([w / 2, hgt, d / 2]) },
      snapPoints: Array.from({ length: slots }, (_, k) => ({ position: v3([-w / 2 + pitch * (k + 0.5), 0.002, 0]), rotation: [0, 0, 0], tags: ["card"] })),
      // each slot reaches halfway to the next: a card drawn or set down lands in the one it's over
      snapRadius: r6(pitch / 2),
    });
    setup.push({ id: `hand-${sid}`, piece: hand, name: `${node.handColor}'s hand`, seat: sid, at: pose({ position: [p[0], 0, p[2]], rotation: [0, yaw, 0] }) });
    // the seat's view: from behind and above its hand, down over it to the table beyond, so the
    // hand lies whole in the lower part of the picture (the stage's 45° field of view) and the
    // table's middle above it
    const eye = [p[0] + (out[0] / len) * 14 * u, 26 * u, p[2] + (out[1] / len) * 14 * u];
    const target = [p[0] - (out[0] / len) * 10 * u, 0, p[2] - (out[1] / len) * 10 * u];
    seats[sid] = { name: node.handColor, camera: { position: v3(eye), target: v3(target) } };
    counts.seats++;
  }
  if (truncated) warnings.push(`stopped at ${maxObjects} objects: ${truncated} more were left out`);

  const recipe = recipeOf({ seats, setup, memories, playerCounts: save.playerCounts, unit: u, warnings });
  const span = Math.max(ext.hx, ext.hz) * u;
  const centre = convertPosition([ext.cx, tableY, ext.cz], { unit: u, tableY });
  const about = [`Imported from Tabletop Simulator: “${save.saveName}”. Its components as they start, and nothing scripted: the rules are the players'.`, save.rules, save.note].filter((x) => typeof x === "string" && x.trim()).join("\n\n");
  const game = {
    format: "tabletop-game",
    version: 2,
    title: save.saveName,
    about,
    pieces,
    setup,
    ...(Object.keys(seats).length ? { seats } : {}),
    camera: { position: v3([centre[0], span * 1.1, centre[2] + span]), target: v3(centre) },
    ...(recipe ? { recipe } : {}),
  };
  return { game, counts: { ...counts, pieces: Object.keys(pieces).length, placed, tableY }, skipped, approximated, warnings };
}

/** TTS's player colours, in its own order: the order seats are kept in as fewer play. */
const COLOURS = ["white", "brown", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "grey", "black"];

/**
 * The setup recipe a mod's data says (above): how many play, its memory
 * bags' layouts, shuffling its face-down decks at the start. null when it
 * says none. Options are added while every way of setting them can still be
 * checked (MAX_COMBINATIONS); a memory bag past that stays a bag (warned).
 */
function recipeOf({ seats, setup, memories, playerCounts, unit, warnings }) {
  const options = [];
  const layout = [];
  const start = [];
  /** Can every way of setting these options, with these steps, still be checked (the validator's bounds)? */
  const fits = (extra, more = {}) => {
    const g = { setup, seats, recipe: { options: [...options, ...extra], layout: [...layout, ...(more.layout ?? [])], start: [...start, ...(more.start ?? [])] } };
    const n = combinationCount(g);
    return n <= MAX_COMBINATIONS && n * layoutCost(g) <= MAX_LAYOUT_COST;
  };
  // how many play: the seats in TTS's colour order, the last ones left out for fewer
  const order = Object.keys(seats).sort((a, b) => (COLOURS.indexOf(a) + 1 || 99) - (COLOURS.indexOf(b) + 1 || 99) || (a < b ? -1 : 1));
  if (order.length > 1) {
    const min = Math.max(1, Math.min(order.length, playerCounts?.[0] ?? 1));
    const players = { key: "players", label: "Players", kind: "integer", min, max: order.length, default: order.length };
    const removes = [];
    for (let k = order.length; k > min; k--) removes.push({ remove: { seat: order[k - 1] }, unless: `players >= ${k}` });
    if (fits([players], { layout: removes })) options.push(players), layout.push(...removes);
    else warnings.push("every seat kept, whoever plays: too much to check for each count");
  }
  // memory bags: those laying out the same spot (any two places within a card's width) are one choice
  const near = (a, b) => Object.values(a.place).some((p) => Object.values(b.place).some((q) => Math.hypot(p.position[0] - q.position[0], p.position[2] - q.position[2]) < CARD.w * unit));
  const groups = [];
  for (const m of memories) {
    const hit = groups.filter((g) => g.some((x) => near(x, m)));
    const merged = [m, ...hit.flat()];
    for (const g of hit) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  // a bag's value in a choice: its GUID, made a word and its own (a bag may have none, or share one)
  const used = new Set(["none"]);
  const valueOf = (m) => {
    const base = String(m.guid ?? "").replace(/[^A-Za-z0-9_-]/g, "") || "bag";
    let v = base;
    for (let k = 2; used.has(v); k++) v = `${base}-${k}`;
    used.add(v);
    return v;
  };
  let n = 0;
  for (const group of groups.map((g) => [...g].sort((a, b) => memories.indexOf(a) - memories.indexOf(b)))) {
    const key = `layout${n ? n + 1 : ""}`;
    const values = group.map(valueOf);
    const option =
      group.length === 1
        ? { key, label: `Lay out “${group[0].name}”`, kind: "boolean", default: false }
        : { key, label: "Lay out", kind: "enum", options: [{ value: "none", label: "Nothing" }, ...group.map((m, i) => ({ value: values[i], label: m.name }))], default: "none" };
    const steps = group.map((m, i) => ({ place: m.place, when: group.length === 1 ? key : `${key} == ${values[i]}` }));
    if (!fits([option], { layout: steps })) {
      warnings.push(`${group.length === 1 ? `the memory bag “${group[0].name}”` : `${group.length} memory bags`} left as bags: too many ways to set the game up already`);
      continue;
    }
    n++;
    options.push(option);
    layout.push(...steps);
  }
  // face-down decks on the table: shuffled when the game starts, if chosen
  const down = setup.filter((t) => t.deck?.faceDown && t.id != null);
  const shuffle = { key: "shuffle", label: "Shuffle the face-down decks when the game starts", kind: "boolean", default: false };
  const shuffles = down.map((t) => ({ shuffle: t.id, when: "shuffle" }));
  if (down.length && fits([shuffle], { start: shuffles })) options.push(shuffle), start.push(...shuffles);
  if (!options.length) return null;
  return { options, ...(layout.length ? { layout } : {}), ...(start.length ? { start } : {}) };
}

// ── a custom d6: its image is six cells, the k-th the side TTS turns up by its k-th default RotationValue ──

/** TTS's default RotationValues for a d6 (values 1 to 6): each the turn that puts its side up. */
export const D6_ROTATIONS = Object.freeze([[-90, 0, 0], [0, 0, 0], [0, 0, -90], [0, 0, 90], [0, 0, -180], [90, 0, 0]]);
/**
 * Where the k-th side's picture is on a custom d6's image (fractions, top
 * left): TTS's own d6 template (the one it ships, Modding/Dice Templates/
 * D6.png) is a square in thirds, the top row unused, its sides 2 4 5 across
 * the middle row and 1 3 6 across the bottom, each numbered as its default
 * RotationValue (1 and 6 drawn upside down there: which way up a picture
 * lies on its side is our die's, not TTS's).
 */
const D6_CELLS = [[0, 2], [0, 1], [1, 2], [1, 1], [2, 1], [2, 2]];
const d6Cell = (k) => ({ x: D6_CELLS[k][0] / 3, y: D6_CELLS[k][1] / 3, w: 1 / 3, h: 1 / 3 });
/** The side up when TTS turns a die by these Euler degrees, in the die's own frame as the format has it (z mirrored). */
export function sideUp(degrees) {
  const m = unityRotation(degrees.map(Number));
  // Rᵀ · (0, 1, 0): the local direction R turns to world up
  return [m[1][0], m[1][1], -m[1][2]];
}
const nearest = (dirs, v) => dirs.reduce((best, d, k) => (d[0] * v[0] + d[1] * v[1] + d[2] * v[2] > best.dot ? { k, dot: d[0] * v[0] + d[1] * v[1] + d[2] * v[2] } : best), { k: -1, dot: 0.9 }).k;

/**
 * A custom d6's faces, in the order the dice package's d6 has its outcomes:
 * each the cell of the die's image on the side its RotationValue turns up,
 * named by that value (as it reads when rolled), its value as a text mark
 * where the image can't be had. `imageOf(cell)` names the image's cell
 * ({ file, rect? }), or nothing when the mod's image isn't had. null for any
 * other custom die, or RotationValues that don't put each value on a side
 * of its own.
 */
export function customDieFaces(node, imageOf) {
  if (([4, 6, 8, 10, 12, 20][Number(node.image?.CustomDice?.Type) || 0] ?? 6) !== 6) return null;
  const rv = (node.rotationValues ?? []).filter((v) => v && typeof v.Rotation === "object");
  const values = (rv.length === 6 ? rv.map((v) => ({ value: String(v.Value ?? "").trim(), up: sideUp([v.Rotation.x ?? 0, v.Rotation.y ?? 0, v.Rotation.z ?? 0]) })) : D6_ROTATIONS.map((r, k) => ({ value: String(k + 1), up: sideUp(r) })));
  const cells = D6_ROTATIONS.map(sideUp);
  const outcomes = solid("d6").outcomes.map((o) => o.up);
  const faces = new Array(6).fill(null);
  for (const v of values) {
    const cell = nearest(cells, v.up);
    const i = nearest(outcomes, v.up);
    if (cell < 0 || i < 0 || faces[i]) return null;
    const im = imageOf(d6Cell(cell));
    faces[i] = { marks: v.value ? [{ kind: "text", value: v.value.slice(0, 6) }] : [], ...(v.value ? { name: v.value.slice(0, 24) } : {}), ...(im?.file ? { image: { file: im.file, ...(im.rect ? { rect: im.rect } : {}) } } : {}) };
  }
  return faces;
}

/** A rotation that's another turned over about its own length (z): R · Rz(180°), as TTS degrees. */
function flipped([x, y, z]) {
  return [x, y, z + 180];
}

/** Every HandTrigger, top level and inside things. */
function handsOf(nodes, out = []) {
  for (const n of nodes) {
    if (n.kind === "zone" && n.name === "HandTrigger" && n.handColor) out.push(n);
    handsOf(n.children, out);
  }
  return out;
}

/** A TTS colour name → a colour TTS draws it in. */
const NAMED = { white: "#ffffff", brown: "#713b17", red: "#da1918", orange: "#f4641d", yellow: "#e7e52c", green: "#31b32b", teal: "#21b19b", blue: "#1f87ff", purple: "#a020f0", pink: "#f570ce", grey: "#7f7f7f", black: "#3f3f3f" };
const hexOf = (name) => {
  const h = NAMED[String(name).toLowerCase()];
  return h ? { r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 } : null;
};
/** A colour, darkened for a tray. */
const shade = (hex) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.55).toString(16).padStart(2, "0")).join("")}`;

/** How far below its origin each flat kind's bottom is, at scale 1 (TTS units), for finding the table top; null for anything else. */
function footOf(node) {
  const sy = scaleOf(node)[1];
  switch (node.kind) {
    case "card":
      return (CARD.t / 2) * sy;
    case "deck":
      return ((Math.max(1, node.contents.length || node.deckIds?.length || 1) * CARD.t) / 2) * sy;
    case "tile":
      return 0;
    case "token":
      return ((Number(node.image?.CustomToken?.Thickness) || 0.2) / 2) * sy;
    case "board":
      return 0.1 * sy;
    default:
      return null;
  }
}

/**
 * Where the table top is in TTS y: the commonest resting height of the
 * top-level flat things lying level (their foot), else 0.96 (TTS's usual
 * tables). Ignores things stored far below or above.
 */
export function tableHeight(nodes) {
  const bins = new Map();
  for (const node of nodes) {
    const foot = footOf(node);
    if (foot == null) continue;
    const t = readTransform(node.transform);
    if (Math.abs(applyMat3(unityRotation(t.rotation), [0, 1, 0])[1]) < 0.99) continue;
    const bottom = t.position[1] - foot;
    if (bottom < -2 || bottom > 10) continue;
    const k = Math.round(bottom / 0.05);
    const bin = bins.get(k) ?? { n: 0, min: Infinity };
    bin.n++;
    bin.min = Math.min(bin.min, bottom);
    bins.set(k, bin);
  }
  let best = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  return best ? +best.min.toFixed(4) : 0.96;
}

const percentile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/** The table's extent in TTS x/z: where most top-level things are, plus a margin. */
export function extentOf(nodes) {
  const xs = [];
  const zs = [];
  for (const node of nodes) {
    if (node.kind === "zone" || node.kind === "text") continue;
    const t = readTransform(node.transform);
    xs.push(t.position[0]);
    zs.push(t.position[2]);
  }
  if (!xs.length) return { cx: 0, cz: 0, hx: 20, hz: 15 };
  const x0 = percentile(xs, 0.03), x1 = percentile(xs, 0.97), z0 = percentile(zs, 0.03), z1 = percentile(zs, 0.97);
  const r3 = (v) => +v.toFixed(3);
  return { cx: r3((x0 + x1) / 2), cz: r3((z0 + z1) / 2), hx: r3(Math.max(10, (x1 - x0) / 2 + 6)), hz: r3(Math.max(8, (z1 - z0) / 2 + 6)) };
}
