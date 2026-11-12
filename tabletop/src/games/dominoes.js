// Draw Dominoes, a white-label table for the traditional double-six game
// (2–4 players): the 28 tiles of a double-six set, face down on the table
// (the boneyard), a place for each player where their tiles stand on edge
// facing them, and a felt to play on whose edge the line bends at. Only the
// components and where they start; nothing deals, scores or checks a move.
//
// The art is drawn here, from boxes, tapered boxes and discs: an ivory tile
// 50 × 25 × 9.5 mm with a bevel top and bottom, a centre bar with a brass
// spinner, black pips on a 3 × 3 grid in each half (the usual layouts, the
// same as a die's spots), and a plain back. A tile's face is its +Y; its
// length runs along Z, as a card's does, so F turns it over end to end.
//
// How many seats is a setup choice (`dominoes(players)`): a table whose
// tiles its players shuffle between them (a joint keeper) needs every seat
// taken before the first shuffle, so a table is laid for exactly the players
// at it. How many tiles each draws (7, or 6 with four players) is theirs: the
// table deals nothing.

/** A tile's size (m): across (x), along (z, the long way), thick (y). */
export const TILE = Object.freeze({ w: 0.025, l: 0.05, t: 0.0095 });
const BEVEL = 0.0011; // how far the top and bottom edges are taken off
const INK = "#18181b";
const IVORY = "#f2ebd8";
const BRASS = "#b08d3c";
/** The top of everything on a tile, face or back, so the two have one box. */
export const TILE_TOP = +(TILE.t + 0.00015).toFixed(5);
/** The one tag every tile has, and every place in a rack takes. */
export const TILE_TAGS = Object.freeze(["domino"]);

/** Spots on a 3 × 3 grid, in steps across (x) and along (z) one half of a tile: 0 to 6. */
export const PIPS = Object.freeze({
  0: [],
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
});
const PIP_STEP = 0.0068; // between spots in a half (m)
const PIP_R = 0.0019;

/** Every tile of a double-six set, once: [high, low], 28 of them. */
export function doubleSix() {
  const out = [];
  for (let hi = 0; hi <= 6; hi++) for (let lo = 0; lo <= hi; lo++) out.push([hi, lo]);
  return out;
}

/** The ivory body every tile shares: bevelled top and bottom, as a frustum, a box, a frustum. */
function body() {
  const { w, l, t } = TILE;
  const inset = [w - 2 * BEVEL, l - 2 * BEVEL];
  return [
    { shape: "frustum", bottom: inset, top: [w, l], height: BEVEL, color: IVORY, name: "tile" },
    { shape: "box", size: [w, t - 2 * BEVEL, l], at: [0, BEVEL, 0], color: IVORY, name: "tile" },
    { shape: "frustum", bottom: [w, l], top: inset, height: BEVEL, at: [0, t - BEVEL, 0], color: IVORY, name: "tile" },
  ];
}

const disc = (r, y0, y1, at, color, segments = 14) => ({ shape: "lathe", profile: [[0, y0], [r, y0], [r, y1], [0, y1]], segments, at, color });

/** A tile's face: the bar, the spinner, and `hi` pips in the far half (−z), `lo` in the near (+z). */
function faceParts(hi, lo) {
  const y0 = TILE.t - 0.0001;
  const parts = [
    { shape: "box", size: [TILE.w - 0.007, 0.0002, 0.0011], at: [0, y0, 0], color: INK, name: "bar" },
    disc(0.0016, y0, TILE_TOP, [0, 0, 0], BRASS, 16),
  ];
  for (const [value, z] of [[hi, -TILE.l / 4], [lo, TILE.l / 4]]) {
    for (const [a, b] of PIPS[value]) parts.push({ ...disc(PIP_R, y0, TILE.t + 0.0001, [a * PIP_STEP, 0, z + b * PIP_STEP], INK), name: "pip" });
  }
  return parts;
}

