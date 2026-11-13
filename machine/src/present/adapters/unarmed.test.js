// The Unarmed adapter, checked frame by frame against the scripted two- and
// four-player runs (engines/snes/test/unarmed.js): every player's position
// against where the game then draws it (the PPU's OAM, a frame later, as the
// NMI copies it), every facing against the buttons the script holds, the
// players and the round against the menus the script goes through, and the
// arena against the map's walls. All finite: the scripts are fixed. The
// four-player run is the default tier; test:full adds the two-player one.
import { readFileSync } from "node:fs";
import { compile } from "../../engine.js";
import { FULL } from "../../test-tier.js";
import { A, B, FOUR_PLAYERS, TWO_PLAYERS, X, Y, pads } from "../../../engines/snes/test/unarmed.js";
import { ADDRESS, FACING, TILE, unarmed } from "./unarmed.js";

const wasm = readFileSync(new URL("../../../engines/snes/dist/snes.wasm", import.meta.url));
const rom = new Uint8Array(readFileSync(new URL("../../../engines/snes/test/unarmed.sfc", import.meta.url)));
const machine = await compile(wasm);

/**
 * Runs a script from power-on for `frames` steps; each(f, read, oam) after
 * step f (1-based: the state after f steps).
 */
function run(script, frames, each) {
  const e = machine.boot(rom);
  for (let f = 1; f <= frames; f++) {
    e.step(pads(script, f - 1));
    each(f, unarmed(e.query(0)), e.query(2));
  }
}

/** Where the PPU's OAM has sprite i: [x (9 bits, with the high table's bit), y]. */
const sprite = (oam, i) => [oam[4 * i] | (((oam[512 + (i >> 2)] >> ((i & 3) * 2)) & 1) << 8), oam[4 * i + 1]];
// The players' sprites (defines.inc:60-71): the caret's 8 entries, the bullets' 16, then 4 heads and 4 bodies.
const HEAD = 24;
const BODY = 28;

/** The facing the buttons ask for (set_best_keys, player.inc:1505-1543; set_player_direction's order, player.inc:1197-1260), or null. */
function asked(buttons) {
  const all = (m) => (buttons & m) === m;
  if (all(X | Y)) return "top_left";
  if (all(B | Y)) return "bottom_left";
  if (all(X | A)) return "top_right";
  if (all(B | A)) return "bottom_right";
  if (buttons & Y) return "left";
  if (buttons & X) return "top";
  if (buttons & B) return "bottom";
  if (buttons & A) return "right";
  return null;
}
const held = (script, port, f) => {
  const p = pads(script, f);
  return p[port * 2] | (p[port * 2 + 1] << 8);
};

/**
 * The round's map, every frame of it: its walled extent; row 1 and the
 * outer columns walls, the bottom two rows killing; every player within
 * its walls.
 */
function arenaHolds({ arena: a, players }) {
  expect([a.left, a.top, a.right, a.bottom, a.width, a.height]).toEqual([0, 8, 256, 224, 256, 216]);
  const { columns, rows, size, props } = a.tiles;
  expect([columns, rows, size, props.length]).toEqual([32, 28, 8, 896]);
  for (let c = 0; c < 32; c++) if (!(props[32 + c] & TILE.wall)) throw new Error(`row 1, column ${c}: no wall`);
  for (let r = 1; r < 28; r++) if (!(props[r * 32] & props[r * 32 + 31] & TILE.wall)) throw new Error(`row ${r}: no side walls`);
  for (let c = 1; c < 31; c++) if (!(props[26 * 32 + c] & props[27 * 32 + c] & TILE.kill)) throw new Error(`column ${c}: the floor does not kill`);
  for (const p of players) {
    expect(p.x).toBeGreaterThanOrEqual(a.left);
    expect(p.x + 8).toBeLessThanOrEqual(a.right);
    expect(p.y).toBeGreaterThanOrEqual(a.top);
    // A player who falls into the killing rows sinks on, out of the map,
    // until the game's out-of-bounds line (OUT_OF_BOUNDS_Y, $f7f: defines.inc:115)
    // puts them back at a start (the four-player run's blue does, frames 1318-1345).
    expect(p.y).toBeLessThan(0xf7f / 16);
  }
}

const RUNS = {
  "two players": { script: TWO_PLAYERS, players: 2, frames: 1300 },
  "four players": { script: FOUR_PLAYERS, players: 4, frames: 1530 },
};

