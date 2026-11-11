// The tabletop's parts (scene:part, scene/STAGE.md "Parts"), for the editor's
// parts bin, under "Tabletop": a pawn, a token and a card spot. Each is one
// object showing the scene's one GLB doc for its kind (ctx.file, under
// "tabletop/<kind>@1": ten pawns share one file), drawn from the same piece
// vocabulary the games use (shapes.js, pieces.js).
//
// - A card spot is a small mat with one card slot: a connector tagged "card"
//   (the one tag every card and card slot shares, slots.js), with a snap
//   radius, so a card carried over it or a deck dropped on it squares onto
//   it. Untagged pieces (a pawn) don't snap there.
//
// A part goes where the bin says, under what it was dropped on (filed in
// that one's group), and isn't locked: it's placed by hand, so the gizmo may
// move it. If what it was dropped on went while its file was made (a peer
// deleted it), it puts nothing. The pieces never make or change seats: a
// table's seats are the template's, the game page's, a game's part's or the
// inspector's.
//
// Two more set a table up anywhere, a ship's cockpit say:
// - the Card table: a table to play at, 0.76 × 1.20 m on a pedestal, its top
//   0.70 m up, origin at its foot. Locked (a table isn't carried about in
//   play), with one connector at the middle of its top that takes a game.
// - Lost Cities: the whole game's table (template.js layOutTable), set down
//   on what it was dropped on, every piece under that in its frame and each
//   seat's view in it too (`camera.in`), so it all rides along. A game is
//   the one part that brings seats, and only to a scene that has none (a
//   table's seats are made once).
// Either one put on something squares itself to it: upright in its frame,
// turned only about its +Y, wherever it was put (on a heeling deck it stands
// square to the deck, not plumb).

import { glbFile } from "./files.js";
import { composeMatrix } from "./frame.js";
import { layOutTable } from "./template.js";
import * as lostCitiesGame from "../games/lost-cities.js";

// ─── what each is drawn as ──────────────────────────────────────────────────

/** A pawn's turned outline: a foot, a waist and a round head ([r, y], m). */
function pawnProfile() {
  const profile = [[0, 0], [0.011, 0], [0.011, 0.003], [0.0085, 0.005], [0.0055, 0.019], [0.008, 0.0205], [0.008, 0.022]];
  // the head: a ball sitting on the collar, from its neck round to the top
  const c = 0.0275;
  const r = 0.0055;
  const a0 = -Math.acos(0.0035 / r);
  for (let i = 0; i <= 10; i++) {
    const a = a0 + ((Math.PI / 2 - a0) * i) / 10;
    profile.push([+Math.max(0, r * Math.cos(a)).toFixed(5), +(c + r * Math.sin(a)).toFixed(5)]);
  }
  return profile;
}

/** The Card table's size (m): its top, and how high that is. */
export const TABLE = Object.freeze({ w: 0.76, l: 1.2, h: 0.7, t: 0.03 });
/** The tag a game's table fits: the Card table's top takes it. */
export const GAME_TAG = "tabletop.game";

/** A card spot's size: a little more than a card (lost-cities.js CARD). */
const SPOT = { w: 0.066, l: 0.097, t: 0.0015 };

/**
 * What each part is drawn as, in the games' piece vocabulary (pieces.js):
 * parts, and a card spot's one snap point.
 */
export const PIECES = Object.freeze({
  pawn: { name: "Pawn", parts: [{ shape: "lathe", profile: pawnProfile(), segments: 32, color: "#c0392b" }] },
  token: {
    name: "Token",
    parts: [
      { shape: "lathe", profile: [[0, 0], [0.013, 0], [0.013, 0.004], [0, 0.004]], segments: 40, color: "#c9a24a" },
      { shape: "lathe", profile: [[0.008, 0.004], [0.0095, 0.004], [0.0095, 0.0042], [0.008, 0.0042], [0.008, 0.004]], segments: 40, color: "#8a6a24" },
    ],
  },
  "card-spot": {
    name: "Card spot",
    parts: [
      { shape: "box", size: [SPOT.w, SPOT.t, SPOT.l], color: "#2f4a3a", name: "mat" },
      { shape: "box", size: [SPOT.w - 0.006, 0.0002, SPOT.l - 0.006], at: [0, SPOT.t, 0], color: "#3d6150", name: "inset" },
    ],
    // one slot for cards only: a card lies on it squared to the mat
    snapPoints: [{ position: [0, SPOT.t + 0.0002, 0], yaw: 0, tags: ["card"] }],
    snapRadius: 0.04,
  },
  table: tableDrawing(),
});