/** What a face-down tile is drawn as, from either side: the body and a plain plate as high as a face's spinner. */
function backTile() {
  return {
    name: "Domino",
    count: 0,
    tags: [...TILE_TAGS],
    parts: [...body(), { shape: "box", size: [TILE.w - 0.006, TILE_TOP - (TILE.t - 0.0001), TILE.l - 0.006], at: [0, TILE.t - 0.0001, 0], color: IVORY, name: "back" }],
    supply: { at: [0, 0], cols: 1, gap: [0, 0] },
  };
}

function faceTile(hi, lo) {
  return {
    name: `Domino ${hi}–${lo}`,
    count: 1,
    hidden: true,
    back: "back",
    deck: "boneyard",
    parts: [...body(), ...faceParts(hi, lo)],
    supply: { at: [0, 0], cols: 1, gap: [0, 0] },
  };
}

/** The felt the line of play is laid on: its edge is where the line turns. */
export const FELT = Object.freeze({ size: 0.74, t: 0.003 });

function felt() {
  const { size, t } = FELT;
  const rim = 0.012;
  return {
    name: "Table",
    count: 1,
    locked: true,
    parts: [
      { shape: "box", size: [size, t, size], color: "#244c3a", name: "felt" },
      // a darker band round the edge, so the edge reads from any seat
      ...[[0, size / 2 - rim / 2, size, rim], [0, -size / 2 + rim / 2, size, rim], [size / 2 - rim / 2, 0, rim, size - 2 * rim], [-size / 2 + rim / 2, 0, rim, size - 2 * rim]].map(([x, z, w, d]) => ({
        shape: "box",
        size: [w, 0.0002, d],
        at: [x, t, z],
        color: "#183528",
        name: "edge",
      })),
    ],
    supply: { at: [0, 0], cols: 1, gap: [0, 0] },
  };
}

/** A rack's size and its two rows of places: the front row on its base, the back row on a step behind it. */
export const RACK = Object.freeze({ w: 0.62, d: 0.07, base: 0.003, step: 0.019, places: 11, pitch: 0.054, front: 0.016, back: -0.022 });
/**
 * Standing on edge, facing the rack's +Z (its player): the tile's face (+Y)
 * turned to +Z, its length (+Z) along the rack (+X). Euler XYZ: a quarter
 * turn about Y, then a quarter about X.
 */
export const STANDING = Object.freeze([Math.PI / 2, Math.PI / 2, 0]);

/**
 * A player's place: a low rack whose +Z faces them, with two rows of 11
 * places where a tile stands on edge facing them (22: more than anyone holds
 * in a two-player game, 21). It is that seat's hand (a zone): what is in it
 * is turned toward its player and screened from the rest.
 */
function rack(seat, n, side) {
  const { w, d, base, step, places, pitch, front, back } = RACK;
  const x0 = -((places - 1) / 2) * pitch;
  const snapPoints = [];
  for (const [z, y] of [[front, base], [back, step]]) {
    for (let k = 0; k < places; k++) snapPoints.push({ position: [+(x0 + k * pitch).toFixed(4), y, z], rotation: [...STANDING], tags: [...TILE_TAGS] });
  }
  return {
    name: `Player ${n}'s rack`,
    count: 1,
    locked: true,
    zone: { seat, min: [-w / 2, 0, -d / 2], max: [w / 2, 0.1, d / 2] },
    parts: [
      { shape: "box", size: [w, base, d], color: "#7a5434", name: "rack" },
      { shape: "box", size: [w, step - base, 0.026], at: [0, base, back], color: "#8b6340", name: "step" },
    ],
    snapPoints,
    snapRadius: 0.02,
    supply: { at: [side.at[0], side.at[1]], cols: 1, gap: [0, 0], yaw: side.yaw },
  };
}

/** Where the racks go: one to a side of the felt, each turned so its +Z faces out to its player. */
const OUT = FELT.size / 2 + 0.015 + RACK.d / 2;
const SIDES = {
  south: { at: [0, OUT], yaw: 0 },
  west: { at: [-OUT, 0], yaw: -Math.PI / 2 },
  north: { at: [0, -OUT], yaw: Math.PI },
  east: { at: [OUT, 0], yaw: Math.PI / 2 },
};
/** Which sides are taken, by how many play: two face each other; three leave the boneyard's side (north) open. */
export const SEATING = Object.freeze({ 2: ["south", "north"], 3: ["south", "west", "east"], 4: ["south", "west", "north", "east"] });

