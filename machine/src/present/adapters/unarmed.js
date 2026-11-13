// Unarmed (verzonken, SNESDEV 2025; GPL; https://github.com/stuij/unarmed),
// read out of the Super NES's work RAM: the engine's query 0 (ENGINE.md, "What
// each engine answers to query"), 131,072 bytes from $7E0000. The console
// knows nothing of the game; this is the game's adapter, as a speedrun timer
// is: where its variables live, from its source.
//
// Source: stuij/unarmed 664d40d (2025-09-06). Its linker config puts BSS at
// $0100 (lorom256.cfg), and src/data.inc's BSS starts with the four players
// (data.inc:62-65), each a `player` struct of $50 bytes (defines.inc:240-276,
// its first $1e bytes a `sprite`, defines.inc:145-165), then (aligned to 16,
// which $0240 already is) wins, matches, hp and game_data (data.inc:69-73;
// defines.inc:475-510). After the bullets comes OAM_mirror ($220 bytes) and
// then current_coll_map (data.inc:119-121), at $0A10 in this build: found by
// matching OAM_mirror against the PPU's OAM, then checked against the map
// (unarmed.test.js). Port n's pad drives player n.
//
//   sprite::x_pos, y_pos   $02, $0A: 12.4 fixed point, pixels from the
//                          screen's top left, the sprite's top left corner;
//                          the game draws the head at (x >> 4, y >> 4) and
//                          the body 8 below (finalize_players, player.inc)
//   sprite::move_state     $16: idle run jump cling climb hit recoil dead
//   sprite::face_dir       $18: the way it aims (defines.inc:126-136)
//   player::nr             $40
//   hp                     $0250, a word per player: alive is hp != 0, the
//                          game's own test (check_win, main_loop.inc:63-80)
//   game_data::no_players  $0258, twice the number of players
//   game_data::in_game     $026C: 1 while a round is on
//   current_coll_map       $0A10: 32 x 28 tiles of 8 pixels, a byte of
//                          tile_props each (defines.inc:96-103)

export const ADDRESS = {
  players: 0x0100,
  stride: 0x50,
  hp: 0x0250,
  noPlayers: 0x0258,
  inGame: 0x026c,
  collision: 0x0a10,
};

/** Offsets within a player struct. */
export const PLAYER = { x: 0x02, y: 0x0a, moveState: 0x16, faceDir: 0x18, nr: 0x40 };

export const MOVE_STATES = ["idle", "run", "jump", "cling", "climb", "hit", "recoil", "dead"];

/**
 * face_dir (defines.inc:126-136) as a direction: its name, and its angle in
 * radians counterclockwise from the screen's right with up positive (so the
 * screen's y, which grows downward, is negated).
 */
export const FACING = {
  0x0: { name: "top_left", angle: (3 * Math.PI) / 4 },
  0x2: { name: "bottom_left", angle: (5 * Math.PI) / 4 },
  0x4: { name: "top_right", angle: Math.PI / 4 },
  0x6: { name: "bottom_right", angle: (7 * Math.PI) / 4 },
  0x8: { name: "left", angle: Math.PI },
  0xa: { name: "top", angle: Math.PI / 2 },
  0xc: { name: "bottom", angle: (3 * Math.PI) / 2 },
  0xe: { name: "right", angle: 0 },
};

/** tile_props (defines.inc:96-103). */
export const TILE = { wall: 0x1, bounce: 0x2, destructable: 0x4, kill: 0x8, explode: 0x10, outOfBounds: 0x80 };

const COLUMNS = 32;
const ROWS = 28;
const TILE_PX = 8;
/** A player's sprite: a head and a body, each 8 by 8. */
export const PLAYER_SIZE = { width: 8, height: 16 };

const word = (w, a) => w[a] | (w[a + 1] << 8);

/**
 * The game as it stands, from WRAM (engine.query(0)):
 *   { inGame, players: [{ port, x, y, facing, facingName, alive, hp, state }], arena }
 * players: the ones in this match (port 0 .. n-1), x and y in pixels (the
 * sprite's top left, fractions are its sub-pixels), facing in radians as
 * FACING has it. Outside a round (title, menus) there are no players.
 * arena: the current map's extent in pixels, the bounding box of its
 * non-empty tiles, { left, top, right, bottom, width, height }, and its tiles
 * ({ columns, rows, size, props }: props a copy of the collision map).
 */
export function unarmed(wram) {
  if (!wram || wram.length < 0x2000) throw new Error("unarmed: needs the work RAM (query 0)");
  const inGame = word(wram, ADDRESS.inGame) === 1;
  const n = word(wram, ADDRESS.noPlayers) >> 1;
  const players = [];
  if (inGame && n >= 1 && n <= 4)
    for (let port = 0; port < n; port++) {
      const at = ADDRESS.players + port * ADDRESS.stride;
      const dir = FACING[word(wram, at + PLAYER.faceDir)];
      const hp = word(wram, ADDRESS.hp + 2 * port);
      players.push({
        port,
        x: word(wram, at + PLAYER.x) / 16,
        y: word(wram, at + PLAYER.y) / 16,
        facing: dir ? dir.angle : null,
        facingName: dir ? dir.name : null,
        alive: hp !== 0,
        hp,
        state: MOVE_STATES[word(wram, at + PLAYER.moveState)] ?? null,
      });
    }
  return { inGame, players, arena: arena(wram) };
}

/** The collision map's extent and tiles (see unarmed()). */
export function arena(wram) {
  const props = wram.slice(ADDRESS.collision, ADDRESS.collision + COLUMNS * ROWS);
  let [c0, r0, c1, r1] = [COLUMNS, ROWS, -1, -1];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLUMNS; c++)
      if (props[r * COLUMNS + c]) {
        c0 = Math.min(c0, c);
        c1 = Math.max(c1, c);
        r0 = Math.min(r0, r);
        r1 = Math.max(r1, r);
      }
  const tiles = { columns: COLUMNS, rows: ROWS, size: TILE_PX, props };
  if (c1 < 0) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, tiles };
  const [left, top, right, bottom] = [c0 * TILE_PX, r0 * TILE_PX, (c1 + 1) * TILE_PX, (r1 + 1) * TILE_PX];
  return { left, top, right, bottom, width: right - left, height: bottom - top, tiles };
}
