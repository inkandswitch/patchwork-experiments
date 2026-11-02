// Lost Cities (Reiner Knizia, 1999) as a tabletop-game: 60 cards in five
// expeditions, a board with a discard pile for each, and a hand tray for each
// of the two players. Hidden information: the deck is face down and shuffled,
// and each hand is seen only by whoever sits in its seat. Only the components
// and where they start; the rules are a summary for the players.

import { numberParts } from "../glyphs.js";

const CARD = { w: 0.056, l: 0.087, t: 0.0008 };
const TOP = CARD.t + 0.0004; // a card's height, face or back: everything sits on y = 0..TOP
const CREAM = "#efe8d6";
const BACK = "#6b3e26";
const GOLD = "#c9a24a";

export const EXPEDITIONS = [
  { key: "yellow", name: "Yellow", color: "#e3b23c", ink: "#2a2418" },
  { key: "blue", name: "Blue", color: "#2f6db5", ink: "#f4f1ea" },
  { key: "white", name: "White", color: "#f7f6f2", ink: "#2a2a2c" },
  { key: "green", name: "Green", color: "#3f8f4a", ink: "#f4f1ea" },
  { key: "red", name: "Red", color: "#c4452f", ink: "#f4f1ea" },
];

const COLUMN_X = (i) => +((i - 2) * 0.085).toFixed(4);
const SLOT_GAP = 0.022; // cards in an expedition overlap, each showing its corner
const HAND_Z = 0.5;

export const ABOUT = `Lost Cities — 2 players. 60 cards in five expeditions (yellow, blue, white, green, red): each has three wager cards and one each of 2 to 10. Each player starts with 8 cards.

On your turn, play one card from your hand, then draw one.

Play it onto your own expedition of that colour (the column on your side of the board), higher than the last card there — wagers only before any number — or face up onto that colour's discard pile on the board.

Draw the top card of the deck, or the top card of any discard pile except the one you just discarded to.

The game ends when the last card of the deck is drawn. Each expedition you started scores the sum of its numbers minus 20, times one more than the number of wagers in it; one with 8 or more cards scores 20 more. Expeditions you never started score nothing.

In this scene: choose your seat in the top bar. Once both players are seated, your two clients shuffle the deck between them (a few seconds) so that neither of you knows its order. Your hand is the tray at your edge, and only you see its faces; a card's face appears for you once the other player's client has handed over its key, so play with both of you at the table. Carry the top card of the deck to your tray to draw it. A card played face up is seen by everyone. F flips a card while you carry it.`;

/** The underside every card shares: a back panel with a gold diamond. */
const underside = () => [
  { shape: "lathe", profile: [[0, 0], [0.018, 0], [0.018, 0.0001], [0, 0.0001]], segments: 4, color: GOLD, name: "diamond" },
  { shape: "box", size: [CARD.w - 0.004, 0.0002, CARD.l - 0.004], at: [0, 0.0001, 0], color: BACK, name: "back" },
  { shape: "box", size: [CARD.w, CARD.t - 0.0003, CARD.l], at: [0, 0.0003, 0], color: CREAM, name: "card" },
];

/** A card seen from either side: what hidden cards look like. */
function backCard() {
  return {
    name: "Card",
    count: 0,
    parts: [
      ...underside(),
      { shape: "box", size: [CARD.w - 0.004, 0.0002, CARD.l - 0.004], at: [0, CARD.t, 0], color: BACK },
      { shape: "lathe", profile: [[0, CARD.t + 0.0002], [0.018, CARD.t + 0.0002], [0.018, TOP], [0, TOP]], segments: 4, color: GOLD },
    ],
    supply: { at: [0, 0], cols: 1, gap: [0, 0] },
  };
}