/** A seat's view: from behind its rack, looking over it at the middle of the felt. */
function seatCamera(side) {
  const { at } = SIDES[side];
  const len = Math.hypot(at[0], at[1]);
  const u = [at[0] / len, at[1] / len];
  const r = (v) => +v.toFixed(4);
  return { position: [r(u[0] * 0.86), 0.5, r(u[1] * 0.86)], target: [r(u[0] * 0.18), 0, r(u[1] * 0.18)] };
}

/** Where the boneyard is laid out (the middle of a 7 × 4 jumble), and its cells (m). */
export const BONEYARD = Object.freeze({ at: [0, -0.17], cols: 7, cell: 0.06 });

export const ABOUT = `Draw Dominoes — 2 to 4 players, one double-six set: 28 tiles, each end showing 0 to 6 spots.

Wash the tiles: hover one in the boneyard (the face-down tiles) and press W, which mixes them where they lie, so nobody knows which is which. Each player then draws 7 tiles (6 each with four players): hover a boneyard tile and press D, and it stands on edge in your rack, facing you. Only you see its face; the others see its back.

The player with the highest double sets it down, and play goes round the table. On your turn, play one tile face up onto an open end of the line, its matching end against it: carry it there with the hand, Q and E turn it (twice for a quarter turn), and a double goes crosswise. Where the line reaches the edge of the felt, turn it. If you can't play, or would rather not, draw from the boneyard (D) — as many as you like, one at a time; once the boneyard is empty, a player who can't play passes.

A hand ends when someone plays their last tile (they win it), or when nobody can play (the lowest count of spots in hand wins it). Players then lay their hands face up for everyone to count (right-click a tile of yours → Lay my hand face up), and anything left in the boneyard can be turned over (F). The winner scores the spots in the others' hands. In the block game, nobody draws once the hands are taken.

In this scene: pick your seat at the top right. Once every seat is taken, your clients shuffle the tiles between them (a few seconds) so that no one, not even whoever washes, knows which face-down tile is which. A tile in your rack shows its face to you once the others' clients have handed over its key, so play with everyone at the table. U stands a tile on edge facing you, in your rack or on the table in front of you (as when playing without a rack: only you see its face), or lays one flat. F turns a tile over; a tile turned over by accident is just a tile.`;

/**
 * Draw Dominoes for `players` (2, 3 or 4) as a game module: `fill(d)` writes
 * it into an empty tabletop-game (inside a change).
 */
export function dominoes(players) {
  const sides = SEATING[players];
  if (!sides) throw new Error(`Draw Dominoes is for 2, 3 or 4 players, not ${players}`);
  return {
    players,
    fill(d) {
      const pieces = { table: felt() };
      sides.forEach((side, i) => (pieces[`rack${i + 1}`] = rack(`p${i + 1}`, i + 1, SIDES[side])));
      pieces.back = backTile();
      for (const [hi, lo] of doubleSix()) pieces[`tile-${hi}-${lo}`] = faceTile(hi, lo);
      d.title = `Draw Dominoes (${players} players)`;
      d.about = ABOUT;
      d.pieces = {};
      for (const [k, p] of Object.entries(pieces)) d.pieces[k] = { ...p, glbUrl: null, glbKey: null };
      d.order = Object.keys(pieces);
      d.seats = {};
      sides.forEach((side, i) => (d.seats[`p${i + 1}`] = { name: `Player ${i + 1}`, camera: seatCamera(side) }));
      // face down and jumbled where it lies: what washing leaves (the players' first shuffle decides which is which)
      d.decks = { boneyard: { name: "Boneyard", at: [...BONEYARD.at], faceDown: true, secure: true, spread: { cols: BONEYARD.cols, cell: BONEYARD.cell } } };
      d.camera = { position: [0, 0.95, 0.75], target: [0, 0, 0] };
      if (!d.tables) d.tables = [];
    },
  };
}

export const two = dominoes(2);
export const three = dominoes(3);
export const four = dominoes(4);