/** A table to play at: a top on a turned pedestal and a round foot, origin on the floor under its middle. */
function tableDrawing() {
  const { w, l, h, t } = TABLE;
  const wood = "#6d4a2f";
  const dark = "#4a3020";
  return {
    name: "Card table",
    parts: [
      { shape: "lathe", profile: [[0, 0], [0.26, 0], [0.26, 0.015], [0.2, 0.04], [0, 0.04]], segments: 40, color: dark, name: "foot" },
      { shape: "lathe", profile: [[0, 0.04], [0.06, 0.04], [0.045, 0.1], [0.04, h - t - 0.06], [0.07, h - t - 0.01], [0.07, h - t], [0, h - t]], segments: 32, color: wood, name: "pedestal" },
      { shape: "box", size: [w, t, l], at: [0, h - t, 0], color: wood, name: "top" },
      { shape: "box", size: [w - 0.04, 0.0006, l - 0.04], at: [0, h, 0], color: "#2f5a45", name: "baize" },
    ],
    // where a game's table goes: the middle of the top, square to it
    snapPoints: [{ position: [0, h + 0.0006, 0], yaw: 0, tags: [GAME_TAG] }],
    snapRadius: 0.6,
  };
}

/** Parts written locked: the gizmo and the hand leave them where they are. */
const LOCKED = new Set(["table"]);

// ─── files ──────────────────────────────────────────────────────────────────

/** The scene's assets key for a part's GLB. Bump its version when its drawing changes. (A game's: template.js gameFileKey.) */
export const partKey = (kind) => `tabletop/${kind}@1`;

/** A part's GLB, as ctx.file's make() wants it (files.js). */
export const makeFile = (kind) => glbFile(PIECES[kind]);

// ─── the parts ──────────────────────────────────────────────────────────────

const IDENTITY = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

/** A scene object for a part: a passthrough GLB, not locked. */
export function partObject(kind, { url, hint }, { transform = IDENTITY, parent = null, group = null } = {}) {
  const t = { ...IDENTITY, ...transform };
  return {
    name: PIECES[kind].name,
    sourceUrl: url,
    providerId: "file-glb",
    renderUrl: null,
    parent,
    group,
    visible: true,
    color: null,
    opacity: 1,
    wireframe: false,
    locked: LOCKED.has(kind),
    transform: { position: [...t.position].map(Number), rotation: [...t.rotation].map(Number), scale: Number(t.scale) || 1 },
    ...(hint?.bounds ? { hint: { bounds: { min: [...hint.bounds.min], max: [...hint.bounds.max] } } } : {}),
  };
}

/**
 * The part that puts one piece of `kind` where the bin says, and returns its
 * id: its file first, then one change (in which it checks that what it was
 * put on is still there).
 */
export function part(kind, { square = false } = {}) {
  return {
    async create(ctx, at) {
      const file = await ctx.file(partKey(kind), () => makeFile(kind));
      const id = ctx.newId("o");
      const parent = at?.parent ?? null;
      const transform = square && parent ? squared(at?.transform) : (at?.transform ?? IDENTITY);
      let put = false;
      ctx.change((d) => {
        if (parent && !d.objects?.[parent]) return;
        // under what it was put on, in that one's group (as addObject files it)
        const group = parent ? (d.objects[parent].group ?? null) : null;
        d.objects[id] = partObject(kind, file, { transform, parent, group });
        d.order.push(id);
        put = true;
      });
      if (!put) ctx.notify?.("What that was put on has gone.");
      return put ? id : null;
    },
  };
}

/**
 * A transform in a parent's frame, made upright in it: the same place and
 * scale, turned only about the parent's +Y (the way it faced, seen from above).
 */
export function squared(t) {
  const m = composeMatrix(t ?? IDENTITY);
  const yaw = Math.atan2(m[8], m[10]);
  return {
    position: [...(t?.position ?? [0, 0, 0])].map((v) => +Number(v).toFixed(6)),
    rotation: [0, Math.abs(yaw) < 1e-9 ? 0 : +yaw.toFixed(6), 0],
    scale: Number(t?.scale) || 1,
  };
}

/**
 * A game's whole table as a part: laid out (template.js layOutTable) where
 * it was put, under what it was put on, squared to it. Its seats only where
 * the scene has none; the scene's view, title and home are left alone. The
 * board is what's selected.
 */
export function gamePart(gameId, game) {
  return {
    async create(ctx, at) {
      const parent = at?.parent ?? null;
      const transform = parent ? squared(at?.transform) : (at?.transform ?? null);
      const layout = await layOutTable(ctx, gameId, game, { parent, transform, view: false });
      if (!layout) return null;
      return layout.order.find((oid) => layout.objects[oid]?.kind !== "group" && layout.objects[oid]?.locked) ?? null;
    },
  };
}

export const pawn = part("pawn");
export const token = part("token");
export const cardSpot = part("card-spot");
export const cardTable = part("table", { square: true });
export const lostCities = gamePart("lost-cities", lostCitiesGame);
