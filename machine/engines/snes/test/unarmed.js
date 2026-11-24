// Scripted pads for Unarmed (verzonken, SNESDEV 2025; https://github.com/stuij/unarmed):
// one script that reaches a two-player round and one that reaches a
// four-player round, both from power-on. Frames are steps from boot.
//
// A press is [frame, pad, buttons, frames held]. Buttons are the engine's
// 16-bit pad report (engines/snes/src/machine.cpp).
export const B = 0x1, Y = 0x2, SELECT = 0x4, START = 0x8;
export const UP = 0x10, DOWN = 0x20, LEFT = 0x40, RIGHT = 0x80;
export const A = 0x100, X = 0x200, L = 0x400, R = 0x800;

// Title, lore, controls: Start on each brings up the match menu, cursor on
// "start match", two players selected.
const TO_MENU = [
  [240, 0, START, 4],
  [420, 0, START, 4],
  [600, 0, START, 4],
];

// "start match"; the gladiators are out by frame 1000. Pad 0 (yellow) walks
// right and shoots up, then jumps; pad 1 (green) walks left and shoots left.
export const TWO_PLAYERS = [
  ...TO_MENU,
  [780, 0, A, 4],
  [1000, 0, RIGHT, 80],
  [1000, 1, LEFT, 80],
  [1100, 0, X, 60],
  [1100, 1, Y, 60],
  [1180, 0, R, 6],
];

// Down to "players", choose 4, up to "start match", start; the gladiators
// are out by frame 1200. Each pad then does something different: yellow
// right then shoots up, green left then shoots left, pink right, jumps, then
// shoots right, blue left (off its ledge), shoots down, parries.
export const FOUR_PLAYERS = [
  ...TO_MENU,
  [780, 0, DOWN, 4],
  [800, 0, DOWN, 4],
  [820, 0, A, 4],
  [840, 0, RIGHT, 4],
  [860, 0, RIGHT, 4],
  [880, 0, A, 4],
  [900, 0, UP, 4],
  [920, 0, UP, 4],
  [1010, 0, A, 4],
  [1200, 0, RIGHT, 80],
  [1200, 1, LEFT, 80],
  [1200, 2, RIGHT, 80],
  [1200, 3, LEFT, 80],
  [1300, 0, X, 40],
  [1300, 1, Y, 40],
  [1300, 2, R, 6],
  [1300, 3, B, 40],
  [1360, 2, A, 40],
  [1360, 3, L, 6],
];

/** The engine's input for one step: five pads, two bytes each, little-endian. */
export function pads(script, frame) {
  const input = new Uint8Array(10);
  for (const [start, pad, buttons, held] of script)
    if (frame >= start && frame < start + held) {
      input[pad * 2] |= buttons & 0xff;
      input[pad * 2 + 1] |= buttons >> 8;
    }
  return input;
}