function faceCard(ex, value) {
  const face = { shape: "box", size: [CARD.w - 0.006, 0.0002, CARD.l - 0.006], at: [0, CARD.t, 0], color: ex.color, name: ex.key };
  const y = CARD.t + 0.0002;
  const corner = [-CARD.w / 2 + 0.014, y, -CARD.l / 2 + 0.012];
  const marks =
    value === "wager"
      ? [
          // a coin with a rim (not a ring, which reads as a zero), and a small coin in the corner
          { shape: "lathe", profile: [[0, y], [0.009, y], [0.009, TOP], [0, TOP]], segments: 28, at: [0, 0, 0.004], color: ex.ink },
          { shape: "lathe", profile: [[0.0115, y], [0.0135, y], [0.0135, TOP], [0.0115, TOP], [0.0115, y]], segments: 28, at: [0, 0, 0.004], color: ex.ink },
          { shape: "lathe", profile: [[0, y], [0.004, y], [0.004, TOP], [0, TOP]], segments: 16, at: [corner[0], 0, corner[2]], color: ex.ink },
        ]
      : [
          ...numberParts(value, { at: [0, y, 0.004], height: 0.032, color: ex.ink }),
          ...numberParts(value, { at: corner, height: 0.011, color: ex.ink }),
        ];
  return {
    name: `${ex.name} ${value === "wager" ? "wager" : value}`,
    count: value === "wager" ? 3 : 1,
    hidden: true,
    back: "back",
    deck: "main",
    parts: [...underside(), face, ...marks],
    supply: { at: [0, 0], cols: 1, gap: [0, 0] },
  };
}

function board() {
  const parts = [{ shape: "box", size: [0.46, 0.004, 0.12], color: "#d9c9a3", name: "board" }];
  const snapPoints = [];
  EXPEDITIONS.forEach((ex, i) => {
    const x = COLUMN_X(i);
    parts.push({ shape: "box", size: [0.064, 0.0004, 0.095], at: [x, 0.004, 0], color: ex.color });
    snapPoints.push({ position: [x, 0.0044, 0] }); // the discard pile: cards keep the way they face
    for (let k = 0; k < 12; k++) {
      const z = +(0.11 + k * SLOT_GAP).toFixed(4);
      snapPoints.push({ position: [x, 0, z], yaw: 0 }, { position: [x, 0, -z], yaw: Math.PI });
    }
  });
  snapPoints.push({ position: [0.3, 0, 0] }); // the deck
  return { name: "Board", count: 1, locked: true, parts, snapPoints, snapRadius: 0.03, supply: { at: [0, 0], cols: 1, gap: [0, 0] } };
}

function hand(seat, n, z, yaw) {
  const snapPoints = [];
  for (let k = 0; k < 10; k++) snapPoints.push({ position: [+(-0.27 + k * 0.06).toFixed(3), 0.002, 0], yaw });
  return {
    name: `Player ${n}'s hand`,
    count: 1,
    locked: true,
    zone: { seat, min: [-0.32, 0, -0.065], max: [0.32, 0.15, 0.065] },
    parts: [{ shape: "box", size: [0.64, 0.002, 0.12], color: "#2f4a3a" }],
    snapPoints,
    supply: { at: [0, z], cols: 1, gap: [0, 0] },
  };
}

export function lostCitiesPieces() {
  const pieces = { board: board(), hand1: hand("p1", 1, HAND_Z, 0), hand2: hand("p2", 2, -HAND_Z, Math.PI), back: backCard() };
  for (const ex of EXPEDITIONS) {
    pieces[`${ex.key}-wager`] = faceCard(ex, "wager");
    for (let v = 2; v <= 10; v++) pieces[`${ex.key}-${v}`] = faceCard(ex, v);
  }
  return pieces;
}

/** Fill a tabletop-game doc (inside a change) with Lost Cities. */
export function fill(d) {
  const pieces = lostCitiesPieces();
  d.title = "Lost Cities";
  d.about = ABOUT;
  d.pieces = {};
  for (const [k, p] of Object.entries(pieces)) d.pieces[k] = { ...p, glbUrl: null, glbKey: null };
  d.order = Object.keys(pieces);
  d.seats = {
    p1: { name: "Player 1", camera: { position: [0, 0.5, 0.95], target: [0, 0, 0.16] } },
    p2: { name: "Player 2", camera: { position: [0, 0.5, -0.95], target: [0, 0, -0.16] } },
  };
  d.decks = {
    main: { name: "Deck", at: [0.3, 0], yaw: 0, faceDown: true, secure: true, deal: [{ to: "hand1", count: 8 }, { to: "hand2", count: 8 }] },
  };
  d.camera = { position: [0.95, 0.7, 0], target: [0, 0, 0] };
  if (!d.tables) d.tables = [];
}
