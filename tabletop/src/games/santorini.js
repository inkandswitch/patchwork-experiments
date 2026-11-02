// Santorini (Gordon Hamilton, 2004; Roxley edition 2016) as a tabletop-game:
// the island board, the three building levels, domes, and workers for three
// players. Perfect information, no hidden state. Only the components and
// where they start; the rules are a summary for the players, not enforced.
// God powers (face-up cards) are not modelled yet.

const PITCH = 0.06; // centre to centre of the board's spaces
const TILE_TOP = 0.04; // height of a space's surface above the table

const WHITE = "#f1ede3";
const DARK = "#3b3f4a";
const DOME = "#234a9c";

export const ABOUT = `Santorini — 2–3 players. Take turns; on your turn, move one of your two workers, then build with that same worker.

Move: one space in any direction (diagonals too) onto an unoccupied space without a dome. A worker can climb at most one level up, and can step down any number of levels.

Build: on any unoccupied space next to the worker that moved — a level 1 block on bare ground, level 2 on level 1, level 3 on level 2, or a dome on level 3. A domed space is closed for good.

Win by moving one of your workers up onto level 3. If you cannot move and build on your turn, you lose.

Setup: the youngest player places both their workers first, then the others in turn. In this scene, use the hand (H) to carry pieces; they snap to the board's spaces and stack on whatever is already there. Hold Alt to put a piece down without snapping, Q / E to turn it.`;

function board() {
  const tiles = [];
  const snapPoints = [];
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const x = +(i * PITCH).toFixed(4);
      const z = +(j * PITCH).toFixed(4);
      tiles.push({ shape: "box", size: [0.054, 0.002, 0.054], at: [x, TILE_TOP - 0.002, z], color: "#9cc46f" });
      snapPoints.push([x, TILE_TOP, z]);
    }
  }
  return {
    name: "Island board",
    count: 1,
    locked: true,
    parts: [
      { shape: "lathe", profile: [[0, 0], [0.27, 0], [0.27, 0.004], [0, 0.004]], segments: 64, color: "#4f8fbf", name: "sea" },
      { shape: "frustum", bottom: [0.36, 0.36], top: [0.32, 0.32], height: 0.034, color: "#c8b38a", name: "cliffs" },
      { shape: "box", size: [0.32, 0.004, 0.32], at: [0, 0.034, 0], color: "#78a656", name: "grass" },
      ...tiles,
    ],
    snapPoints,
    supply: { at: [0, 0], cols: 1, gap: [0, 0] },
  };
}

/** Four of something, one centred on each side of a square of half-width `h`, at height `y`. */
function onEachSide(h, y, size, color) {
  const [w, hh] = size;
  const t = 0.001;
  return [
    { shape: "box", size: [w, hh, t], at: [0, y, h], color },
    { shape: "box", size: [w, hh, t], at: [0, y, -h], color },
    { shape: "box", size: [t, hh, w], at: [h, y, 0], color },
    { shape: "box", size: [t, hh, w], at: [-h, y, 0], color },
  ];
}

function level1() {
  return {
    name: "Level 1",
    count: 22,
    parts: [{ shape: "box", size: [0.052, 0.032, 0.052], color: WHITE }, ...onEachSide(0.026, 0, [0.012, 0.018], DARK)],
    supply: { at: [0.3, -0.15], cols: 4, gap: [0.056, 0.056] },
  };
}

function level2() {
  const windows = [];
  for (const dx of [-0.01, 0.01]) {
    for (const side of onEachSide(0.022, 0.012, [0.007, 0.008], DARK)) {
      const at = [...side.at];
      if (side.size[0] > side.size[2]) at[0] += dx;
      else at[2] += dx;
      windows.push({ ...side, at });
    }
  }
  return {
    name: "Level 2",
    count: 18,
    parts: [{ shape: "box", size: [0.044, 0.026, 0.044], color: WHITE }, ...windows],
    supply: { at: [-0.3, -0.12], cols: 4, gap: [-0.05, 0.05] },
  };
}

function level3() {
  return {
    name: "Level 3",
    count: 14,
    parts: [
      { shape: "lathe", profile: [[0, 0], [0.02, 0], [0.02, 0.019], [0, 0.019]], segments: 40, color: WHITE },
      { shape: "lathe", profile: [[0, 0.019], [0.0215, 0.019], [0.0215, 0.022], [0, 0.022]], segments: 40, color: "#d9d3c4", name: "cornice" },
    ],
    supply: { at: [-0.138, -0.31], cols: 7, gap: [0.046, -0.046] },
  };
}

function dome() {
  const profile = [[0, 0], [0.0175, 0]];
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * (Math.PI / 2);
    profile.push([+(0.0165 * Math.cos(a)).toFixed(5), +(0.002 + 0.0165 * Math.sin(a)).toFixed(5)]);
  }
  return {
    name: "Dome",
    count: 18,
    parts: [{ shape: "lathe", profile, segments: 40, color: DOME }],
    supply: { at: [-0.16, -0.4], cols: 9, gap: [0.04, -0.04] },
  };
}

function workerProfile() {
  const profile = [[0, 0], [0.009, 0], [0.009, 0.003], [0.006, 0.005], [0.0045, 0.018], [0.0065, 0.0195], [0.0065, 0.021], [0.003, 0.022]];
  // the head: most of a sphere of radius 0.0045 centred at y = 0.0262
  for (let k = 1; k <= 8; k++) {
    const a = -Math.PI / 3 + (k / 8) * (Math.PI / 2 + Math.PI / 3);
    profile.push([+(0.0045 * Math.cos(a)).toFixed(5), +(0.0262 + 0.0045 * Math.sin(a)).toFixed(5)]);
  }
  return profile;
}

function worker(name, color, at) {
  return {
    name: `${name} worker`,
    count: 2,
    parts: [{ shape: "lathe", profile: workerProfile(), segments: 32, color }],
    supply: { at, cols: 2, gap: [0.04, 0] },
  };
}

/** The game's pieces, in the order they're listed (and set up). */
export function santoriniPieces() {
  return {
    board: board(),
    level1: level1(),
    level2: level2(),
    level3: level3(),
    dome: dome(),
    blue: worker("Blue", "#3a78d8", [-0.02, 0.31]),
    cream: worker("Cream", "#efe3c2", [-0.36, 0.2]),
    grey: worker("Grey", "#7d838d", [0.34, 0.24]),
  };
}

/** Fill a tabletop-game doc (inside a change) with Santorini. */
export function fill(d) {
  const pieces = santoriniPieces();
  d.title = "Santorini";
  d.about = ABOUT;
  d.pieces = {};
  for (const [k, p] of Object.entries(pieces)) d.pieces[k] = { ...p, glbUrl: null, glbKey: null };
  d.order = Object.keys(pieces);
  delete d.seats;
  delete d.decks;
  delete d.camera;
  if (!d.tables) d.tables = [];
}