describe.each(FULL ? Object.keys(RUNS) : ["four players"])("Unarmed, %s, every frame", (name) => {
  const { script, players: n, frames } = RUNS[name];

  test("positions are where the game draws its players, facings what the buttons asked, the round, its players and its arena as the script plays them", () => {
    let prev = null;
    let rounds = 0;
    let checked = 0;
    let turned = 0;
    let start = null;
    const facing = Array(n).fill("right"); // init_players (player.inc:294)
    run(script, frames, (f, now, oam) => {
      // The round begins once and stays; with it come exactly the script's players, in port order.
      if (now.inGame && !prev?.inGame) {
        rounds++;
        start = f;
      }
      if (now.inGame) {
        expect(now.players.map((p) => p.port)).toEqual([...Array(n).keys()]);
        arenaHolds(now);
      } else expect(now.players).toEqual([]);
      // What was read after step f - 1 is drawn after step f: head at (x, y), body 8 below.
      if (prev?.inGame && now.inGame)
        for (const p of prev.players) {
          const want = [Math.floor(p.x) & 0x1ff, Math.floor(p.y) & 0xff];
          expect([f, p.port, sprite(oam, HEAD + p.port)]).toEqual([f, p.port, want]);
          expect([f, p.port, sprite(oam, BODY + p.port)]).toEqual([f, p.port, [want[0], (want[1] + 8) & 0xff]]);
          checked++;
        }
      // Facing follows the buttons held in the step just taken, and is kept when none are.
      if (now.inGame)
        for (const p of now.players) {
          if (["hit", "recoil", "dead"].includes(p.state)) {
            facing[p.port] = p.facingName; // a hit player is not steering
            continue;
          }
          const a = asked(held(script, p.port, f - 1));
          if (a && a !== facing[p.port]) turned++;
          if (a) facing[p.port] = a;
          expect([f, p.port, p.facingName]).toEqual([f, p.port, facing[p.port]]);
          expect(p.facing).toBe(Object.values(FACING).find((d) => d.name === p.facingName).angle);
          expect(p.alive).toBe(p.hp !== 0);
        }
      prev = now;
    });
    expect(rounds).toBe(1);
    expect({ start, checked, turned }).toEqual(RUNS_SEEN[name]);
  });
});

// What the runs come to: the frame the round starts, the positions checked
// against the OAM (each player, each frame after the round's first: 427 x 2
// and 427 x 4), and the turns the scripts make (2p: yellow aims up, green
// left; 4p: those, and blue down; pink's A asks for right, which it faces).
const RUNS_SEEN = {
  "two players": { start: 873, checked: 854, turned: 2 },
  "four players": { start: 1103, checked: 1708, turned: 3 },
};

describe("the decoding", () => {
  test("decodes what it is given: alive is hp, a facing it does not know is null, no round no players", () => {
    const w = new Uint8Array(0x20000);
    const put = (a, v) => ((w[a] = v & 0xff), (w[a + 1] = v >> 8));
    expect(unarmed(w)).toMatchObject({ inGame: false, players: [], arena: { width: 0, height: 0 } });
    put(ADDRESS.inGame, 1);
    put(ADDRESS.noPlayers, 6); // three players
    for (let p = 0; p < 3; p++) {
      const at = ADDRESS.players + p * ADDRESS.stride;
      put(at + 0x02, 0x280 + p * 16 + 8); // x 40.5 + p
      put(at + 0x0a, 0x2a0);
      put(at + 0x16, p === 2 ? 7 : 0);
      put(at + 0x18, [0xe, 0xa, 0x3][p]);
      put(ADDRESS.hp + 2 * p, p === 2 ? 0 : 4);
    }
    const { players } = unarmed(w);
    expect(players).toEqual([
      { port: 0, x: 40.5, y: 42, facing: 0, facingName: "right", alive: true, hp: 4, state: "idle" },
      { port: 1, x: 41.5, y: 42, facing: Math.PI / 2, facingName: "top", alive: true, hp: 4, state: "idle" },
      { port: 2, x: 42.5, y: 42, facing: null, facingName: null, alive: false, hp: 0, state: "dead" },
    ]);
    expect(() => unarmed(new Uint8Array(16))).toThrow("needs the work RAM");
  });
});
